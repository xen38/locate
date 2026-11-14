/**
 * Brainmaxxing console commands for Syn.
 *
 * Ported from poteto/brainmaxxing and adapted to Syn's architecture:
 * terminal + MCP + Memory Vault (brain/).
 *
 * Every command reads brain/index.md first, then operates on the Memory Vault
 * and/or indexed sessions via the IndexingEngine.
 *
 * Usage:
 *   const bm = require('./brainmaxxing')
 *   await bm.reflect(sessionId, engine)
 *   await bm.meditate(engine)
 *   await bm.ruminate(engine)
 *   await bm.plan(task, engine)
 *   await bm.review(content, engine)
 *   await bm.brainRead(relativePath)
 *   await bm.brainWrite(relativePath, content)
 *   await bm.brainList()
 *   await bm.rebuildIndex()
 */

const path = require('path')
const fs = require('fs')

// Brain vault lives at the repo root: <repo>/brain
const BRAIN_DIR = path.join(__dirname, '..', '..', 'brain')

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

// ── Brain Vault helpers ──────────────────────────────────────────────────

function brainRead(relativePath) {
  const filePath = path.join(BRAIN_DIR, relativePath)
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `Brain file not found: ${relativePath}` }
  }
  const content = fs.readFileSync(filePath, 'utf8')
  return { ok: true, path: relativePath, content }
}

function brainWrite(relativePath, content) {
  ensureDir(BRAIN_DIR)
  const filePath = path.join(BRAIN_DIR, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf8')
  return { ok: true, path: relativePath }
}

function brainList() {
  ensureDir(BRAIN_DIR)
  const files = []
  function walk(dir, prefix) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(full, rel)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(rel)
      }
    }
  }
  walk(BRAIN_DIR, '')
  return files.sort()
}

function rebuildIndex() {
  ensureDir(BRAIN_DIR)
  const files = brainList()
  const lines = ['# Brain Index', '', 'Root entry point for the Syn Memory Vault. Every brain file is reachable from here.', '', '## Sections', '']
  // Group files by top-level directory
  const groups = {}
  for (const f of files) {
    const top = f.split('/')[0]
    if (!groups[top]) groups[top] = []
    groups[top].push(f)
  }
  const order = ['index.md', 'principles.md', 'codebase.md', 'principles', 'codebase', 'memories', 'plans', 'sessions']
  const seen = new Set()
  for (const key of order) {
    if (groups[key]) {
      for (const f of groups[key]) {
        if (f === 'index.md') continue
        const name = f.replace(/\.md$/, '').split('/').pop()
        lines.push(`- [[${f.replace(/\.md$/, '')}]] — ${name}`)
        seen.add(f)
      }
    }
  }
  for (const f of files) {
    if (seen.has(f) || f === 'index.md') continue
    const name = f.replace(/\.md$/, '').split('/').pop()
    lines.push(`- [[${f.replace(/\.md$/, '')}]] — ${name}`)
  }
  lines.push('', '## Rules', '')
  lines.push('- One topic per file. File name = topic slug (lowercase, hyphenated).')
  lines.push('- `[[wikilink]]` format: `[[section/file-name]]`.')
  lines.push('- Index files are link-only, no inlined content.')
  lines.push('- `brain/index.md` is the root; every brain file reachable from it.')
  lines.push('- Plain markdown, `# Title`, no frontmatter, bullets over prose.')
  lines.push('- Keep notes under ~50 lines.')
  const content = lines.join('\n') + '\n'
  brainWrite('index.md', content)
  return { ok: true, files: files.length }
}

function readIndexMd() {
  const r = brainRead('index.md')
  return r.ok ? r.content : ''
}

// ── /reflect ─────────────────────────────────────────────────────────────
// Scan a session for learnings and write a memory to brain/memories/

const LEARNING_KEYWORDS = [
  'decided', 'decision', 'implemented', 'implementation', 'fixed', 'fix',
  'error', 'bug', 'solution', 'solved', 'pattern', 'architecture', 'approach',
  'learned', 'note', 'remember', 'important', 'key', 'insight'
]

function extractLearnings(content) {
  const lines = content.split('\n')
  const learnings = []
  for (const line of lines) {
    const lower = line.toLowerCase()
    if (LEARNING_KEYWORDS.some(k => lower.includes(k))) {
      const trimmed = line.trim()
      if (trimmed.length > 0 && trimmed.length < 200) {
        learnings.push(trimmed)
      }
    }
  }
  // Dedup
  return [...new Set(learnings)].slice(0, 20)
}

