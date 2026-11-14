# Locate — Harness Research: Archived Session Storage Formats

This document summarizes how the 10+ AI coding agent harnesses store their archived sessions, and how **locate** reads each format **without copying files** (read-only, direct file access only).

## Verified on this machine (C:\Users\luizy\ and K:\Users\luizy\)

| # | Harness | Storage location (Windows) | File format | How locate reads it |
|---|---------|---------------------------|-------------|---------------------|
| 1 | **Cline** | `.cline\sessions\` / `.cline\data\sessions\` | `.json`, `.jsonl`, `.txt`, `.md` | `.json` → extract `title`/`message`/`summary`/`prompt`; `.jsonl` → parse each line, extract `content`/`text`/`message`; `.txt`/.md → raw text |
| 2 | **Codex (old ChatGPT)** | `.codex\goals_1.sqlite` | SQLite (`.sqlite`) | Open read-only, scan `sessions` table, extract `title`+`content` text columns |
| 3 | **GitHub Copilot** | `.copilot\session-store.db` | SQLite (`.db`) | Open read-only, scan `sessions` table, extract `title`+`summary` content |
| 4 | **Cursor** | `.cursor\projects\<ws>\agent-transcripts\<id>\<id>.jsonl` | `.jsonl` | Parse each JSONL line as a message. Extract nested `message.content[].text`. Excludes `subagents/` paths. |
| 5 | **Pi** | `.pi\agent\sessions\<id>\<timestamp>_<uuid>.jsonl` | `.jsonl` (pretty-printed) | Parse multi-line JSON with whole-file fallback. Extract `text`/`content`/`message` fields. |
| 6 | **T3 Code** | `.t3\userdata\statev2.sqlite` | SQLite (`.sqlite`) | Open read-only, scan `sessions` table ("settled" sessions). Extract `title`+`content`. |

### On-disk format samples (verified)

**Cline `.json`** (`api-session.json`):
```json
{ "summary": "...", "title": "API Design Session", "session_id": "api-001", "prompt": "..." }
```

**Cline `.jsonl`**: one JSON object per line with `content`, `timestamp`, `type`, `role`.

**Pi `.jsonl`**: pretty-printed multi-line JSON objects separated by blank lines, with `timestamp`, `id`, `text`, `role` fields.

**Cursor `.jsonl`**: nested structure `{"role":"user","message":{"content":[{"type":"text","text":"..."}]}}`.

**SQLite (Copilot/Codex/T3)** table `sessions(id, session_id, title, content|summary, created_at)`.

**Copilot `session-store.db`**: sessions table has columns `id, cwd, repository, host_type, branch, summary, created_at, updated_at` — uses `summary` as content column (no `content` column).

## Researched (not installed on this machine)

| # | Harness | Storage location | File format | Notes |
|---|---------|-----------------|-------------|-------|
| 7 | **Claude Code** | `~/.claude/` | `.jsonl` | Sessions stored as `~/.claude/projects/<workspace>/<session_id>.jsonl`. One JSON object per line with `role`, `content`, `timestamp`. |
| 8 | **OpenCode / Crush** | `~/.opencode/` | SQLite | Uses Drizzle ORM with SQLite. Main session table is `session_v2` (NOT `sessions`). Message table is `session_message` with `data` JSON column. Also has `session_part`, `session_inbox`, `blob` tables. Database path: `<data-dir>/<db-name>` where data-dir resolves via XDG to `~/.opencode/` on Windows. |
| 9 | **Windsurf** | `~/.windsurf/` | JSON / JSONL | Windsurf stores sessions as JSON/JSONL files; locate's `.json`/`.jsonl` extractors handle them. |
| 10 | **Zed** | `~/.zed/` | JSON | Zed's AI assistant stores conversation history as JSON; locate's JSON extractor handles it. |
| 11 | **Roo Code** | `~/.roo/` | JSON / JSONL | Roo Code (formerly Roo) stores sessions as JSON/JSONL; locate's extractors handle them. |
| 12 | **Continue** | `~/.continue/` | JSON / JSONL | Continue stores session history as JSON/JSONL; locate's `.json`/`.jsonl` extractors handle them. |
| 13 | **Aider** | `~/.aider/` | JSON / Markdown | Aider stores chat history as JSON and session notes as Markdown; locate's extractors handle both. |
| 14 | **Gemini CLI** | `~/.gemini/` | JSON / JSONL | Gemini CLI stores conversation history as JSON/JSONL; locate's extractors handle them. |

## Generic fallback

Any harness not listed above is still supported if its session files use one of these extensions: `.md`, `.txt`, `.json`, `.jsonl`, `.db`, `.sqlite`. locate:
- Reads `.md`/`.txt` as plain text.
- Parses `.json` (single object) and `.jsonl` (one object per line), extracting `content`/`message`/`text`/`prompt`/`response`/`summary`/`title`.
- Opens `.db`/`.sqlite` read-only with sql.js, scans tables literally named `sessions` for text-like columns and returns their values.

## Design principle: no copies

locate never copies, imports, or duplicates session files. It opens each file read-only, extracts the displayable text, and shows it in the UI. The original files stay exactly where the harness created them.

## T3 Code sessions

T3 stores its archived ("settled") sessions in `.t3\userdata\statev2.sqlite` in a `sessions` table with columns `id, session_id, title, content, created_at`. locate treats this the same as the other SQLite harnesses (Copilot `data.db`, Codex `goals_1.sqlite`).

T3 also streams live device sessions as `.t3\userdata\device\agent-device\sessions\<session_id>\events.ndjson` — one JSON object per line. locate parses each line as a message.

## OpenCode / Crush sessions (not installed)

OpenCode uses Drizzle ORM with SQLite. Key tables:
- `session_v2` — session metadata (id, title, directory, slug, project_id, metadata, cost, tokens, agent, model, timestamps)
- `session_message` — messages (id, session_id, type, seq, data JSON)
- `session_part` — message parts
- `session_inbox` — inbox items
- `blob` — binary media blobs

The session table is named `session_v2`, not `sessions`. locate's SQLite adapter currently only scans tables literally named `sessions`, so OpenCode sessions would NOT be picked up by the SQLite adapter. If OpenCode support is needed, the adapter would need to also recognize `session_v2` as a session table, or OpenCode would need to be added as a separate adapter.

## Claude Code sessions (not installed)

Claude Code stores sessions as `~/.claude/projects/<workspace>/<session_id>.jsonl` — one JSON object per line with `role`, `content`, `timestamp`. locate's `.jsonl` extractor handles these directly.

## Filtering rules (to avoid false positives)

### Per-harness validators (registry.js)

Each harness has a strict session-file validator that checks both extension and path structure:

- **Cline**: `.json`/`.jsonl`/`.md`/`.txt` under a `sessions/` directory within `.cline/`, excluding `.messages.json` and config files (`settings`, `config`, `providers`, `feature-flags`)
- **Codex**: `.sqlite`/`.db` matching `^(goals|logs|queue|memories|state)_\d+\.sqlite$`
- **GitHub Copilot**: `data.db` or `session-store.db` at `.copilot/` root (NOT `chats/`), or `session.db` under `session-state/`
- **Cursor**: `.jsonl` under `agent-transcripts/` directory, excluding paths containing `subagents/`
- **Pi**: `.jsonl`/`.ndjson` under `agent/sessions/` directory
- **T3 Code**: `statev2*.sqlite` for settled sessions; `events.ndjson` under `agent-device/sessions/` for device sessions
- **Claude Code**: `.jsonl` under `.claude/projects/`
- **OpenCode / Crush**: `.sqlite`/`.db` (excluding cache/temp/lock/config DBs) or `.jsonl`/`.ndjson` under `sessions/`/`conversations/`
- **Windsurf/Continue/Zed/Roo/Aider/Gemini**: extension + directory match

### Generic filename filters (index.js isNonSessionFile)

- Numeric-only filenames (e.g. `22135`, `22136`)
- Known non-session names: `models_cache`, `.lease`, `lease`, `cache`, `temp`, `tmp`, `lock`, `.lock`, `config`, `settings`, `preferences`, `.config`, `messages`, `.messages`, `providers`, `feature-flags`, `feature_flags`, `credential(s)`, `token(s)`, `auth`, `history`, `index`, `indexed_db`, `leveldb`, `localstorage`, `websql`
- Dotfiles without recognized extensions

### Content quality filter (index.js safety net)

Sessions are rejected if:
- First message content is raw JSON metadata (contains `models`, `fetched_at`, `etag`, or `identity` keys)
- No message has real text content (all messages are `[object Object]` or empty)

### SQLite table filtering (sqlite.js parseAllSessions)

- Only tables literally named `sessions` are treated as session tables (not `activity_items`, `workspaces`, `session_mcp_event_sources`, etc.)
- Content column detection uses word-boundary regex `/\b(content|summary|message|text|body|prompt|response)\b/i` to avoid matching columns like `context_current_tokens`
- `summary` is included as a content-like column (for Copilot `session-store.db`)

## Known issues / limitations

- **Duplicate paths on C: and K:**: Same harness directories exist on both drives (e.g. `C:\Users\luizy\.cline` and `K:\Users\luizy\.cline`), causing duplicate sessions in the index. Dedup by content hash is not yet implemented.
- **OpenCode `session_v2` table**: Not recognized by the SQLite adapter's `sessions`-only table filter.
- **.cagent directory**: Present on C:\Users\luizy\.cagent but not a recognized harness; uses content-addressed storage (sha256 hash files) that doesn't match any session validator.
- **.github-copilot-cli directory**: Present on C:\Users\luizy\.github-copilot-cli but only contains model cache and logs, no session databases. Sessions are in `.copilot/session-store.db` instead.
