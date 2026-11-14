/**
 * Locate Core Indexing Engine
 *
 * SQLite-based full-text search index for archived coding sessions.
 * Uses LIKE-based search (sql.js does not include FTS5).
 * Reads original session files read-only; never copies or modifies them.
 *
 * Schema:
 *   sources   - registered harness directories
 *   sessions  - session records (metadata + content)
 *   messages  - individual messages (role, timestamp, content, tool calls)
 */

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const initSqlJs = require('sql.js')
const { wrapDb } = require('./db-compat')
const { AdapterRegistry, getSessionValidator } = require('../adapters/registry')

// Supported session file extensions
const SUPPORTED_EXTS = new Set(['.md', '.txt', '.json', '.jsonl', '.db', '.sqlite'])

let SQL = null
const sqlPromise = initSqlJs({
  locateFile: file => path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
}).then(sql => { SQL = sql })

// Yield to the event loop so the UI stays responsive during long indexing
const sleep = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms))

// Known non-session file / directory names that should never appear as sessions
const NON_SESSION_NAMES = new Set([
  'models_cache',
  '.lease',
  'lease',
  'cache',
  'temp',
  'tmp',
  'lock',
  '.lock',
  'config',
  'settings',
  'preferences',
  '.config',
  'messages',
  '.messages',
  'providers',
  'feature-flags',
  'feature_flags',
  'credential',
  'credentials',
  'token',
  'tokens',
  'auth',
  'history',
  'index',
  'indexed_db',
  'leveldb',
  'localstorage',
  'websql'
])

function isNonSessionFile(filePath) {
  const base = path.basename(filePath)
  const lower = base.toLowerCase()
  const nameWithoutExt = path.basename(filePath, path.extname(filePath))
  const nameWithoutExtLower = nameWithoutExt.toLowerCase()
  // Skip numeric-only filenames (e.g. "22135", "22136") - not real session files
  if (/^\d+$/.test(nameWithoutExtLower)) return true
  // Check name without extension against known non-session names (e.g. "config.json" -> "config")
  if (NON_SESSION_NAMES.has(nameWithoutExtLower)) return true
  if (NON_SESSION_NAMES.has(lower)) return true
  // Skip files whose name contains or ends with known non-session patterns
  // e.g. "139.lease.json", "foo.lease.db", ".lease" itself
  for (const name of NON_SESSION_NAMES) {
    if (lower === name || lower.endsWith('.' + name) || lower.includes('.' + name + '.')) return true
  }
  // Skip dotfiles that aren't recognized session formats
  if (lower.startsWith('.') && !['.jsonl', '.json', '.md', '.txt', '.db', '.sqlite'].includes(path.extname(lower))) return true
  return false
}

class IndexingEngine {
  constructor(dbPath) {
    this.dbPath = dbPath
    this.db = null
    this.initialized = false
    this.registry = new AdapterRegistry()
  }

  // ── Initialization ────────────────────────────────────────────────────

