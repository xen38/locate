const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

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

// IPC: List session files in a directory
ipcMain.handle('session:list', async (event, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    const sessions = []
    const supportedExts = ['.md', '.txt', '.json']

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!supportedExts.includes(ext)) continue

      const filePath = path.join(dirPath, entry.name)
      const stat = fs.statSync(filePath)
      const label = path.basename(entry.name, ext)

      // Read a small preview for the title (first non-empty line or first 100 chars)
      let preview = ''
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        const firstLine = content.split('\n')[0].trim()
        preview = firstLine || content.substring(0, 100)
      } catch (e) {
        preview = entry.name
      }

      sessions.push({
        id: filePath,
        label: label,
        preview: preview.substring(0, 120),
        harness: path.basename(dirPath),
        directory: dirPath,
        modified: stat.mtimeMs,
        size: stat.size
      })
    }

    // Sort by modified time descending
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
    const supportedExts = ['.md', '.txt', '.json']

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (!supportedExts.includes(ext)) continue

      const filePath = path.join(dirPath, entry.name)
      const stat = fs.statSync(filePath)
      const label = path.basename(entry.name, ext)

      let preview = ''
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        const firstLine = content.split('\n')[0].trim()
        preview = firstLine || content.substring(0, 100)
      } catch (e) {
        preview = entry.name
      }

      sessions.push({
        id: filePath,
        label: label,
        preview: preview.substring(0, 120),
        harness: path.basename(dirPath),
        directory: dirPath,
        modified: stat.mtimeMs,
        size: stat.size
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
    const content = fs.readFileSync(filePath, 'utf8')
    const stat = fs.statSync(filePath)
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
    'allai', 'midas', 'ucos', 'locate', 'archive', 'chat', 'conversation'
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
ipcMain.handle('session:search', async (event, query, options = {}) => {
  const batchSize = options.batchSize || config.batchSize || 10
  const results = []
  const queryLower = query.toLowerCase()

  for (const dir of config.harnessDirectories) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      const files = entries.filter(e =>
        e.isFile() && ['.md', '.txt', '.json'].includes(path.extname(e.name).toLowerCase())
      )

      // Process files in batches of batchSize
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize)
        const batchPromises = batch.map(async (entry) => {
          const filePath = path.join(dir, entry.name)
          try {
            const content = fs.readFileSync(filePath, 'utf8')
            const label = path.basename(entry.name, path.extname(entry.name))
            const labelMatch = label.toLowerCase().includes(queryLower)
            const contentMatch = content.toLowerCase().includes(queryLower)

            if (!labelMatch && !contentMatch) return null

            // Find matching context in content
            let context = ''
            if (contentMatch) {
              const idx = content.toLowerCase().indexOf(queryLower)
              const start = Math.max(0, idx - 100)
              const end = Math.min(content.length, idx + query.length + 100)
              context = content.substring(start, end).replace(/\n/g, ' ')
            }

            return {
              id: filePath,
              label: label,
              harness: path.basename(dir),
              directory: dir,
              labelMatch: labelMatch,
              contentMatch: contentMatch,
              context: context,
              score: (labelMatch ? 2 : 0) + (contentMatch ? 1 : 0)
            }
          } catch (e) {
            return null
          }
        })

        const batchResults = await Promise.all(batchPromises)
        batchResults.forEach(r => { if (r) results.push(r) })
      }
    } catch (e) {
      console.error(`Failed to search in ${dir}:`, e.message)
    }
  }

  // Sort by score descending, then by label
  results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
  return results
})
