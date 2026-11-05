# Locate — Harness Compatibility

This document describes how **Locate** reads archived sessions from each supported AI coding harness.
Locate reads original session archives **read-only**, directly from their existing locations — it never copies, moves, modifies, or duplicates original session files.

## Verified on this machine (K:\Users\luizy\)

| # | Harness | Storage location (Windows) | File format | How Locate reads it |
|---|---------|---------------------------|-------------|---------------------|
| 1 | **Cline** | `.cline\sessions\` | `.json`, `.jsonl`, `.txt` | `.json` → extract `title`/`message`/`summary`; `.jsonl` → parse each line, extract `content`/`text`/`message`; `.txt` → raw text |
| 2 | **Codex (old ChatGPT)** | `.codex\goals_1.sqlite` | SQLite (`.sqlite`) | Open read-only, scan `sessions` table, extract `title`+`content` text columns |
| 3 | **GitHub Copilot** | `.copilot\data.db` | SQLite (`.db`) | Open read-only, scan `sessions` table, extract `title`+`content` |
| 4 | **Cursor** | `.cursor\agents\` | `.md` (markdown) | Raw text read |
| 5 | **Pi** | `.pi\agent\sessions\<id>\` | `.jsonl` | Parse each line, extract `text`/`content`/`message` |
| 6 | **T3 Code** | `.t3\userdata\statev2.sqlite` | SQLite (`.sqlite`) | Open read-only, scan `sessions` table, extract `title`+`content` ("settled" sessions) |

### On-disk format samples (verified)

**Cline `.json`** (`api-session.json`):
```json
{ "summary": "...", "title": "API Design Session", "session_id": "api-001", "message": "..." }
```

**Cline `.jsonl`** (`cline-session.jsonl`): one JSON object per line with `content`, `timestamp`, `type`, `role`.

**Pi `.jsonl** (`...jsonl`): one JSON object per line with `timestamp`, `id`, `text`, `role`.

**Cursor `.md`** (`meteor-client-expert.md`): plain markdown agent definition.

**SQLite (Copilot/Codex/T3)** table `sessions(id, session_id, title, content, created_at)`.

## Researched (not installed on this machine)

| # | Harness | Storage location | File format | Notes |
|---|---------|-----------------|-------------|-------|
| 7 | **OpenCode / Crush** | `~/.opencode/` or `~/.crush/` | SQLite | OpenCode (now Crush by Charm) uses a SQLite database for persistent conversation/session storage. Locate opens it read-only and scans text columns like the other SQLite harnesses. |
| 8 | **Windsurf** | `~/.windsurf/` | JSON / JSONL | Windsurf stores sessions as JSON/JSONL files; Locate's `.json`/`.jsonl` extractors handle them. |
| 9 | **Zed** | `~/.zed/` | JSON | Zed's AI assistant stores conversation history as JSON; Locate's JSON extractor handles it. |
| 10 | **Roo Code** | `~/.roo/` | JSON / JSONL | Roo Code (formerly Roo) stores sessions as JSON/JSONL; Locate's extractors handle them. |

## Generic fallback

Any harness not listed above is still supported if its session files use one of these extensions: `.md`, `.txt`, `.json`, `.jsonl`, `.db`, `.sqlite`. Locate:
- Reads `.md`/`.txt` as plain text.
- Parses `.json` (single object) and `.jsonl` (one object per line), extracting `content`/`message`/`text`/`prompt`/`response`/`summary`/`title`.
- Opens `.db`/`.sqlite` read-only with better-sqlite3, scans all tables for text-like columns (`content|message|text|body|prompt|response|title|summary`) and returns their values.

## T3 Code "settled" sessions

T3 Code stores its archived ("settled") sessions in `.t3\userdata\statev2.sqlite` in a `sessions` table with columns `id, session_id, title, content, created_at`. Locate treats this the same as the other SQLite harnesses (Copilot `data.db`, Codex `goals_1.sqlite`).

## Per-harness reference

### 1. Claude Code

| Property | Details |
|----------|---------|
| Default archive directory | `~/.claude/projects/<project>/` (JSONL files) or `~/.claude/sessions/` |
| Alternative locations | `~/.config/claude/`, `~/.claude.d/` |
| File formats | `.jsonl` |
| Naming conventions | `session-<id>.jsonl`, `<date>-<slug>.jsonl` |
| Session identification | `sessionId` or `id` field in each JSONL line |
| Message structure | One JSON object per line: `{type, role, content, timestamp, ...}` |
| Role identification | `role` field: `user`, `assistant`, `system` |
| Timestamp representation | ISO 8601 `timestamp` field |
| Tool-call representation | `tool_calls` array or `type: "tool"` lines |
| Incremental update behavior | Append-only JSONL; new lines appended to existing session files |
| Known limitations | Project-scoped sessions split across directories; need to scan all project subdirectories |
| Detect installation | Check for `~/.claude/` directory or `claude` CLI on PATH |

