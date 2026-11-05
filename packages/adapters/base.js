/**
 * Base harness adapter.
 *
 * Each harness adapter implements a common interface for discovering,
 * parsing, and extracting content from session archive files.
 *
 * All file access is read-only. Original archives are never modified.
 */

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

class BaseAdapter {
  constructor(options = {}) {
    this.name = options.name || 'Unknown'
    this.harness = options.harness || 'Unknown'
    this.extensions = options.extensions || []
  }

  // ── Discovery ─────────────────────────────────────────────────────────

  /**
   * Check if this adapter can handle a given file path.
   * Returns true if the file extension matches.
   */
  canHandle(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    return this.extensions.includes(ext)
  }

  /**
   * Discover session files in a directory.
   * Returns an array of { filePath, ext } objects.
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
          results.push({ filePath: fullPath, ext: path.extname(entry.name).toLowerCase() })
        }
      }
    } catch (e) {
      // Skip inaccessible directories
    }
    return results
  }

  // ── Parsing ───────────────────────────────────────────────────────────

  /**
   * Parse a session file into structured data.
   * Returns { sessionId, title, createdAt, messages: [] } or null.
   */
  parseSession(filePath) {
    throw new Error('parseSession not implemented')
  }

  /**
   * Extract full text content from a file for indexing.
   */
  extractText(filePath) {
    throw new Error('extractText not implemented')
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  _readFile(filePath) {
    return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
  }

  _fingerprint(filePath) {
    try {
      const stat = fs.statSync(filePath)
      const hash = crypto.createHash('sha256')
        .update(filePath + '|' + stat.size + '|' + stat.mtimeMs)
        .digest('hex')
      return { mtime: stat.mtimeMs, size: stat.size, hash }
    } catch (e) {
      return { mtime: 0, size: 0, hash: '' }
    }
  }
}

module.exports = { BaseAdapter }
