const setup = () => {
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
  const harnessSettingsEl = document.getElementById('harnessSettings')
  const btnScanHarnesses = document.getElementById('btnScanHarnesses')
  const btnAddFolder = document.getElementById('btnAddFolder')
  const settingBatchSize = document.getElementById('settingBatchSize')

  // Context menu elements
  const ctxMenu = document.getElementById('ctxMenu')
  const ctxDeleteEntry = document.getElementById('ctxDeleteEntry')
  const ctxDeleteFile = document.getElementById('ctxDeleteFile')
  const ctxConfirmOverlay = document.getElementById('ctxConfirmOverlay')
  const ctxConfirmTitle = document.getElementById('ctxConfirmTitle')
  const ctxConfirmMessage = document.getElementById('ctxConfirmMessage')
  const ctxConfirmCancel = document.getElementById('ctxConfirmCancel')
  const ctxConfirmDelete = document.getElementById('ctxConfirmDelete')

  // Close session button
  const btnCloseSession = document.getElementById('btnCloseSession')

  // State
  let allSessions = []
  let selectedSessionId = null
  let isSearching = false
  let menuOpen = false
  let batchSize = 10
  let harnessSettings = {}
  let ctxTargetSessionId = null
  let ctxTargetSession = null
  let confirmResolve = null

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
      renderHarnessSettings()
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
    // Close context menu when clicking outside
    if (ctxMenu.style.display === 'block' && !ctxMenu.contains(e.target)) {
      ctxMenu.style.display = 'none'
    }
    // Close confirm overlay when clicking outside
    if (ctxConfirmOverlay.style.display === 'block' && !ctxConfirmOverlay.contains(e.target)) {
      hideConfirm()
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

  // Close session
  btnCloseSession.addEventListener('click', (e) => {
    e.stopPropagation()
    closeSession()
  })

  // Context menu: Delete Entry (white text) - removes from list, undoable via refresh
  ctxDeleteEntry.addEventListener('click', async (e) => {
    e.stopPropagation()
    ctxMenu.style.display = 'none'
    if (!ctxTargetSessionId) return
    try {
      await locateAPI.deleteSession(ctxTargetSessionId)
      // Remove from local list
      allSessions = allSessions.filter(s => s.id !== ctxTargetSessionId)
      if (selectedSessionId === ctxTargetSessionId) {
        closeSession()
      }
      renderSessionList(allSessions)
    } catch (err) {
      console.error('Delete entry failed:', err)
      alert('Failed to delete entry: ' + err.message)
    }
    ctxTargetSessionId = null
    ctxTargetSession = null
  })

  // Context menu: Delete Session File (red text) - confirmation then delete actual file
  ctxDeleteFile.addEventListener('click', async (e) => {
    e.stopPropagation()
    ctxMenu.style.display = 'none'
    if (!ctxTargetSession) return
    showConfirm(
      'Delete Session File?',
      `This will permanently delete the session file:\n${ctxTargetSession.file_path}\n\nThis cannot be undone.`,
      async () => {
        hideConfirm()
        try {
          await locateAPI.deleteSessionFile(ctxTargetSessionId)
          allSessions = allSessions.filter(s => s.id !== ctxTargetSessionId)
          if (selectedSessionId === ctxTargetSessionId) {
            closeSession()
          }
          renderSessionList(allSessions)
        } catch (err) {
          console.error('Delete file failed:', err)
          alert('Failed to delete session file: ' + err.message)
        }
        ctxTargetSessionId = null
        ctxTargetSession = null
      }
    )
  })

  ctxConfirmCancel.addEventListener('click', () => {
    hideConfirm()
    ctxTargetSessionId = null
    ctxTargetSession = null
  })

  ctxConfirmDelete.addEventListener('click', async () => {
    hideConfirm()
    if (!ctxTargetSessionId) return
    try {
      await locateAPI.deleteSessionFile(ctxTargetSessionId)
      allSessions = allSessions.filter(s => s.id !== ctxTargetSessionId)
      if (selectedSessionId === ctxTargetSessionId) {
        closeSession()
      }
      renderSessionList(allSessions)
    } catch (err) {
      console.error('Delete file failed:', err)
      alert('Failed to delete session file: ' + err.message)
    }
    ctxTargetSessionId = null
    ctxTargetSession = null
  })

  function showConfirm(title, message, onConfirm) {
    ctxConfirmTitle.textContent = title
    ctxConfirmMessage.textContent = message
    ctxConfirmOverlay.style.display = 'flex'
    confirmResolve = onConfirm
  }

  function hideConfirm() {
    ctxConfirmOverlay.style.display = 'none'
    confirmResolve = null
  }

  function closeSession() {
    selectedSessionId = null
    sessionView.classList.add('hidden')
    sessionView.style.display = 'none'
    emptyState.classList.remove('hidden')
    emptyState.style.display = 'flex'
    renderSessionList(allSessions)
  }

  async function init() {
    try {
      const config = await locateAPI.getConfig()
      batchSize = config.batchSize || 10
      settingBatchSize.value = String(batchSize)

      // Load harness enable/disable settings
      try {
        const settings = await locateAPI.getHarnessSettings()
        harnessSettings = Object.fromEntries(settings.map(s => [s.name, s.enabled]))
        renderHarnessSettings()
      } catch (e) {
        console.error('Failed to load harness settings:', e)
      }

      // Auto-detect harnesses on first run if none configured
      if (!config.harnessDirectories || config.harnessDirectories.length === 0) {
        await scanAndAutodetectHarnesses()
      } else {
        // Ensure all configured sources are registered in the engine (idempotent)
        for (const dir of config.harnessDirectories) {
          try {
            await locateAPI.addHarness(dir)
          } catch (e) {
            console.error('Failed to add harness:', dir, e.message)
          }
        }

        // Index all sources so sessions appear in the list
        try {
          await locateAPI.indexAllSources()
        } catch (e) {
          console.error('Indexing failed:', e.message)
        }

        // Load sessions from all configured harnesses
        await loadSessions()
      }
    } catch (e) {
      console.error('Init failed:', e)
      alert('Init failed: ' + e.message)
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
    } else {
      emptyState.classList.add('hidden')
      emptyState.style.display = 'none'
      sessionView.classList.remove('hidden')
      sessionView.style.display = 'flex'
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

      // Right-click context menu
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault()
        e.stopPropagation()
        ctxMenu.style.display = 'none'
        ctxTargetSessionId = s.id
        ctxTargetSession = s
        // Position menu near cursor
        ctxMenu.style.left = e.clientX + 'px'
        ctxMenu.style.top = e.clientY + 'px'
        ctxMenu.style.display = 'block'
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
      renderMessages(messages)
    } catch (e) {
      sessionContent.innerHTML = `<div style="color:#ff6666;padding:12px">Error loading session: ${escapeHtml(e.message)}</div>`
    }
  }

  function renderMessages(messages) {
    if (!messages || messages.length === 0) {
      sessionContent.innerHTML = '<div style="color:#666;font-style:italic;padding:12px">No messages found.</div>'
      return
    }

    const parts = []
    messages.forEach((m, i) => {
      const role = (m.role || 'unknown').toLowerCase()
      const roleColor = role === 'user' ? '#007aff' : role === 'assistant' ? '#00ccff' : '#888888'
      const roleLabel = role.charAt(0).toUpperCase() + role.slice(1)
      const ts = m.timestamp ? ` <span style="color:#666;font-size:11px;margin-left:8px">${escapeHtml(m.timestamp)}</span>` : ''
      const content = escapeHtml(m.content || '')
      parts.push(`
        <div class="message" style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #222;">
          <div style="display:flex;align-items:baseline;margin-bottom:6px;">
            <span style="color:${roleColor};font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.5px">${roleLabel}</span>${ts}
          </div>
          <div style="color:#e0e0e0;line-height:1.6;white-space:pre-wrap;font-size:14px">${content}</div>
        </div>
      `)
    })
    sessionContent.innerHTML = parts.join('')
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

  // Render per-harness enable/disable toggles
  function renderHarnessSettings() {
    if (!harnessSettingsEl) return
    const names = Object.keys(harnessSettings).sort()
    harnessSettingsEl.innerHTML = ''

    if (names.length === 0) {
      harnessSettingsEl.innerHTML = '<div style="padding:8px;color:#666;font-size:12px">No harnesses detected yet.</div>'
      return
    }

    names.forEach((name) => {
      const enabled = harnessSettings[name] !== false
      const row = document.createElement('div')
      row.className = 'setting-row harness-row'
      row.innerHTML = `
        <label class="harness-label" data-harness="${escapeHtml(name)}">
          <input type="checkbox" class="harness-toggle" data-harness="${escapeHtml(name)}" ${enabled ? 'checked' : ''}>
          <span>${escapeHtml(name)}</span>
        </label>
      `
      const toggle = row.querySelector('.harness-toggle')
      toggle.addEventListener('change', async (e) => {
        const on = e.target.checked
        harnessSettings[name] = on
        try {
          await locateAPI.setHarnessSetting(name, on)
          await loadSessions()
          renderHarnessSettings()
        } catch (err) {
          console.error('Failed to save harness setting:', err)
          e.target.checked = !on
          harnessSettings[name] = !on
          alert('Failed to save harness setting: ' + err.message)
        }
      })
      harnessSettingsEl.appendChild(row)
    })
  }

  // Initialize
  init()
}

// Helpers
  function escapeHtml(text) {
    if (!text) return ''
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup)
  } else {
    setup()
  }
