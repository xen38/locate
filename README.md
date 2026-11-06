# /locate

A local-first, cross-harness memory search engine for AI coding agents.

Locate is an independent desktop application that acts as a centralized search engine for archived sessions and conversation history of AI coding agents. It allows both humans and AI agents to search, retrieve, explore, and read previous sessions across multiple coding harnesses without manually opening, parsing, or reading archive files themselves.

## Core principle

**Locate is not a chat application. Locate is not another coding agent. Locate is not a file browser with a search box. Locate is the searchable memory infrastructure for AI coding agents.**

An agent should be able to ask:

```
/locate Find the implementation decision we made about authentication in the previous project.
```

Locate searches the archives, identifies the relevant session, retrieves the exact context, and returns it to the agent. The model does not need to read thousands of lines or inspect archive directories.

## Architecture

Locate consists of three main components sharing a single SQLite FTS5 indexing engine:

| Component | Description | Entry point |
|-----------|-------------|-------------|
| **Locate Core** | Indexing engine (SQLite FTS5) — discovery, parsing, indexing, search | `packages/core/index.js` |
| **Locate Desktop App** | Electron UI for humans to explore, search, and manage sessions | `main.js` + `renderer/` |
| **Locate MCP Server** | MCP tools for AI agents to search and retrieve programmatically | `mcp-server.js` |

The desktop app and MCP server share the same index database at `%APPDATA%\locate\locate-index.db`. Either component can index sources, and both can search the same index.

## Critical constraint

**NEVER COPY, MOVE, MODIFY, OR DUPLICATE ORIGINAL SESSION FILES.** Locate only reads original files read-only. It maintains its own lightweight metadata database and search index, which never modify or duplicate the original session archives.

## Supported adapters

File extensions → adapter:
- `.db`, `.sqlite` → SQLiteAdapter (Copilot `data.db`, Codex `goals_1.sqlite`, T3 `statev2.sqlite`, etc.)
- `.jsonl` → JsonlAdapter (Cline, Pi, Aider, Gemini CLI, etc.)
- `.json` → JsonAdapter (Cline, Continue, Zed, etc.)
- `.md`, `.txt` → TextAdapter (Cursor, etc.)

## Quick start

### Desktop app

```bash
# Install dependencies
npm install

# Run the app
npm start
```

### MCP server

```bash
# Run the MCP server on stdio
node mcp-server.js
```

Then register and index harness directories via MCP tools:
- `locate_add_harness` — register a directory
- `locate_index_source` / `locate_index_all` — index sessions
- `locate_search` — search across all indexed sessions

## Project structure

```
packages/core/        # Indexing engine (SQLite FTS5)
packages/adapters/    # Per-format parsers (SQLite, JSONL, JSON, Text)
main.js               # Electron main process (IPC handlers)
preload.js            # Electron preload (bridge to renderer)
renderer/             # Desktop UI
mcp-server.js         # MCP server (stdio transport)
test/                 # Indexing engine tests
docs/                 # Documentation (HARNESS_COMPATIBILITY.md, etc.)
skills/locate/        # /locate agent skill
```

## Search and retrieval model

Locate separates search from retrieval for token efficiency:

| Operation | What Locate returns |
|-----------|---------------------|
| Search | Ranked excerpts from relevant sessions |
| Context | Relevant message + surrounding messages |
| Retrieve | Complete selected messages |
| Session | Entire session, only when explicitly requested |

## Testing

```bash
node test/indexing.test.js
```

## Documentation

- `docs/HARNESS_COMPATIBILITY.md` — archive structures and adapter strategy for 11+ harnesses
- `skills/locate/skill.md` — /locate agent skill

## License

GNU GENERAL PUBLIC LICENSE

