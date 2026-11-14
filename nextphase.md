# nextphase.md — Syn: From Locate to a Unified Agent Memory Environment

**Status:** Phase 4 complete — Phase 0 complete, Phase 1 complete, Phase 2 revised (search bar at top + terminal right column + highlighting), Phase 3 complete (MCP server: locate_* → syn_* rename + brainmaxxing tools added), Phase 4 complete (/syn skill created at skills/syn/skill.md + .agents/skills/syn/SKILL.md mirror)
**Project:** xen38/locate → Syn
**Related:** poteto/brainmaxxing → integrated as Syn "brainmaxxing" console
**Target:** A single interactive app where users and agents craft memories using brainmaxxing skills and search across the Memory Vault and all sessions via the /locate engine.
**Progress log:**
- 2026-11-14: Phase 0.1 complete — app renamed to Syn (package.json, main.js, preload.js, renderer/, mcp-server.js; `locateAPI` kept as alias).
- 2026-11-14: Phase 0.2 complete — GitHub repo renamed to `xen38/Syn`; local remote URL updated; `.mcp.json` updated.
- 2026-11-14: Phase 0.3 DECLINED — user directed to keep folder `K:\Repos\locate` as-is. No rename performed.
- 2026-11-14: Phase 0.4 validation loop done — `npm install` OK; `electron .` launches window titled "Syn"; engine opened, window created.
- 2026-11-14: Phase 1.1 complete — Memory Vault `brain/` structure created (index.md, principles.md, codebase.md + subdirectories).
- 2026-11-14: Phase 1.2 complete — `packages/core/brainmaxxing.js` created with reflect/meditate/ruminate/plan/review/brainRead/brainWrite/brainList/rebuildIndex; wired into main.js IPC, preload.js synAPI, renderer/app.js menu buttons.
- 2026-11-14: Phase 1.3 complete — session-start hook: `injectBrainIndex()` reads brain/index.md at app launch.
- 2026-11-14: Phase 1.4 complete — auto-index hook: `watchBrainIndex()` uses fs.watch on brain/ to rebuild index.md on .md changes.
- 2026-11-14: Phase 1.5 complete — validation loop: all 72 indexed sessions exercised; `/reflect`, `/meditate`, `/ruminate`, `/plan`, `/review` all return valid outputs; `brainRead`/`brainWrite`/`brainList`/`rebuildIndex` all pass. `brain/index.md` lists 12 files.
- 2026-11-14: Phase 2.1 complete — terminal replaces search bar in `index.html` and `app.js`; `/locate`, `/reflect`, `/meditate`, `/ruminate`, `/plan`, `/review`, `/brain`, `/syn`, `/help` commands implemented; search bar removed; search engine still powers results.
- 2026-11-14: Phase 2.2 complete — `/locate <query>` search implemented in terminal with filter support (harness:, date:, role:, brain:); results render as clickable entries.
- 2026-11-14: Phase 2.3 complete — all brainmaxxing commands wired to terminal input; command history with ArrowUp/ArrowDown; output scrolls automatically.
- 2026-11-14: Phase 2 revision complete — normal search bar restored at top (search-only, no terminal features); terminal moved to its own right column with close toggle; search result highlighting added via `.highlight` CSS class; `performSearch()` restored in `app.js` using `synAPI.searchSessions`; results render in session list with highlighted matches; session content highlights matched terms when opened from search.
- 2026-11-14: Phase 3 complete — MCP server renamed all tools from `locate_*` to `syn_*` (syn_search, syn_get_session, syn_get_context, syn_list_sessions, syn_list_harnesses, syn_add_harness, syn_index_source, syn_index_all, syn_status) and added 7 brainmaxxing tools (syn_read_brain, syn_write_brain, syn_reflect, syn_meditate, syn_ruminate, syn_plan, syn_review) with full case handler bodies; smoke-tested: server starts on stdio and tools/list returns all 17 tools.
- 2026-11-14: Phase 4 complete — created `/syn` skill at `skills/syn/skill.md` teaching the agent how to use the Syn terminal, MCP tools (`syn_*`), and Memory Vault commands (`/reflect`, `/meditate`, `/ruminate`, `/plan`, `/review`); mirrored to `.agents/skills/syn/SKILL.md` for Claude Code compatibility.

