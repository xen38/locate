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
  if (base.includes('windsurf') || lower.includes('windsurf')) return 'Windsurf'
  if (base.includes('aider') || lower.includes('aider')) return 'Aider'
  if (base.includes('continue') || lower.includes('continue')) return 'Continue'
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
    const parts = filePath.split(path.sep)
    return parts.includes('agent-transcripts')
  }
}

function makeClineValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath)
    if (ext !== '.json') return false
    // Cline sessions: data/sessions/<session_id>/session_<id>.json
    if (!/^session_/.test(base)) return false
    const parts = filePath.split(path.sep)
    return parts.includes('data') && parts.includes('sessions')
  }
}

function makeCodexValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath)
    if (ext !== '.sqlite' && ext !== '.db') return false
    // Codex session databases: goals_1.sqlite, logs_2.sqlite, etc.
    // Not: auth.json, config.toml, models_cache.json
    return /^(goals|logs|queue|memories|state)_\d+\.sqlite$/i.test(base)
  }
}

function makeCopilotValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath)
    if (ext !== '.db' && ext !== '.sqlite') return false
    // Copilot sessions: data.db or session-store.db inside chats/
    if (base !== 'data.db' && base !== 'session-store.db') return false
    const parts = filePath.split(path.sep)
    return parts.includes('chats')
  }
}

function makePiValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    if (ext !== '.jsonl' && ext !== '.ndjson') return false
    // Pi sessions: agent/sessions/<workspace>/<timestamp>_<uuid>.jsonl
    const parts = filePath.split(path.sep)
    return parts.includes('agent') && parts.includes('sessions')
  }
}

function makeT3CodeValidator() {
  return (filePath) => {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath)
    if (ext !== '.ndjson' && ext !== '.jsonl') return false
    // T3 Code sessions: userdata/device/agent-device/sessions/<session>/events.ndjson
    if (base !== 'events.ndjson') return false
    const parts = filePath.split(path.sep)
    return parts.includes('agent-device') && parts.includes('sessions')
  }
}

function getSessionValidator(harness) {
  const validators = {
    Cursor: makeCursorValidator(),
    Cline: makeClineValidator(),
    Codex: makeCodexValidator(),
    'GitHub Copilot': makeCopilotValidator(),
    Pi: makePiValidator(),
    'T3 Code': makeT3CodeValidator()
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
    // SQLite adapter - handles .db/.sqlite files
    this.adapters.push(new SQLiteAdapter({ harness: 'SQLite' }))

    // JSONL adapter - handles .jsonl files
    this.adapters.push(new JsonlAdapter({ harness: 'JSONL' }))

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

module.exports = { AdapterRegistry, detectHarness }
