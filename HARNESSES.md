# Locate — Harness Research: Archived Session Storage Formats

This document summarizes how the 10 most-used AI coding agent harnesses store their archived sessions, and how **locate** reads each format **without copying files** (read-only, direct file access only).

## Verified on this machine (K:\Users\luizy\)

| # | Harness | Storage location (Windows) | File format | How locate reads it |
|---|---------|---------------------------|-------------|---------------------|
| 1 | **Cline** | `.cline\sessions\` | `.json`, `.jsonl`, `.txt` | `.json` → extract `title`/`message`/`summary`; `.jsonl` → parse each line, extract `content`/`text`/`message`; `.txt` → raw text |
| 2 | **Codex (old ChatGPT)** | `.codex\goals_1.sqlite` | SQLite (`.sqlite`) | Open read-only, scan `sessions` table, extract `title`+`content` text columns |
| 3 | **GitHub Copilot** | `.copilot\data.db` | SQLite (`.db`) | Open read-only, scan `sessions` table, extract `title`+`content` |
| 4 | **Cursor** | `.cursor\agents\` | `.md` (markdown) | Raw text read |
| 5 | **Pi** | `.pi\agent\sessions\<id>\` | `.jsonl` | Parse each line, extract `text`/`content`/`message` |
| 6 | **T3** | `.t3\userdata\statev2.sqlite` | SQLite (`.sqlite`) | Open read-only, scan `sessions` table, extract `title`+`content` ("settled" sessions) |

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
| 7 | **OpenCode / Crush** | `~/.opencode/` or `~/.crush/` | SQLite | OpenCode (now Crush by Charm) uses a SQLite database for persistent conversation/session storage. locate opens it read-only and scans text columns like the other SQLite harnesses. |
| 8 | **Windsurf** | `~/.windsurf/` | JSON / JSONL | Windsurf stores sessions as JSON/JSONL files; locate's `.json`/`.jsonl` extractors handle them. |
| 9 | **Zed** | `~/.zed/` | JSON | Zed's AI assistant stores conversation history as JSON; locate's JSON extractor handles it. |
| 10 | **Roo Code** | `~/.roo/` | JSON / JSONL | Roo Code (formerly Roo) stores sessions as JSON/JSONL; locate's extractors handle them. |

## Generic fallback

Any harness not listed above is still supported if its session files use one of these extensions: `.md`, `.txt`, `.json`, `.jsonl`, `.db`, `.sqlite`. locate:
- Reads `.md`/`.txt` as plain text.
- Parses `.json` (single object) and `.jsonl` (one object per line), extracting `content`/`message`/`text`/`prompt`/`response`/`summary`/`title`.
- Opens `.db`/`.sqlite` read-only with better-sqlite3, scans all tables for text-like columns (`content|message|text|body|prompt|response|title|summary`) and returns their values.

## Design principle: no copies

locate never copies, imports, or duplicates session files. It opens each file read-only, extracts the displayable text, and shows it in the UI. The original files stay exactly where the harness created them.

## T3 "settled" sessions

T3 stores its archived ("settled") sessions in `.t3\userdata\statev2.sqlite` in a `sessions` table with columns `id, session_id, title, content, created_at`. locate treats this the same as the other SQLite harnesses (Copilot `data.db`, Codex `goals_1.sqlite`).
