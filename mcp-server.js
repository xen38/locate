#!/usr/bin/env node
/**
 * Locate MCP Server
 *
 * Exposes the Locate search engine as MCP tools so AI assistants can search
 * archived sessions without reading interface or wasting tokens.
 *
 * Uses the core IndexingEngine (SQLite FTS5) for all search and retrieval.
 *
 * Usage: node mcp-server.js
 * Transport: stdio (JSON-RPC 2.0)
 */

const path = require('path')
const fs = require('fs')
const os = require('os')
const { IndexingEngine } = require('./packages/core/index')

// ── Configuration ──────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(
  process.env.APPDATA || process.env.HOME || os.homedir(),
  'locate-mcp-config.json'
)

// Shared index database path — same location used by the desktop app so both
// components share a single index.
const INDEX_DB_PATH = path.join(
  process.env.APPDATA || process.env.HOME || os.homedir(),
  'locate',
  'locate-index.db'
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
    const dir = path.dirname(CONFIG_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
  } catch (e) {
    console.error('[locate-mcp] Failed to save config:', e.message)
  }
}

loadConfig()

// ── Core Indexing Engine ───────────────────────────────────────────────────

const engine = new IndexingEngine(INDEX_DB_PATH)
engine.open().catch(e => console.error('[locate-mcp] Failed to open index:', e))

// ── MCP Server ─────────────────────────────────────────────────────────────

const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js')

