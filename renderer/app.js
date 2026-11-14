// Global error handlers to capture crashes
window.onerror = (msg, url, line, col, error) => {
  console.error('UNCAUGHT ERROR:', msg, 'at', url, ':', line, ':', col, error)
  return true
}

window.onunhandledrejection = (event) => {
  console.error('UNHANDLED REJECTION:', event.reason)
}

const setup = () => {
  const synAPI = window.synAPI

  // DOM elements
  const terminalInput = document.getElementById('terminalInput')
  const terminalOutput = document.getElementById('terminalOutput')
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
  const btnBrainReflect = document.getElementById('btnBrainReflect')
  const btnBrainMeditate = document.getElementById('btnBrainMeditate')
  const btnBrainRuminate = document.getElementById('btnBrainRuminate')
  const btnBrainPlan = document.getElementById('btnBrainPlan')
  const btnBrainReview = document.getElementById('btnBrainReview')
  const btnBrainIndex = document.getElementById('btnBrainIndex')
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
  let terminalHistory = []
  let terminalHistoryIndex = -1

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
    const dir = await synAPI.openFolderDialog()
    if (dir) {
      await synAPI.addHarness(dir)
      renderHarnesses()
      try {
        await synAPI.indexAllSources()
      } catch (e) {
        console.error('Indexing failed:', e)
      }
      await loadSessions()
    }
  })

  // ── Brainmaxxing commands ─────────────────────────────────────────────
  async function showBrainResult(title, result) {
    const ok = result && result.ok !== false
    const lines = [
      `<div style="padding:12px;background:#1a1a1a;border:1px solid #333;border-radius:8px;margin-top:12px;">`,
      `<div style="font-weight:600;color:#00ccff;margin-bottom:8px">${escapeHtml(title)}</div>`,
      `<div style="color:#e0e0e0;font-size:13px;white-space:pre-wrap">${escapeHtml(JSON.stringify(result, null, 2))}</div>`,
      `</div>`
    ]
    sessionContent.insertAdjacentHTML('beforeend', lines.join(''))
    sessionView.classList.remove('hidden')
    sessionView.style.display = 'flex'
    emptyState.classList.add('hidden')
    emptyState.style.display = 'none'
  }

  btnBrainReflect.addEventListener('click', async (e) => {
    e.stopPropagation()
    if (!selectedSessionId) {
      alert('Select a session first.')
      return
    }
    try {
      const result = await synAPI.brainReflect(selectedSessionId)
      showBrainResult('/reflect', result)
    } catch (err) {
      alert('Reflect failed: ' + err.message)
    }
    menuOpen = false
    menuPanel.style.display = 'none'
  })

  btnBrainMeditate.addEventListener('click', async (e) => {
    e.stopPropagation()
    try {
      const result = await synAPI.brainMeditate()
      showBrainResult('/meditate', result)
    } catch (err) {
      alert('Meditate failed: ' + err.message)
    }
    menuOpen = false
    menuPanel.style.display = 'none'
  })

  btnBrainRuminate.addEventListener('click', async (e) => {
    e.stopPropagation()
    try {
      const result = await synAPI.brainRuminate()
      showBrainResult('/ruminate', result)
    } catch (err) {
      alert('Ruminate failed: ' + err.message)
    }
    menuOpen = false
    menuPanel.style.display = 'none'
  })

  btnBrainPlan.addEventListener('click', async (e) => {
    e.stopPropagation()
    const task = prompt('Enter plan task:')
    if (!task) return
    try {
      const result = await synAPI.brainPlan(task)
      showBrainResult('/plan', result)
    } catch (err) {
      alert('Plan failed: ' + err.message)
    }
    menuOpen = false
    menuPanel.style.display = 'none'
  })

  btnBrainReview.addEventListener('click', async (e) => {
    e.stopPropagation()
    const content = prompt('Enter content to review:')
    if (content === null) return
    try {
      const result = await synAPI.brainReview(content)
      showBrainResult('/review', result)
    } catch (err) {
      alert('Review failed: ' + err.message)
    }
    menuOpen = false
    menuPanel.style.display = 'none'
  })

  btnBrainIndex.addEventListener('click', async (e) => {
    e.stopPropagation()
    try {
      const result = await synAPI.brainIndex()
      showBrainResult('/index', result)
    } catch (err) {
      alert('Index failed: ' + err.message)
    }
    menuOpen = false
    menuPanel.style.display = 'none'
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
    await synAPI.setConfig({ batchSize })
  })

  // ── Terminal command input ────────────────────────────────────────────
  terminalInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const raw = terminalInput.value.trim()
      terminalInput.value = ''
      if (!raw) return

      // Add to history
      terminalHistory.push(raw)
      terminalHistoryIndex = terminalHistory.length

      // Echo command
      appendTerminalLine(`$ ${raw}`, 'cmd')

      try {
        await executeTerminalCommand(raw)
      } catch (err) {
        appendTerminalLine(`Error: ${err.message}`, 'error')
      }
      terminalOutput.scrollTop = terminalOutput.scrollHeight
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (terminalHistoryIndex > 0) {
        terminalHistoryIndex--
        terminalInput.value = terminalHistory[terminalHistoryIndex]
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (terminalHistoryIndex < terminalHistory.length - 1) {
        terminalHistoryIndex++
        terminalInput.value = terminalHistory[terminalHistoryIndex]
      } else {
        terminalHistoryIndex = terminalHistory.length
        terminalInput.value = ''
      }
    }
  })

  async function executeTerminalCommand(raw) {
    const parts = raw.split(/\s+/)
    const cmd = parts[0].toLowerCase()
    const args = parts.slice(1)

    switch (cmd) {
      case '/locate': {
        if (args.length === 0) {
          appendTerminalLine('Usage: /locate <search query> [filters...]', 'warn')
          appendTerminalLine('Filters: harness:X, date:YYYY-MM-DD, role:user, role:assistant, brain:X', 'warn')
          return
        }
        const query = args.filter(a => !a.includes(':')).join(' ')
        const filters = {}
        args.filter(a => a.includes(':')).forEach(f => {
          const [k, v] = f.split(':', 2)
          filters[k] = v
        })
        appendTerminalLine(`/locate "${query}" ${JSON.stringify(filters)}`, 'cmd')
        const results = await synAPI.searchSessions(query, { batchSize, filters })
        renderSearchResults(results)
        break
      }

      case '/reflect': {
        const sessionId = args[0] || selectedSessionId
        if (!sessionId) {
          appendTerminalLine('Usage: /reflect <sessionId> (or select a session first)', 'warn')
          return
        }
        const result = await synAPI.brainReflect(sessionId)
        appendTerminalLine(`/reflect → ${result.path || 'done'}`, 'ok')
        appendTerminalLine(`Learnings: ${result.learningsCount || 0}`, 'ok')
        break
      }

      case '/meditate': {
        const result = await synAPI.brainMeditate()
        appendTerminalLine(`/meditate → ${result.path || 'done'}`, 'ok')
        appendTerminalLine(`Files audited: ${result.filesAudited || 0}, principles: ${result.principlesExtracted || 0}, stale: ${result.staleNotes ? result.staleNotes.length : 0}`, 'ok')
        break
      }

      case '/ruminate': {
        const result = await synAPI.brainRuminate()
        appendTerminalLine(`/ruminate → ${result.path || 'done'}`, 'ok')
        appendTerminalLine(`Sessions scanned: ${result.sessionsScanned || 0}, patterns: ${result.patternsFound || 0}`, 'ok')
        break
      }

      case '/plan': {
        const task = args.join(' ')
        if (!task) {
          appendTerminalLine('Usage: /plan <task description>', 'warn')
          return
        }
        const result = await synAPI.brainPlan(task)
        appendTerminalLine(`/plan → ${result.path || 'done'}`, 'ok')
        appendTerminalLine(`Task: ${result.task || task}`, 'ok')
        break
      }

      case '/review': {
        const content = args.join(' ')
        if (!content) {
          appendTerminalLine('Usage: /review <content to review>', 'warn')
          return
        }
        const result = await synAPI.brainReview(content)
        appendTerminalLine(`/review → ${result.path || 'done'}`, 'ok')
        if (result.issues && result.issues.length) {
          result.issues.forEach((issue, i) => {
            appendTerminalLine(`  ${i + 1}. [${issue.severity}] ${issue.message}`, 'warn')
          })
        } else {
          appendTerminalLine('No issues found.', 'ok')
        }
        break
      }

      case '/brain': {
        const sub = args[0]
        if (sub === 'list') {
          const files = await synAPI.brainList()
          appendTerminalLine('Brain files:', 'ok')
          files.forEach(f => appendTerminalLine(`  [[${f}]]`, 'ok'))
        } else if (sub === 'index') {
          const result = await synAPI.brainIndex()
          appendTerminalLine(`/brain index → ${result.files} files indexed`, 'ok')
        } else if (sub === 'read') {
          const path = args[1]
          if (!path) {
            appendTerminalLine('Usage: /brain read <path>', 'warn')
            return
          }
          const result = await synAPI.brainRead(path)
          if (result.ok) {
            appendTerminalLine(`--- ${path} ---`, 'ok')
            appendTerminalLine(result.content, 'ok')
          } else {
            appendTerminalLine(`Read failed: ${result.error}`, 'error')
          }
        } else if (sub === 'write') {
          const path = args[1]
          const content = args.slice(2).join(' ')
          if (!path || !content) {
            appendTerminalLine('Usage: /brain write <path> <content>', 'warn')
            return
          }
          const result = await synAPI.brainWrite(path, content)
          appendTerminalLine(`/brain write → ${result.path}`, 'ok')
        } else {
          appendTerminalLine('Usage: /brain <list|index|read <path>|write <path> <content>>', 'warn')
        }
        break
      }

      case '/syn': {
        appendTerminalLine('/syn — Syn skill guidance', 'ok')
        appendTerminalLine('Use /locate <query> to search sessions and Memory Vault.', 'ok')
        appendTerminalLine('Use /reflect, /meditate, /ruminate, /plan, /review for brainmaxxing.', 'ok')
        appendTerminalLine('Use /brain <read|write|list|index> for Memory Vault file ops.', 'ok')
        appendTerminalLine('Click any search result to open the session.', 'ok')
        break
      }

      case '/help': {
        appendTerminalLine('Available commands:', 'ok')
        appendTerminalLine('  /locate <query> [filters]  — search sessions + Memory Vault', 'ok')
        appendTerminalLine('  /reflect [sessionId]       — reflect on a session', 'ok')
        appendTerminalLine('  /meditate                  — audit brain vault', 'ok')
        appendTerminalLine('  /ruminate                  — mine session patterns', 'ok')
        appendTerminalLine('  /plan <task>               — create phased plan', 'ok')
        appendTerminalLine('  /review <content>          — review content against principles', 'ok')
        appendTerminalLine('  /brain <list|index|read|write>  — Memory Vault file ops', 'ok')
        appendTerminalLine('  /syn                       — skill guidance', 'ok')
        appendTerminalLine('  /help                      — this help', 'ok')
        break
      }

      default: {
        appendTerminalLine(`Unknown command: ${cmd}. Type /help for available commands.`, 'error')
      }
    }
  }

  function appendTerminalLine(text, type = 'normal') {
    const div = document.createElement('div')
    div.className = `terminal-line terminal-${type}`
    div.textContent = text
    terminalOutput.appendChild(div)
  }

  function renderSearchResults(results) {
    if (!results || results.length === 0) {
      appendTerminalLine('No results found.', 'warn')
      return
    }
    appendTerminalLine(`Found ${results.length} result${results.length !== 1 ? 's' : ''}:`, 'ok')
    results.forEach((r) => {
      const div = document.createElement('div')
      div.className = 'terminal-result'
      div.textContent = `${r.title} [${r.harness}]`
      div.style.cursor = 'pointer'
      div.style.color = '#00ccff'
      div.style.marginLeft = '20px'
      div.addEventListener('click', () => {
        selectedSessionId = r.id
        renderSessionList(allSessions)
        loadSessionContent(r)
        // Scroll terminal out of the way / focus session
        terminalOutput.style.display = 'none'
      })
      terminalOutput.appendChild(div)
    })
  }

  // ── Search input (kept for backward compat, now delegates to terminal) ──
  // The old searchInput is removed; use /locate in the terminal instead.

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
      await synAPI.deleteSession(ctxTargetSessionId)
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
          await synAPI.deleteSessionFile(ctxTargetSessionId)
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
      await synAPI.deleteSessionFile(ctxTargetSessionId)
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
      const config = await synAPI.getConfig()
      batchSize = config.batchSize || 10
      settingBatchSize.value = String(batchSize)

      // Load harness enable/disable settings
      try {
        const settings = await synAPI.getHarnessSettings()
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
            await synAPI.addHarness(dir)
          } catch (e) {
            console.error('Failed to add harness:', dir, e.message)
          }
        }

        // Index all sources so sessions appear in the list
        try {
          await synAPI.indexAllSources()
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
    allSessions = await synAPI.listAllSessions()
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
      const data = await synAPI.readSession(session.id)
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

  // ── performSearch removed — replaced by terminal /locate command ──

  async function scanAndAutodetectHarnesses() {
    try {
      const detected = await synAPI.autodetectHarnesses()
      const current = await synAPI.listHarnesses()
      const currentPaths = new Set(current.map(h => h.path))
      let added = 0
      for (const d of detected) {
        if (!currentPaths.has(d)) {
          await synAPI.addHarness(d)
          added++
        }
      }

      renderHarnesses()

      // Index all sources so sessions appear in the list
      try {
        await synAPI.indexAllSources()
      } catch (e) {
        console.error('Indexing failed:', e)
      }

      try {
        await loadSessions()
      } catch (e) {
        console.error('Loading sessions failed:', e)
      }

      // Notify user
      const btn = btnScanHarnesses
      const orig = btn.textContent
      btn.textContent = `Found ${added} new harness${added !== 1 ? 'es' : ''}`
      setTimeout(() => { btn.textContent = orig }, 2000)
    } catch (e) {
      console.error('Scan failed:', e)
      alert('Scan failed: ' + e.message)
    }
    menuOpen = false
    menuPanel.style.display = 'none'
  }

  function renderHarnesses() {
    loadHarnesses()
  }

  async function loadHarnesses() {
    const harnesses = await synAPI.listHarnesses()
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
        try {
          // Remove all directories for this harness
          for (const h of items) {
            await synAPI.removeHarness(h.path || h)
          }
          loadHarnesses()
          await loadSessions()
        } catch (err) {
          console.error('Remove harness failed:', err)
          alert('Failed to remove harness: ' + err.message)
        }
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
          await synAPI.setHarnessSetting(name, on)
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

