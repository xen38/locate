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
      extensions: ['.jsonl', '.ndjson'],
      ...options
    })
  }

  canHandle(filePath) {
    return path.extname(filePath).toLowerCase() === '.jsonl'
  }

  parseSession(filePath) {
    const content = this._readFile(filePath).trim()
    const messages = []
    let sessionId = path.basename(filePath, '.jsonl')
    let title = sessionId
    let createdAt = ''

    // Helper to extract text content from a message object
    const extractContent = (obj) => {
      let c = obj.content || obj.text || obj.message || ''
      if (typeof c === 'object' && c !== null) {
        if (Array.isArray(c)) {
          c = c.map(x => (typeof x === 'string' ? x : x.text || '')).filter(Boolean).join('\n')
        } else if (typeof c.text === 'string') {
          c = c.text
        } else if (typeof c.content === 'string') {
          c = c.content
        } else if (Array.isArray(c.content)) {
          c = c.content.map(x => (typeof x === 'string' ? x : x.text || '')).filter(Boolean).join('\n')
        } else {
          c = ''
        }
      }
      return typeof c === 'string' ? c : ''
    }

    // Try parsing the whole file as JSON (handles single JSON object or array)
    try {
      const obj = JSON.parse(content)
      const arr = Array.isArray(obj) ? obj : [obj]
      let index = 0
      for (const item of arr) {
        if (typeof item !== 'object' || item === null) continue
        if (item.session_id && !sessionId) sessionId = item.session_id
        if (item.title && !title) title = item.title
        if (item.timestamp && !createdAt) createdAt = item.timestamp
        messages.push({
          session_id: sessionId,
          message_index: index++,
          role: item.role || 'unknown',
          timestamp: item.timestamp || '',
          content: extractContent(item),
          tool_calls: item.tool_calls || item.tools || null
        })
      }
      if (!createdAt && messages.length > 0) createdAt = messages[0].timestamp || ''
      return { sessionId, title, createdAt, messages, filePath, harness: this.harness }
    } catch (e) {
      // Fall back to multi-line JSON chunks separated by blank lines
      // (e.g. Pi harness stores pretty-printed JSON objects separated by blank lines)
    }

    // Multi-line JSON chunks: split concatenated JSON objects by tracking brace depth
    // (e.g. Pi harness stores pretty-printed JSON objects directly adjacent: }\\n{)
    const chunks = splitConcatJson(content)
    let chunkIndex = 0
    let chunkMessages = 0
    for (const chunk of chunks) {
      try {
        const obj = JSON.parse(chunk)
        if (typeof obj !== 'object' || obj === null) continue
        if (obj.session_id && !sessionId) sessionId = obj.session_id
        if (obj.title && !title) title = obj.title
        if (obj.timestamp && !createdAt) createdAt = obj.timestamp
        messages.push({
          session_id: sessionId,
          message_index: chunkIndex++,
          role: obj.role || 'unknown',
          timestamp: obj.timestamp || '',
          content: extractContent(obj),
          tool_calls: obj.tool_calls || obj.tools || null
        })
        chunkMessages++
      } catch (e) {
        // Skip unparseable chunks
      }
    }
    if (chunkMessages > 0) {
      if (!createdAt && messages.length > 0) createdAt = messages[0].timestamp || ''
      return { sessionId, title, createdAt, messages, filePath, harness: this.harness }
    }

    // Line-by-line JSONL (each line is a complete JSON object)
    const lines = content.split('\n').filter(l => l.trim())
    let index = 0
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (obj.session_id && !sessionId) sessionId = obj.session_id
        if (obj.title && !title) title = obj.title
        if (obj.timestamp && !createdAt) createdAt = item.timestamp
        messages.push({
          session_id: sessionId,
          message_index: index++,
          role: obj.role || 'unknown',
          timestamp: obj.timestamp || '',
          content: extractContent(obj),
          tool_calls: obj.tool_calls || obj.tools || null
        })
      } catch (e) {
        // Skip unparseable lines
      }
    }

    if (!createdAt && messages.length > 0) createdAt = messages[0].timestamp || ''
    return { sessionId, title, createdAt, messages, filePath, harness: this.harness }
  }

  extractText(filePath) {
    const parsed = this.parseSession(filePath)
    return parsed.messages.map(m => m.content).join('\n')
  }
}

// Split concatenated JSON objects (e.g. }\\n{) by tracking brace depth,
// accounting for strings and escape sequences.
function splitConcatJson(content) {
  const chunks = []
  let depth = 0
  let inString = false
  let escape = false
  let start = 0
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (inString) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{') { if (depth === 0) start = i; depth++ }
    else if (ch === '}') { depth--; if (depth === 0) chunks.push(content.slice(start, i + 1)) }
  }
  return chunks.filter(c => c.trim())
}

module.exports = { JsonlAdapter }
