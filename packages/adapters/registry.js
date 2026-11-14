/**
 * Adapter registry.
 *
 * Maps file extensions and directory names to the appropriate harness adapter.
 * Provides a unified interface for discovering and parsing session files
 * across all supported harness formats.
 */

const path = require('path')
const fs = require('fs')
const { SQLiteAdapter } = require('./sqlite')
const { JsonlAdapter } = require('./jsonl')
const { JsonAdapter } = require('./json')
const { TextAdapter } = require('./text')
const { OpencodeAdapter } = require('./opencode')
const { CodexAdapter } = require('./codex')
const { ClaudeCodeAdapter } = require('./claude-code')

// Harness detection from directory path
function detectHarness(dirPath) {
  const lower = dirPath.toLowerCase()
  const base = path.basename(lower)
  if (base.includes('cline') || lower.includes('cline')) return 'Cline'
  if (base.includes('codex') || lower.includes('codex')) return 'Codex'
  if (base.includes('copilot') || lower.includes('copilot')) return 'GitHub Copilot'
  if (base.includes('cursor') || lower.includes('cursor')) return 'Cursor'
  if (base.includes('pi') || lower.includes('pi')) return 'Pi'
  if (base.includes('t3') || lower.includes('t3')) return 'T3 Code'
  if (base.includes('claude') || lower.includes('claude')) return 'Claude Code'
  if (base.includes('opencode') || lower.includes('opencode')) return 'OpenCode'
  if (base.includes('crush') || lower.includes('crush')) return 'OpenCode / Crush'
  if (base.includes('windsurf') || lower.includes('windsurf')) return 'Windsurf'
  if (base.includes('aider') || lower.includes('aider')) return 'Aider'
  if (base.includes('continue') || lower.includes('continue')) return 'Continue'
  if (base.includes('zed') || lower.includes('zed')) return 'Zed'
  if (base.includes('roo') || lower.includes('roo')) return 'Roo'
  if (base.includes('gemini') || lower.includes('gemini')) return 'Gemini CLI'
  return 'Unknown'
}

// ── Per-harness session file validators ─────────────────────────────────
//
// Each validator returns true only if the given file path is a real session
// file for that harness. Files that don't match are skipped during discovery.

function makeCursorValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.jsonl') return false
    // Cursor sessions: projects/*/agent-transcripts/<uuid>/<uuid>.jsonl
    // Exclude subagent transcripts under subagents/
    const parts = filePath.split(/[\\/]/)
    if (parts.includes('subagents')) return false
    return parts.includes('agent-transcripts')
  }
}

function makeClineValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath)
    const lower = base.toLowerCase()
    const parts = filePath.split(/[\\/]/)
    // Cline sessions can be .json, .jsonl, .md, or .txt
    if (!['.json', '.jsonl', '.md', '.txt'].includes(ext)) return false
    // Must be under a cline directory (e.g. .cline, cline)
    if (!parts.some(p => p === '.cline' || p === 'cline')) return false
    // Must be in a "sessions" directory
    if (!parts.includes('sessions')) return false
    // Exclude companion messages files (e.g. session_XXX.messages.json)
    if (lower.endsWith('.messages.json')) return false
    // Exclude known non-session config files
    const nameWithoutExt = path.basename(filePath, ext).toLowerCase()
    const nonSessionNames = ['settings', 'config', 'providers', 'feature-flags']
    if (nonSessionNames.includes(nameWithoutExt)) return false
    return true
  }
}

function makeCodexValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath)
    const parts = filePath.split(/[\\/]/)
    // Codex session database: codex.db (or codex-dev.db) contains local_thread_catalog
    // with ChatGPT thread metadata. Other .sqlite files under .codex (goals_1.sqlite,
    // logs_2.sqlite, state_5.sqlite, etc.) are NOT session files.
    if (ext === '.sqlite' || ext === '.db') {
      return /^codex(\.dev)?\.db$/i.test(base)
    }
    // Codex archived sessions: .jsonl files under .codex/archived_sessions/
    // contain real local session transcripts with message content.
    if (ext === '.jsonl') {
      return parts.includes('archived_sessions') && parts.some(p => p === '.codex' || p === 'codex')
    }
    return false
  }
}

function makeCopilotValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath)
    const parts = filePath.split(/[\\/]/)
    // Copilot sessions:
    //   - data.db or session-store.db at .copilot/ root (NOT chats/)
    //   - session-state/<uuid>/session.db
    if (base === 'data.db' || base === 'session-store.db') {
      return parts.includes('.copilot') && !parts.includes('chats')
    }
    if (base === 'session.db' && parts.includes('session-state')) return true
    return false
  }
}

function makePiValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.jsonl' && ext !== '.ndjson') return false
    // Pi sessions: agent/sessions/<workspace>/<timestamp>_<uuid>.jsonl
    const parts = filePath.split(/[\\/]/)
    return parts.includes('agent') && parts.includes('sessions')
  }
}

function makeT3CodeValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath)
    const lower = base.toLowerCase()
    const parts = filePath.split(/[\\/]/)
    // T3 Code sessions come in two shapes:
    //   - .t3/userdata/statev2.sqlite  (settled/archived sessions, SQLite)
    //   - .../agent-device/sessions/<session>/events.ndjson  (device session stream)
    if (ext === '.sqlite' || ext === '.db') {
      return /^statev2(\.\d+)?\.sqlite$/i.test(lower)
    }
    if (ext === '.ndjson' || ext === '.jsonl') {
      if (lower !== 'events.ndjson') return false
      return parts.includes('agent-device') && parts.includes('sessions')
    }
    return false
  }
}

function makeClaudeCodeValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.jsonl') return false
    // Claude Code sessions: ~/.claude/projects/<workspace>/<session_id>.jsonl
    const parts = filePath.split(/[\\/]/)
    return parts.includes('.claude') && parts.includes('projects')
  }
}

function makeOpencodeValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath)
    const lower = base.toLowerCase()
    const parts = filePath.split(/[\\/]/)
    const inOpencode = parts.some(p => p === '.opencode' || p === '.crush' || p === 'opencode' || p === 'crush')
    if (!inOpencode) return false
    // OpenCode / Crush store conversations in SQLite databases
    if (ext === '.sqlite' || ext === '.db') {
      const name = path.basename(filePath, ext).toLowerCase()
      // Skip cache / temp / lock databases
      if (NON_SESSION_DB_NAMES.has(name)) return false
      return true
    }
    // JSONL session exports
    if (ext === '.jsonl' || ext === '.ndjson') {
      return parts.includes('sessions') || parts.includes('conversations')
    }
    return false
  }
}

function makeWindsurfValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.json' && ext !== '.jsonl') return false
    const parts = filePath.split(/[\\/]/)
    return parts.some(p => p === '.windsurf' || p === 'windsurf')
  }
}

function makeContinueValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.json' && ext !== '.jsonl') return false
    const parts = filePath.split(/[\\/]/)
    return parts.some(p => p === '.continue' || p === 'continue')
  }
}

function makeZedValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.json') return false
    const parts = filePath.split(/[\\/]/)
    return parts.some(p => p === '.zed' || p === 'zed')
  }
}

function makeRooValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.json' && ext !== '.jsonl') return false
    const parts = filePath.split(/[\\/]/)
    return parts.some(p => p === '.roo' || p === 'roo')
  }
}

function makeAiderValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.json' && ext !== '.md') return false
    const parts = filePath.split(/[\\/]/)
    return parts.some(p => p === '.aider' || p === 'aider')
  }
}

function makeGeminiValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.json' && ext !== '.jsonl') return false
    const parts = filePath.split(/[\\/]/)
    return parts.some(p => p === '.gemini' || p === 'gemini')
  }
}

// Known non-session database names for SQLite-backed harnesses (Opencode/Crush, etc.)
const NON_SESSION_DB_NAMES = new Set([
  'cache', 'temp', 'tmp', 'lock', 'config', 'settings', 'models_cache',
  'platform-cache', 'repo-metadata-cache', 'session-search'
])

