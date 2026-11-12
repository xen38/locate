/**
 * SQLite archive adapter.
 *
 * Handles harnesses that store sessions in SQLite databases:
 *   - GitHub Copilot (.copilot/data.db)
 *   - ChatGPT / Codex (.codex/goals_1.sqlite)
 *   - T3 Code (.t3/userdata/statev2.sqlite)
 *
 * Each row in a sessions-like table is treated as one session.
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

      // Find tables that look like session tables
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map(r => r.name)

      for (const table of tables) {
        try {
          const columns = db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map(c => c.name)

          const colSet = new Set(columns.map(c => c.toLowerCase()))

          // Detect if this table has session-like columns
          const hasSessionId = [...colSet].some(c =>
            c === 'session_id' || c === 'id' || c.includes('session')
          )
          const hasContent = [...colSet].some(c =>
            c === 'content' || c.includes('message') || c.includes('text') ||
            c.includes('body') || c.includes('prompt') || c.includes('response')
          )
          if (!hasContent) continue

          // Determine column names
          const idCol = columns.find(c => c.toLowerCase() === 'session_id') ||
                        columns.find(c => c.toLowerCase() === 'id') ||
                        columns[0]
          const titleCol = columns.find(c => c.toLowerCase() === 'title') ||
                           columns.find(c => c.toLowerCase() === 'label') ||
                           columns.find(c => /name|title|label/i.test(c)) ||
                           null
          const contentCol = columns.find(c => c.toLowerCase() === 'content') ||
                             columns.find(c => /content|message|text|body|prompt|response/i.test(c))
          const tsCol = columns.find(c => c.toLowerCase() === 'created_at') ||
                        columns.find(c => /timestamp|created_at|date/i.test(c)) ||
                        null
          const roleCol = columns.find(c => c.toLowerCase() === 'role') || null

          const query = `SELECT * FROM ${table}`
          const rows = db.prepare(query).all()

          let index = 0
          for (const row of rows) {
            // Yield periodically to keep UI responsive during large DB scans
            if (index % 50 === 0) await sleep()
            const sessionId = String(row[idCol] || path.basename(filePath, '.db') + '-' + index)
            const title = titleCol ? String(row[titleCol] || sessionId) : sessionId
            const createdAt = tsCol ? String(row[tsCol] || '') : ''
            const content = row[contentCol] || ''
          
            // If content looks like JSON, extract meaningful text instead of raw JSON
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

              // Build messages - if there's a role column, treat each row as one message
              // Otherwise treat the whole content as one message
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
              // Split content into paragraphs as pseudo-messages
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
              filePath,
              harness: this.harness
            })
            index++
          }
        } catch (e) {
          // Skip unreadable tables
        }
      }
    } catch (e) {
      // Skip unreadable databases
    } finally {
      if (db) db.close()
    }
    return sessions
  }

  extractText(filePath) {
    const sessions = this.parseAllSessions(filePath)
    return sessions.map(s => s.messages.map(m => m.content).join('\n')).join('\n')
  }
}

module.exports = { SQLiteAdapter }
