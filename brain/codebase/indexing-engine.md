# Indexing Engine

The core indexing engine lives in `packages/core/index.js` (`IndexingEngine` class). It uses SQLite FTS5 for full-text search over archived coding sessions.

Key responsibilities:
- Discover and register harness directories (sources)
- Parse session files (.jsonl, .json, .md, .txt, .db, .sqlite) into messages
- Incremental re-indexing by file mtime/size/hash
- Search sessions with filters (harness, role, date, brain)
- Return ranked results with excerpts

Shared by both the desktop app (main.js) and the MCP server (mcp-server.js) via the same index database.
