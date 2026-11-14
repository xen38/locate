# MCP Server

The Syn MCP server lives in `mcp-server.js`. It exposes `syn_*` tools over stdio (local-only, no network).

Tools:
- syn_search — search sessions + Memory Vault
- syn_get_session — retrieve a full session by ID
- syn_get_context — messages around a search result
- syn_list_harnesses — list registered harnesses + indexing status
- syn_status — indexing health, source counts, availability
- syn_add_harness — register a directory for indexing
- syn_index_source / syn_index_all — index sessions
- syn_read_brain / syn_write_brain — read/write Memory Vault files
- syn_reflect / syn_meditate / syn_ruminate / syn_plan / syn_review — brainmaxxing commands

Config: `%APPDATA%\syn\syn-mcp-config.json` (Windows).
Index DB: same path used by the desktop app → shared index.
