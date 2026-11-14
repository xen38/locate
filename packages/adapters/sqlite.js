/**
 * SQLite archive adapter.
 *
 * Handles harnesses that store sessions in SQLite databases:
 *   - GitHub Copilot (.copilot/session-store.db)
 *   - ChatGPT / Codex (.codex/goals_1.sqlite)
 *   - T3 Code (.t3/userdata/statev2.sqlite)
 *
 * Each row in a sessions-like table is treated as one session.
 * Copilot's session-store.db is handled specially: sessions + turns
 * are joined to reconstruct full conversations.
 */

const path = require('path')
const fs = require('fs')
const initSqlJs = require('sql.js')
const { wrapDb } = require('../core/db-compat')
const { BaseAdapter } = require('./base')

// Extract readable text from a JSON value (inline to avoid circular dep with IndexingEngine)
function extractTextFromJsonValue(obj) {
  if (typeof obj === 'string') return obj
  if (obj === null || obj === undefined) return ''
  if (typeof obj.content === 'string') return obj.content
  if (typeof obj.message === 'string') return obj.message
  if (typeof obj.text === 'string') return obj.text
  if (typeof obj.prompt === 'string') return obj.prompt
  if (typeof obj.response === 'string') return obj.response
  if (Array.isArray(obj.content)) {
    return obj.content
      .map(c => (typeof c === 'string' ? c : c.text || c.content || ''))
      .filter(Boolean)
      .join('\n')
  }
  const parts = []
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' || k === 'id' || k === 'timestamp' || k === 'role') continue
    if (typeof v === 'string' && v.length > 0) parts.push(`${k}: ${v}`)
    else if (typeof v === 'object' && v !== null) {
      const t = extractTextFromJsonValue(v)
      if (t) parts.push(t)
    }
  }
  return parts.join('\n')
}

let SQL = null
const sqlPromise = initSqlJs({
  locateFile: file => path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
}).then(sql => { SQL = sql })

// Yield to the event loop periodically during long row processing
const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

class SQLiteAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({
      name: options.name || 'SQLite',
      harness: options.harness || 'Unknown',
      extensions: ['.db', '.sqlite'],
      ...options
    })
    this.sessionTable = options.sessionTable || 'sessions'
    this.sessionIdCol = options.sessionIdCol || 'session_id'
    this.titleCol = options.titleCol || 'title'
    this.contentCol = options.contentCol || 'content'
    this.createdAtCol = options.createdAtCol || 'created_at'
    this.roleCol = options.roleCol || null
    this.timestampCol = options.timestampCol || null
  }

  canHandle(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    return ext === '.db' || ext === '.sqlite'
  }

  /**
   * Discover session files (SQLite databases) in a directory.
   */
  discover(dirPath) {
    const results = []
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          results.push(...this.discover(fullPath))
        } else if (entry.isFile() && this.canHandle(fullPath)) {
          results.push({ filePath: fullPath, ext: '.db' })
        }
      }
    } catch (e) {
      // skip
    }
    return results
  }

  /**
   * Parse a SQLite database file into sessions.
   * Each row in the sessions table becomes one session.
   */
  parseSession(filePath) {
    // SQLite databases contain multiple sessions; return null here
    // and use parseAllSessions instead for multi-session files.
    return null
  }

  /**
   * Parse all sessions from a SQLite database file.
   * Returns an array of { sessionId, title, createdAt, messages, filePath }.
   */
  async parseAllSessions(filePath) {
    const sessions = []
    let db
    try {
      await sqlPromise
      const buffer = fs.readFileSync(filePath)
      db = wrapDb(new SQL.Database(buffer))

      const base = path.basename(filePath).toLowerCase()

      // ── Copilot session-store.db: sessions + turns joined ───────────────
      if (base === 'session-store.db') {
        try {
          const copilotRows = this._parseCopilotStore(db, filePath)
          sessions.push(...copilotRows)
        } catch (e) {
          // Skip unreadable Copilot store
        }
        return sessions
      }

      // ── Phase 1: tables literally named "sessions" ──────────────────────
      const sessionTables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map(r => r.name)
        .filter(t => t.toLowerCase() === 'sessions')

      for (const table of sessionTables) {
        try {
          const rows = this._parseSessionTable(db, table)
          sessions.push(...rows)
        } catch (e) {
          // Skip unreadable tables
        }
      }

      // ── Phase 2: fallback — message-store tables grouped by thread_id ───
      if (sessions.length === 0) {
        const allTables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map(r => r.name)

        for (const table of allTables) {
          try {
            const threads = this._parseMessageStoreTable(db, table, filePath)
            sessions.push(...threads)
          } catch (e) {
            // Skip unreadable tables
          }
        }
      }
    } catch (e) {
      // Skip unreadable databases
    } finally {
      if (db) db.close()
    }
    return sessions
  }

  /**
   * Parse GitHub Copilot's session-store.db by joining sessions + turns.
   * Each session becomes one conversation with alternating user/assistant messages.
   * Title is derived from cwd/repository/branch/summary.
   */
  _parseCopilotStore(db, filePath) {
    const sessions = []

    // Verify tables exist with expected columns
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(r => r.name)
    if (!tables.includes('sessions') || !tables.includes('turns')) return sessions

    const sessionCols = new Set(
      db.prepare('PRAGMA table_info(sessions)').all().map(c => c.name)
    )
    const turnCols = new Set(
      db.prepare('PRAGMA table_info(turns)').all().map(c => c.name)
    )

    // Need at minimum: sessions.id, sessions.cwd; turns.session_id, turns.user_message
    if (!sessionCols.has('id') || !sessionCols.has('cwd')) return sessions
    if (!turnCols.has('session_id') || !turnCols.has('user_message')) return sessions

    const idCol = 'id'
    const cwdCol = sessionCols.has('cwd') ? 'cwd' : null
    const repoCol = sessionCols.has('repository') ? 'repository' : null
    const branchCol = sessionCols.has('branch') ? 'branch' : null
    const summaryCol = sessionCols.has('summary') ? 'summary' : null
    const createdAtCol = sessionCols.has('created_at') ? 'created_at' : null

    const turnSessionCol = 'session_id'
    const turnIndexCol = turnCols.has('turn_index') ? 'turn_index' : null
    const userMsgCol = turnCols.has('user_message') ? 'user_message' : null
    const assistantMsgCol = turnCols.has('assistant_response') ? 'assistant_response' : null
    const turnTsCol = turnCols.has('timestamp') ? 'timestamp' : null

    const rows = db
      .prepare(`
        SELECT s.${idCol} AS session_id,
               s.${cwdCol} AS cwd,
               s.${repoCol} AS repository,
               s.${branchCol} AS branch,
               s.${summaryCol} AS summary,
               s.${createdAtCol} AS created_at,
               t.${turnIndexCol} AS turn_index,
               t.${userMsgCol} AS user_message,
               t.${assistantMsgCol} AS assistant_response,
               t.${turnTsCol} AS turn_timestamp
        FROM sessions s
        LEFT JOIN turns t ON s.${idCol} = t.${turnSessionCol}
        ORDER BY s.${idCol}, t.${turnIndexCol || 'id'}
      `)
      .all()

    // Group by session
    const bySession = new Map()
    for (const r of rows) {
      const sid = r.session_id
      if (!bySession.has(sid)) {
        bySession.set(sid, {
          sessionId: sid,
          cwd: r.cwd,
          repository: r.repository,
          branch: r.branch,
          summary: r.summary,
          createdAt: r.created_at || '',
          turns: []
        })
      }
      if (r.turn_index !== null && r.turn_index !== undefined) {
        bySession.get(sid).turns.push(r)
      }
    }

    for (const [sid, s] of bySession) {
      // Build messages from turns: alternating user/assistant
      const messages = []
      let msgIndex = 0

      // Sort turns by turn_index
      s.turns.sort((a, b) => (a.turn_index || 0) - (b.turn_index || 0))

      for (const t of s.turns) {
        if (t.user_message && t.user_message.trim().length > 0) {
          messages.push({
            message_index: msgIndex++,
            role: 'user',
            timestamp: t.turn_timestamp || '',
            content: t.user_message,
            tool_calls: null
          })
        }
        if (t.assistant_response && t.assistant_response.trim().length > 0) {
          messages.push({
            message_index: msgIndex++,
            role: 'assistant',
            timestamp: t.turn_timestamp || '',
            content: t.assistant_response,
            tool_calls: null
          })
        }
      }

      if (messages.length === 0) continue

      // Derive title from summary, cwd, repository, branch
      let title = s.summary
      if (!title || title.trim().length === 0) {
        const parts = []
        if (s.repository) parts.push(s.repository)
        if (s.branch) parts.push(s.branch)
        if (s.cwd) parts.push(path.basename(s.cwd))
        title = parts.length > 0 ? parts.join(' / ') : sid
      }
      if (title && title.length > 80) title = title.trim().substring(0, 80) + '...'

      sessions.push({
        sessionId: sid,
        title: title || sid,
        createdAt: s.createdAt,
        messages: messages,
        filePath: filePath,
        harness: this.harness
      })
    }

    return sessions
  }

  /**
   * Parse a single "sessions" table into session objects.
   * Each row = one session.
   */
  _parseSessionTable(db, table) {
    const sessions = []
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map(c => c.name)

    const colSet = new Set(columns.map(c => c.toLowerCase()))

    // Use word-boundary regex to avoid matching columns like
    // context_current_tokens (contains "text" as substring).
    const contentPattern = /\b(content|summary|message|text|body|prompt|response)\b/i
    const hasContent = [...colSet].some(c => contentPattern.test(c))
    if (!hasContent) return sessions

    // Determine column names
    const idCol = columns.find(c => c.toLowerCase() === 'session_id') ||
                  columns.find(c => c.toLowerCase() === 'id') ||
                  columns[0]
    const titleCol = columns.find(c => c.toLowerCase() === 'title') ||
                     columns.find(c => c.toLowerCase() === 'label') ||
                     columns.find(c => /\b(name|title|label)\b/i.test(c)) ||
                     null
    const contentCol = columns.find(c => c.toLowerCase() === 'content') ||
                       columns.find(c => contentPattern.test(c))
    const tsCol = columns.find(c => c.toLowerCase() === 'created_at') ||
                  columns.find(c => /timestamp|created_at|date/i.test(c)) ||
                  null
    const roleCol = columns.find(c => c.toLowerCase() === 'role') || null

    const query = `SELECT * FROM ${table}`
    const rows = db.prepare(query).all()

    let index = 0
    for (const row of rows) {
      const sessionId = String(row[idCol] || path.basename(table) + '-' + index)
      const title = titleCol ? String(row[titleCol] || sessionId) : sessionId
      const createdAt = tsCol ? String(row[tsCol] || '') : ''
      const content = row[contentCol] || ''

      let messageContent = content
      const trimmed = String(content).trim()
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed)
          const extracted = extractTextFromJsonValue(parsed)
          if (extracted && extracted.trim().length > 0) {
            messageContent = extracted
          }
        } catch (e) {
          // Keep raw content if not valid JSON
        }
      }

      const messages = []
      if (roleCol) {
        messages.push({
          message_index: 0,
          role: row[roleCol] || 'unknown',
          timestamp: row[tsCol] || '',
          content: messageContent,
          tool_calls: null
        })
      } else {
        const paragraphs = String(content).split(/\n\s*\n/).filter(p => p.trim())
        paragraphs.forEach((p, i) => {
          messages.push({
            message_index: i,
            role: 'unknown',
            timestamp: '',
            content: p.trim(),
            tool_calls: null
          })
        })
      }

      sessions.push({
        sessionId,
        title,
        createdAt,
        messages,
        harness: this.harness
      })
      index++
    }
    return sessions
  }

  /**
   * Parse a message-store table into session objects grouped by thread_id.
   * A message-store table has: thread_id column + role column + content column.
   * Each thread becomes one session with all its messages.
   */
  _parseMessageStoreTable(db, table, filePath) {
    const sessions = []
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map(c => c.name)

    const colSet = new Set(columns.map(c => c.toLowerCase()))

    // Must have thread_id + role + at least one content-like column.
    // Use substring match (not word-boundary) because columns like
    // "payload_json" contain "payload" as part of a compound name.
    const hasThreadId = [...colSet].some(c =>
      c === 'thread_id' || c.includes('thread')
    )
    const hasRole = colSet.has('role')
    const contentKeywords = ['content', 'summary', 'message', 'text', 'body', 'prompt', 'response', 'payload', 'data']
    const hasContent = [...colSet].some(c =>
      contentKeywords.some(kw => c.includes(kw))
    )
    if (!hasThreadId || !hasRole || !hasContent) return sessions

    const threadCol = columns.find(c => c.toLowerCase() === 'thread_id') ||
                      columns.find(c => c.includes('thread'))
    const roleCol = columns.find(c => c.toLowerCase() === 'role')
    const contentCol = columns.find(c => c.toLowerCase() === 'content') ||
                       columns.find(c => c.toLowerCase() === 'payload_json') ||
                       columns.find(c => c.toLowerCase() === 'data') ||
                       columns.find(c => contentKeywords.some(kw => c.toLowerCase().includes(kw)))
    const tsCol = columns.find(c => c.toLowerCase() === 'created_at') ||
                  columns.find(c => c.toLowerCase() === 'updated_at') ||
                  columns.find(c => /timestamp|created_at|date/i.test(c)) ||
                  null

    // Fetch all rows ordered by thread_id, created_at
    const query = `SELECT * FROM ${table} ORDER BY ${threadCol}, ${tsCol || threadCol}`
    const rows = db.prepare(query).all()

    // Group by thread_id
    const threads = new Map()
    for (const row of rows) {
      const threadId = String(row[threadCol] || '')
      if (!threadId) continue
      if (!threads.has(threadId)) {
        threads.set(threadId, [])
      }
      threads.get(threadId).push(row)
    }

    let index = 0
    for (const [threadId, rows] of threads) {
      // Build messages in order
      const messages = rows.map((row, i) => {
        const content = row[contentCol] || ''
        let messageContent = content
        const trimmed = String(content).trim()
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
          try {
            const parsed = JSON.parse(trimmed)
            const extracted = extractTextFromJsonValue(parsed)
            if (extracted && extracted.trim().length > 0) {
              messageContent = extracted
            }
          } catch (e) {
            // Keep raw content if not valid JSON
          }
        }
        return {
          message_index: i,
          role: row[roleCol] || 'unknown',
          timestamp: tsCol ? String(row[tsCol] || '') : '',
          content: messageContent,
          tool_calls: null
        }
      })

      // Title: first user message text, truncated, or thread_id
      let title = threadId
      const firstUserMsg = messages.find(m => m.role === 'user')
      if (firstUserMsg && firstUserMsg.content) {
        title = firstUserMsg.content.trim().substring(0, 80)
      }

      sessions.push({
        sessionId: threadId,
        title,
        createdAt: messages[0]?.timestamp || '',
        messages,
        harness: this.harness
      })
      index++
    }
    return sessions
  }

  extractText(filePath) {
    const sessions = this.parseAllSessions(filePath)
    return sessions.map(s => s.messages.map(m => m.content).join('\n')).join('\n')
  }
}

module.exports = { SQLiteAdapter }
