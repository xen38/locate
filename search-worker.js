/**
 * Locate search worker thread.
 *
 * Runs the cross-harness session search off the Electron main thread so the
 * UI stays responsive while scanning potentially thousands of session files.
 *
 * Receives: { query, directories, batchSize }
 * Sends back: { results }
 */

const { parentPort, workerData } = require('worker_threads')
const fs = require('fs')
const path = require('path')
const Database = require('better-sqlite3')

const { query, directories, batchSize = 10 } = workerData || {}
const queryLower = (query || '').toLowerCase()
const results = []

const SUPPORTED_EXTS = ['.md', '.txt', '.json', '.jsonl', '.db', '.sqlite']
const CHUNK_SIZE = 64 * 1024 // 64 KB chunks for large text files

// ── Text extraction (read-only, no copies) ────────────────────────────────

function extractTextFromJsonl(content) {
  const lines = content.split('\n').filter(l => l.trim())
  const texts = []
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      const text = extractTextFromJsonValue(obj)
      if (text) texts.push(text)
    } catch (e) {
      if (line.trim()) texts.push(line.trim())
    }
  }
  return texts.join('\n')
}

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

function readTextFile(filePath) {
  // Read as UTF-8 and strip a leading BOM so JSON.parse works on files
  // saved with a byte-order mark (common on Windows).
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
}

function extractTextFromJsonFile(filePath) {
  try {
    const content = readTextFile(filePath)
    try {
      const obj = JSON.parse(content)
      return extractTextFromJsonValue(obj)
    } catch (e) {
      return extractTextFromJsonl(content)
    }
  } catch (e) {
    return ''
  }
}

function extractTextFromSqlite(dbPath) {
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
          /content|message|text|body|prompt|response|title|summary/i.test(c)
        )
        if (textCols.length === 0) continue
        const idCol = columns.find(c => /id|session|thread/i.test(c)) || columns[0]
        const querySql = `SELECT ${[idCol, ...textCols].join(', ')} FROM ${table} LIMIT 1000`
        const rows = db.prepare(querySql).all()
        for (const row of rows) {
          const parts = []
          for (const col of textCols) {
            if (row[col] && typeof row[col] === 'string') parts.push(row[col])
          }
          if (parts.length > 0) texts.push(parts.join('\n'))
        }
      } catch (e) {
        // skip
      }
    }
    db.close()
    return texts.join('\n')
  } catch (e) {
    return ''
  }
}

function readSessionFileContent(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  try {
    switch (ext) {
      case '.jsonl': return extractTextFromJsonl(fs.readFileSync(filePath, 'utf8'))
      case '.json': return extractTextFromJsonFile(filePath)
      case '.db':
      case '.sqlite': return extractTextFromSqlite(filePath)
      case '.md':
      case '.txt': return readTextFile(filePath)
      default: return readTextFile(filePath)
    }
  } catch (e) {
    return `[Error reading ${filePath}: ${e.message}]`
  }
}

/**
 * Search a single large text file in chunks, returning the first matching
 * context snippet (or null). Avoids loading entire huge files into memory.
 */
function searchTextFileChunks(filePath) {
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
  } catch (e) {
    return null
  }
  const stat = fs.fstatSync(fd)
  const size = stat.size
  const overlap = queryLower.length + 200
  let foundContext = null
  let offset = 0

  try {
    while (offset < size && !foundContext) {
      const chunkLen = Math.min(CHUNK_SIZE, size - offset)
      const buf = Buffer.alloc(chunkLen)
      fs.readSync(fd, buf, 0, chunkLen, offset)
      const chunk = buf.toString('utf8')
      const idx = chunk.toLowerCase().indexOf(queryLower)
      if (idx >= 0) {
        const absIdx = offset + idx
        const start = Math.max(0, absIdx - 100)
        const end = Math.min(size, absIdx + queryLower.length + 100)
        // Re-read the context window cleanly
        const ctxBuf = Buffer.alloc(end - start)
        fs.readSync(fd, ctxBuf, 0, end - start, start)
        foundContext = ctxBuf.toString('utf8').replace(/\n/g, ' ')
      }
      offset += chunkLen
      // Overlap region to catch matches split across chunk boundaries
      if (offset < size) offset = Math.max(0, offset - overlap)
    }
  } catch (e) {
    // ignore read errors
  } finally {
    try { fs.closeSync(fd) } catch (e) { /* ignore */ }
  }
  return foundContext
}

