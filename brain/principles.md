# Principles

Engineering principles index. Each principle lives in `principles/` as its own file.

- [[principles/read-only-sessions]] — never copy, move, or modify original session files
- [[principles/local-only]] — MCP server is local-only over stdio, no network calls
- [[principles/delegate-to-syn]] — agents delegate search to Syn, never read archive files directly
- [[principles/session-start-brain]] — brain/index.md is injected at every Syn session start
