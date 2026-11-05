#!/usr/bin/env node
/**
 * Locate MCP Server
 * 
 * Exposes the Locate app's session archive search functionality as MCP tools
 * so that AI assistants (Claude, Cline, Opencode, GitHub Copilot, etc.) can
 * search archived sessions without reading interface or wasting tokens.
 * 
 * Usage: node mcp-server.js
 * Transport: stdio (JSON-RPC 2.0)
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js')
const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

// ── Configuration ──────────────────────────────────────────────────────────
const CONFIG_FILE = path.join(
  process.env.APPDATA || process.env.HOME || require('os').homedir(),
  'locate-mcp-config.json'
)

const DEFAULT_CONFIG = {
  harnessDirectories: [],
  batchSize: 10,
}

let config = { ...DEFAULT_CONFIG }

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }
    }
  } catch (e) {
    console.error('[locate-mcp] Failed to load config:', e.message)
  }
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
  } catch (e) {
    console.error('[locate-mcp] Failed to save config:', e.message)
  }
}

loadConfig()

// ── Session reading helpers ────────────────────────────────────────────────

const SUPPORTED_EXTS = ['.md', '.txt', '.json', '.jsonl', '.db', '.sqlite']

function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function extractTextFromJsonl(content) {
  // JSONL: each line is a JSON object. Extract text from message/content fields.
  const lines = content.split('\n').filter(l => l.trim())
  const texts = []
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      const text = extractTextFromJson(obj)
      if (text) texts.push(text)
    } catch (e) {
      // Not valid JSON, treat as plain text
      if (line.trim()) texts.push(line.trim())
    }
  }
  return texts.join('\n')
}

function extractTextFromJson(obj) {
  if (typeof obj === 'string') return obj
  if (obj === null || obj === undefined) return ''

  // Common message/content fields
  if (typeof obj.content === 'string') return obj.content
  if (typeof obj.message === 'string') return obj.message
  if (typeof obj.text === 'string') return obj.text
  if (typeof obj.prompt === 'string') return obj.prompt
  if (typeof obj.response === 'string') return obj.response

  // Array of content blocks (Pi, Claude style)
  if (Array.isArray(obj.content)) {
    return obj.content
      .map(c => (typeof c === 'string' ? c : c.text || c.content || ''))
      .filter(Boolean)
      .join('\n')
  }

  // Recurse into object values
  const parts = []
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' || k === 'id' || k === 'timestamp' || k === 'role') continue
    if (typeof v === 'string' && v.length > 0) parts.push(`${k}: ${v}`)
    else if (typeof v === 'object' && v !== null) {
      const t = extractTextFromJson(v)
      if (t) parts.push(t)
    }
  }
  return parts.join('\n')
}

function extractTextFromJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    // Try parsing as single JSON object
    try {
      const obj = JSON.parse(content)
      return extractTextFromJson(obj)
    } catch (e) {
      // Not a single JSON object, try JSONL
      return extractTextFromJsonl(content)
    }
  } catch (e) {
    return ''
  }
}

function extractTextFromSqlite(dbPath) {
  // Try to open as SQLite and extract session text
  try {
    const db = new Database(dbPath, { readonly: true })
    const texts = []

    // List all tables
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

        // Look for text-like columns
        const textCols = columns.filter(c =>
          /content|message|text|body|prompt|response|title|summary/i.test(c)
        )

        if (textCols.length === 0) continue

        const idCol = columns.find(c => /id|session|thread/i.test(c)) || columns[0]
        const query = `SELECT ${[idCol, ...textCols].join(', ')} FROM ${table} LIMIT 1000`
        const rows = db.prepare(query).all()

        for (const row of rows) {
          const parts = []
          for (const col of textCols) {
            if (row[col] && typeof row[col] === 'string') {
              parts.push(row[col])
            }
          }
          if (parts.length > 0) {
            texts.push(parts.join('\n'))
          }
        }
      } catch (e) {
        // Skip tables that can't be read
      }
    }

    db.close()
    return texts.join('\n')
  } catch (e) {
    return ''
  }
}

function readSessionFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  try {
    switch (ext) {
      case '.jsonl':
        return extractTextFromJsonl(readTextFile(filePath))
      case '.json':
        return extractTextFromJsonFile(filePath)
      case '.db':
      case '.sqlite':
        return extractTextFromSqlite(filePath)
      case '.md':
      case '.txt':
        return readTextFile(filePath)
      default:
        return readTextFile(filePath)
    }
  } catch (e) {
    return `[Error reading ${filePath}: ${e.message}]`
  }
}

function collectSessionFiles(dirPath) {
  // Recursively collect session files (with supported extensions) under dirPath.
  const files = []
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        files.push(...collectSessionFiles(fullPath))
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (SUPPORTED_EXTS.includes(ext)) {
          files.push({ name: entry.name, fullPath })
        }
      }
    }
  } catch (e) {
    // Directory may not exist or be inaccessible
  }
  return files
}

function listSessionsInDir(dirPath) {
  const sessions = []
  try {
    const files = collectSessionFiles(dirPath)
    for (const { name: entryName, fullPath: filePath } of files) {
      const ext = path.extname(entryName).toLowerCase()
      const stat = fs.statSync(filePath)
      const label = path.basename(entryName, ext)

      // Read a small preview
      let preview = ''
      try {
        if (ext === '.jsonl') {
          const content = fs.readFileSync(filePath, 'utf8')
          const firstLine = content.split('\n')[0]
          preview = firstLine ? firstLine.substring(0, 120) : entryName
        } else if (ext === '.json') {
          const content = fs.readFileSync(filePath, 'utf8')
          try {
            const obj = JSON.parse(content)
            preview = (obj.title || obj.label || obj.session_id || entryName).toString().substring(0, 120)
          } catch (e) {
            preview = entryName
          }
        } else {
          const content = fs.readFileSync(filePath, 'utf8')
          const firstLine = content.split('\n')[0]
          preview = firstLine ? firstLine.substring(0, 120) : entryName
        }
      } catch (e) {
        preview = entryName
      }

      sessions.push({
        id: filePath,
        label: label,
        preview: preview,
        harness: path.basename(dirPath),
        directory: dirPath,
        modified: stat.mtimeMs,
        size: stat.size,
        ext,
      })
    }
    sessions.sort((a, b) => b.modified - a.modified)
  } catch (e) {
    // Directory may not exist
  }
  return sessions
}

function listAllSessions() {
  const all = []
  for (const dir of config.harnessDirectories) {
    all.push(...listSessionsInDir(dir))
  }
  all.sort((a, b) => b.modified - a.modified)
  return all
}

function searchSessions(query, options = {}) {
  const batchSize = options.batchSize || config.batchSize || 10
  const queryLower = query.toLowerCase()
  const results = []

  for (const dir of config.harnessDirectories) {
    try {
      const files = collectSessionFiles(dir)

      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize)
        for (const { name: entryName, fullPath: filePath } of batch) {
          try {
            const content = readSessionFile(filePath)
            const label = path.basename(entryName, path.extname(entryName))
            const labelMatch = label.toLowerCase().includes(queryLower)
            const contentMatch = content.toLowerCase().includes(queryLower)

            if (!labelMatch && !contentMatch) continue

            let context = ''
            if (contentMatch) {
              const idx = content.toLowerCase().indexOf(queryLower)
              const start = Math.max(0, idx - 100)
              const end = Math.min(content.length, idx + query.length + 100)
              context = content.substring(start, end).replace(/\n/g, ' ')
            }

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
          } catch (e) {
            // Skip unreadable files
          }
        }
      }
    } catch (e) {
      // Skip inaccessible directories
    }
  }

  results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
  return results
}

// ── MCP Server ─────────────────────────────────────────────────────────────

const server = new Server(
  {
    name: 'locate',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'locate_search',
        description: 'Search across all archived sessions in the Locate app. Scans titles and contents of all sessions across configured harnesses. Returns ranked results with context snippets.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query - free text to match against session titles and contents',
            },
            batchSize: {
              type: 'number',
              description: 'Number of sessions to scan in parallel per group (5, 10, or 20). Default: 10',
              minimum: 1,
              maximum: 100,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'locate_read_session',
        description: 'Read the full content of a specific archived session by its file path.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Full file path of the session to read',
            },
          },
          required: ['filePath'],
        },
      },
      {
        name: 'locate_list_sessions',
        description: 'List all archived sessions across all configured harness directories.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'locate_list_harnesses',
        description: 'List all configured harness directories in the Locate app.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'locate_add_harness',
        description: 'Add a new harness directory to scan for archived sessions.',
        inputSchema: {
          type: 'object',
          properties: {
            dirPath: {
              type: 'string',
              description: 'Absolute path to the harness directory containing session files',
            },
          },
          required: ['dirPath'],
        },
      },
    ],
  }
})

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'locate_search': {
        const results = searchSessions(args.query, { batchSize: args.batchSize })
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  query: args.query,
                  totalResults: results.length,
                  results: results.slice(0, 50),
                },
                null,
                2
              ),
            },
          ],
        }
      }

      case 'locate_read_session': {
        const content = readSessionFile(args.filePath)
        const stat = fs.statSync(args.filePath)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  path: args.filePath,
                  content,
                  modified: stat.mtimeMs,
                  size: stat.size,
                },
                null,
                2
              ),
            },
          ],
        }
      }

      case 'locate_list_sessions': {
        const sessions = listAllSessions()
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  totalSessions: sessions.length,
                  sessions: sessions.map(s => ({
                    id: s.id,
                    label: s.label,
                    harness: s.harness,
                    preview: s.preview,
                    modified: s.modified,
                  })),
                },
                null,
                2
              ),
            },
          ],
        }
      }

      case 'locate_list_harnesses': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  harnesses: config.harnessDirectories,
                },
                null,
                2
              ),
            },
          ],
        }
      }

      case 'locate_add_harness': {
        if (!config.harnessDirectories.includes(args.dirPath)) {
          config.harnessDirectories.push(args.dirPath)
          saveConfig()
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  harnesses: config.harnessDirectories,
                  added: args.dirPath,
                },
                null,
                2
              ),
            },
          ],
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (e) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: e.message }, null, 2),
        },
      ],
      isError: true,
    }
  }
})

// ── Start ──────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[locate-mcp] Locate MCP server running on stdio')
}

main().catch((err) => {
  console.error('[locate-mcp] Fatal error:', err)
  process.exit(1)
})
