const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const { Worker } = require('worker_threads')
const path = require('path')
const fs = require('fs')
const Database = require('better-sqlite3')

// Configuration file path (user data dir)
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json')

// Default configuration
const DEFAULT_CONFIG = {
  harnessDirectories: [],
  batchSize: 10,
  windowBounds: { width: 1200, height: 800 }
}

let config = { ...DEFAULT_CONFIG }

// Load config
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8')
      config = { ...DEFAULT_CONFIG, ...JSON.parse(data) }
    }
  } catch (e) {
    console.error('Failed to load config:', e.message)
    config = { ...DEFAULT_CONFIG }
  }
}

// Save config
function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8')
  } catch (e) {
    console.error('Failed to save config:', e.message)
  }
}

loadConfig()

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: config.windowBounds.width || 1200,
    height: config.windowBounds.height || 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: 'locate',
    backgroundColor: '#000000'
  })

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'))

  // Remove default Electron menu bar (File, Edit, View, Window, Help)
  Menu.setApplicationMenu(null)

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('resize', () => {
    if (mainWindow) {
      const [w, h] = mainWindow.getSize()
      config.windowBounds = { width: w, height: h }
      saveConfig()
    }
  })
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// IPC: Get configuration
ipcMain.handle('config:get', async () => {
  return config
})

// IPC: Update configuration
ipcMain.handle('config:set', async (event, updates) => {
  config = { ...config, ...updates }
  saveConfig()
  return config
})

// IPC: Add a harness directory
ipcMain.handle('harness:add', async (event, dirPath) => {
  if (!config.harnessDirectories.includes(dirPath)) {
    config.harnessDirectories.push(dirPath)
    saveConfig()
  }
  return config.harnessDirectories
})

// IPC: Remove a harness directory
ipcMain.handle('harness:remove', async (event, dirPath) => {
  config.harnessDirectories = config.harnessDirectories.filter(d => d !== dirPath)
  saveConfig()
  return config.harnessDirectories
})

// IPC: List all harness directories
ipcMain.handle('harness:list', async () => {
  return config.harnessDirectories
})

// IPC: Open folder picker dialog
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select harness folder to scan'
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

const SUPPORTED_EXTS = ['.md', '.txt', '.json', '.jsonl', '.db', '.sqlite']

function extractTextFromJsonl(content) {
  const lines = content.split('\n').filter(l => l.trim())
  const texts = []
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      const text = extractTextFromJsonValue(obj)
      if (text) texts.push(text)
    } catch (e) {
      if (line.trim()) texts.push(line.trim())
    }
  }
  return texts.join('\n')
}

function extractTextFromJsonValue(obj) {
  if (typeof obj === 'string') return obj
  if (obj === null || obj === undefined) return ''

  if (typeof obj.content === 'string') return obj.content
  if (typeof obj.message === 'string') return obj.message
  if (typeof obj.text === 'string') return obj.text
  if (typeof obj.prompt === 'string') return obj.prompt
  if (typeof obj.response === 'string') return obj.response

  if (Array.isArray(obj.content)) {
    return obj.content
      .map(c => (typeof c === 'string' ? c : c.text || c.content || ''))
      .filter(Boolean)
      .join('\n')
  }

  const parts = []
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' || k === 'id' || k === 'timestamp' || k === 'role') continue
    if (typeof v === 'string' && v.length > 0) parts.push(`${k}: ${v}`)
    else if (typeof v === 'object' && v !== null) {
      const t = extractTextFromJsonValue(v)
      if (t) parts.push(t)
    }
  }
  return parts.join('\n')
}

function extractTextFromJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    try {
      const obj = JSON.parse(content)
      return extractTextFromJsonValue(obj)
    } catch (e) {
      return extractTextFromJsonl(content)
    }
  } catch (e) {
    return ''
  }
}

function extractTextFromSqlite(dbPath) {
  try {
    const db = new Database(dbPath, { readonly: true })
    const texts = []

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map(r => r.name)

    for (const table of tables) {
      try {
        const columns = db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map(c => c.name)

        const textCols = columns.filter(c =>
          /content|message|text|body|prompt|response|title|summary/i.test(c)
        )

        if (textCols.length === 0) continue

        const idCol = columns.find(c => /id|session|thread/i.test(c)) || columns[0]
        const query = `SELECT ${[idCol, ...textCols].join(', ')} FROM ${table} LIMIT 1000`
        const rows = db.prepare(query).all()

        for (const row of rows) {
          const parts = []
          for (const col of textCols) {
            if (row[col] && typeof row[col] === 'string') {
              parts.push(row[col])
            }
          }
          if (parts.length > 0) texts.push(parts.join('\n'))
        }
      } catch (e) {
        // skip
      }
    }

    db.close()
    return texts.join('\n')
  } catch (e) {
    return ''
  }
}

function readSessionFileContent(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  try {
    switch (ext) {
      case '.jsonl':
        return extractTextFromJsonl(fs.readFileSync(filePath, 'utf8'))
      case '.json':
        return extractTextFromJsonFile(filePath)
      case '.db':
      case '.sqlite':
        return extractTextFromSqlite(filePath)
      case '.md':
      case '.txt':
        return fs.readFileSync(filePath, 'utf8')
      default:
        return fs.readFileSync(filePath, 'utf8')
    }
  } catch (e) {
    return `[Error reading ${filePath}: ${e.message}]`
  }
}