function getSessionValidator(harness) {
  const validators = {
    Cursor: makeCursorValidator(),
    Cline: makeClineValidator(),
    Codex: makeCodexValidator(),
    'GitHub Copilot': makeCopilotValidator(),
    Pi: makePiValidator(),
    'T3 Code': makeT3CodeValidator(),
    'Claude Code': makeClaudeCodeValidator(),
    'OpenCode / Crush': makeOpencodeValidator(),
    OpenCode: makeOpencodeValidator(),
    Windsurf: makeWindsurfValidator(),
    Continue: makeContinueValidator(),
    Zed: makeZedValidator(),
    Roo: makeRooValidator(),
    Aider: makeAiderValidator(),
    'Gemini CLI': makeGeminiValidator()
  }
  const validator = validators[harness]
  if (!validator) return () => false // Unknown harness → discover nothing
  return validator
}

class AdapterRegistry {
  constructor() {
    this.adapters = []
    this._registerBuiltins()
  }

  _registerBuiltins() {
    // OpenCode adapter - handles opencode.db (better-sqlite3, large files).
    // Registered BEFORE SQLiteAdapter so opencode.db matches this adapter first.
    this.adapters.push(new OpencodeAdapter({ harness: 'OpenCode' }))

    // Codex adapter - handles codex.db (sql.js) for ChatGPT thread catalog.
    // Registered BEFORE SQLiteAdapter so codex.db matches this adapter first.
    this.adapters.push(new CodexAdapter({ harness: 'Codex' }))

    // SQLite adapter - handles .db/.sqlite files (Codex fallback, T3 Code, generic)
    this.adapters.push(new SQLiteAdapter({ harness: 'SQLite' }))

    // SQLite adapter for GitHub Copilot session-store.db
    this.adapters.push(new SQLiteAdapter({ harness: 'GitHub Copilot' }))

    // JSONL adapter - handles .jsonl files (Pi, Cline, Claude Code)
    this.adapters.push(new JsonlAdapter({ harness: 'JSONL' }))

    // Claude Code adapter - handles Claude Code .jsonl session transcripts
    this.adapters.push(new ClaudeCodeAdapter({ harness: 'Claude Code' }))

    // JSON adapter - handles .json files
    this.adapters.push(new JsonAdapter({ harness: 'JSON' }))

    // Text/Markdown adapter - handles .md/.txt files
    this.adapters.push(new TextAdapter({ harness: 'Text' }))
  }

  /**
   * Find the best adapter for a given file path.
   * Returns the adapter instance or null if none matches.
   */
  findAdapterForFile(filePath) {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(filePath)) return adapter
    }
    return null
  }

  /**
   * Discover all session files in a directory, filtered per-harness.
   *
   * @param {string} dirPath - The source root directory to scan
   * @param {string|null} harness - Optional harness name. If not provided,
   *   it is detected from the directory path.
   * @returns {Array<{filePath, ext, adapter, harness}>}
   */
  discover(dirPath, harness = null) {
    if (!harness) harness = detectHarness(dirPath)
    const isSessionFile = getSessionValidator(harness)

    const discovered = []
    const walk = (currentDir) => {
      try {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true })
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name)
          if (entry.isDirectory()) {
            walk(fullPath)
          } else if (entry.isFile()) {
            const adapter = this.findAdapterForFile(fullPath)
            if (adapter && isSessionFile(fullPath)) {
              discovered.push({
                filePath: fullPath,
                ext: path.extname(entry.name).toLowerCase(),
                adapter,
                harness
              })
            }
          }
        }
      } catch (e) {
        // skip inaccessible directories
      }
    }
    walk(dirPath)
    return discovered
  }

  /**
   * Parse a session file using the appropriate adapter.
   * Returns parsed session data or null.
   */
  parseSession(filePath) {
    const adapter = this.findAdapterForFile(filePath)
    if (!adapter) return null
    return adapter.parseSession(filePath)
  }

  /**
   * Extract text content from a file using the appropriate adapter.
   */
  extractText(filePath) {
    const adapter = this.findAdapterForFile(filePath)
    if (!adapter) return ''
    return adapter.extractText(filePath)
  }

  /**
   * Get the detected harness name for a directory.
   */
  detectHarness(dirPath) {
    return detectHarness(dirPath)
  }

  listAdapters() {
    return this.adapters.map(a => ({ name: a.name, harness: a.harness, extensions: a.extensions }))
  }
}

module.exports = { AdapterRegistry, detectHarness, getSessionValidator }