const server = new Server(
  { name: 'locate', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'locate_search',
        description: 'Search across all indexed archived sessions using full-text search (FTS5). Returns ranked results with excerpts, session metadata, and source references.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query - free text matched against session titles and message content',
            },
            harness: {
              type: 'string',
              description: 'Optional harness filter (e.g. "GitHub Copilot", "Cline", "Codex")',
            },
            role: {
              type: 'string',
              description: 'Optional message role filter (e.g. "user", "assistant")',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 50)',
              minimum: 1,
              maximum: 200,
            },
            excerptLength: {
              type: 'number',
              description: 'Maximum excerpt length in characters (default: 200)',
              minimum: 50,
              maximum: 2000,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'locate_get_session',
        description: 'Retrieve a complete indexed session by session ID, including all messages.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID to retrieve',
            },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'locate_get_context',
        description: 'Retrieve messages surrounding a specific message index within a session.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID',
            },
            messageIndex: {
              type: 'number',
              description: 'The center message index',
            },
            before: {
              type: 'number',
              description: 'Number of preceding messages (default: 5)',
              minimum: 0,
              maximum: 50,
            },
            after: {
              type: 'number',
              description: 'Number of following messages (default: 5)',
              minimum: 0,
              maximum: 50,
            },
          },
          required: ['sessionId', 'messageIndex'],
        },
      },
      {
        name: 'locate_list_sessions',
        description: 'List all indexed sessions across all registered harnesses.',
        inputSchema: {
          type: 'object',
          properties: {
            harness: {
              type: 'string',
              description: 'Optional harness filter',
            },
            limit: {
              type: 'number',
              description: 'Maximum sessions to return (default: 100)',
              minimum: 1,
              maximum: 500,
            },
          },
        },
      },
      {
        name: 'locate_list_harnesses',
        description: 'List all registered harness directories and their indexing status.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'locate_add_harness',
        description: 'Register a new directory as a harness source for indexing.',
        inputSchema: {
          type: 'object',
          properties: {
            dirPath: {
              type: 'string',
              description: 'Absolute path to the harness directory containing session archives',
            },
            harness: {
              type: 'string',
              description: 'Optional harness name override (auto-detected if omitted)',
            },
          },
          required: ['dirPath'],
        },
      },
      {
        name: 'locate_index_source',
        description: 'Index a specific registered harness directory. Scans session files and adds them to the FTS5 search index.',
        inputSchema: {
          type: 'object',
          properties: {
            dirPath: {
              type: 'string',
              description: 'Absolute path of the harness directory to index',
            },
          },
          required: ['dirPath'],
        },
      },
      {
        name: 'locate_index_all',
        description: 'Index all registered harness directories that have not yet been indexed.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'locate_status',
        description: 'Return indexing health, source counts, session counts, and engine availability.',
        inputSchema: {
          type: 'object',
          properties: {},
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
        const results = engine.search(args.query, {
          harness: args.harness || undefined,
          role: args.role || undefined,
          limit: args.limit || 50,
          excerptLength: args.excerptLength || 200,
        })
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  query: args.query,
                  totalResults: results.length,
                  results: results.map(r => ({
                    id: r.session_id,
                    session_id: r.session_id,
                    title: r.title,
                    harness: r.harness,
                    source_path: r.source_path,
                    file_path: r.file_path,
                    created_at: r.created_at,
                    rank: r.rank,
                    excerpt: r.excerpt,
                  })),
                },
                null,
                2
              ),
            },
          ],
        }
      }

      case 'locate_get_session': {
        const session = engine.getSession(args.sessionId)
        if (!session) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  session_id: session.session_id,
                  title: session.title,
                  harness: session.harness,
                  source_path: session.source_path,
                  file_path: session.file_path,
                  created_at: session.created_at,
                  indexed_at: session.indexed_at,
                  messages: session.messages || [],
                },
                null,
                2
              ),
            },
          ],
        }
      }

      case 'locate_get_context': {
        const ctx = engine.getContext(args.sessionId, args.messageIndex, args.before || 5, args.after || 5)
        if (!ctx) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Session not found' }, null, 2) }],
            isError: true,
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(ctx, null, 2),
            },
          ],
        }
      }

      case 'locate_list_sessions': {
        const sessions = engine.listSessions({
          harness: args.harness || undefined,
          limit: args.limit || 100,
        })
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  totalSessions: sessions.length,
                  sessions: sessions.map(s => ({
                    id: s.session_id,
                    session_id: s.session_id,
                    title: s.title,
                    harness: s.harness,
                    source_path: s.source_path,
                    file_path: s.file_path,
                    created_at: s.created_at,
                    indexed_at: s.indexed_at,
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
        const sources = engine.listSources()
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  harnesses: sources.map(s => ({
                    id: s.id,
                    path: s.path,
                    name: s.name,
                    format: s.format,
                    harness: s.harness,
                    session_count: s.session_count,
                    indexed_count: s.indexed_count,
                    last_scan: s.last_scan,
                    status: s.status,
                    error: s.error,
                  })),
                },
                null,
                2
              ),
            },
          ],
        }
      }

      case 'locate_add_harness': {
        try {
          const sourceId = engine.addSource(args.dirPath, args.harness || undefined)
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    sourceId,
                    path: path.resolve(args.dirPath),
                    added: args.dirPath,
                  status: 'pending',
                  note: 'Source registered. Call locate_index_source or locate_index_all to index sessions.',
                },
                null,
                2
              ),
            },
          ],
        }
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: e.message }, null, 2) }],
          isError: true,
        }
      }
      }

      case 'locate_index_source': {
      try {
        const normalized = path.resolve(args.dirPath)
        const sources = engine.listSources()
        const source = sources.find(s => path.resolve(s.path) === normalized)
        if (!source) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Source not registered: ' + args.dirPath }, null, 2) }],
            isError: true,
          }
        }
        const result = engine.indexSource(source.id)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  path: normalized,
                  sourceId: source.id,
                  indexed: result.indexed || 0,
                  skipped: result.skipped || 0,
                  total: result.total || 0,
                  status: result.status || 'done',
                },
                null,
                2
              ),
            },
          ],
        }
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: e.message }, null, 2) }],
          isError: true,
        }
      }
      }

      case 'locate_index_all': {
      try {
        const result = engine.indexAllSources()
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  indexed: result.indexed || 0,
                  skipped: result.skipped || 0,
                  total: result.total || 0,
                  sources: result.sources || [],
                },
                null,
                2
              ),
            },
          ],
        }
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: e.message }, null, 2) }],
          isError: true,
        }
      }
      }

      case 'locate_status': {
        const sources = engine.listSources()
        const sessionCount = engine.countSessions()
        const indexedSources = sources.filter(s => s.status === 'indexed').length
        const errorSources = sources.filter(s => s.status === 'error').length
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  engine: 'IndexingEngine (SQLite FTS5)',
                  database: INDEX_DB_PATH,
                  initialized: engine.initialized,
                  totalSources: sources.length,
                  indexedSources,
                  pendingSources: sources.length - indexedSources - errorSources,
                  errorSources,
                  totalSessions: sessionCount,
                  sources: sources.map(s => ({
                    path: s.path,
                    harness: s.harness,
                    status: s.status,
                    session_count: s.session_count,
                    indexed_count: s.indexed_count,
                    last_scan: s.last_scan,
                    error: s.error,
                  })),
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