// Recursively collect all session files under a directory
function collectSessionFiles(dirPath) {
  const results = []
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)
      if (entry.isDirectory()) {
        results.push(...collectSessionFiles(fullPath))
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (SUPPORTED_EXTS.includes(ext)) {
          results.push(fullPath)
        }
      }
    }
  } catch (e) {
    // skip inaccessible directories
  }
  return results
}

function getSessionPreview(filePath, ext) {
  try {
    if (ext === '.jsonl') {
      const content = fs.readFileSync(filePath, 'utf8')
      const firstLine = content.split('\n')[0]
      return firstLine ? firstLine.substring(0, 120) : path.basename(filePath)
    }
    if (ext === '.json') {
      const content = fs.readFileSync(filePath, 'utf8')
      try {
        const obj = JSON.parse(content)
        return (obj.title || obj.label || obj.session_id || path.basename(filePath)).toString().substring(0, 120)
      } catch (e) {
        return path.basename(filePath)
      }
    }
    if (ext === '.db' || ext === '.sqlite') {
      return `SQLite database: ${path.basename(filePath)}`
    }
    const content = fs.readFileSync(filePath, 'utf8')
    const firstLine = content.split('\n')[0].trim()
    return firstLine || content.substring(0, 100)
  } catch (e) {
    return path.basename(filePath)
  }
}

// IPC: List session files in a directory
ipcMain.handle('session:list', async (event, dirPath) => {
  try {
    const filePaths = collectSessionFiles(dirPath)
    const sessions = []

    for (const filePath of filePaths) {
      const stat = fs.statSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const label = path.basename(filePath, ext)
      const preview = getSessionPreview(filePath, ext).substring(0, 120)

      sessions.push({
        id: filePath,
        label: label,
        preview: preview,
        harness: path.basename(dirPath),
        directory: dirPath,
        modified: stat.mtimeMs,
        size: stat.size,
        ext,
      })
    }

    sessions.sort((a, b) => b.modified - a.modified)
    return sessions
  } catch (e) {
    console.error('Failed to list sessions:', e.message)
    return []
  }
})

// IPC: List all sessions across all harness directories
ipcMain.handle('session:listAll', async () => {
  const allSessions = []
  for (const dir of config.harnessDirectories) {
    try {
      const sessions = await sessionListHandler(dir)
      allSessions.push(...sessions)
    } catch (e) {
      console.error(`Failed to list sessions in ${dir}:`, e.message)
    }
  }
  allSessions.sort((a, b) => b.modified - a.modified)
  return allSessions
})

async function sessionListHandler(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const sessions = []

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!SUPPORTED_EXTS.includes(ext)) continue

      const filePath = path.join(dirPath, entry.name)
      const stat = fs.statSync(filePath)
      const label = path.basename(entry.name, ext)
      const preview = getSessionPreview(filePath, ext).substring(0, 120)

      sessions.push({
        id: filePath,
        label: label,
        preview: preview,
        harness: path.basename(dirPath),
        directory: dirPath,
        modified: stat.mtimeMs,
        size: stat.size,
        ext,
      })
    }

    sessions.sort((a, b) => b.modified - a.modified)
    return sessions
  } catch (e) {
    return []
  }
}

// IPC: Read a single session file content
ipcMain.handle('session:read', async (event, filePath) => {
  try {
    const stat = fs.statSync(filePath)
    const content = readSessionFileContent(filePath)
    return {
      path: filePath,
      content: content,
      modified: stat.mtimeMs,
      size: stat.size
    }
  } catch (e) {
    throw new Error(`Failed to read ${filePath}: ${e.message}`)
  }
})

// IPC: Autodetect harness directories in common locations
ipcMain.handle('harness:autodetect', async () => {
  const fs = require('fs')
  const path = require('path')

  const commonRoots = [
    'C:\\Users',
    'C:\\Users\\Public',
    'D:\\',
    'E:\\',
    'F:\\'
  ]

  const keywords = [
    'session', 'harness', 'copilot', 'cursor', 'cline', 'windsurf',
    'allai', 'midas', 'ucos', 'locate', 'archive', 'chat', 'conversation',
    't3', 'pi', 'codex', 'opencode', 'claude', 'continue', 'zed', 'roo',
    'aider', 'devin'
  ]

  const detected = []

  for (const root of commonRoots) {
    try {
      if (!fs.existsSync(root)) continue
      const entries = fs.readdirSync(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const lower = entry.name.toLowerCase()
        if (keywords.some(k => lower.includes(k))) {
          detected.push(path.join(root, entry.name))
        }
      }
    } catch (e) {
      // skip inaccessible roots
    }
  }

  return detected
})

// IPC: Search across all sessions (titles and contents)
// Runs in a Worker thread so the main process (and UI) stays responsive while
// scanning potentially thousands of session files. Files are read in chunks for
// large plain-text sessions to avoid loading whole files into memory.
ipcMain.handle('session:search', async (event, query, options = {}) => {
  const batchSize = options.batchSize || config.batchSize || 10
  const dirs = config.harnessDirectories.slice()
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'search-worker.js'), {
      workerData: { query, directories: dirs, batchSize },
    })
    worker.on('message', (message) => {
      if (message.error) {
        reject(new Error(message.error))
      } else {
        resolve(message.results || [])
      }
    })
    worker.on('error', (err) => reject(err))
  })
})