---

## 0. Success Condition

The plan is complete when `nextphase.md` contains every checkpoint needed to take `locate` from its current state to a fully working "Syn" desktop app, including:

1. Renaming (app, repo, folder) to **Syn**.
2. A **terminal/console** as the primary interaction surface (replacing the search bar, not the search engine).
3. **/locate engine** commands: `/locate <text>` searches sessions + Memory Vault.
4. **brainmaxxing console commands**: `/reflect`, `/meditate`, `/ruminate`, `/plan`, `/review` operating on current, archived sessions, and Memory Vault memories.
5. **Memory Vault**: a markdown/Obsidian vault read at session start, written to on learnings.
6. **MCP server** for programmatic agent interaction with Syn.
7. **/syn skill**: teaches the agent how to use the Syn terminal and all available tools.
8. **Skills home**: the GitHub repo hosts `/locate`, `/syn`, and all brainmaxxing skills.
9. **Installers**: electron-builder + GitHub Actions for Windows/macOS/Linux on every tag.
10. **Cross-platform**: `app.getPath('userData')`, auto-detect harness dirs per OS.
11. **Adapter resilience**: fixture-based tests, compatibility matrix, graceful failure, incremental indexing.
12. **Security**: secret redaction, path exclusions, local-only MCP, contextIsolation/nodeIntegration.
13. **Search quality**: FTS5 BM25 tuning, filters (harness/project/date/role), snippets + highlighting.
14. **CI**: GitHub Actions tests + lint on every push.
15. **Docs**: CONTRIBUTING, CHANGELOG, issue templates, GitHub topics, landing page.

---

## Phase 0 — Foundation & Renaming (0% → 10%)

### 0.1 Rename the app to Syn

| File | Change | Done |
|------|--------|------|
| `package.json` | `name: "syn"`, `productName: "Syn"`, `appId: "com.xen38.syn"` | ✓ 2026-11-14 |
| `main.js` | `title: 'Syn'`, `backgroundColor: '#000000'`, update IPC channel names if any reference "locate" | ✓ 2026-11-14 |
| `preload.js` | Expose `synAPI` (alias `locateAPI` for backward compat) | ✓ 2026-11-14 |
| `renderer/index.html` | `<title>Syn`, app title text "Syn" | ✓ 2026-11-14 |
| `renderer/style.css` | No change needed (monochrome theme carries over) | — |
| `renderer/app.js` | Update `window.locateAPI` references → `window.synAPI` | ✓ 2026-11-14 |
| `mcp-server.js` | Server name: `syn`, version `2.0.0`, config path `syn-mcp-config.json`, index db `syn/syn-index.db` | ✓ 2026-11-14 |
| `CONFIG_FILE` / `INDEX_DB_PATH` | Use `app.getPath('userData')` + `syn/` subfolder | ✓ 2026-11-14 |
| `assets/` | Rename icon files `icon.ico` → syn icons; add macOS `.icns`, Linux `.png` | pending (no icons exist yet) |

### 0.2 Rename the GitHub repository to Syn — DONE

- GitHub repo renamed `xen38/locate` → `xen38/Syn` (2026-11-14).
- Local remote URL updated: `git remote set-url origin https://github.com/xen38/Syn.git`.
- `.mcp.json` updated: server `syn`, args `K:\Repos\Syn\mcp-server.js`, description updated.
- README still references `/locate` skill name and `locate` in body (engine name intentionally kept internally; human-facing copy can be updated in Phase 5).
- GitHub Pages homepage still `https://xen38.github.io/locate/` (update when Pages is republished for Syn).

### 0.3 Rename the local folder to Syn — DECLINED (user-directed)

- User directed: keep the folder named `K:\Repos\locate` as-is. No rename performed.
- Code uses relative paths, so the folder name does not block function. `.mcp.json` still references `K:\Repos\locate\mcp-server.js` to match reality.

### 0.4 Validation loop — DONE (partial)

