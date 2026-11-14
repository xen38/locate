/**
 * JSON archive adapter.
 *
 * Handles harnesses that store sessions as JSON files:
 *   - Cline (.cline/sessions/*.json)
 *
 * A JSON file may contain a single session object or an array of messages.
 */

const path = require('path')
const fs = require('fs')
const { BaseAdapter } = require('./base')

class JsonAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({
      name: options.name || 'JSON',
      harness: options.harness || 'Unknown',
      extensions: ['.json'],
      ...options
    })
  }

  canHandle(filePath) {
    return path.extname(filePath).toLowerCase() === '.json'
  }

  parseSession(filePath) {
    const content = this._readFile(filePath)
    let obj
    try {
      obj = JSON.parse(content)
    } catch (e) {
      // Fall back to treating as JSONL
      const { JsonlAdapter } = require('./jsonl')
      return new JsonlAdapter({ harness: this.harness }).parseSession(filePath)
    }

    const sessionId = obj.session_id || obj.id || path.basename(filePath, '.json')
    const title = obj.title || obj.label || sessionId
    const createdAt = obj.timestamp || obj.created_at || ''
    const messages = []

    if (Array.isArray(obj.messages)) {
      obj.messages.forEach((m, i) => {
        messages.push({
          session_id: sessionId,
          message_index: i,
          role: m.role || 'unknown',
          timestamp: m.timestamp || '',
          content: m.content || m.text || m.message || '',
          tool_calls: m.tool_calls || null
        })
      })
    } else {
      // Single message object or session metadata (e.g. Cline)
      // Extract prompt/text/content as the session content
      const content = obj.prompt || obj.content || obj.text || obj.message || ''
      messages.push({
        session_id: sessionId,
        message_index: 0,
        role: obj.role || 'user',
        timestamp: obj.timestamp || obj.created_at || '',
        content: typeof content === 'string' ? content : '',
        tool_calls: obj.tool_calls || null
      })
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

module.exports = { JsonAdapter }