async function reflect(sessionId, engine) {
  const indexMd = readIndexMd()
  if (!engine || !engine.getSession) {
    return { ok: false, error: 'IndexingEngine not provided' }
  }
  const session = engine.getSession(sessionId)
  if (!session) {
    return { ok: false, error: `Session not found: ${sessionId}` }
  }
  const messages = session.messages || []
  const text = messages.map(m => m.content || '').join('\n')
  const learnings = extractLearnings(text)
  const title = session.title || sessionId
  const slug = slugify(title)
  const date = new Date().toISOString().slice(0, 10)
  const fileName = `memories/reflect-${date}-${slug}.md`
  const lines = [
    `# Reflect: ${title}`,
    '',
    `Source: session [[${sessionId}]] (harness: ${session.harness || 'unknown'})`,
    `Reflected on: ${new Date().toISOString()}`,
    '',
    '## Learnings',
    ''
  ]
  if (learnings.length === 0) {
    lines.push('- No distinct learnings detected in this session.')
  } else {
    for (const l of learnings) {
      lines.push(`- ${l}`)
    }
  }
  lines.push('', '---', '', 'Generated by `/reflect` (Syn brainmaxxing).')
  brainWrite(fileName, lines.join('\n') + '\n')
  rebuildIndex()
  return {
    ok: true,
    path: fileName,
    title,
    learningsCount: learnings.length,
    learnings
  }
}

// ── /meditate ────────────────────────────────────────────────────────────
// Audit brain vault, prune stale notes, extract principles

async function meditate(engine) {
  const indexMd = readIndexMd()
  const files = brainList()
  const report = {
    ok: true,
    filesAudited: files.length,
    principlesExtracted: 0,
    staleNotes: [],
    report: ''
  }
  const principleKeywords = ['principle', 'rule', 'never', 'always', 'must', 'should', 'guideline']
  const extracted = []
  for (const f of files) {
    const r = brainRead(f)
    if (!r.ok) continue
    const content = r.content
    const lower = content.toLowerCase()
    for (const kw of principleKeywords) {
      if (lower.includes(kw)) {
        extracted.push({ file: f, keyword: kw })
        break
      }
    }
    // Detect potentially stale notes (very short, placeholder-like)
    if (content.trim().length < 40 && f !== 'index.md') {
      report.staleNotes.push(f)
    }
  }
  report.principlesExtracted = extracted.length
  const lines = [
    '# Meditate Report',
    '',
    `Audited on: ${new Date().toISOString()}`,
    `Files audited: ${files.length}`,
    `Principles extracted: ${extracted.length}`,
    `Stale notes: ${report.staleNotes.length}`,
    '',
    '## Extracted Principles',
    ''
  ]
  if (extracted.length === 0) {
    lines.push('- No principle candidates found.')
  } else {
    for (const e of extracted) {
      lines.push(`- [[${e.file}]] (keyword: ${e.keyword})`)
    }
  }
  lines.push('', '## Stale Notes (candidates for pruning)', '')
  if (report.staleNotes.length === 0) {
    lines.push('- No stale notes detected.')
  } else {
    for (const f of report.staleNotes) {
      lines.push(`- [[${f}]]`)
    }
  }
  lines.push('', '---', '', 'Generated by `/meditate` (Syn brainmaxxing).')
  const reportFile = `principles/meditate-${new Date().toISOString().slice(0, 10)}.md`
  brainWrite(reportFile, lines.join('\n') + '\n')
  rebuildIndex()
  report.path = reportFile
  return report
}

// ── /ruminate ────────────────────────────────────────────────────────────
// Mine archived sessions for uncaptured patterns

