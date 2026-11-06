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
   * Discover all session files in a directory, grouped by adapter.
   * Returns { adapter: [...files], ... } or a flat list with adapter info.
   */
  discover(dirPath) {
    const discovered = []
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
          discovered.push(...this.discover(fullPath))
        } else if (entry.isFile()) {
          const adapter = this.findAdapterForFile(fullPath)
          if (adapter) {
            discovered.push({
              filePath: fullPath,
              ext: path.extname(entry.name).toLowerCase(),
              adapter,
              harness: detectHarness(dirPath)
            })
          }
        }
      }
    } catch (e) {
      // skip inaccessible directories
    }
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