function collectSessionFiles(dirPath) {
  const results = []
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        results.push(...collectSessionFiles(fullPath))
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (SUPPORTED_EXTS.includes(ext)) results.push(fullPath)
      }
    }
  } catch (e) {
    // skip inaccessible directories
  }
  return results
}

function getSessionPreview(filePath, ext) {
  try {
    if (ext === '.jsonl') {
      const content = fs.readFileSync(filePath, 'utf8')
      const firstLine = content.split('\n')[0]
      return firstLine ? firstLine.substring(0, 120) : path.basename(filePath)
    }
    if (ext === '.json') {
      const content = fs.readFileSync(filePath, 'utf8')
      try {
        const obj = JSON.parse(content)
        return (obj.title || obj.label || obj.session_id || path.basename(filePath)).toString().substring(0, 120)
      } catch (e) {
        return path.basename(filePath)
      }
    }
    if (ext === '.db' || ext === '.sqlite') {
      return `SQLite database: ${path.basename(filePath)}`
    }
    const content = fs.readFileSync(filePath, 'utf8')
    const firstLine = content.split('\n')[0].trim()
    return firstLine || content.substring(0, 100)
  } catch (e) {
    return path.basename(filePath)
  }
}

function processFile(filePath, dir) {
  const ext = path.extname(filePath).toLowerCase()
  const label = path.basename(filePath, ext)
  const labelMatch = label.toLowerCase().includes(queryLower)

  let contentMatch = false
  let context = ''

  // Label-only match: no need to read file contents.
  if (labelMatch) {
    contentMatch = false
  } else {
    // Content match: read file. For large plain-text files use chunked reading
    // to avoid loading the whole file into memory.
    if (ext === '.md' || ext === '.txt') {
      context = searchTextFileChunks(filePath)
      contentMatch = context !== null
    } else {
      const content = readSessionFileContent(filePath)
      const contentLower = content.toLowerCase()
      const idx = contentLower.indexOf(queryLower)
      contentMatch = idx >= 0
      if (contentMatch) {
        const start = Math.max(0, idx - 100)
        const end = Math.min(content.length, idx + queryLower.length + 100)
        context = content.substring(start, end).replace(/\n/g, ' ')
      }
    }
  }

  if (!labelMatch && !contentMatch) return

  results.push({
    id: filePath,
    label,
    harness: path.basename(dir),
    directory: dir,
    labelMatch,
    contentMatch,
    context,
    score: (labelMatch ? 2 : 0) + (contentMatch ? 1 : 0),
  })
}

async function run() {
  for (const dir of directories) {
    try {
      const filePaths = collectSessionFiles(dir)
      // Process files in batches of batchSize within this worker thread.
      for (let i = 0; i < filePaths.length; i += batchSize) {
        const batch = filePaths.slice(i, i + batchSize)
        await Promise.all(batch.map((fp) => processFile(fp, dir)))
      }
    } catch (e) {
      // skip inaccessible directories
    }
  }

  // Deduplicate by file path so overlapping or repeated directories never
  // produce duplicate results.
  const seen = new Set()
  const deduped = []
  for (const r of results) {
    if (!seen.has(r.id)) {
      seen.add(r.id)
      deduped.push(r)
    }
  }

  deduped.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
  parentPort.postMessage({ results: deduped })
}

run().catch((err) => {
  parentPort.postMessage({ error: err.message })
})