async function ruminate(engine) {
  const indexMd = readIndexMd()
  if (!engine || !engine.listSessions || !engine.getSession) {
    return { ok: false, error: 'IndexingEngine not provided' }
  }
  const sessions = engine.listSessions({}) || []
  const patterns = []
  for (const s of sessions.slice(0, 50)) {
    const session = engine.getSession(s.session_id)
    if (!session) continue
    const messages = session.messages || []
    const text = messages.map(m => m.content || '').join('\n').toLowerCase()
    const hits = []
    for (const kw of ['refactor', 'refactoring', 'architecture', 'design pattern', 'workaround', 'hack', 'todo', 'fixme', 'optimization', 'performance']) {
      if (text.includes(kw)) hits.push(kw)
    }
    if (hits.length > 0) {
      patterns.push({ sessionId: s.session_id, title: s.title, harness: s.harness, hits })
    }
  }
  const date = new Date().toISOString().slice(0, 10)
  const fileName = `sessions/ruminate-${date}.md`
  const lines = [
    `# Ruminate: Archived Session Patterns`,
    '',
    `Minied on: ${new Date().toISOString()}`,
    `Sessions scanned: ${sessions.length}`,
    `Patterns found: ${patterns.length}`,
    '',
    '## Patterns',
    ''
  ]
  if (patterns.length === 0) {
    lines.push('- No recurring patterns detected in sampled sessions.')
  } else {
    for (const p of patterns) {
      lines.push(`- [[session:${p.sessionId}]] "${p.title}" (${p.harness}): ${p.hits.join(', ')}`)
    }
  }
  lines.push('', '---', '', 'Generated by `/ruminate` (Syn brainmaxxing).')
  brainWrite(fileName, lines.join('\n') + '\n')
  rebuildIndex()
  return { ok: true, path: fileName, sessionsScanned: sessions.length, patternsFound: patterns.length, patterns }
}

// ── /plan ────────────────────────────────────────────────────────────────
// Break a task into phased plans, write to brain/plans/

async function plan(task, engine) {
  const indexMd = readIndexMd()
  const date = new Date().toISOString().slice(0, 10)
  const slug = slugify(task)
  const fileName = `plans/plan-${date}-${slug}.md`
  const lines = [
    `# Plan: ${task}`,
    '',
    `Created: ${new Date().toISOString()}`,
    '',
    '## Phases',
    '',
    '1. Discovery — research the task and gather context (use `/locate` to search prior sessions).',
    '2. Design — sketch the approach and check against brain principles.',
    '3. Implement — write the code, keeping sessions read-only.',
    '4. Validate — run tests, lint, and the validation loop for this phase.',
    '5. Document — update brain/ and write a memory via `/reflect`.',
    '',
    '## Success Condition',
    '',
    '- The plan is complete when every checkpoint is validated before proceeding.',
    '',
    '---',
    '',
    `Generated by \`/plan\` (Syn brainmaxxing) for task: ${task}`
  ]
  brainWrite(fileName, lines.join('\n') + '\n')
  rebuildIndex()
  return { ok: true, path: fileName, task }
}

// ── /review ──────────────────────────────────────────────────────────────
// Review code/plans against principles

async function review(content, engine) {
  const indexMd = readIndexMd()
  const issues = []
  const lower = content.toLowerCase()
  if (lower.includes('copy ') || lower.includes('duplicate')) {
    issues.push({ severity: 'high', message: 'Avoid copying or duplicating original session files (read-only principle).' })
  }
  if (lower.includes('network') || lower.includes('fetch(') || lower.includes('axios')) {
    issues.push({ severity: 'medium', message: 'MCP server is local-only over stdio; avoid network calls.' })
  }
  if (!lower.includes('principle') && content.length > 200) {
    issues.push({ severity: 'low', message: 'Consider referencing relevant brain principles in this review target.' })
  }
  const date = new Date().toISOString().slice(0, 10)
  const slug = slugify(content.slice(0, 40))
  const fileName = `plans/review-${date}-${slug}.md`
  const lines = [
    `# Review`,
    '',
    `Reviewed: ${new Date().toISOString()}`,
    `Issues found: ${issues.length}`,
    '',
    '## Issues',
    ''
  ]
  if (issues.length === 0) {
    lines.push('- No issues found against current principles.')
  } else {
    let i = 1
    for (const issue of issues) {
      lines.push(`${i}. [${issue.severity}] ${issue.message}`)
      i++
    }
  }
  lines.push('', '---', '', 'Generated by `/review` (Syn brainmaxxing).')
  brainWrite(fileName, lines.join('\n') + '\n')
  rebuildIndex()
  return { ok: true, path: fileName, issues }
}

module.exports = {
  BRAIN_DIR,
  brainRead,
  brainWrite,
  brainList,
  rebuildIndex,
  readIndexMd,
  reflect,
  meditate,
  ruminate,
  plan,
  review
}