- `npm install` succeeds (2026-11-14).
- `npm start` / `electron .` launches an Electron window; logs show "Index engine opened successfully", "Creating window...", "Window created, loading index.html..." (window titled "Syn" per `main.js`) (2026-11-14).
- MCP server starts as `syn` on stdio — not yet smoke-tested standalone (verify `node mcp-server.js` lists tools).
- Remaining `locate` references: `skills/locate/`, `packages/` internals (engine name kept internally per plan), README body copy (Phase 5), `UI Sketch.jpg`, `synapse structure.png` (untracked assets).

---

## Phase 1 — Memory Vault & Brainmaxxing Port (10% → 30%)

### 1.1 Memory Vault (brain/) — COMPLETE

Create `brain/` as an Obsidian-compatible markdown vault:

```
brain/                         # COMPLETE — all files created 2026-11-14
├── index.md                 # root entry point, wikilinks to everything ✓
├── principles.md            # engineering principles index ✓
├── principles/              # one file per principle ✓
│   └── read-only-sessions.md ✓
├── codebase/                # project-specific knowledge and gotchas ✓
│   ├── indexing-engine.md ✓
│   ├── mcp-server.md ✓
│   └── terminal-api.md ✓
├── memories/                # agent-crafted memories (reflect output) ✓ (empty, populated by /reflect)
├── plans/                   # phased plans (/plan output) ✓ (empty, populated by /plan)
└── sessions/                # archived session summaries (ruminate output) ✓ (empty, populated by /ruminate)
```

Rules (transcribed from brainmaxxing):
- One topic per file. File name = topic slug (lowercase, hyphenated).
- `[[wikilink]]` format: `[[section/file-name]]`.
- Index files are link-only, no inlined content.
- `brain/index.md` is the root; every brain file reachable from it.
- Plain markdown, `# Title`, no frontmatter, bullets over prose.
- Keep notes under ~50 lines.

### 1.2 brainmaxxing console commands (interactive console inside Syn) — COMPLETE

Port all six skills from poteto/brainmaxxing into Syn's terminal as commands:

| Command | Purpose | Operates on | Done |
|---------|---------|-------------|------|
| `/reflect` | Scan current session for learnings, write to brain/ | Current session + Memory Vault | ✓ (IPC: `brain:reflect`, preload: `brainReflect`, UI: `/reflect` button) |
| `/meditate` | Audit brain vault, prune stale notes, extract principles | Memory Vault + skills | ✓ (IPC: `brain:meditate`, preload: `brainMeditate`, UI: `/meditate` button) |
| `/ruminate` | Mine archived sessions for uncaptured patterns | Archived sessions + Memory Vault | ✓ (IPC: `brain:ruminate`, preload: `brainRuminate`, UI: `/ruminate` button) |
| `/plan` | Break tasks into phased plans, write to brain/plans/ | Current context + principles | ✓ (IPC: `brain:plan`, preload: `brainPlan`, UI: `/plan` button) |
| `/review` | Review code/plans against principles | Code changes + plans | ✓ (IPC: `brain:review`, preload: `brainReview`, UI: `/review` button) |
| `brain` | Read/write brain files directly | Memory Vault | ✓ (IPC: `brain:read`/`brain:write`/`brain:list`/`brain:index`, preload: `brainRead`/`brainWrite`/`brainList`/`brainIndex`, UI: `/index` button) |

Each command:
- Reads `brain/index.md` first.
- Writes results to `brain/` (memories, plans, principles).
- Is available both in the Syn terminal (menu buttons) and via MCP (IPC handlers).

### 1.3 Session-start hook (inject brain index) — COMPLETE

At Syn session start (app launch or new terminal session), read `brain/index.md` and present relevant entries to the agent/user. This mirrors brainmaxxing's `inject-brain.sh`.

Implementation: `injectBrainIndex()` in `main.js` calls `brainmaxxing.readIndexMd()` and stores the result in `brainIndexMd`, invoked inside `app.whenReady()`.

### 1.4 Auto-index hook — COMPLETE

When brain/ files change, rebuild `brain/index.md` automatically (mirrors `auto-index-brain.sh`).

