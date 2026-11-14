# /syn — Agent Skill for Syn

## Purpose

`/syn` is the agent's interface to **Syn** — a unified agent memory environment built on top of the Locate search engine. Syn combines a local searchable memory of all your archived sessions with a **Memory Vault** (`brain/`) where learnings are written back as markdown notes, plus a **terminal UI** and **MCP server** for programmatic agent interaction.

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

## When to use /syn

Use `/syn` whenever, in the middle of a task, you need to:

1. Consult a previous session for context, decisions, or code
2. Find how a similar problem was solved before
3. Retrieve a specific conversation, error, or solution from an earlier session
4. Cross-reference information across harnesses
5. Recover context from another harness
6. Reuse previous debugging information
7. Write a learning/memory to the Memory Vault (`/reflect`)
8. Audit the Memory Vault and extract principles (`/meditate`)
9. Mine archived sessions for recurring patterns (`/ruminate`)
10. Break a task into phased plans (`/plan`)
11. Review code/plans against brain principles (`/review`)

The agent should not search Syn unnecessarily for unrelated tasks.

## The Syn terminal

Syn's desktop UI presents a terminal/console as a right-hand column (with a normal search bar at the top for search-only queries). The terminal accepts commands in the form:

```
/<command> <topic>
```

**Available terminal commands:**

| Command | Purpose |
|---------|---------|
| `/locate <query>` | Search sessions + Memory Vault (filters: `harness:`, `date:`, `role:`, `brain:`) |
| `/reflect <sessionId>` | Extract learnings from a session; write to `brain/memories/` |
| `/meditate` | Audit the Memory Vault; extract principles to `brain/principles/` |
| `/ruminate` | Mine archived sessions for recurring patterns; write to `brain/sessions/` |
| `/plan <task>` | Break a task into phased plans; write to `brain/plans/` |
| `/review <content>` | Review code/plans against brain principles; write to `brain/plans/` |
| `/brain <path>` | Read/write a Memory Vault file |
| `/syn` | Show this skill summary |
| `/help` | List all commands |

**Iteration loop:**

```
/command+topic → search result → agent action / memory creation → /command+newtopic → new result → ... → objective
```

Each iteration feeds the previous result into the next command, building up context and memories as you work.

## MCP tools (programmatic access)

Syn exposes an MCP server over stdio (`node mcp-server.js`) with these tools (all prefixed `syn_*`):

| Tool | Purpose |
|------|---------|
| `syn_search` | Search sessions + Memory Vault (query, harness, role, limit, excerptLength) |
| `syn_get_session` | Retrieve a complete indexed session by session ID |
| `syn_get_context` | Retrieve messages surrounding a specific message index |
| `syn_list_sessions` | List all indexed sessions across all registered harnesses |
| `syn_list_harnesses` | List registered harnesses + indexing status |
| `syn_add_harness` | Register a directory for indexing |
| `syn_index_source` | Index a specific registered harness directory |
| `syn_index_all` | Index all registered harness directories |
| `syn_status` | Indexing health, source counts, availability |
| `syn_read_brain` | Read a brain/memory file |
| `syn_write_brain` | Write to a brain/memory file |
| `syn_reflect` | Run /reflect on a session via MCP |
| `syn_meditate` | Run /meditate on the brain vault via MCP |
| `syn_ruminate` | Run /ruminate on archived sessions via MCP |
| `syn_plan` | Run /plan on a task via MCP |
| `syn_review` | Run /review on code/plans via MCP |

Agents using MCP should call `syn_search` with their query, then `syn_get_session` or `syn_get_context` to fetch full content of selected sessions. The same principle applies: the search engine does the scanning; the agent only formulates the query and reads the returned results.

## Memory Vault (brain/)

The Memory Vault lives at `brain/` in the Syn repo and is read at session start (`brain/index.md`). Commands that write to it:

- `/reflect` → `brain/memories/reflect-<date>-<slug>.md`
- `/meditate` → `brain/principles/meditate-<date>.md`
- `/ruminate` → `brain/sessions/ruminate-<date>.md`
- `/plan` → `brain/plans/plan-<date>-<slug>.md`
- `/review` → `brain/plans/review-<date>-<slug>.md`

Use `syn_read_brain` / `syn_write_brain` (MCP) or `/brain <path>` (terminal) to read/write vault files directly.

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

## Example

```
/syn /locate "authentication token refresh error"
```

Returns sessions whose titles or contents mention authentication, token, refresh, or error, with context excerpts showing where the match occurs. Each result includes enough information to locate the original source: harness, session ID, session title, and timestamp.

## Key principle

**The model never reads session archive files directly and never searches by itself.** The Syn search engine does the scanning. The agent only formulates the query and reads the returned results. This prevents token waste from reading entire session files to find a small relevant piece of information.

## Installation and usage

1. Build and run the Syn desktop app (`electron .`), or run the MCP server standalone: `node mcp-server.js`
2. Register harness directories: `syn_add_harness` with the path to each harness's archive directory
3. Index the sources: `syn_index_all` or `syn_index_source` for each directory
4. Use `/syn` / `/locate` to search and retrieve session content
5. Use brainmaxxing commands (`/reflect`, `/meditate`, `/ruminate`, `/plan`, `/review`) to write learnings back to the Memory Vault

The desktop app and MCP server share the same index database at `%APPDATA%\syn\syn-index.db`, so indexing done by either component is available to the other.
