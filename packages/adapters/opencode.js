/**
 * OpenCode archive adapter.
 *
 * Handles OpenCode (anomalyco/opencode) sessions stored in a single
 * SQLite database at ~/.local/share/opencode/opencode.db.
 *
 * Schema:
 *   session(id, project_id, directory, title, time_created, time_updated, ...)
 *   message(id, session_id, time_created, data JSON)  -- data has role, etc.
 *   part(id, message_id, session_id, data JSON)       -- data has type, text/tool/reasoning
 *
 * Each session row becomes one session. Messages are read from the message
 * table, with content parts joined from the part table.
 */

const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')
const { BaseAdapter } = require('./base')

const OPENARCHIVE_DB_PATHS = [
  // Primary OpenCode location
  process.env.LOCATE_OPENERCODE_DB ||
  (process.platform === 'win32'
    ? process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, '..', 'Local', 'share', 'opencode', 'opencode.db')
      : path.join(process.env.USERPROFILE || '', '.local', 'share', 'opencode', 'opencode.db')
    : path.join(process.env.HOME || '', '.local', 'share', 'opencode', 'opencode.db')),
  path.join(process.env.HOME || '', '.opencode', 'opencode.db'),
  path.join(process.env.HOME || '', '.local', 'share', 'opencode', 'opencode.db')
]

function findOpencodeDb() {
  for (const p of OPENARCHIVE_DB_PATHS) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

class OpencodeAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({
      name: options.name || 'OpenCode',
      harness: options.harness || 'OpenCode',
      extensions: ['.db'],
      ...options
    })
  }

  canHandle(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath).toLowerCase()
    return ext === '.db' && base === 'opencode.db'
  }

  /**
   * Discover the OpenCode database file.
   */
  discover(dirPath) {
    const results = []
    const dbPath = findOpencodeDb()
    if (dbPath && this.canHandle(dbPath)) {
      results.push({ filePath: dbPath, ext: '.db' })
    }
    return results
  }

  parseSession(filePath) {
    // Multi-session database; use parseAllSessions instead
    return null
  }

  /**
   * Parse all sessions from the OpenCode database.
   */
  parseAllSessions(filePath) {
    const sessions = []
    let db
    try {
      db = new Database(filePath, { readonly: true })

      // Load all sessions
      const sessionRows = db
        .prepare('SELECT * FROM session ORDER BY time_created')
        .all()

      // Load all messages indexed by session_id
      const messageRows = db
        .prepare('SELECT * FROM message ORDER BY session_id, time_created')
        .all()
      const messagesBySession = new Map()
      for (const m of messageRows) {
        if (!messagesBySession.has(m.session_id)) messagesBySession.set(m.session_id, [])
        messagesBySession.get(m.session_id).push(m)
      }

      // Load all parts indexed by message_id
      const partRows = db
        .prepare('SELECT * FROM part ORDER BY message_id, time_created')
        .all()
      const partsByMessage = new Map()
      for (const p of partRows) {
        if (!partsByMessage.has(p.message_id)) partsByMessage.set(p.message_id, [])
        partsByMessage.get(p.message_id).push(p)
      }

      for (const s of sessionRows) {
        const sessionId = s.id
        const title = s.title || sessionId
        const createdAt = s.time_created
          ? new Date(s.time_created).toISOString()
          : ''

        const messages = []
        const msgList = messagesBySession.get(sessionId) || []
        for (const m of msgList) {
          let data = {}
          try {
            data = JSON.parse(m.data || '{}')
          } catch (e) {
            data = {}
          }

          const role = data.role || 'unknown'
          const timestamp = data.time?.created
            ? new Date(data.time.created).toISOString()
            : m.time_created
              ? new Date(m.time_created).toISOString()
              : ''

          // Build content from parts
          let content = ''
          const parts = partsByMessage.get(m.id) || []
          const partTexts = []
          for (const p of parts) {
            let pd = {}
            try {
              pd = JSON.parse(p.data || '{}')
            } catch (e) {
              pd = {}
            }
            if (pd.type === 'text' && pd.text) {
              partTexts.push(pd.text)
            } else if (pd.type === 'reasoning' && pd.text) {
              partTexts.push('[reasoning] ' + pd.text)
            } else if (pd.type === 'tool') {
              partTexts.push('[tool] ' + (pd.text || pd.tool || ''))
            } else if (pd.type === 'step-start') {
              partTexts.push('[step-start]')
            } else if (pd.type === 'step-finish') {
              partTexts.push('[step-finish]')
            } else if (pd.text) {
              partTexts.push(pd.text)
            }
          }

          if (partTexts.length > 0) {
            content = partTexts.join('\n')
          } else if (data.content) {
            content = typeof data.content === 'string'
              ? data.content
              : JSON.stringify(data.content)
          } else if (data.summary) {
            content = data.summary
          } else if (data.text) {
            content = data.text
          }

          messages.push({
            message_index: messages.length,
            role: role,
            timestamp: timestamp,
            content: content,
            tool_calls: null
          })
        }

        if (messages.length === 0) continue

        sessions.push({
          sessionId: sessionId,
          title: title,
          createdAt: createdAt,
          messages: messages,
          filePath: filePath,
          harness: this.harness
        })
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
    return sessions
      .map(s => s.messages.map(m => m.content).join('\n'))
      .join('\n')
  }
}

module.exports = { OpencodeAdapter, findOpencodeDb }