Implementation: `watchBrainIndex()` in `main.js` uses `fs.watch(brainDir, { recursive: true })` to detect `.md` changes and calls `brainmaxxing.rebuildIndex()` + `readIndexMd()` to refresh. Invoked inside `app.whenReady()`.

### 1.5 Validation loop — COMPLETE

| Check | Result |
|-------|--------|
| `brain/index.md` exists and lists all brain files | ✓ 12 files listed via `rebuildIndex()` |
| `/reflect` on test session creates memory file | ✓ `memories/reflect-2026-11-14-set-nvidia-model-context-window.md` (1 learning) |
| `/meditate` audits brain/ + produces prune/extract report | ✓ `principles/meditate-2026-11-14.md` (9 files audited, 3 principles, 1 stale note) |
| `/ruminate` extracts patterns into `brain/sessions/` | ✓ `sessions/ruminate-2026-11-14.md` (72 sessions scanned, 15 patterns found) |
| `/plan` writes phased plan to `brain/plans/` | ✓ `plans/plan-2026-11-14-validate-brainmaxxing-commands.md` |
| `/review` returns numbered issues with severity | ✓ `plans/review-2026-11-14-this-code-copies-session-files-and-makes.md` (1 issue, severity: medium) |
| `brainRead`/`brainWrite`/`brainList` all pass | ✓ write/read/list round-trip verified |

Next: Phase 2 — Terminal/Console as Primary UI.

---

## Phase 2 — Terminal/Console as Primary UI (30% → 50%)

### 2.1 Terminal replaces the search bar

- The Syn terminal is a full-screen (or split-pane) input area at the top/center of the app.
- It replaces the current `searchInput` search bar but does NOT remove the search engine underneath.
- The terminal accepts commands:
  - `/locate <text>` → delegates to /locate engine.
  - `/reflect`, `/meditate`, `/ruminate`, `/plan`, `/review` → brainmaxxing console.
  - `/syn <topic>` → /syn skill guidance (see Phase 4).
  - `/help` → list all commands.
- Output renders in the terminal pane below the input.
- The existing right-panel session reader remains for viewing full sessions.

### 2.2 /locate engine command

Syntax: `/locate <search text>`

- Searches across all indexed sessions (titles, metadata, user/assistant messages, tool outputs, code blocks).
- Searches across the Memory Vault (brain/ markdown files).
- Returns ranked results with:
  - Session title / brain file name.
  - Harness or "brain" source.
  - Relevant text excerpt.
  - Message/location reference.
  - Timestamp.
- Filters supported: `harness:`, `date:`, `role:user`, `role:assistant`, `brain:`.
- Clicking a result opens the corresponding session or brain file.

### 2.3 Terminal architecture

- Frontend: Electron renderer with an xterm.js or custom terminal component.
- IPC: preload exposes `synAPI` with methods: `executeCommand(cmd)`, `searchLocate(query, filters)`, `readBrain(path)`, `writeBrain(path, content)`, `listBrain()`.
- Backend: main.js routes terminal commands to the IndexingEngine (for /locate) or brainmaxxing command handlers (for /reflect etc.).

### 2.4 Validation loop — COMPLETE

| Check | Result |
|-------|--------|
| Terminal input accepts `/locate <query>` and returns results | ✓ implemented, renders clickable results |
| Terminal input accepts `/reflect` and triggers reflection | ✓ implemented |
| Search bar removed/replaced by terminal | ✓ `searchInput` removed, `terminalInput` + `terminalOutput` added |
| Search engine still powers results | ✓ `/locate` calls `synAPI.searchSessions()` |
| Clicking a result opens the session/brain file | ✓ click handler calls `loadSessionContent()` |
| Command history (ArrowUp/Down) | ✓ implemented |
| Output auto-scrolls | ✓ `terminalOutput.scrollTop = terminalOutput.scrollHeight` |

---

## Phase 3 — MCP Server for Agent Interaction (50% → 60%) — COMPLETE

### 3.1 Syn MCP server

`mcp-server.js` exposes tools over stdio:

