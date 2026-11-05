# /locate — Agent Skill for the Locate App

## Purpose

The `/locate` command is the agent's interface to the **Locate app** — a search engine for your archive of coding sessions across all harnesses. Instead of reading session files directly (which wastes tokens scanning irrelevant content), the agent uses `/locate` to query the Locate app's search engine, which scans session titles and contents in parallel and returns only the relevant matches with context snippets.

## When to use /locate

Use `/locate` whenever, in the middle of a task, you need to:

- Consult a previous session for context, decisions, or code
- Find how a similar problem was solved before
- Retrieve a specific conversation, error, or solution from an earlier session
- Cross-reference information across harnesses

Do NOT read session files directly to find information. Use `/locate` to let the search engine do the work.

## The /locate command

```
/locate <search query>
```

**Arguments:**
- `<search query>` — free-text search terms to match against session titles and contents

**Behavior:**
1. The agent invokes the Locate app's search bar with the query
2. The Locate app scans all archived sessions across all configured harnesses in parallel (configurable batch size, default 10)
3. The search engine matches against both session titles (file names) and session contents
4. Results are returned ranked by relevance (title matches score higher than content matches)
5. Each result includes: session label, harness name, file path, and a context snippet around the match
6. The agent can then open a specific session to read its full content

## How the agent interacts with the Locate app

1. **Formulate the query** — Use specific, descriptive terms. Include error messages, function names, file paths, or key concepts you're looking for.
2. **Run /locate** — The Locate app searches across all sessions in parallel and returns ranked results with context snippets.
3. **Review results** — Read the context snippets to identify the most relevant session(s).
4. **Open a session** — Click/select a session in the Locate app to load and read its full content on the right panel.
5. **Copy as needed** — Text in the Locate app is selectable and copyable.

## Example

```
/locate "authentication token refresh error"
```

Returns sessions whose titles or contents mention authentication, token, refresh, or error, with context snippets showing where the match occurs.

## Configuration (in the Locate app)

- **Harnesses** — Add directories where your coding agents archive sessions. Use "Scan & autodetect harnesses" to find common locations, or "Browse folder…" to pick one manually.
- **Search batch size** — Controls how many sessions are scanned in parallel per group (5, 10, or 20). Default: 10.

## Key principle

**The model never reads the interface and never searches by itself.** The search engine of the Locate app does the scanning. The agent only formulates the query and reads the returned results. This prevents token waste from reading entire session files to find a small relevant piece of information.
