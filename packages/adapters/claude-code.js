/**
 * Claude Code archive adapter.
 *
 * Handles Claude Code sessions stored as JSON Lines transcripts:
 *   - CLI: ~/.claude/projects/<workspace>/<session_id>.jsonl
 *   - Desktop app: .../Claude-Data/claude_pzs8sxrjxfjjc/claude-code-sessions/<uuid>/<uuid>/<file>.jsonl
 *
 * Each line is a JSON object representing a message. Only real transcript
 * files are matched; placeholder files (e.g. scheduled-tasks.json) are excluded.
 */

const path = require('path')
const fs = require('fs')
const { BaseAdapter } = require('./base')

// Claude Code session file locations
const CLAUDE_PROJECTS_DIRS = [
  process.env.LOCATE_CLAUDE_PROJECTS ||
    (process.platform === 'win32'
      ? process.env.USERPROFILE
        ? path.join(process.env.USERPROFILE, '.claude', 'projects')
        : path.join(process.env.HOME || '', '.claude', 'projects')
      : path.join(process.env.HOME || '', '.claude', 'projects')),
  path.join(process.env.HOME || '', '.claude', 'projects')
]

// Desktop app Claude-Data location (Windows)
const CLAUDE_DESKTOP_DIRS = [
  process.env.LOCATE_CLAUDE_DESKTOP ||
    (process.platform === 'win32'
      ? process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, '..', 'Local', 'Claude-Data', 'claude_pzs8sxrjxfjjc')
        : path.join(process.env.USERPROFILE || '', 'AppData', 'Local', 'Claude-Data', 'claude_pzs8sxrjxfjjc')
      : path.join(process.env.HOME || '', '.claude-data'))
]

function findClaudeProjectsDir() {
  for (const p of CLAUDE_PROJECTS_DIRS) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

function findClaudeDesktopDir() {
  for (const p of CLAUDE_DESKTOP_DIRS) {
    if (p && fs.existsSync(p)) return p
  }
  return null
}

// Known non-session file names under claude-code-sessions (desktop app placeholders)
const NON_SESSION_CLAUDE_FILES = new Set([
  'scheduled-tasks.json',
  'local-agent-mode-sessions'
])

class ClaudeCodeAdapter extends BaseAdapter {
  constructor(options = {}) {
    super({
      name: options.name || 'Claude Code',
      harness: options.harness || 'Claude Code',
      extensions: ['.jsonl'],
      ...options
    })
  }

  canHandle(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    const base = path.basename(filePath).toLowerCase()
    if (ext !== '.jsonl') return false

    const parts = filePath.split(/[\\/]/)

    // CLI format: ~/.claude/projects/<workspace>/<session>.jsonl
    if (parts.includes('.claude') && parts.includes('projects')) {
      return true
    }

    // Desktop app format: .../claude-code-sessions/<uuid>/<uuid>/<file>.jsonl
    if (parts.includes('claude-code-sessions')) {
      // Exclude known non-session placeholder files
      if (NON_SESSION_CLAUDE_FILES.has(base)) return false
      return true
    }

    return false
  }

  /** Discover Claude Code session JSONL files. */
  discover(dirPath) {
    const results = []

    // Check CLI projects directory
    const projectsDir = findClaudeProjectsDir()
    if (projectsDir) {
      try {
        const entries = fs.readdirSync(projectsDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isDirectory()) continue
          const workspaceDir = path.join(projectsDir, entry.name)
          try {
            const files = fs.readdirSync(workspaceDir, { withFileTypes: true })
            for (const file of files) {
              if (file.isFile() && file.name.endsWith('.jsonl')) {
                results.push({ filePath: path.join(workspaceDir, file.name), ext: '.jsonl' })
              }
            }
          } catch (e) { /* skip inaccessible workspace dirs */ }
        }
      } catch (e) { /* skip */ }
    }

    // Check desktop app claude-code-sessions directory
    const desktopDir = findClaudeDesktopDir()
    if (desktopDir) {
      const sessionsDir = path.join(desktopDir, 'claude-code-sessions')
      try {
        results.push(...this._walkJsonl(sessionsDir))
      } catch (e) { /* skip */ }
    }

    return results
  }

  _walkJsonl(dir) {
    const results = []
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          results.push(...this._walkJsonl(fullPath))
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          results.push({ filePath: fullPath, ext: '.jsonl' })
        }
      }
    } catch (e) { /* skip */ }
    return results
  }

  parseSession(filePath) {
    const content = this._readFile(filePath).trim()
    if (!content) return null

    const messages = []
    let sessionId = path.basename(filePath, '.jsonl')
    let title = sessionId
    let createdAt = ''

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

    // Line-by-line JSONL (each line is a complete JSON object)
    const lines = content.split('\n').filter(l => l.trim())
    let index = 0
    for (const line of lines) {
      try {
        const obj = JSON.parse(line)
        if (typeof obj !== 'object' || obj === null) continue
        if (obj.session_id && !sessionId) sessionId = obj.session_id
        if (obj.title && !title) title = obj.title
        if (obj.timestamp && !createdAt) createdAt = obj.timestamp
        messages.push({
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

    if (messages.length === 0) return null

    if (!createdAt && messages.length > 0) createdAt = messages[0].timestamp || ''

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
    if (!parsed) return ''
    return parsed.messages.map(m => m.content).join('\n')
  }
}

module.exports = { ClaudeCodeAdapter, findClaudeProjectsDir, findClaudeDesktopDir }