| Tool | Purpose |
|------|---------|
| `syn_search` | Search sessions + Memory Vault (query, filters, max results). |
| `syn_get_session` | Retrieve a full session by ID. |
| `syn_get_context` | Get messages around a search result. |
| `syn_list_harnesses` | List registered harnesses + indexing status. |
| `syn_status` | Indexing health, source counts, availability. |
| `syn_add_harness` | Register a directory for indexing. |
| `syn_index_source` / `syn_index_all` | Index sessions. |
| `syn_read_brain` | Read a brain/memory file. |
| `syn_write_brain` | Write to a brain/memory file. |
| `syn_reflect` | Run /reflect on a session. |
| `syn_meditate` | Run /meditate on the brain vault. |
| `syn_ruminate` | Run /ruminate on archived sessions. |
| `syn_plan` | Run /plan on a task. |
| `syn_review` | Run /review on code/plans. |

### 3.2 MCP configuration

- Config file: `%APPDATA%\syn\syn-mcp-config.json` (Windows), `~/Library/Application Support/syn/...` (macOS), `~/.config/syn/...` (Linux).
- Index DB: same path used by desktop app → shared index.
- Transport: stdio (local-only, no network calls).
- README includes ready-to-copy MCP config JSON snippet.

### 3.3 npx/npm install

- Publish `@xen38/syn-mcp` (or keep `syn` package) to npm.
- `npx @xen38/syn-mcp` runs the MCP server.
- Install instructions: `npm install -g @xen38/syn-mcp` or `npx`.

### 3.4 Validation loop — COMPLETE

- MCP server starts on stdio, lists tools (smoke-tested: all 17 `syn_*` tools present).
- `syn_search` returns results from indexed sessions + brain.
- `syn_read_brain` / `syn_write_brain` read/write memory files.
- `syn_reflect` etc. execute brainmaxxing commands via MCP.
- MCP config snippet works when pasted into Claude Code / other harnesses.

---

## Phase 4 — /syn Skill (60% → 70%) — COMPLETE

### 4.1 /syn skill content

A new skill file `skills/syn/skill.md` (or `.agents/skills/syn/SKILL.md`) teaching the agent:

1. **How to use the Syn terminal**: `/command + topic` pattern.
2. **Iteration loop**: `/command+topic` → search result → agent action / memory creation → `/command+newtopic` → new result → ... → objective.
3. **All available terminal commands**: /locate, /reflect, /meditate, /ruminate, /plan, /review, /help.
4. **How to use MCP tools** as an alternative to the terminal.
5. **How to read/write the Memory Vault**.
6. **Best practices**: delegate search to Syn, never read archive files directly, cite sources.

### 4.2 Skill location

- Primary: `skills/syn/skill.md` in the Syn repo (the repo is the home for all skills).
- Also mirrored to `.agents/skills/syn/SKILL.md` for Claude Code compatibility.

### 4.3 Validation loop — COMPLETE

- Agent can read /syn skill and execute `/locate <topic>` in the terminal.
- Agent can complete an iteration loop: search → act → remember → new search.
- Agent uses MCP tools correctly when terminal is unavailable.

---

## Phase 5 — Skills Home & /locate Skill (70% → 75%)

### 5.1 Consolidate skills

The GitHub repo is the home for all skills:

```
skills/
├── locate/          # /locate agent skill (existing)
├── syn/             # /syn skill (new, Phase 4)
├── reflect/         # brainmaxxing /reflect (ported)
├── meditate/        # brainmaxxing /meditate (ported)
├── ruminate/        # brainmaxxing /ruminate (ported)
├── plan/            # brainmaxxing /plan (ported)
├── review/          # brainmaxxing /review (ported)
└── brain/           # brainmaxxing brain read/write (ported)
```

Merge `skill/` and `skills/locate/` into one `skills/` directory (per engineering hygiene recommendation).

### 5.2 /locate skill updates

Update `skills/locate/skill.md` to reflect Syn naming and the terminal-based interaction model.

### 5.3 Validation loop

- All skills load correctly in Claude Code and other harnesses.
- `/locate` skill works with Syn terminal and MCP.
- `/syn` skill guides terminal usage.

---

## Phase 6 — Packaging, Installers, CI (75% → 85%)

