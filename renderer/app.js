document.addEventListener('DOMContentLoaded', () => {
  const locateAPI = window.locateAPI

  // DOM elements
  const searchInput = document.getElementById('searchInput')
  const menuBtn = document.getElementById('menuBtn')
  const menuPanel = document.getElementById('menuPanel')
  const sessionList = document.getElementById('sessionList')
const btnRefreshSessions = document.getElementById('btnRefreshSessions')
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
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    menuOpen = !menuOpen
    if (menuOpen) {
      menuPanel.style.display = 'block'
      renderHarnesses()
    } else {
      menuPanel.style.display = 'none'
    }
  }

  // Menu button click
  menuBtn.addEventListener('click', toggleMenu)

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (menuOpen && !menuPanel.contains(e.target) && e.target !== menuBtn) {
      menuOpen = false
      menuPanel.style.display = 'none'
    }
  })

  // Refresh sessions
    btnRefreshSessions.addEventListener('click', async () => {
      await loadSessions()
    })

    // Add folder
    btnAddFolder.addEventListener('click', async () => {
      const dir = await locateAPI.openFolderDialog()
      if (dir) {
        await locateAPI.addHarness(dir)
        renderHarnesses()
        // Index the new source so sessions appear
        try {
          await locateAPI.indexAllSources()
        } catch (e) {
          console.error('Indexing failed:', e)
        }
        await loadSessions()
      }
    })

  // Scan & autodetect harnesses
  btnScanHarnesses.addEventListener('click', async () => {
    try {
      await scanAndAutodetectHarnesses()
    } catch (e) {
      console.error('Scan failed:', e)
      alert('Scan failed: ' + e.message)
    }
    menuOpen = false
    menuPanel.style.display = 'none'
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

    // Auto-detect harnesses on first run if none configured
    if (!config.harnessDirectories || config.harnessDirectories.length === 0) {
      await scanAndAutodetectHarnesses()
    } else {
      // Load sessions from all configured harnesses
      await loadSessions()
    }
  }

  async function loadSessions() {
    allSessions = await locateAPI.listAllSessions()
    renderSessionList(allSessions)
  }

  function renderSessionList(sessions) {
    sessionList.innerHTML = ''

    // If no session is selected, show empty state
    if (!selectedSessionId) {
      emptyState.classList.remove('hidden')
      emptyState.style.display = 'flex'
      sessionView.classList.add('hidden')
      sessionView.style.display = 'none'
    }

    if (sessions.length === 0) {
      sessionList.innerHTML = '<div style="padding:12px;color:#666;font-size:12px">No sessions found. Add a harness directory from the menu.</div>'
      return
    }

    const fragment = document.createDocumentFragment()
    sessions.forEach((s) => {
      const item = document.createElement('div')
      item.className = `session-item${selectedSessionId === s.id ? ' selected' : ''}`
      item.innerHTML = `
        <div class="label">${escapeHtml(s.title)}</div>
        <div class="harness">${escapeHtml(s.harness)}</div>
      `
      item.addEventListener('click', () => {
        selectedSessionId = s.id
        renderSessionList(allSessions)
        loadSessionContent(s)
      })
      fragment.appendChild(item)
    })
    sessionList.appendChild(fragment)
  }

  async function loadSessionContent(session) {
    emptyState.classList.add('hidden')
    emptyState.style.display = 'none'
    sessionView.classList.remove('hidden')
    sessionView.style.display = 'flex'

    metaHarness.textContent = session.harness
    metaPath.textContent = session.source_path

    try {
      const data = await locateAPI.readSession(session.id)
      const messages = data.messages || []
      sessionContent.textContent = messages.map(m => m.content).join('\n')
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
    const currentPaths = new Set(current.map(h => h.path))
    let added = 0
    for (const d of detected) {
      if (!currentPaths.has(d)) {
        await locateAPI.addHarness(d)
        added++
      }
    }

    renderHarnesses()

    // Index all sources so sessions appear in the list
    try {
      await locateAPI.indexAllSources()
    } catch (e) {
      console.error('Indexing failed:', e)
    }

    await loadSessions()

    // Notify user
    const btn = btnScanHarnesses
    const orig = btn.textContent
    btn.textContent = `Found ${added} new harness${added !== 1 ? 'es' : ''}`
    setTimeout(() => { btn.textContent = orig }, 2000)
  }

  function renderHarnesses() {
    loadHarnesses()
  }

  async function loadHarnesses() {
    const harnesses = await locateAPI.listHarnesses()
    harnessList.innerHTML = ''

    if (harnesses.length === 0) {
      harnessList.innerHTML = '<div style="padding:8px;color:#666;font-size:12px">No harnesses configured</div>'
      return
    }

    // Group by harness name to compact duplicates
    const grouped = new Map()
    harnesses.forEach((h) => {
      const key = h.harness || h.name || h.path
      if (!grouped.has(key)) {
        grouped.set(key, [])
      }
      grouped.get(key).push(h)
    })

    grouped.forEach((items, harnessName) => {
      const item = document.createElement('div')
      item.className = 'harness-item'
      const suffix = items.length > 1 ? ` (${items.length})` : ''
      item.innerHTML = `
        <span>${escapeHtml(harnessName)}${suffix}</span>
        <span class="remove" title="Remove">&#215;</span>
      `
      const removeBtn = item.querySelector('.remove')
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        // Remove all directories for this harness
        for (const h of items) {
          await locateAPI.removeHarness(h.path || h)
        }
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
})
