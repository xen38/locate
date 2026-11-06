/**
 * Locate Core Indexing Engine
 *
 * SQLite FTS5-based full-text search index for archived coding sessions.
 * Reads original session files read-only; never copies or modifies them.
 *
 * Schema:
 *   sources       - registered harness directories
 *   sessions      - session records (metadata + file fingerprint)
 *   messages      - individual messages (role, timestamp, content, tool calls)
 *   sessions_fts  - FTS5 virtual table over session content
 *   messages_fts  - FTS5 virtual table over message content
 */

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const Database = require('better-sqlite3')
const { AdapterRegistry } = require('../adapters/registry')

// Supported session file extensions
const SUPPORTED_EXTS = new Set(['.md', '.txt', '.json', '.jsonl', '.db', '.sqlite'])

class IndexingEngine {
  constructor(dbPath) {
    this.dbPath = dbPath
    this.db = null
    this.initialized = false
    this.registry = new AdapterRegistry()
  }

  // ── Initialization ────────────────────────────────────────────────────

  open() {
    const dir = path.dirname(this.dbPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    this.db = new Database(this.dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this._createSchema()
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

      CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
        session_id, title, content, harness,
        content='sessions', content_rowid='id'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        session_id, role, content, timestamp,
        content='messages', content_rowid='id'
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_harness ON sessions(harness);
      CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source_path);
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
      CREATE INDEX IF NOT EXISTS idx_sessions_file ON sessions(file_path);
    `)

    // Triggers to keep FTS tables in sync with content tables
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
        INSERT INTO sessions_fts(rowid, session_id, title, content, harness)
        VALUES (new.id, new.session_id, new.title, new.content, new.harness);
      END;

      CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
        INSERT INTO sessions_fts(sessions_fts, rowid, session_id, title, content, harness)
        VALUES ('delete', old.id, old.session_id, old.title, old.content, old.harness);
      END;

      CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
        INSERT INTO sessions_fts(sessions_fts, rowid, session_id, title, content, harness)
        VALUES ('delete', old.id, old.session_id, old.title, old.content, old.harness);
        INSERT INTO sessions_fts(rowid, session_id, title, content, harness)
        VALUES (new.id, new.session_id, new.title, new.content, new.harness);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, session_id, role, content, timestamp)
        VALUES (new.id, new.session_id, new.role, new.content, new.timestamp);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, session_id, role, content, timestamp)
        VALUES ('delete', old.id, old.session_id, old.role, old.content, old.timestamp);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, session_id, role, content, timestamp)
        VALUES ('delete', old.id, old.session_id, old.role, old.content, old.timestamp);
        INSERT INTO messages_fts(rowid, session_id, role, content, timestamp)
        VALUES (new.id, new.session_id, new.role, new.content, new.timestamp);
      END;
    `)
  }

