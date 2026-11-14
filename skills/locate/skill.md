# /locate — Agent Skill for Syn

## Purpose

The `/locate` command is the agent's interface to **Syn** — a local-first, cross-harness memory search engine for AI coding agents. Instead of reading session archive files directly (which wastes tokens scanning irrelevant content), the agent uses `/locate` to query Syn's search engine, which returns only the relevant matches with context snippets.

Syn is **not** a chat application, **not** another coding agent, and **not** a file browser with a search box. It is the searchable memory infrastructure for AI coding agents.

## Fundamental rule

**THE MODEL MUST NEVER SEARCH THROUGH SESSION ARCHIVE FILES ITSELF WHEN SYN IS AVAILABLE.**

The model must not:
- Open archive directories to search for previous conversations
- Read entire archive files to find relevant information
- Manually grep through archived session contents
- Load large session files into its context
- Reimplement Syn's search functionality

Instead, it must delegate retrieval to Syn. The search engine performs the work. The model receives only relevant results.

## When to use /locate

Use `/locate` whenever, in the middle of a task, you need to:

1. Consult a previous session for context, decisions, or code
2. Find how a similar problem was solved before
3. Retrieve a specific conversation, error, or solution from an earlier session
4. Cross-reference information across harnesses
5. Recover context from another harness
6. Reuse previous debugging information
7. Prevent duplicated work by finding previous solutions or architecture decisions

The agent should not search Syn unnecessarily for unrelated tasks.

## The /locate command

Syn's terminal (right-hand column) accepts commands in the form:

```
/locate <search query>
```

**Arguments:**
- `<search query>` — free-text search terms to match against session titles and message contents

**Behavior:**
1. The agent checks Syn availability (via MCP tool `syn_status`)
2. The agent invokes `syn_search` with the query
3. The Syn search engine scans all indexed archived sessions across all configured harnesses using SQLite FTS5 full-text search
4. Results are returned ranked by relevance (title matches score higher than content matches)
5. Each result includes: session ID, title, harness, source path, file path, timestamp, rank, and a context excerpt
6. The agent can then retrieve full session content via `syn_get_session` or surrounding context via `syn_get_context`

## How the agent interacts with Syn

1. **Check availability** — Call `syn_status` to verify the Syn MCP server is running and indexed sources exist.
2. **Formulate the query** — Use specific, descriptive terms. Include error messages, function names, file paths, or key concepts you're looking for.
3. **Run /locate** — Call `syn_search` with the query. Optionally filter by `harness` (e.g. "GitHub Copilot", "Cline", "Codex") or `role` (e.g. "user", "assistant").
4. **Review results** — Read the context excerpts to identify the most relevant session(s). Results are deliberately limited — Syn does not return entire sessions unless explicitly requested.
5. **Retrieve full content** — Call `syn_get_session` with a session ID to get the complete session with all messages.
6. **Retrieve context** — Call `syn_get_context` with a session ID and message index to get surrounding messages before and after a match.
7. **Cite the source** — Always reference the session ID, harness, and timestamp when citing information from Syn.

## MCP tools

Syn exposes an MCP server over stdio (`node mcp-server.js`) with these tools (all prefixed `syn_*`):

| Tool | Purpose |
|------|---------|
| `syn_search` | Search across all indexed sessions (query, optional harness/role/limit/excerptLength) |
| `syn_get_session` | Retrieve a complete indexed session by session ID |
| `syn_get_context` | Retrieve messages surrounding a specific message index |
| `syn_list_sessions` | List all indexed sessions across all registered harnesses |
| `syn_list_harnesses` | List all registered harness directories and their indexing status |
| `syn_add_harness` | Register a new directory as a harness source |
| `syn_index_source` | Index a specific registered harness directory |
| `syn_index_all` | Index all registered harness directories |
| `syn_status` | Return indexing health, source counts, and availability |

## What to do when no relevant results are found

- Refine the query with more specific terms
- Try searching without filters (harness, role)
- Check if the relevant harness directory is registered (`syn_list_harnesses`)
- Check if the source has been indexed (`syn_status`)
- Index new sources (`syn_add_harness` then `syn_index_source`)

## What to do when the MCP server is unavailable

- Verify the Syn MCP server process is running (`node mcp-server.js`)
- Check that the shared index database exists at `%APPDATA%\syn\syn-index.db`
- If the desktop app is running, it shares the same index database
- If Syn is completely unavailable, fall back to reading session archive files directly (this is the exception, not the rule)

## Programmatic access (MCP)

Agents using MCP should call `syn_search` with their query, then `syn_get_session` or `syn_get_context` to fetch full content of selected sessions. The same principle applies: the search engine does the scanning; the agent only formulates the query and reads the returned results.

## Example

```
/locate "authentication token refresh error"
```

Returns sessions whose titles or contents mention authentication, token, refresh, or error, with context excerpts showing where the match occurs. Each result includes enough information to locate the original source: harness, session ID, session title, and timestamp.

## Key principle

**The model never reads session archive files directly and never searches by itself.** The Syn search engine does the scanning. The agent only formulates the query and reads the returned results. This prevents token waste from reading entire session files to find a small relevant piece of information.

## Installation and usage

1. Build and run the Syn desktop app (`electron .`), or run the MCP server standalone: `node mcp-server.js`
2. Register harness directories: `syn_add_harness` with the path to each harness's archive directory
3. Index the sources: `syn_index_all` or `syn_index_source` for each directory
4. Use `/locate` to search and retrieve session content

The desktop app and MCP server share the same index database at `%APPDATA%\syn\syn-index.db`, so indexing done by either component is available to the other.