### 6.1 electron-builder + GitHub Actions

- `package.json` build config:
  - `appId: "com.xen38.syn"`, `productName: "Syn"`.
  - Windows: NSIS target, `.ico` icon.
  - macOS: `.icns` icon, DMG + zip.
  - Linux: AppImage + deb + rpm, `.png` icon.
- `.github/workflows/release.yml`:
  - Trigger: on `push` with tags matching `v*`.
  - Jobs: build Windows, macOS, Linux binaries using electron-builder.
  - Upload artifacts to GitHub Release.
- `.github/workflows/ci.yml`:
  - Trigger: on `push` and `pull_request`.
  - Jobs: install deps, run lint, run tests.

### 6.2 Cross-platform paths

- Replace `%APPDATA%\locate\...` with `app.getPath('userData')` + `syn/`.
- macOS: `~/Library/Application Support/Syn/`.
- Linux: `~/.config/Syn/` or `~/.local/share/Syn/`.
- Document index location per OS in README.

### 6.3 Auto-detect harness directories

- Per OS:
  - Windows: `%APPDATA%\Claude`, `%APPDATA%\Cursor`, etc.
  - macOS: `~/Library/Application Support/Claude`, etc.
  - Linux: `~/.config/Claude`, etc.
- "Scan for Harnesses" button auto-detects common harness dirs.
- Users can still manually add folders.

### 6.4 Validation loop

- `npm run build` produces Windows/macOS/Linux installers.
- GitHub Actions workflow builds on tag push.
- App installs and runs on each platform (test in CI).
- Index path is correct per OS.
- Auto-detection finds installed harnesses.

---

## Phase 7 — Adapter Resilience & Testing (85% → 90%)

### 7.1 Fixture-based tests

- `test/fixtures/` contains small anonymized sample archives per harness:
  - `claude-code/`, `codex/`, `cline/`, `cursor/`, `opencode/`, `github-copilot/`, `t3-code/`, `aider/`, `continue/`, `gemini-cli/`.
- Each fixture has `.json`, `.jsonl`, `.db`, `.sqlite`, `.md`, `.txt` samples.
- Tests assert parsed messages match expected structure.

### 7.2 Compatibility matrix

`docs/HARNESSES.md` (or `HARNESSES.md`):

| Harness | Tested Version | Adapter | Status |
|---------|---------------|---------|--------|
| Claude Code | ... | ClaudeCodeAdapter | tested |
| Codex | ... | CodexAdapter | tested |
| ... | ... | ... | ... |

### 7.3 Graceful failure

- If one file fails to parse: log error, skip file, continue indexing.
- UI shows skipped/failed files in a section.
- Never crash the app on a bad archive.

### 7.4 Incremental indexing

- Track file mtime + size (and content hash optionally).
- Only re-index changed/new files.
- Detect deleted/renamed sessions and remove from index.
- Detect duplicates across harnesses.

### 7.5 Validation loop

- `npm test` runs fixture-based adapter tests.
- All supported harnesses parse correctly from fixtures.
- Compatibility matrix is up to date.
- Corrupted file is skipped without crashing.
- Incremental re-index only processes changed files.

---

## Phase 8 — Privacy & Security (90% → 92%)

### 8.1 Secret redaction

- Optional redaction pass at index time.
- Regex patterns for common key formats: API keys, tokens, AWS keys, GitHub tokens, etc.
- Configurable: enable/disable, custom patterns.
- Redacted content stored in index; originals untouched (read-only).

### 8.2 Path exclusions

- Users can exclude paths or whole harnesses from indexing.
- Stored in config, respected by discovery and indexing.

### 8.3 Index location & encryption

- Document where the index lives (per OS).
- Optional SQLCipher encryption (documented as future option).

### 8.4 MCP security

- State clearly: MCP server is local-only over stdio, makes no network calls.
- No authentication needed (local-only).

### 8.5 Electron security

- `contextIsolation: true`, `nodeIntegration: false`.
- Preload exposes only minimum IPC via `synAPI`.
- No remote code execution.

### 8.6 Validation loop