  async open() {
    await sqlPromise
    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    let buffer = null
    if (fs.existsSync(this.dbPath)) {
      buffer = fs.readFileSync(this.dbPath)
    }
    this.db = wrapDb(new SQL.Database(buffer))
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA synchronous = NORMAL')
    this._createSchema()
    // Persist initial empty DB to disk so the file exists after open()
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, this.db.export())
    }
    this.initialized = true
    return this
  }

  _createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        name TEXT,
        format TEXT,
        harness TEXT,
        session_count INTEGER DEFAULT 0,
        indexed_count INTEGER DEFAULT 0,
        last_scan TEXT,
        status TEXT DEFAULT 'pending',
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        title TEXT,
        harness TEXT,
        source_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_ext TEXT,
        file_mtime REAL,
        file_size INTEGER,
        file_hash TEXT,
        created_at TEXT,
        indexed_at TEXT DEFAULT (datetime('now')),
        content_hash TEXT,
        content TEXT
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        role TEXT,
        timestamp TEXT,
        content TEXT,
        tool_calls TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_harness ON sessions(harness);
      CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source_path);
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
      CREATE INDEX IF NOT EXISTS idx_sessions_file ON sessions(file_path);
    `)
  }

  close() {
    if (this.db) {
      const data = this.db.export()
      fs.writeFileSync(this.dbPath, data)
      this.db.close()
      this.db = null
      this.initialized = false
    }
  }

  // ── Fingerprinting ────────────────────────────────────────────────────

  _fingerprint(filePath) {
    try {
      const stat = fs.statSync(filePath)
      const hash = crypto.createHash('sha256')
        .update(filePath + '|' + stat.size + '|' + stat.mtimeMs)
        .digest('hex')
      return {
        mtime: stat.mtimeMs,
        size: stat.size,
        hash
      }
    } catch (e) {
      return { mtime: 0, size: 0, hash: '' }
    }
  }

  // ── Text extraction (read-only) ──────────────────────────────────────

  static readTextFile(filePath) {
    return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  }

  static extractTextFromJsonl(content) {
    const lines = content.split('\n').filter(l => l.trim())
    const texts = []
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        const text = IndexingEngine.extractTextFromJsonValue(obj)
        if (text) texts.push(text)
      } catch (e) {
        if (line.trim()) texts.push(line.trim())
      }
    }
    return texts.join('\n')
  }

  static extractTextFromJsonValue(obj) {
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
        const t = IndexingEngine.extractTextFromJsonValue(v)
        if (t) parts.push(t)
      }
    }
    return parts.join('\n')
  }

  static extractTextFromJsonFile(filePath) {
    try {
      const content = IndexingEngine.readTextFile(filePath)
      try {
        const obj = JSON.parse(content)
        return IndexingEngine.extractTextFromJsonValue(obj)
      } catch (e) {
        return IndexingEngine.extractTextFromJsonl(content)
      }
    } catch (e) {
      return ''
    }
  }

  static async extractTextFromSqlite(dbPath) {
    try {
      await sqlPromise
      const buffer = fs.readFileSync(dbPath)
      const db = new SQL.Database(buffer)
      const texts = []
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
          const textCols = columns.filter(c =>
            /content|message|text|body|prompt|response|title|summary|objective|goal|description|note|answer|output/i.test(c)
          )
          if (textCols.length === 0) continue
          const idCol = columns.find(c => /id|session|thread/i.test(c)) || columns[0]
          const query = `SELECT ${[idCol, ...textCols].join(', ')} FROM ${table} LIMIT 1000`
          const rows = db.prepare(query).all()
          for (const row of rows) {
            const parts = []
            for (const col of textCols) {
              if (row[col] && typeof row[col] === 'string') parts.push(row[col])
            }
            if (parts.length > 0) texts.push(parts.join('\n'))
          }
        } catch (e) {
          // skip unreadable tables
        }
      }
      db.close()
      return texts.join('\n')
    } catch (e) {
      return ''
    }
  }

  static async readSessionFileContent(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    try {
      switch (ext) {
        case '.jsonl':
          return IndexingEngine.extractTextFromJsonl(IndexingEngine.readTextFile(filePath))
        case '.json':
          return IndexingEngine.extractTextFromJsonFile(filePath)
        case '.db':
        case '.sqlite':
          return await IndexingEngine.extractTextFromSqlite(filePath)
        case '.md':
        case '.txt':
          return IndexingEngine.readTextFile(filePath)
        default:
          return IndexingEngine.readTextFile(filePath)
      }
    } catch (e) {
      return `[Error reading ${filePath}: ${e.message}]`
    }
  }

  // ── Session parsing into messages ────────────────────────────────────

  static async parseMessages(filePath, sessionId) {
    const ext = path.extname(filePath).toLowerCase()
    const messages = []

    try {
      if (ext === '.jsonl') {
        const content = IndexingEngine.readTextFile(filePath)
        const lines = content.split('\n').filter(l => l.trim())
        let index = 0
        for (const line of lines) {
          try {
            const obj = JSON.parse(line)
            messages.push({
              session_id: sessionId,
              message_index: index++,
              role: obj.role || 'unknown',
              timestamp: obj.timestamp || '',
              content: obj.content || obj.text || obj.message || '',
              tool_calls: obj.tool_calls || obj.tools || null
            })
          } catch (e) {
            messages.push({
              session_id: sessionId,
              message_index: index++,
              role: 'unknown',
              timestamp: '',
              content: line.trim(),
              tool_calls: null
            })
          }
        }
      } else if (ext === '.json') {
        const content = IndexingEngine.readTextFile(filePath)
        try {
          const obj = JSON.parse(content)
          // Single session object - may contain a messages array or be one message
          if (Array.isArray(obj.messages)) {
            obj.messages.forEach((m, i) => {
              messages.push({
                session_id: sessionId,
                message_index: i,
                role: m.role || 'unknown',
                timestamp: m.timestamp || '',
                content: m.content || m.text || m.message || '',
                tool_calls: m.tool_calls || null
              })
            })
          } else {
            messages.push({
              session_id: sessionId,
              message_index: 0,
              role: obj.role || 'unknown',
              timestamp: obj.timestamp || '',
              content: obj.content || obj.text || obj.message || '',
              tool_calls: obj.tool_calls || null
            })
          }
        } catch (e) {
          messages.push({
            session_id: sessionId,
            message_index: 0,
            role: 'unknown',
            timestamp: '',
            content: content,
            tool_calls: null
          })
        }
      } else if (ext === '.md' || ext === '.txt') {
        const content = IndexingEngine.readTextFile(filePath)
        // Split markdown into paragraphs/messages
        const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim())
        paragraphs.forEach((p, i) => {
          messages.push({
            session_id: sessionId,
            message_index: i,
            role: 'unknown',
            timestamp: '',
            content: p.trim(),
            tool_calls: null
          })
        })
      } else if (ext === '.db' || ext === '.sqlite') {
        await sqlPromise
        const buffer = fs.readFileSync(filePath)
        const db = new SQL.Database(buffer)
        const tables = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map(r => r.name)
        let index = 0
        for (const table of tables) {
          try {
            const columns = db
              .prepare(`PRAGMA table_info(${table})`)
              .all()
              .map(c => c.name)
            const hasRole = columns.some(c => /role/i.test(c))
            const hasContent = columns.some(c => /content|message|text|body|prompt|response/i.test(c))
            if (!hasContent) continue
            const contentCol = columns.find(c => /content|message|text|body|prompt|response/i.test(c))
            const roleCol = columns.find(c => /role/i.test(c))
            const tsCol = columns.find(c => /timestamp|created_at|date/i.test(c))
            const rows = db.prepare(`SELECT * FROM ${table}`).all()
            rows.forEach(row => {
              let rawContent = row[contentCol] || ''
              // If content looks like JSON, extract meaningful text instead of raw JSON
              let content = rawContent
              const trimmed = rawContent.trim()
              if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                  const parsed = JSON.parse(trimmed)
                  const extracted = IndexingEngine.extractTextFromJsonValue(parsed)
                  if (extracted && extracted.trim().length > 0) {
                    content = extracted
                  } else {
                    content = rawContent
                  }
                } catch (e) {
                  content = rawContent
                }
              }
              messages.push({
                session_id: sessionId,
                message_index: index++,
                role: roleCol ? row[roleCol] : 'unknown',
                timestamp: tsCol ? row[tsCol] : '',
                content,
                tool_calls: null
              })
            })
          } catch (e) {
            // skip
          }
        }
        db.close()
      }
    } catch (e) {
      // Return whatever we have
    }

    return messages
  }

  static collectSessionFiles(dirPath, harness = null) {
    const registry = new AdapterRegistry()
    if (!harness) harness = registry.detectHarness(dirPath)
    try {
      // registry.discover() applies both the extension check (via adapters)
      // and the per-harness session validator, so only real session files
      // are returned. This replaces the previous extension-only scan which
      // produced false positives (agent definitions, caches, configs, etc.)
      return registry.discover(dirPath, harness).map(d => d.filePath)
    } catch (e) {
      // skip inaccessible directories
      return []
    }
  }

  // ── Source management ─────────────────────────────────────────────────

  addSource(dirPath, harness = null) {
    const normalized = path.resolve(dirPath)
    if (!fs.existsSync(normalized)) {
      throw new Error(`Directory does not exist: ${normalized}`)
    }
    const stat = fs.statSync(normalized)
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${normalized}`)
    }

    const name = path.basename(normalized)
    const detectedHarness = harness || this._detectHarness(normalized)

    const existing = this.db
      .prepare('SELECT id FROM sources WHERE path = ?')
      .get(normalized)
    if (existing) {
      return existing.id
    }

    const info = this._analyzeDirectory(normalized)
    this.db
      .prepare(
        `INSERT INTO sources (path, name, format, harness, session_count, indexed_count, last_scan, status)
         VALUES (?, ?, ?, ?, 0, 0, NULL, 'pending')`
      )
      .run(normalized, name, info.format, detectedHarness)

    return this.db
      .prepare('SELECT id FROM sources WHERE path = ?')
      .get(normalized).id
  }

  listSources() {
    return this.db.prepare('SELECT * FROM sources ORDER BY name').all()
  }

  removeSource(dirPath) {
    const normalized = path.resolve(dirPath)
    // Delete sessions and their messages from this source
    const sessions = this.db
      .prepare('SELECT session_id FROM sessions WHERE source_path = ?')
      .all(normalized)
    for (const s of sessions) {
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(s.session_id)
      this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(s.session_id)
    }
    this.db.prepare('DELETE FROM sources WHERE path = ?').run(normalized)
  }

  // Remove a single session from the index (undoable via re-index/refresh)
  removeSession(sessionId) {
    const safeId = String(sessionId).replace(/'/g, "''")
    this.db.exec(`DELETE FROM messages WHERE session_id = '${safeId}'`)
    this.db.exec(`DELETE FROM sessions WHERE session_id = '${safeId}'`)
  }

  _detectHarness(dirPath) {
    return this.registry.detectHarness(dirPath)
  }

  _analyzeDirectory(dirPath) {
    const files = IndexingEngine.collectSessionFiles(dirPath)
    const exts = new Set()
    for (const f of files) exts.add(path.extname(f).toLowerCase())
    let format = 'mixed'
    if (exts.size === 1) {
      const e = exts.values().next().value
      if (e === '.db' || e === '.sqlite') format = 'sqlite'
      else if (e === '.jsonl') format = 'jsonl'
      else if (e === '.json') format = 'json'
      else format = 'text'
    }
    return { format, fileCount: files.length }
  }

  // ── Indexing ──────────────────────────────────────────────────────────

  async indexSource(sourceId, options = {}) {
    const source = this.db
      .prepare('SELECT * FROM sources WHERE id = ?')
      .get(sourceId)
    if (!source) throw new Error(`Source not found: ${sourceId}`)

    const batchSize = options.batchSize || 10
    const startTime = Date.now()
    let indexed = 0
    let skipped = 0

    const discovered = this.registry.discover(source.path, source.harness)
    const files = discovered.map(d => d.filePath)
    const discoveredSet = new Set(files)

    // Remove sessions from files that are no longer discovered (e.g. validator
    // changes that exclude previously-matched non-session files)
    const staleFiles = this.db
      .prepare('SELECT DISTINCT file_path FROM sessions WHERE source_path = ?')
      .all(source.path)
      .map(r => r.file_path)
      .filter(fp => !discoveredSet.has(fp))
    for (const staleFile of staleFiles) {
      const sessionsToDelete = this.db
        .prepare('SELECT session_id FROM sessions WHERE file_path = ?')
        .all(staleFile)
      for (const s of sessionsToDelete) {
        this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(s.session_id)
        this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(s.session_id)
      }
    }

    const upsertSession = this.db.prepare(`INSERT INTO sessions (session_id, title, harness, source_path, file_path, file_ext,
                            file_mtime, file_size, file_hash, created_at, content_hash, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        title = excluded.title,
        harness = excluded.harness,
        source_path = excluded.source_path,
        file_path = excluded.file_path,
        file_ext = excluded.file_ext,
        file_mtime = excluded.file_mtime,
        file_size = excluded.file_size,
        file_hash = excluded.file_hash,
        created_at = excluded.created_at,
        indexed_at = datetime('now'),
        content_hash = excluded.content_hash,
        content = excluded.content`)

    const insertMessage = this.db.prepare(`INSERT INTO messages (session_id, message_index, role, timestamp, content, tool_calls)
      VALUES (?, ?, ?, ?, ?, ?)`)

    // Phase 1: discover sessions from files (async, outside transaction)
    const work = []
    const filesProcessedWithoutSessions = new Set()
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      for (const filePath of batch) {
        // Skip known non-session files
        if (isNonSessionFile(filePath)) continue

        const fp = this._fingerprint(filePath)
        // Skip extremely large files that could crash the indexer
        const MAX_INDEX_FILE_SIZE = 200 * 1024 * 1024 // 200 MB
        if (fp.size > MAX_INDEX_FILE_SIZE) {
          console.log(`[ENGINE] indexSource: skipping oversized file ${filePath} (${(fp.size / 1024 / 1024).toFixed(1)} MB)`)
          continue
        }
        const sessions = await this._getFileSessions(filePath)
        // Filter out sessions that have no real content (not actual conversations)
        const validSessions = sessions.filter(s => {
          // Skip sessions with numeric-only IDs (not real conversations)
          if (/^\d+$/.test(String(s.sessionId || ''))) return false
          if (/^\d+$/.test(String(s.title || ''))) return false
          // Must have a valid title
          if (!s.title || s.title.trim().length === 0) return false

          // Sessions with no messages (e.g. Codex DB sessions where content is
          // remote) are still valid sessions — allow them through if they have
          // valid metadata. Sessions with messages still need real content.
          if (!s.messages || s.messages.length === 0) {
            return true
          }

          const hasContent = s.messages.some(m => {
            const c = typeof m.content === 'string' ? m.content : (m.content != null ? String(m.content) : '')
            return c.trim().length > 0
          })
          if (!hasContent) return false
          // Skip records whose content looks like raw JSON metadata, not conversation
          const firstContent = typeof s.messages[0].content === 'string' ? s.messages[0].content : (s.messages[0].content != null ? String(s.messages[0].content) : '')
          if (firstContent.trim().startsWith('{') && firstContent.trim().endsWith('}')) {
            try {
              const parsed = JSON.parse(firstContent)
              if (parsed.models || parsed.fetched_at || parsed.etag || parsed.identity) return false
            } catch (e) {}
          }
          // Reject sessions whose content is "[object Object]" (unextracted object content)
          const hasRealText = s.messages.some(m => {
            const c = typeof m.content === 'string' ? m.content : (m.content != null ? String(m.content) : '')
            return c.trim().length > 0 && c.trim() !== '[object Object]'
          })
          if (!hasRealText) return false
          return true
        })
        if (validSessions.length === 0) {
          filesProcessedWithoutSessions.add(filePath)
          continue
        }

        for (const s of validSessions) {
          const contentHash = crypto.createHash('sha256').update(s.content).digest('hex')
          work.push({
            fp,
            session: s,
            contentHash,
            filePath
          })
        }
      }
      // Yield between batches to keep UI responsive
      await sleep()
    }

    // Remove sessions from files that produced no valid sessions (e.g. empty
    // Codex/ChatGPT threads re-scanned after previous indexing left stale rows)
    for (const filePath of filesProcessedWithoutSessions) {
      const sessionsToDelete = this.db
        .prepare('SELECT session_id FROM sessions WHERE file_path = ?')
        .all(filePath)
      for (const s of sessionsToDelete) {
        this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(s.session_id)
        this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(s.session_id)
      }
    }

    // Phase 2: write all to DB inside a transaction
    const tx = this.db.transaction(() => {
      for (const w of work) {
        const { fp, session, contentHash, filePath } = w
        upsertSession.run([
          session.sessionId,
          session.title,
          source.harness,
          source.path,
          filePath,
          path.extname(filePath).toLowerCase(),
          fp.mtime,
          fp.size,
          fp.hash,
          session.createdAt || new Date(fp.mtime).toISOString(),
          contentHash,
          session.content
        ])

        this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(session.sessionId)
        for (const m of session.messages) {
          const mc = m.content
          const contentStr = typeof mc === 'string' ? mc : String(mc != null ? mc : '')
          insertMessage.run([
            session.sessionId,
            m.message_index ?? m.index ?? 0,
            m.role,
            m.timestamp || '',
            contentStr,
            m.tool_calls ? JSON.stringify(m.tool_calls) : null
          ])
        }
        indexed++
      }
    })

    tx()

    const now = new Date().toISOString()
    const sessionCount = this.db
      .prepare('SELECT COUNT(*) as c FROM sessions WHERE source_path = ?')
      .get(source.path).c

    this.db
      .prepare(`UPDATE sources SET session_count = ?, indexed_count = ?, last_scan = ?, status = 'indexed' WHERE id = ?`)
      .run(sessionCount, indexed + skipped, now, sourceId)

    return {
      sourceId,
      sourcePath: source.path,
      indexed,
      skipped,
      total: files.length,
      sessionCount,
      durationMs: Date.now() - startTime
    }
  }

  async indexAllSources(options = {}) {
    const sources = this.listSources()
    const results = []
    for (const source of sources) {
      try {
        const result = await this.indexSource(source.id, options)
        results.push(result)
      } catch (e) {
        results.push({ sourceId: source.id, sourcePath: source.path, error: e.message })
      }
      // Yield between sources to keep UI responsive
      await sleep()
    }

    return results
  }

  // ── Incremental indexing ─────────────────────────────────────────────

  async incrementalIndex(options = {}) {
    const sources = this.listSources()
    const results = []
    for (const source of sources) {
      try {
        const result = await this._incrementalIndexSource(source.id, options)
        results.push(result)
      } catch (e) {
        results.push({ sourceId: source.id, sourcePath: source.path, error: e.message })
      }
    }
    return results
  }

  async _incrementalIndexSource(sourceId, options = {}) {
    const source = this.db
      .prepare('SELECT * FROM sources WHERE id = ?')
      .get(sourceId)
    if (!source) throw new Error(`Source not found: ${sourceId}`)

    const batchSize = options.batchSize || 10
    const discovered = this.registry.discover(source.path, source.harness)
    const files = discovered.map(d => d.filePath)
    let indexed = 0
    let skipped = 0
    let deleted = 0

    // Get currently indexed file paths for this source
    const indexedPaths = new Set(
      this.db
        .prepare('SELECT file_path FROM sessions WHERE source_path = ?')
        .all(source.path)
        .map(r => r.file_path)
    )

    const upsertSession = this.db.prepare(`INSERT INTO sessions (session_id, title, harness, source_path, file_path, file_ext,
                            file_mtime, file_size, file_hash, created_at, content_hash, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        title = excluded.title,
        harness = excluded.harness,
        source_path = excluded.source_path,
        file_path = excluded.file_path,
        file_ext = excluded.file_ext,
        file_mtime = excluded.file_mtime,
        file_size = excluded.file_size,
        file_hash = excluded.file_hash,
        created_at = excluded.created_at,
        indexed_at = datetime('now'),
        content_hash = excluded.content_hash,
        content = excluded.content`)

    const insertMessage = this.db.prepare(`INSERT INTO messages (session_id, message_index, role, timestamp, content, tool_calls)
      VALUES (?, ?, ?, ?, ?, ?)`)

    // Phase 1: discover sessions from files (async, outside transaction)
    const work = []
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize)
      for (const filePath of batch) {
        const fp = this._fingerprint(filePath)
        // Skip extremely large files that could crash the indexer
        const MAX_INDEX_FILE_SIZE = 200 * 1024 * 1024 // 200 MB
        if (fp.size > MAX_INDEX_FILE_SIZE) {
          console.log(`[ENGINE] indexSource: skipping oversized file ${filePath} (${(fp.size / 1024 / 1024).toFixed(1)} MB)`)
          continue
        }
        const existing = this.db
          .prepare('SELECT file_hash, file_mtime, file_size FROM sessions WHERE file_path = ?')
          .get(filePath)

        if (existing && existing.file_hash === fp.hash && existing.file_mtime === fp.mtime && existing.file_size === fp.size) {
          skipped++
          indexedPaths.delete(filePath)
          continue
        }

        const sessions = await this._getFileSessions(filePath)
        if (sessions.length === 0) continue

        for (const s of sessions) {
          const contentHash = crypto.createHash('sha256').update(s.content).digest('hex')
          work.push({
            fp,
            session: s,
            contentHash,
            filePath
          })
        }

        indexedPaths.delete(filePath)
      }
    }

    // Phase 2: write all to DB inside a transaction
    const tx = this.db.transaction(() => {
      for (const w of work) {
        const { fp, session, contentHash, filePath } = w
        upsertSession.run([
          session.sessionId,
          session.title,
          source.harness,
          source.path,
          filePath,
          path.extname(filePath).toLowerCase(),
          fp.mtime,
          fp.size,
          fp.hash,
          session.createdAt || new Date(fp.mtime).toISOString(),
          contentHash,
          session.content
        ])

        this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(session.sessionId)
        for (const m of session.messages) {
          insertMessage.run([
            session.sessionId,
            m.message_index ?? m.index ?? 0,
            m.role,
            m.timestamp || '',
            m.content || '',
            m.tool_calls ? JSON.stringify(m.tool_calls) : null
          ])
        }
        indexed++
      }

      // Remove deleted files (and all their sessions)
      for (const filePath of indexedPaths) {
        const sessionsToDelete = this.db
          .prepare('SELECT session_id FROM sessions WHERE file_path = ?')
          .all(filePath)
        for (const s of sessionsToDelete) {
          this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(s.session_id)
          this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(s.session_id)
          deleted++
        }
      }
    })

    tx()

    const now = new Date().toISOString()
    const sessionCount = this.db
      .prepare('SELECT COUNT(*) as c FROM sessions WHERE source_path = ?')
      .get(source.path).c

    this.db
      .prepare(`UPDATE sources SET session_count = ?, indexed_count = ?, last_scan = ?, status = 'indexed' WHERE id = ?`)
      .run(sessionCount, indexed, now, sourceId)

    return {
      sourceId,
      sourcePath: source.path,
      indexed,
      skipped,
      deleted,
      total: files.length,
      sessionCount,
      durationMs: 0
    }
  }

  // ── Session extraction helpers ───────────────────────────────────────

  /**
   * Get all sessions from a file using the appropriate adapter.
   * Returns an array of { sessionId, title, createdAt, messages, content, filePath }.
   * Falls back to static parsing if no adapter matches.
   */
  async _getFileSessions(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    const adapter = this.registry.findAdapterForFile(filePath)

    if (adapter) {
      if (typeof adapter.parseAllSessions === 'function') {
        const sessions = await adapter.parseAllSessions(filePath)
        return sessions.map(s => {
          const content = (s.messages || [])
            .map(m => {
              const c = m.content
              return typeof c === 'string' ? c : String(c != null ? c : '')
            })
            .join('\n')
          return {
            sessionId: s.sessionId,
            title: s.title,
            createdAt: s.createdAt || '',
            messages: s.messages || [],
            content: content || '',
            filePath,
            harness: s.harness || adapter.harness || 'Unknown'
          }
        })
      }
      const parsed = adapter.parseSession(filePath)
      if (parsed) {
        const text = adapter.extractText(filePath)
        return [{
          sessionId: parsed.sessionId,
          title: parsed.title,
          createdAt: parsed.createdAt || '',
          messages: parsed.messages || [],
          content: typeof text === 'string' ? text : String(text || ''),
          filePath,
          harness: parsed.harness || adapter.harness || 'Unknown'
        }]
      }
      return []
    }

    // Fallback: static parsing
    const content = await IndexingEngine.readSessionFileContent(filePath)
    const sessionId = path.basename(filePath, ext)
    let title = sessionId
    let createdAt = ''

    if (ext === '.json') {
      try {
        const obj = JSON.parse(content)
        sessionId = obj.session_id || sessionId
        title = obj.title || obj.label || title
        createdAt = obj.timestamp || obj.created_at || ''
      } catch (e) {}
    } else if (ext === '.jsonl') {
      try {
        const firstLine = content.split('\n')[0]
        if (firstLine) {
          const obj = JSON.parse(firstLine)
          sessionId = obj.session_id || sessionId
          title = obj.title || obj.label || title
          createdAt = obj.timestamp || obj.created_at || ''
        }
      } catch (e) {}
    } else {
      const firstLine = content.split('\n')[0]
      if (firstLine) title = firstLine.substring(0, 200)
      createdAt = new Date(this._fingerprint(filePath).mtime).toISOString()
    }

    return [{
      sessionId,
      title,
      createdAt,
      messages: await IndexingEngine.parseMessages(filePath, sessionId),
      content,
      filePath,
      harness: 'Unknown'
    }]
  }

  search(query, options = {}) {
    const limit = options.limit || 50
    const harness = options.harness || null
    const role = options.role || null
    const excerptLength = options.excerptLength || 200

    const like = '%' + query + '%'
    const enabledHarnesses = options.enabledHarnesses || null

    let sql = `
      SELECT s.id, s.session_id, s.title, s.harness, s.source_path, s.file_path,
             s.created_at, s.file_mtime,
             CASE
               WHEN s.title LIKE ? THEN 1
               WHEN s.content LIKE ? THEN 2
               ELSE 3
             END AS rank
      FROM sessions s
      WHERE (s.title LIKE ? OR s.content LIKE ? OR s.harness LIKE ?)
    `
    const params = [like, like, like, like, like]

    if (harness) {
      sql += ` AND s.harness = ?`
      params.push(harness)
    }

    if (enabledHarnesses) {
      if (enabledHarnesses.length === 0) return []
      sql += ` AND s.harness IN (${enabledHarnesses.map(() => '?').join(', ')})`
      params.push(...enabledHarnesses)
    }

    sql += ` ORDER BY rank, s.created_at DESC`
    if (limit) {
      sql += ` LIMIT ?`
      params.push(limit)
    }

    const rows = this.db.prepare(sql).all(params)

    // Add excerpts
    const results = rows.map(row => {
      const content = row.title + '\n' + this._getSessionContent(row.session_id)
      const excerpt = this._excerpt(content, query, excerptLength)
      return {
        id: row.session_id,
        session_id: row.session_id,
        title: row.title,
        harness: row.harness,
        source_path: row.source_path,
        file_path: row.file_path,
        created_at: row.created_at,
        rank: row.rank,
        excerpt
      }
    })

    return results
  }

  searchMessages(query, options = {}) {
    const limit = options.limit || 50
    const harness = options.harness || null
    const role = options.role || null

    const like = '%' + query + '%'

    let sql = `
      SELECT m.id, m.session_id, m.message_index, m.role, m.timestamp, m.content,
             s.title, s.harness, s.file_path,
             CASE
               WHEN m.content LIKE ? THEN 1
               ELSE 2
             END AS rank
      FROM messages m
      JOIN sessions s ON s.session_id = m.session_id
      WHERE m.content LIKE ?
    `
    const params = [like, like]

    if (harness) {
      sql += ` AND s.harness = ?`
      params.push(harness)
    }
    if (role) {
      sql += ` AND m.role = ?`
      params.push(role)
    }

    sql += ` ORDER BY rank, m.message_index`
    if (limit) {
      sql += ` LIMIT ?`
      params.push(limit)
    }

    return this.db.prepare(sql).all(params)
  }

  // ── Session retrieval ─────────────────────────────────────────────────

  getSession(sessionId) {
    const session = this.db
      .prepare('SELECT * FROM sessions WHERE session_id = ?')
      .get(sessionId)
    if (!session) return null

    const messages = this.db
      .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY message_index')
      .all(sessionId)

    return {
      ...session,
      messages
    }
  }

  getContext(sessionId, messageIndex, before = 5, after = 5) {
    const session = this.db
      .prepare('SELECT * FROM sessions WHERE session_id = ?')
      .get(sessionId)
    if (!session) return null

    const messages = this.db
      .prepare(
        `SELECT * FROM messages WHERE session_id = ? AND message_index BETWEEN ? AND ?
         ORDER BY message_index`
      )
      .all(sessionId, messageIndex - before, messageIndex + after)

    return {
      session: {
        id: session.session_id,
        title: session.title,
        harness: session.harness,
        created_at: session.created_at
      },
      messages,
      centerIndex: messageIndex
    }
  }

  listSessions(options = {}) {
    const harness = options.harness || null
    const enabledHarnesses = options.enabledHarnesses || null
    const limit = options.limit || 10000
    let sql = 'SELECT * FROM sessions'
    const params = []
    const conditions = []
    if (harness) {
      conditions.push('harness = ?')
      params.push(harness)
    }
    if (enabledHarnesses) {
      if (enabledHarnesses.length === 0) return []
      conditions.push(`harness IN (${enabledHarnesses.map(() => '?').join(', ')})`)
      params.push(...enabledHarnesses)
    }
    if (conditions.length) {
      sql += ' WHERE ' + conditions.join(' AND ')
    }
    sql += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)
    return this.db.prepare(sql).all(params)
  }

  getAllHarnesses() {
    const rows = this.db.prepare('SELECT DISTINCT harness FROM sessions').all()
    return rows.map(r => r.harness).filter(h => h != null && h !== '')
  }

  countSessions() {
    return this.db.prepare('SELECT COUNT(*) as c FROM sessions').get().c
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  _getSessionContent(sessionId) {
    const messages = this.db
      .prepare('SELECT content FROM messages WHERE session_id = ? ORDER BY message_index')
      .all(sessionId)
    return messages.map(m => m.content).join('\n')
  }

  _excerpt(content, query, maxLength) {
    const queryLower = query.toLowerCase()
    const contentLower = content.toLowerCase()
    const idx = contentLower.indexOf(queryLower)
    if (idx < 0) {
      return content.substring(0, maxLength)
    }
    const start = Math.max(0, idx - 100)
    const end = Math.min(content.length, idx + query.length + 100)
    return content.substring(start, end).replace(/\n/g, ' ')
  }
}

module.exports = { IndexingEngine, SUPPORTED_EXTS }
