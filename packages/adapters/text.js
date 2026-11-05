/**
 * Text/Markdown archive adapter.
 *
 * Handles harnesses that store sessions as plain text or Markdown files:
 *   - Cursor (.cursor/agents/*.md)
 *   - Cline (.cline/sessions/*.md, *.txt)
 *
 * Paragraphs separated by blank lines are treated as individual messages.
 */

const path = require('path')
const fs = require('fs')
const { BaseAdapter } = require('./base')

class TextAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({
      name: options.name || 'Text',
      harness: options.harness || 'Unknown',
      extensions: ['.md', '.txt'],
      ...options
    })
  }

  canHandle(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    return ext === '.md' || ext === '.txt'
  }

  parseSession(filePath) {
    const content = this._readFile(filePath)
    const sessionId = path.basename(filePath, path.extname(filePath))
    const firstLine = content.split('\n')[0]
    const title = firstLine ? firstLine.substring(0, 200) : sessionId
    const createdAt = ''

    // Split into paragraphs as messages
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim())
    const messages = paragraphs.map((p, i) => ({
      session_id: sessionId,
      message_index: i,
      role: 'unknown',
      timestamp: '',
      content: p.trim(),
      tool_calls: null
    }))

    return {
      sessionId,
      title,
      createdAt,
      messages,
      filePath,
      harness: this.harness
    }
  }

  extractText(filePath) {
    return this._readFile(filePath)
  }
}

module.exports = { TextAdapter }