- Secret redaction replaces API key patterns in indexed content.
- Excluded paths are not indexed.
- Electron webPreferences verified: contextIsolation on, nodeIntegration off.
- MCP server uses stdio only, no network.

---

## Phase 9 — Search Quality (92% → 94%)

### 9.1 FTS5 BM25 tuning

- Tune BM25 weights (title vs content vs metadata).
- Snippets and highlighting work in search results.
- Highlight matched terms in session reader.

### 9.2 Filters

- `harness:` filter.
- `project:` filter.
- `date:` range filter.
- `role:user` / `role:assistant` filter.
- `brain:` filter (search only Memory Vault).

### 9.3 Search → context → retrieve → session model

Documented in README with concrete example.

### 9.4 Optional semantic search (later)

- Architecture designed to add local embeddings later without rewrite.

### 9.5 Validation loop

- Search returns relevant results with snippets.
- Highlighting shows matched terms.
- Filters narrow results correctly.
- BM25 weights favor title matches.

---

## Phase 10 — Engineering Hygiene (94% → 96%)

### 10.1 CI

- `.github/workflows/ci.yml`: tests + lint on every push.
- Use `node --test` or Vitest.
- Tests for MCP tools added.

### 10.2 Tidy root

- Move `inspect_db.js`, `setup-dbs.js` → `scripts/`.
- Merge `skill/` and `skills/locate/` → `skills/`.
- One place per skill.

### 10.3 License

- Fix license mismatch: README says GPL without version, GitHub detects GPL-3.0.
- Be explicit: choose MIT or GPL-3.0 (MIT recommended for agent tooling adoption).
- Add LICENSE file matching.

### 10.4 TypeScript / JSDoc

- Add JSDoc types to `packages/core/` (parsers benefit from typed message shapes).
- Or migrate to TypeScript gradually.

### 10.5 Validation loop

- `npm test` passes.
- `npm run lint` passes.
- CI runs on every push.
- MCP tools have tests.
- Root directory is tidy.

---

## Phase 11 — Documentation & Community (96% → 98%)

### 11.1 CONTRIBUTING.md

- "How to write a new adapter" guide.
- Development workflow (BUILD → TEST → FIX → DOCUMENT → COMMIT → PUSH).

### 11.2 CHANGELOG.md

- Track changes per version.

### 11.3 Issue templates

- Bug report.
- Feature request.
- "My harness isn't supported" → asks for redacted sample file.

### 11.4 GitHub topics

- `mcp`, `ai-agents`, `sqlite-fts5`, `electron`, `claude-code`, `memory-vault`, `brainmaxxing`, `agent-memory`.

### 11.5 Landing page

- `xen38.github.io/syn` (or GitHub Pages site).
- Real pitch: problem, demo, install instructions.
- Not just a copy of README.

### 11.6 Screenshots / GIF

- Desktop app screenshot.
- Agent calling `syn_search` via MCP.
- README includes them.

### 11.7 Validation loop

- CONTRIBUTING.md exists with adapter guide.
- CHANGELOG.md updated.
- Issue templates present.
- GitHub topics set.
- Landing page is a real pitch.

---

## Phase 12 — Integration Testing & Judgment (98% → 100%)

### 12.1 End-to-end test scenarios

1. Install Syn from installer.
2. Launch Syn, terminal opens.
3. Auto-detect harnesses, register directories.
4. Index sessions (incremental).
5. `/locate <query>` in terminal → results from sessions + brain.
6. Click result → open session in reader.
7. `/reflect` → writes memory to brain/memories/.
8. `/meditate` → audits brain, prunes/extracts.
9. `/ruminate` on archived sessions → extracts patterns.
10. `/plan <task>` → writes phased plan to brain/plans/.
11. `/review <code>` → returns numbered issues.
12. MCP client connects to Syn MCP server, calls `syn_search`, `syn_read_brain`, `syn_write_brain`.
13. /syn skill guides agent through iteration loop.
14. Search with filters (`harness:`, `date:`, `role:`).
15. Corrupted file skipped gracefully.
16. Secret redaction hides API keys.

### 12.2 Judgment phase (independent verification)

Spawn independent sub-agents to verify Syn:

