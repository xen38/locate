const path = require('path')
const fs = require('fs')
const initSqlJs = require('sql.js')
const { wrapDb } = require('../packages/core/db-compat')

let SQL = null
const sqlPromise = initSqlJs({
  locateFile: file => path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', file)
}).then(sql => { SQL = sql })

// Reuse the extraction functions from main.js
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

async function extractTextFromSqlite(dbPath) {
  try {
    await sqlPromise
    const buffer = fs.readFileSync(dbPath)
    const db = wrapDb(new SQL.Database(buffer))
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
        const query = `SELECT ${[idCol, ...textCols].join(', ')} FROM ${table} LIMIT 100`
        const rows = db.prepare(query).all()

        for (const row of rows) {
          const parts = []
          for (const col of textCols) {
            if (row[col] && typeof row[col] === 'string') {
              parts.push(row[col])
            }
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
    return `[SQLite error: ${e.message}]`
  }
}

function readSessionFileContent(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  try {
    switch (ext) {
      case '.jsonl':
        return extractTextFromJsonl(fs.readFileSync(filePath, 'utf8'))
      case '.json':
        try {
          const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'))
          return extractTextFromJsonValue(obj)
        } catch (e) {
          return extractTextFromJsonl(fs.readFileSync(filePath, 'utf8'))
        }
      case '.db':
      case '.sqlite':
        return extractTextFromSqlite(filePath)
      case '.md':
      case '.txt':
        return fs.readFileSync(filePath, 'utf8')
      default:
        return fs.readFileSync(filePath, 'utf8')
    }
  } catch (e) {
    return `[Error reading ${filePath}: ${e.message}]`
  }
}

function readSessionFileContent(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  try {
    switch (ext) {
      case '.jsonl':
        return extractTextFromJsonl(fs.readFileSync(filePath, 'utf8'))
      case '.json':
        try {
          const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'))
          return extractTextFromJsonValue(obj)
        } catch (e) {
          return extractTextFromJsonl(fs.readFileSync(filePath, 'utf8'))
        }
      case '.db':
      case '.sqlite':
        return extractTextFromSqlite(filePath)
      case '.md':
      case '.txt':
        return fs.readFileSync(filePath, 'utf8')
      default:
        return fs.readFileSync(filePath, 'utf8')
    }
  } catch (e) {
    return `[Error reading ${filePath}: ${e.message}]`
  }
}

const tests = [
  { name: 'Cline JSON session', file: 'C:\\Users\\luizy\\.cline\\data\\sessions\\1793856300703_vVUs5_cli\\1793856300703_vVUs5_cli.json' },
  { name: 'Pi JSONL session', file: 'C:\\Users\\luizy\\.pi\\agent\\sessions\\--K----\\2026-11-05T06-15-33-232Z_01a1aa59-2c6f-70be-8872-b58b081de28e.jsonl' },
  { name: 'Cursor agent markdown', file: 'C:\\Users\\luizy\\.cursor\\agents\\meteor-client-expert.md' },
  { name: 'Copilot SQLite', file: 'C:\\Users\\luizy\\.copilot\\data.db' },
  { name: 'Codex SQLite', file: 'C:\\Users\\luizy\\.codex\\goals_1.sqlite' },
  { name: 'T3 SQLite', file: 'C:\\Users\\luizy\\.t3\\userdata\\statev2.sqlite' },
]

let passed = 0
let failed = 0

for (const t of tests) {
  try {
    if (!fs.existsSync(t.file)) {
      console.log(`SKIP: ${t.name} - file not found`)
      continue
    }
    const content = readSessionFileContent(t.file)
    const len = content.length
    const preview = content.substring(0, 200).replace(/\n/g, ' ')
    if (len > 0) {
      console.log(`PASS: ${t.name} (${len} chars): ${preview}...`)
      passed++
    } else {
      console.log(`FAIL: ${t.name} - empty content`)
      failed++
    }
  } catch (e) {
    console.log(`FAIL: ${t.name} - ${e.message}`)
    failed++
  }
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
