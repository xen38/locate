const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const { IndexingEngine } = require('./packages/core/index')

// Configuration file path (user data dir)
const CONFIG_FILE = path.join(app.getPath('userData'), 'config.json')

// Shared index database path — same location used by the MCP server so both
// components share a single index.
const INDEX_DB_PATH = path.join(app.getPath('userData'), 'locate-index.db')

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

// ── Core Indexing Engine (shared with MCP server) ──────────────────────────

const engine = new IndexingEngine(INDEX_DB_PATH)

let mainWindow = null

function createWindow() {
  console.log('Creating window...')
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

  console.log('Window created, loading index.html...')
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')).then(() => {
    console.log('index.html loaded')
  }).catch(e => {
    console.error('Failed to load index.html:', e)
  })

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

app.whenReady().then(async () => {
  try {
    await engine.open()
    console.log('Index engine opened successfully')
  } catch (e) {
    console.error('Failed to open index engine:', e)
  }
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

// IPC: Add a harness directory (register as indexing source)
ipcMain.handle('harness:add', async (event, dirPath, harness) => {
  try {
    const normalized = path.resolve(dirPath)
    if (!fs.existsSync(normalized)) {
      throw new Error(`Directory does not exist: ${normalized}`)
    }
    // Prevent duplicate sources in the engine
    const existing = engine.listSources().find(s => s.path === normalized)
    if (existing) {
      return { sourceId: existing.id, path: normalized, harnesses: config.harnessDirectories }
    }
    const sourceId = engine.addSource(normalized, harness || undefined)
    if (!config.harnessDirectories.includes(normalized)) {
      config.harnessDirectories.push(normalized)
      saveConfig()
    }
    return { sourceId, path: normalized, harnesses: config.harnessDirectories }
  } catch (e) {
    console.error('Failed to add harness:', e.message)
    throw e
  }
})

// IPC: Remove a harness directory
ipcMain.handle('harness:remove', async (event, dirPath) => {
  try {
    const normalized = path.resolve(dirPath)
    engine.removeSource(normalized)
    config.harnessDirectories = config.harnessDirectories.filter(d => d !== normalized)
    saveConfig()
    return config.harnessDirectories
  } catch (e) {
    console.error('Failed to remove harness:', e.message)
    throw e
  }
})

// IPC: List all harness directories (sources)
ipcMain.handle('harness:list', async () => {
  const sources = engine.listSources()
  return sources.map(s => ({
    path: s.path,
    name: s.name,
    harness: s.harness,
    status: s.status,
    session_count: s.session_count,
    indexed_count: s.indexed_count,
    last_scan: s.last_scan,
    error: s.error,
  }))
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

// IPC: List sessions (optionally filtered by source path)
ipcMain.handle('session:list', async (event, sourcePath) => {
  try {
    let sessions
    if (sourcePath) {
      const normalized = path.resolve(sourcePath)
      const all = engine.listSessions()
      sessions = all.filter(s => s.source_path === normalized)
    } else {
      sessions = engine.listSessions()
    }
    return sessions.map(s => ({
      id: s.session_id,
      session_id: s.session_id,
      title: s.title,
      harness: s.harness,
      source_path: s.source_path,
      file_path: s.file_path,
      created_at: s.created_at,
      indexed_at: s.indexed_at,
    }))
  } catch (e) {
    console.error('Failed to list sessions:', e.message)
    return []
  }
})

// IPC: List all sessions across all sources
ipcMain.handle('session:listAll', async () => {
  try {
    const sessions = engine.listSessions()
    return sessions.map(s => ({
      id: s.session_id,
      session_id: s.session_id,
      title: s.title,
      harness: s.harness,
      source_path: s.source_path,
      file_path: s.file_path,
      created_at: s.created_at,
      indexed_at: s.indexed_at,
    }))
  } catch (e) {
    console.error('Failed to list all sessions:', e.message)
    return []
  }
})

// IPC: Read a single session by session ID
ipcMain.handle('session:read', async (event, sessionId) => {
  try {
    const session = engine.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    return {
      session_id: session.session_id,
      title: session.title,
      harness: session.harness,
      source_path: session.source_path,
      file_path: session.file_path,
      created_at: session.created_at,
      indexed_at: session.indexed_at,
      messages: session.messages || [],
    }
  } catch (e) {
    throw new Error(`Failed to read session ${sessionId}: ${e.message}`)
  }
})

// Get all available drive roots on Windows (C: through Z:)
function getDriveRoots() {
  const roots = []
  for (let code = 67; code <= 90; code++) { // C-Z
    const drive = String.fromCharCode(code) + ':\\'
    try {
      if (fsExtra.existsSync(drive)) roots.push(drive)
    } catch (e) {}
  }
  return roots
}

const fsExtra = require('fs')

// IPC: Autodetect harness directories across all drives
ipcMain.handle('harness:autodetect', async () => {
  const knownHarnessDirs = [
    '.copilot', '.codex', '.cursor', '.cline', '.windsurf',
    '.t3', '.pi', '.opencode', '.claude', '.continue', '.zed',
    '.roo', '.aider', '.devin'
  ]

  const detected = []
  const driveRoots = getDriveRoots()

  // Delay helper to yield to UI thread between drive scans
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  for (const root of driveRoots) {
    const usersDir = path.join(root, 'Users')
    try {
      if (!fsExtra.existsSync(usersDir)) continue

      const entries = fsExtra.readdirSync(usersDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const userDir = path.join(usersDir, entry.name)

        try {
          const subEntries = fsExtra.readdirSync(userDir, { withFileTypes: true })
          for (const sub of subEntries) {
            if (!sub.isDirectory()) continue
            const lower = sub.name.toLowerCase()
            if (knownHarnessDirs.includes(lower)) {
              detected.push(path.join(userDir, sub.name))
            }
          }
        } catch (e) {
          // skip inaccessible user dirs
        }
      }
    } catch (e) {
      // skip inaccessible roots
    }

    // Yield between drives to keep UI responsive
    await sleep(30)
  }

  return detected
})

// IPC: Index a source explicitly
ipcMain.handle('source:index', async (event, sourceId) => {
  try {
    const result = engine.indexSource(sourceId)
    return result
  } catch (e) {
    console.error('Failed to index source:', e.message)
    throw e
  }
})

// IPC: Index all sources
ipcMain.handle('source:indexAll', async (event, options = {}) => {
  try {
    return engine.indexAllSources(options)
  } catch (e) {
    console.error('Failed to index all sources:', e.message)
    throw e
  }
})

// IPC: Incremental indexing (check for new/modified/deleted)
ipcMain.handle('source:incrementalIndex', async (event, options = {}) => {
  try {
    return engine.incrementalIndex(options)
  } catch (e) {
    console.error('Failed incremental indexing:', e.message)
    throw e
  }
})

// IPC: Search across all sessions (FTS5 via IndexingEngine)
// Synchronous search — no worker needed since FTS5 queries are fast.
ipcMain.handle('session:search', async (event, query, options = {}) => {
  try {
    const results = engine.search(query, {
      harness: options.harness || undefined,
      role: options.role || undefined,
      limit: options.limit || 50,
      excerptLength: options.excerptLength || 200,
    })
    return results.map(r => ({
      id: r.session_id,
      session_id: r.session_id,
      title: r.title,
      harness: r.harness,
      source_path: r.source_path,
      file_path: r.file_path,
      created_at: r.created_at,
      rank: r.rank,
      excerpt: r.excerpt,
    }))
  } catch (e) {
    console.error('Search failed:', e.message)
    throw e
  }
})

// IPC: Get context around a message
ipcMain.handle('session:getContext', async (event, sessionId, messageIndex, before = 5, after = 5) => {
  try {
    return engine.getContext(sessionId, messageIndex, before, after)
  } catch (e) {
    throw new Error(`Failed to get context: ${e.message}`)
  }
})

// IPC: Remove a session from the index (undoable via refresh/re-index)
ipcMain.handle('session:delete', async (event, sessionId) => {
  try {
    engine.removeSession(sessionId)
    return { success: true }
  } catch (e) {
    throw new Error(`Failed to delete session: ${e.message}`)
  }
})

// IPC: Delete the actual session file from disk (not undoable)
ipcMain.handle('session:deleteFile', async (event, sessionId) => {
  try {
    const session = engine.getSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }
    const filePath = session.file_path
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    // Also remove from index
    engine.removeSession(sessionId)
    return { success: true, deletedPath: filePath }
  } catch (e) {
    throw new Error(`Failed to delete session file: ${e.message}`)
  }
})