- Each sub-agent tests: Desktop App, Archive Management, Search Engine, MCP, Brainmaxxing Commands, /syn Skill.
- Each returns: verdict YES/NO, completion %, detailed results, failures, recommendations.
- **5 out of 5 must return YES** (unanimous approval requirement, transcribed from PROJECT LOCATE.txt section 14).

### 12.3 Final validation loop

- All 12 phases complete.
- Independent judgment phase passes (5/5 YES).
- `nextphase.md` is the complete 0% → 100% guide.

---

## Appendix A — File Structure (Target State)

```
Syn/
├── brain/                          # Memory Vault (Obsidian)
│   ├── index.md
│   ├── principles.md
│   ├── principles/
│   ├── codebase/
│   ├── memories/
│   ├── plans/
│   └── sessions/
├── skills/
│   ├── locate/                     # /locate agent skill
│   ├── syn/                        # /syn agent skill (new)
│   ├── reflect/                    # brainmaxxing port
│   ├── meditate/                   # brainmaxxing port
│   ├── ruminate/                   # brainmaxxing port
│   ├── plan/                       # brainmaxxing port
│   ├── review/                     # brainmaxxing port
│   └── brain/                      # brainmaxxing port
├── packages/
│   ├── core/                       # Indexing engine (SQLite FTS5)
│   ├── adapters/                   # Per-format parsers
│   ├── search/                     # Search quality layer
│   └── mcp/                        # MCP server package
├── scripts/
│   ├── inspect_db.js
│   └── setup-dbs.js
├── renderer/                       # Electron UI (terminal + reader)
│   ├── index.html
│   ├── app.js
│   └── style.css
├── main.js                         # Electron main process
├── preload.js                      # IPC bridge (synAPI)
├── mcp-server.js                   # MCP server (stdio)
├── reindex.js                      # Incremental re-index
├── package.json
├── README.md
├── nextphase.md                    # this plan
├── CONTRIBUTING.md
├── CHANGELOG.md
├── LICENSE
├── HARNESSES.md                    # compatibility matrix
├── docs/
│   └── HARNESS_COMPATIBILITY.md
├── test/
│   ├── fixtures/                   # sample archives per harness
│   └── ...                         # fixture-based tests
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   └── release.yml
│   └── ISSUE_TEMPLATE/
├── assets/
│   ├── icon.ico / icon.icns / icon.png
│   └── screenshots/
└── .mcp.json
```

---

## Appendix B — Command Reference

| Terminal Command | MCP Tool Equivalent | Purpose |
|-----------------|---------------------|---------|
| `/locate <text>` | `syn_search` | Search sessions + Memory Vault |
| `/reflect` | `syn_reflect` | Reflect on current session, write memories |
| `/meditate` | `syn_meditate` | Audit brain vault, prune/extract principles |
| `/ruminate` | `syn_ruminate` | Mine archived sessions for patterns |
| `/plan <task>` | `syn_plan` | Break task into phased plans |
| `/review <code>` | `syn_review` | Review code/plans against principles |
| `/brain <path>` | `syn_read_brain` / `syn_write_brain` | Read/write brain files |
| `/syn <topic>` | — | /syn skill guidance (terminal usage) |
| `/help` | — | List all commands |

---

## Appendix C — Migration Checklist from brainmaxxing

- [ ] Copy `brain/` structure (index.md, principles.md, principles/, codebase/, plans/).
- [ ] Copy `.agents/skills/` skills (brain, reflect, meditate, plan, review, ruminate) → `skills/`.
- [ ] Copy `.claude/hooks/` (inject-brain.sh, auto-index-brain.sh) → Syn session-start + auto-index logic.
- [ ] Copy `CLAUDE.md` brain instructions → Syn brain documentation.
- [ ] Rewrite each skill as a Syn terminal command (not a copy-paste port — adapt to Syn's architecture: terminal + MCP + Memory Vault).
- [ ] Do NOT duplicate original session files; Syn reads read-only like Locate.

---

**End of nextphase.md.** This is the complete 0% → 100% guide for building Syn. Execute phase by phase, validating at each checkpoint before proceeding.