  close() {
    if (this.db) {
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

  static extractTextFromSqlite(dbPath) {
    try {
      const db = new Database(dbPath, { readonly: true })
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

  static readSessionFileContent(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    try {
      switch (ext) {
        case '.jsonl':
          return IndexingEngine.extractTextFromJsonl(IndexingEngine.readTextFile(filePath))
        case '.json':
          return IndexingEngine.extractTextFromJsonFile(filePath)
        case '.db':
        case '.sqlite':
          return IndexingEngine.extractTextFromSqlite(filePath)
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

  static parseMessages(filePath, sessionId) {
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
        const db = new Database(filePath, { readonly: true })
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
              messages.push({
                session_id: sessionId,
                message_index: index++,
                role: roleCol ? row[roleCol] : 'unknown',
                timestamp: tsCol ? row[tsCol] : '',
                content: row[contentCol] || '',
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

  static collectSessionFiles(dirPath) {
    const results = []
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          results.push(...IndexingEngine.collectSessionFiles(fullPath))
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (SUPPORTED_EXTS.has(ext)) results.push(fullPath)
        }
      }
    } catch (e) {
      // skip inaccessible directories
    }
    return results
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
    // Delete sessions from this source first (cascades to messages)
    const sessions = this.db
      .prepare('SELECT session_id FROM sessions WHERE source_path = ?')
      .all(normalized)
    for (const s of sessions) {
      this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(s.session_id)
    }
    this.db.prepare('DELETE FROM sources WHERE path = ?').run(normalized)
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

  indexSource(sourceId, options = {}) {
    const source = this.db
      .prepare('SELECT * FROM sources WHERE id = ?')
      .get(sourceId)
    if (!source) throw new Error(`Source not found: ${sourceId}`)

    const batchSize = options.batchSize || 10
    const startTime = Date.now()
    let indexed = 0
    let skipped = 0

    const discovered = this.registry.discover(source.path)
    const files = discovered.map(d => d.filePath)

    const upsertSession = this.db.prepare(`
      INSERT INTO sessions (session_id, title, harness, source_path, file_path, file_ext,
                            file_mtime, file_size, file_hash, created_at, content_hash, content)
      VALUES (@session_id, @title, @harness, @source_path, @file_path, @file_ext,
              @file_mtime, @file_size, @file_hash, @created_at, @content_hash, @content)
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
        content = excluded.content
    `);

    const insertMessage = this.db.prepare(`
      INSERT INTO messages (session_id, message_index, role, timestamp, content, tool_calls)
      VALUES (@session_id, @message_index, @role, @timestamp, @content, @tool_calls)
    `)

    const fileToAdapter = new Map()
    for (const d of discovered) fileToAdapter.set(d.filePath, d.adapter)

    const tx = this.db.transaction(() => {
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize)
        for (const filePath of batch) {
          const fp = this._fingerprint(filePath)
          const existing = this.db
            .prepare('SELECT file_hash, file_mtime, file_size FROM sessions WHERE file_path = ?')
            .get(filePath)

          if (existing && existing.file_hash === fp.hash && existing.file_mtime === fp.mtime && existing.file_size === fp.size) {
            skipped++
            continue
          }

          const sessions = this._getFileSessions(filePath)

          if (sessions.length === 0) continue

          for (const s of sessions) {
            const contentHash = crypto.createHash('sha256').update(s.content).digest('hex')

            upsertSession.run({
              session_id: s.sessionId,
              title: s.title,
              harness: source.harness,
              source_path: source.path,
              file_path: filePath,
              file_ext: path.extname(filePath).toLowerCase(),
              file_mtime: fp.mtime,
              file_size: fp.size,
              file_hash: fp.hash,
              created_at: s.createdAt || new Date(fp.mtime).toISOString(),
              content_hash: contentHash,
              content: s.content
            })

            // Parse and insert messages (replace existing)
            this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(s.sessionId)
            for (const m of s.messages) {
              insertMessage.run({
                session_id: s.sessionId,
                message_index: m.message_index ?? m.index ?? 0,
                role: m.role,
                timestamp: m.timestamp || '',
                content: m.content || '',
                tool_calls: m.tool_calls ? JSON.stringify(m.tool_calls) : null
              })
            }

            indexed++
          }
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

  indexAllSources(options = {}) {
    const sources = this.listSources()
    const results = []
    for (const source of sources) {
      try {
        const result = this.indexSource(source.id, options)
        results.push(result)
      } catch (e) {
        results.push({ sourceId: source.id, sourcePath: source.path, error: e.message })
      }
    }
    return results
  }

  // ── Incremental indexing ─────────────────────────────────────────────

  incrementalIndex(options = {}) {
    const sources = this.listSources()
    const results = []
    for (const source of sources) {
      try {
        const result = this._incrementalIndexSource(source.id, options)
        results.push(result)
      } catch (e) {
        results.push({ sourceId: source.id, sourcePath: source.path, error: e.message })
      }
    }
    return results
  }

  _incrementalIndexSource(sourceId, options = {}) {
    const source = this.db
      .prepare('SELECT * FROM sources WHERE id = ?')
      .get(sourceId)
    if (!source) throw new Error(`Source not found: ${sourceId}`)

    const batchSize = options.batchSize || 10
    const discovered = this.registry.discover(source.path)
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

    const upsertSession = this.db.prepare(`
      INSERT INTO sessions (session_id, title, harness, source_path, file_path, file_ext,
                            file_mtime, file_size, file_hash, created_at, content_hash, content)
      VALUES (@session_id, @title, @harness, @source_path, @file_path, @file_ext,
              @file_mtime, @file_size, @file_hash, @created_at, @content_hash, @content)
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
        content = excluded.content
    `)

    const insertMessage = this.db.prepare(`
      INSERT INTO messages (session_id, message_index, role, timestamp, content, tool_calls)
      VALUES (@session_id, @message_index, @role, @timestamp, @content, @tool_calls)
    `)

    const fileToAdapter = new Map()
    for (const d of discovered) fileToAdapter.set(d.filePath, d.adapter)

    const tx = this.db.transaction(() => {
      // Process new/modified files
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize)
        for (const filePath of batch) {
          const fp = this._fingerprint(filePath)
          const existing = this.db
            .prepare('SELECT file_hash, file_mtime, file_size FROM sessions WHERE file_path = ?')
            .get(filePath)

          if (existing && existing.file_hash === fp.hash && existing.file_mtime === fp.mtime && existing.file_size === fp.size) {
            skipped++
            indexedPaths.delete(filePath)
            continue
          }

          const sessions = this._getFileSessions(filePath)

          if (sessions.length === 0) continue

          for (const s of sessions) {
            const contentHash = crypto.createHash('sha256').update(s.content).digest('hex')

            upsertSession.run({
              session_id: s.sessionId,
              title: s.title,
              harness: source.harness,
              source_path: source.path,
              file_path: filePath,
              file_ext: path.extname(filePath).toLowerCase(),
              file_mtime: fp.mtime,
              file_size: fp.size,
              file_hash: fp.hash,
              created_at: s.createdAt || new Date(fp.mtime).toISOString(),
              content_hash: contentHash,
              content: s.content
            })

            this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(s.sessionId)
            for (const m of s.messages) {
              insertMessage.run({
                session_id: s.sessionId,
                message_index: m.message_index ?? m.index ?? 0,
                role: m.role,
                timestamp: m.timestamp || '',
                content: m.content || '',
                tool_calls: m.tool_calls ? JSON.stringify(m.tool_calls) : null
              })
            }

            indexed++
          }

          indexedPaths.delete(filePath)
        }
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
  _getFileSessions(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    const adapter = this.registry.findAdapterForFile(filePath)

    if (adapter) {
      if (typeof adapter.parseAllSessions === 'function') {
        return adapter.parseAllSessions(filePath).map(s => ({
          sessionId: s.sessionId,
          title: s.title,
          createdAt: s.createdAt || '',
          messages: s.messages || [],
          content: adapter.extractText(filePath) || '',
          filePath,
          harness: s.harness || adapter.harness || 'Unknown'
        }))
      }
      const parsed = adapter.parseSession(filePath)
      if (parsed) {
        return [{
          sessionId: parsed.sessionId,
          title: parsed.title,
          createdAt: parsed.createdAt || '',
          messages: parsed.messages || [],
          content: adapter.extractText(filePath) || '',
          filePath,
          harness: parsed.harness || adapter.harness || 'Unknown'
        }]
      }
      return []
    }

    // Fallback: static parsing
    const content = IndexingEngine.readSessionFileContent(filePath)
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
      messages: IndexingEngine.parseMessages(filePath, sessionId),
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

    let sql = `
      SELECT s.id, s.session_id, s.title, s.harness, s.source_path, s.file_path,
             s.created_at, s.file_mtime,
             bm25(sessions_fts) AS rank
      FROM sessions_fts
      JOIN sessions s ON s.id = sessions_fts.rowid
      WHERE sessions_fts MATCH ?
    `
    const params = [query]

    if (harness) {
      sql += ` AND s.harness = ?`
      params.push(harness)
    }

    sql += ` ORDER BY rank`
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

    let sql = `
      SELECT m.id, m.session_id, m.message_index, m.role, m.timestamp, m.content,
             s.title, s.harness, s.file_path,
             bm25(messages_fts) AS rank
      FROM messages_fts
      JOIN messages m ON m.id = messages_fts.rowid
      JOIN sessions s ON s.session_id = m.session_id
      WHERE messages_fts MATCH ?
    `
    const params = [query]

    if (harness) {
      sql += ` AND s.harness = ?`
      params.push(harness)
    }
    if (role) {
      sql += ` AND m.role = ?`
      params.push(role)
    }

    sql += ` ORDER BY rank LIMIT ?`
    params.push(limit)

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
    const limit = options.limit || 100
    let sql = 'SELECT * FROM sessions'
    const params = []
    if (harness) {
      sql += ' WHERE harness = ?'
      params.push(harness)
    }
    sql += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)
    return this.db.prepare(sql).all(params)
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
