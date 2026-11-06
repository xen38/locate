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
const Database = require('better-sqlite3')
const { BaseAdapter } = require('./base')

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
  parseAllSessions(filePath) {
    const sessions = []
    let db
    try {
      db = new Database(filePath, { readonly: true })

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
            const sessionId = String(row[idCol] || path.basename(filePath, '.db') + '-' + index)
            const title = titleCol ? String(row[titleCol] || sessionId) : sessionId
            const createdAt = tsCol ? String(row[tsCol] || '') : ''
            const content = row[contentCol] || ''

            // Build messages - if there's a role column, treat each row as one message
            // Otherwise treat the whole content as one message
            const messages = []
            if (roleCol) {
              messages.push({
                message_index: 0,
                role: row[roleCol] || 'unknown',
                timestamp: row[tsCol] || '',
                content: content,
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
