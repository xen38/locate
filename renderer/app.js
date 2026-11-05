const locateAPI = window.locateAPI

// DOM elements
const searchInput = document.getElementById('searchInput')
const menuBtn = document.getElementById('menuBtn')
const menuPanel = document.getElementById('menuPanel')
const sessionList = document.getElementById('sessionList')
const emptyState = document.getElementById('emptyState')
const sessionView = document.getElementById('sessionView')
const sessionContent = document.getElementById('sessionContent')
const metaHarness = document.getElementById('metaHarness')
const metaPath = document.getElementById('metaPath')
const harnessList = document.getElementById('harnessList')
const btnScanHarnesses = document.getElementById('btnScanHarnesses')
const btnAddFolder = document.getElementById('btnAddFolder')
const settingBatchSize = document.getElementById('settingBatchSize')

// State
let allSessions = []
let selectedSessionId = null
let isSearching = false
let menuOpen = false
let batchSize = 10

// Toggle menu
function toggleMenu(e) {
  if (e) e.stopPropagation()
  menuOpen = !menuOpen
  menuPanel.classList.toggle('open', menuOpen)
  if (menuOpen) {
    renderHarnesses()
  }
}

menuBtn.addEventListener('click', (e) => {
  toggleMenu(e)
})

// Close menu when clicking outside
document.addEventListener('click', (e) => {
  if (menuOpen && !menuPanel.contains(e.target) && e.target !== menuBtn) {
    menuOpen = false
    menuPanel.classList.remove('open')
  }
})

// Add folder
btnAddFolder.addEventListener('click', async () => {
  const dir = await locateAPI.openFolderDialog()
  if (dir) {
    await locateAPI.addHarness(dir)
    renderHarnesses()
    loadSessions()
  }
})

// Scan & autodetect harnesses
btnScanHarnesses.addEventListener('click', async () => {
  await scanAndAutodetectHarnesses()
  menuOpen = false
  menuPanel.classList.remove('open')
})

// Batch size setting
settingBatchSize.addEventListener('change', async (e) => {
  batchSize = parseInt(e.target.value, 10)
  await locateAPI.setConfig({ batchSize })
})

// Search input
let searchDebounce = null
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    performSearch(e.target.value)
  }, 150)
})

async function init() {
  const config = await locateAPI.getConfig()
  batchSize = config.batchSize || 10
  settingBatchSize.value = String(batchSize)

  // Load sessions from all configured harnesses
  await loadSessions()
}

async function loadSessions() {
  allSessions = await locateAPI.listAllSessions()
  renderSessionList(allSessions)
}

function renderSessionList(sessions) {
  sessionList.innerHTML = ''

  if (sessions.length === 0) {
    sessionList.innerHTML = '<div style="padding:12px;color:#666;font-size:12px">No sessions found. Add a harness directory from the menu.</div>'
    return
  }

  sessions.forEach((s) => {
    const item = document.createElement('div')
    item.className = `session-item${selectedSessionId === s.id ? ' selected' : ''}`
    item.innerHTML = `
      <div class="label">${escapeHtml(s.label)}</div>
      <div class="harness">${escapeHtml(s.harness)}</div>
    `
    item.addEventListener('click', () => {
      selectedSessionId = s.id
      renderSessionList(allSessions)
      loadSessionContent(s)
    })
    sessionList.appendChild(item)
  })
}

async function loadSessionContent(session) {
  emptyState.classList.add('hidden')
  sessionView.classList.remove('hidden')

  metaHarness.textContent = session.harness
  metaPath.textContent = session.directory

  try {
    const data = await locateAPI.readSession(session.id)
    sessionContent.textContent = data.content
  } catch (e) {
    sessionContent.textContent = `Error loading session: ${e.message}`
  }
}

async function performSearch(query) {
  if (searchDebounce) clearTimeout(searchDebounce)
  searchDebounce = null

  const q = query.trim()
  if (!q) {
    renderSessionList(allSessions)
    return
  }

  isSearching = true
  try {
    const results = await locateAPI.searchSessions(q, { batchSize })
    renderSessionList(results)
  } catch (e) {
    console.error('Search failed:', e)
  } finally {
    isSearching = false
  }
}

async function scanAndAutodetectHarnesses() {
  const detected = await locateAPI.autodetectHarnesses()
  const current = await locateAPI.listHarnesses()
  let added = 0
  for (const d of detected) {
    if (!current.includes(d)) {
      await locateAPI.addHarness(d)
      added++
    }
  }

  renderHarnesses()
  await loadSessions()

  // Notify user
  const btn = btnScanHarnesses
  const orig = btn.textContent
  btn.textContent = `Found ${added} new harness${added !== 1 ? 'es' : ''}`
  setTimeout(() => { btn.textContent = orig }, 2000)
}

function renderHarnesses() {
  // We need async to fetch harnesses, but this is called from menu open which is sync
  // The harness list will be populated by loadHarnesses()
  loadHarnesses()
}

async function loadHarnesses() {
  const harnesses = await locateAPI.listHarnesses()
  harnessList.innerHTML = ''

  if (harnesses.length === 0) {
    harnessList.innerHTML = '<div style="padding:8px;color:#666;font-size:12px">No harnesses configured</div>'
    return
  }

  harnesses.forEach((h) => {
    const item = document.createElement('div')
    item.className = 'harness-item'
    item.innerHTML = `
      <span>${escapeHtml(h)}</span>
      <span class="remove" title="Remove">&#215;</span>
    `
    item.querySelector('.remove').addEventListener('click', async (e) => {
      e.stopPropagation()
      await locateAPI.removeHarness(h)
      loadHarnesses()
      await loadSessions()
    })
    harnessList.appendChild(item)
  })
}

// Helpers
function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Initialize
init()
