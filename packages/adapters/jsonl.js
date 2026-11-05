/**
 * JSONL archive adapter.
 *
 * Handles harnesses that store sessions as JSON Lines files:
 *   - Pi (.pi/agent/sessions/*.jsonl)
 *   - Cline (.cline/sessions/*.jsonl)
 *
 * Each line is a JSON object representing a message.
 */

const path = require('path')
const fs = require('fs')
const { BaseAdapter } = require('./base')

class JsonlAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({
      name: options.name || 'JSONL',
      harness: options.harness || 'Unknown',
      extensions: ['.jsonl'],
      ...options
    })
  }

  canHandle(filePath) {
    return path.extname(filePath).toLowerCase() === '.jsonl'
  }

  parseSession(filePath) {
    const content = this._readFile(filePath)
    const lines = content.split('\n').filter(l => l.trim())
    const messages = []
    let sessionId = path.basename(filePath, '.jsonl')
    let title = sessionId
    let createdAt = ''

    let index = 0
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (obj.session_id && !sessionId) sessionId = obj.session_id
        if (obj.title && !title) title = obj.title
        if (obj.timestamp && !createdAt) createdAt = obj.timestamp

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

    // Use first message's timestamp as createdAt if not set
    if (!createdAt && messages.length > 0) {
      createdAt = messages[0].timestamp || ''
    }

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
    const parsed = this.parseSession(filePath)
    return parsed.messages.map(m => m.content).join('\n')
  }
}

module.exports = { JsonlAdapter }
