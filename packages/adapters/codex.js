/**
 * Codex archive adapter.
 *
 * Handles ChatGPT / Codex sessions stored in SQLite databases at ~/.codex/sqlite/codex.db.
 *
 * Schema:
 *   local_thread_catalog (host_id, thread_id, display_title, source_created_at,
 *     source_updated_at, cwd, source_kind, model_provider, ...)
 *
 * Each thread row becomes one session. Message content is not stored locally
 * for ChatGPT threads (it's on remote servers), so sessions have empty message
 * arrays but retain title and metadata.
 */

const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')
const { BaseAdapter } = require('./base')

// Codex database locations
// On Windows the .codex directory is at %USERPROFILE%\.codex (NOT under AppData\Local)
const CODEX_DB_PATHS = [
  process.env.LOCATE_CODEX_DB ||
    (process.platform === 'win32'
      ? process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, '.codex', 'sqlite', 'codex.db')
        : path.join(process.env.HOME || '', '.codex', 'sqlite', 'codex.db')
      : path.join(process.env.HOME || '', '.codex', 'sqlite', 'codex.db')),
  path.join(process.env.HOME || '', '.codex', 'sqlite', 'codex.db'),
  path.join(process.env.HOME || '', '.codex', 'codex.db'),
  // Fallback: LOCALAPPDATA/.codex (some installations)
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, '.codex', 'sqlite', 'codex.db')
    : null
].filter(Boolean)

function findCodexDbs() {
  const dbs = []
  for (const p of CODEX_DB_PATHS) {
    if (p && fs.existsSync(p) && !dbs.includes(p)) dbs.push(p)
  }
  return dbs
}

class CodexAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({
      name: options.name || 'Codex',
      harness: options.harness || 'Codex',
      extensions: ['.db', '.sqlite', '.jsonl'],
      ...options
    })
  }

  canHandle(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath).toLowerCase()
    const parts = filePath.split(/[\\/]/)
    // Codex session database: codex.db (or codex-dev.db)
    if ((ext === '.db' || ext === '.sqlite') && /^codex(\.dev)?\.db$/i.test(base)) {
      return true
    }
    // Codex archived sessions: .jsonl files under .codex/archived_sessions/
    if (ext === '.jsonl' && parts.includes('archived_sessions') && parts.some(p => p === '.codex' || p === 'codex')) {
      return true
    }
    return false
  }

  /** Discover all Codex database files and archived session JSONL files. */
  discover(dirPath) {
    const results = []
    for (const dbPath of findCodexDbs()) {
      if (this.canHandle(dbPath)) {
        results.push({ filePath: dbPath, ext: '.db' })
      }
    }
    // Also discover archived session JSONL files under .codex/archived_sessions/
    const archivedDir = path.join(path.dirname(findCodexDbs()[0] || ''), 'archived_sessions')
    if (archivedDir && fs.existsSync(archivedDir)) {
      try {
        const entries = fs.readdirSync(archivedDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
            results.push({ filePath: path.join(archivedDir, entry.name), ext: '.jsonl' })
          }
        }
      } catch (e) { /* skip inaccessible */ }
    }
    return results
  }

  parseSession(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.jsonl') {
      return this.parseArchivedSession(filePath)
    }
    // Multi-session database; use parseAllSessions instead
    return null
  }

  /**
   * Parse all sessions from the Codex database or archived session JSONL file.
   * Each row in local_thread_catalog becomes one session.
   * For .jsonl archived sessions, returns a single session array.
   */
  parseAllSessions(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.jsonl') {
      const parsed = this.parseArchivedSession(filePath)
      return parsed ? [parsed] : []
    }

    const sessions = []
    let db
    try {
      db = new Database(filePath, { readonly: true })

      // Verify local_thread_catalog table exists
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all()
        .map(r => r.name)
      if (!tables.includes('local_thread_catalog')) return sessions

      const cols = db
        .prepare('PRAGMA table_info(local_thread_catalog)')
        .all()
        .map(c => c.name)
      const colSet = new Set(cols.map(c => c.toLowerCase()))

      // Need at least thread_id and display_title
      if (!colSet.has('thread_id') || !colSet.has('display_title')) return sessions

      const threadIdCol = 'thread_id'
      const titleCol = 'display_title'
      const createdAtCol = colSet.has('source_created_at') ? 'source_created_at' : null
      const updatedAtCol = colSet.has('source_updated_at') ? 'source_updated_at' : null
      const cwdCol = colSet.has('cwd') ? 'cwd' : null
      const sourceKindCol = colSet.has('source_kind') ? 'source_kind' : null

      const query = `
        SELECT thread_id, display_title,
               ${createdAtCol || "''"} AS source_created_at,
               ${updatedAtCol || "''"} AS source_updated_at,
               ${cwdCol || "''"} AS cwd,
               ${sourceKindCol || "''"} AS source_kind
        FROM local_thread_catalog
        WHERE display_title IS NOT NULL AND display_title <> ''
      `

      const rows = db.prepare(query).all()

      for (const row of rows) {
        const sessionId = row.thread_id || ''
        if (!sessionId) continue

        const title = row.display_title || sessionId
        const createdAt = row.source_updated_at || row.source_created_at || ''
        const sourceKind = row.source_kind || ''

        // Skip sessions with no local message content (ChatGPT-imported threads
        // live entirely on remote servers — nothing to index locally)
        if (!sourceKind || sourceKind === 'chatgpt') continue

        sessions.push({
          sessionId,
          title,
          createdAt,
          messages: [],
          filePath,
          harness: this.harness,
          _meta: { sourceKind, cwd: row.cwd }
        })
      }
    } catch (e) {
      // Skip unreadable databases
    } finally {
      if (db) db.close()
    }
    return sessions
  }

  /**
   * Parse a single Codex archived session JSONL file.
   *
   * Format: each line is a JSON object with a "type" field:
   *   - session_meta: payload.session_id, payload.timestamp, payload.cwd
   *   - response_item: payload.type==='message', payload.role, payload.content[]
   *   - event_msg: various event types
   *
   * Only response_item lines with role 'user' or 'assistant' become messages.
   */
  parseArchivedSession(filePath) {
    const content = this._readFile(filePath).trim()
    if (!content) return null

    const lines = content.split('\n').filter(l => l.trim())
    let sessionId = path.basename(filePath, '.jsonl')
    let title = sessionId
    let createdAt = ''
    const messages = []

    const extractTextFromContent = (contentArr) => {
      if (!Array.isArray(contentArr)) return ''
      return contentArr
        .filter(c => c && (c.type === 'input_text' || c.type === 'output_text' || c.type === 'text'))
        .map(c => c.text || '')
        .join('\n')
    }

    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (typeof obj !== 'object' || obj === null) continue
        const type = obj.type || ''
        const p = obj.payload || {}

        if (type === 'session_meta') {
          if (p.session_id && !sessionId) sessionId = p.session_id
          if (p.id && !sessionId) sessionId = p.id
          if (p.timestamp && !createdAt) createdAt = p.timestamp
          // Use cwd basename as a fallback title
          if (p.cwd) {
            const cwdParts = p.cwd.split(/[\\/]/).filter(Boolean)
            if (cwdParts.length > 0) title = cwdParts[cwdParts.length - 1] || sessionId
          }
        } else if (type === 'response_item' && p.type === 'message') {
          const role = p.role || 'unknown'
          // Only include user and assistant messages; skip developer/system
          if (role !== 'user' && role !== 'assistant') continue
          const text = extractTextFromContent(p.content)
          if (text.trim().length > 0) {
            messages.push({
              session_id: sessionId,
              message_index: messages.length,
              role,
              timestamp: p.timestamp || obj.timestamp || '',
              content: text,
              tool_calls: null
            })
          }
        } else if (type === 'event_msg' && p.thread_id && !sessionId) {
          sessionId = p.thread_id
        }
      } catch (e) {
        // Skip unparseable lines
      }
    }

    if (!sessionId || sessionId === path.basename(filePath, '.jsonl')) {
      // No session_meta found; fall back to filename
      sessionId = path.basename(filePath, '.jsonl')
    }

    return {
      sessionId,
      title,
      createdAt,
      messages,
      filePath,
      harness: this.harness
    }
  }

  extractText(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.jsonl') {
      const parsed = this.parseArchivedSession(filePath)
      if (!parsed) return ''
      return parsed.messages.map(m => m.content).join('\n')
    }
    const sessions = this.parseAllSessions(filePath)
    return sessions
      .map(s => s.title)
      .filter(Boolean)
      .join('\n')
  }
}

module.exports = { CodexAdapter, findCodexDbs }