### 2. ChatGPT / Codex

| Property | Details |
|----------|---------|
| Default archive directory | `~/.codex/` (Windows: `%USERPROFILE%\.codex\`) |
| Alternative locations | `~/.config/codex/`, `%LOCALAPPDATA%\Codex\` |
| File formats | SQLite (`.sqlite`) |
| Naming conventions | `goals_1.sqlite`, `conversations.sqlite` |
| Session identification | `session_id` column in `sessions` table |
| Message structure | `sessions(id, session_id, title, content, created_at)` |
| Role identification | `role` column if present, otherwise inferred from context |
| Timestamp representation | `created_at` ISO 8601 or Unix epoch |
| Tool-call representation | Embedded in `content` text or separate `tool_calls` column |
| Incremental update behavior | SQLite INSERT of new rows; Locate uses file mtime + hash to detect changes |
| Known limitations | ChatGPT web history is cloud-only; only local Codex app data is accessible |
| Detect installation | Check for `~/.codex/` directory or `codex` CLI on PATH |

### 3. OpenCode / Crush

| Property | Details |
|----------|---------|
| Default archive directory | `~/.opencode/` or `~/.crush/` |
| Alternative locations | `~/.config/opencode/` |
| File formats | SQLite |
| Naming conventions | `sessions.sqlite`, `conversations.db` |
| Session identification | `id` or `session_id` column |
| Message structure | SQLite table with message columns |
| Role identification | `role` column |
| Timestamp representation | `created_at` or `timestamp` column |
| Tool-call representation | Embedded in content or separate columns |
| Incremental update behavior | SQLite INSERT; mtime/hash-based change detection |
| Known limitations | Crush is the renamed OpenCode; storage format may differ between versions |
| Detect installation | Check for `~/.opencode/` or `~/.crush/` directory |

### 4. Cline

| Property | Details |
|----------|---------|
| Default archive directory | `.cline\sessions\` (project-relative) or `~/.cline/sessions/` |
| Alternative locations | `~/.config/cline/` |
| File formats | `.json`, `.jsonl`, `.txt` |
| Naming conventions | `api-session.json`, `cline-session.jsonl`, `<session-id>.txt` |
| Session identification | `session_id` field, or file name |
| Message structure | `.json`: single object with `messages` array; `.jsonl`: one object per line; `.txt`: raw text |
| Role identification | `role` field: `user`, `assistant`, `system` |
| Timestamp representation | `timestamp` field (ISO 8601) |
| Tool-call representation | `tool_calls` array in message objects |
| Incremental update behavior | Append to `.jsonl` or append messages to `.json` messages array |
| Known limitations | Multiple formats in same directory; need to handle each extension separately |
| Detect installation | Check for `.cline/` directory or `cline` CLI on PATH |

### 5. GitHub Copilot

| Property | Details |
|----------|---------|
| Default archive directory | `.copilot\data.db` (project-relative) or `%USERPROFILE%\.copilot\` |
| Alternative locations | `~/.copilot/`, `%LOCALAPPDATA%\GitHub\Copilot\` |
| File formats | SQLite (`.db`) |
| Naming conventions | `data.db` |
| Session identification | `session_id` column |
| Message structure | `sessions(id, session_id, title, content, created_at)` |
| Role identification | `role` column if present |
| Timestamp representation | `created_at` ISO 8601 |
| Tool-call representation | Embedded in `content` |
| Incremental update behavior | SQLite INSERT; mtime/hash-based change detection |
| Known limitations | Some Copilot history is cloud-only; only locally cached sessions are accessible |
| Detect installation | Check for `.copilot/` directory or GitHub Copilot extension |

### 6. Cursor

| Property | Details |
|----------|---------|
| Default archive directory | `.cursor\agents\` (project-relative) or `~/.cursor/` |
| Alternative locations | `~/.config/Cursor/`, `%LOCALAPPDATA%\Cursor\` |
| File formats | `.md` (markdown) |
| Naming conventions | `<agent-name>.md`, `<session-id>.md` |
| Session identification | File name or frontmatter `id` |
| Message structure | Markdown with optional YAML frontmatter |
| Role identification | Markdown headers (`# User`, `# Assistant`) or frontmatter |
| Timestamp representation | Frontmatter `date` or `created_at` |
| Tool-call representation | Markdown code blocks or inline text |
| Incremental update behavior | File append or rewrite; mtime/hash-based change detection |
| Known limitations | Agent definitions mixed with conversations; need to distinguish |
| Detect installation | Check for `.cursor/` directory or Cursor app |

### 7. Windsurf

| Property | Details |
|----------|---------|
| Default archive directory | `~/.windsurf/` |
| Alternative locations | `~/.config/windsurf/`, `%LOCALAPPDATA%\Windsurf\` |
| File formats | JSON / JSONL |
| Naming conventions | `session-<id>.json`, `conversations.jsonl` |
| Session identification | `id` or `session_id` field |
| Message structure | JSON object or JSONL lines with `role`, `content` |
| Role identification | `role` field |
| Timestamp representation | `timestamp` or `created_at` |
| Tool-call representation | `tool_calls` array |
| Incremental update behavior | Append to JSONL or rewrite JSON |
| Known limitations | Format may vary between versions |
| Detect installation | Check for `~/.windsurf/` directory |

### 8. Aider

| Property | Details |
|----------|---------|
| Default archive directory | `~/.aider/` or `~/.aider.history/` |
| Alternative locations | Project-relative `.aider/` |
| File formats | `.jsonl`, `.md` |
| Naming conventions | `history.jsonl`, `<session>.md` |
| Session identification | `session_id` field |
| Message structure | JSONL lines with `role`, `content` |
| Role identification | `role` field: `user`, `assistant`, `system` |
| Timestamp representation | `timestamp` field |
| Tool-call representation | `tool_calls` array |
| Incremental update behavior | Append-only JSONL |
| Known limitations | History files can grow large over time |
| Detect installation | Check for `~/.aider/` directory or `aider` CLI on PATH |

### 9. Continue

| Property | Details |
|----------|---------|
| Default archive directory | `~/.continue/` |
| Alternative locations | `~/.config/continue/`, `%LOCALAPPDATA%\Continue\` |
| File formats | `.json`, `.jsonl` |
| Naming conventions | `sessions.json`, `history.jsonl` |
| Session identification | `id` or `session_id` field |
| Message structure | JSON array of messages or JSONL lines |
| Role identification | `role` field |
| Timestamp representation | `timestamp` or `created_at` |
| Tool-call representation | `tool_calls` array |
| Incremental update behavior | Append to JSONL or rewrite JSON array |
| Known limitations | Multiple IDE integrations (VS Code, JetBrains) may use different paths |
| Detect installation | Check for `~/.continue/` directory or Continue extension |

### 10. Gemini CLI

| Property | Details |
|----------|---------|
| Default archive directory | `~/.gemini/` or `~/.config/gemini/` |
| Alternative locations | `%LOCALAPPDATA%\Gemini\` |
| File formats | `.jsonl`, `.json` |
| Naming conventions | `session-<id>.jsonl`, `history.jsonl` |
| Session identification | `session_id` or `id` field |
| Message structure | JSONL lines with `role`, `content`, `timestamp` |
| Role identification | `role` field: `user`, `model` |
| Timestamp representation | `timestamp` ISO 8601 |
| Tool-call representation | `tool_calls` array or `type: "tool"` |
| Incremental update behavior | Append-only JSONL |
| Known limitations | Google Gemini may store some history cloud-side |
| Detect installation | Check for `~/.gemini/` directory or `gemini` CLI on PATH |

### 11. T3 Code

| Property | Details |
|----------|---------|
| Default archive directory | `.t3\userdata\statev2.sqlite` (project-relative) or `~/.t3/` |
| Alternative locations | `~/.config/t3/`, `%LOCALAPPDATA%\T3\` |
| File formats | SQLite (`.sqlite`) |
| Naming conventions | `statev2.sqlite` |
| Session identification | `session_id` column in `sessions` table |
| Message structure | `sessions(id, session_id, title, content, created_at)` |
| Role identification | `role` column if present |
| Timestamp representation | `created_at` ISO 8601 |
| Tool-call representation | Embedded in `content` |
| Incremental update behavior | SQLite INSERT; mtime/hash-based change detection |
| Known limitations | "Settled" sessions are archived/read-only; active sessions may be in a different table |
| Detect installation | Check for `.t3/` directory or `t3` CLI on PATH |

## Adapter architecture

Locate uses a modular adapter system (`packages/adapters/`). Each harness has its own parser and discovery logic implementing a common interface:

- **Discovery** — locate archive files in known directories
- **Archive identification** — determine file format and harness
- **Metadata extraction** — extract session title, timestamps, harness
- **Content parsing** — extract messages, roles, tool calls
- **Incremental indexing** — detect new/modified/deleted files via mtime + content hash
- **Error handling** — report unsupported formats gracefully without crashing
- **Session retrieval** — return session data by ID

Adapter registry maps file extensions to adapters:
- `.db`, `.sqlite` → SQLiteAdapter
- `.jsonl` → JsonlAdapter
- `.json` → JsonAdapter
- `.md`, `.txt` → TextAdapter

## Design principle: no copies

Locate never copies, imports, or duplicates session files. It opens each file read-only, extracts the displayable text, and indexes it in its own SQLite FTS5 database. The original files stay exactly where the harness created them.

File integrity is verified by automated tests that record original archive hashes before indexing and compare after all operations.