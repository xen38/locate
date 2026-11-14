/**
 * Fixture-based adapter tests for Phase 7 (Adapter Resilience & Testing).
 *
 * These tests use small anonymized sample archives under test/fixtures/ so they
 * do not depend on real user data on C:\ or K:\. They cover:
 *   - All harness adapters (JSON, JSONL, SQLite, Text/Markdown)
 *   - Graceful failure on corrupted/unparseable files
 *   - Incremental indexing (skip unchanged, re-index changed)
 *   - Archive file integrity (read-only, originals unchanged)
 */

const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { IndexingEngine } = require('../packages/core/index')
const { AdapterRegistry } = require('../packages/adapters/registry')

const FIXTURES_DIR = path.join(__dirname, 'fixtures')
const DB_PATH = path.join(os.tmpdir(), 'syn-fixture-test-index.db')

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`  PASS: ${message}`)
  } else {
    failed++
    console.log(`  FAIL: ${message}`)
  }
}

// ── Helper: build a temp copy of fixtures so we can write a corrupted file ──
function copyFixturesToTmp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-fixtures-'))
  function walk(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true })
    for (const e of entries) {
      const s = path.join(src, e.name)
      const d = path.join(dest, e.name)
      if (e.isDirectory()) {
        fs.mkdirSync(d, { recursive: true })
        walk(s, d)
      } else {
        fs.copyFileSync(s, d)
      }
    }
  }
  walk(FIXTURES_DIR, tmp)
  return tmp
}

// ── 1. Adapter discovery per harness ──
console.log('\n=== Phase 7.1: Fixture-based adapter discovery ===')
const registry = new AdapterRegistry()

const expected = [
  { dir: 'cline/sessions', harness: 'Cline', count: 2 },        // .json + .jsonl
  { dir: 'cursor/agent-transcripts/abc123', harness: 'Cursor', count: 1 }, // .jsonl under agent-transcripts
  { dir: 'pi/agent/sessions/ws1', harness: 'Pi', count: 1 },   // .jsonl under agent/sessions
  { dir: '.claude/projects/ws1', harness: 'Claude Code', count: 1 }, // .jsonl under .claude/projects
  { dir: 'opencode/sessions', harness: 'OpenCode', count: 1 }, // .jsonl under sessions
  { dir: 'windsurf', harness: 'Windsurf', count: 1 },          // .json under .windsurf
  { dir: 'continue', harness: 'Continue', count: 1 },          // .jsonl under .continue
  { dir: 'zed', harness: 'Zed', count: 1 },                    // .json under .zed
  { dir: 'roo', harness: 'Roo', count: 1 },                    // .jsonl under .roo
  { dir: 'aider', harness: 'Aider', count: 2 },                // .json + .md under .aider
  { dir: 'gemini', harness: 'Gemini CLI', count: 1 }           // .jsonl under .gemini
]

for (const exp of expected) {
  const dir = path.join(FIXTURES_DIR, exp.dir)
  const discovered = registry.discover(dir, exp.harness)
  assert(discovered.length === exp.count,
    `${exp.harness}: discovered ${discovered.length} session file(s) (expected ${exp.count})`)
}

// Unknown harness discovers nothing
const unknown = registry.discover(path.join(FIXTURES_DIR, 'cline/sessions'), 'Unknown')
assert(unknown.length === 0, 'Unknown harness discovers nothing')

// ── 2. Adapter parsing per harness ──
console.log('\n=== Phase 7.2: Adapter parsing per harness ===')

function parseFixture(relDir, fileName, harness) {
  const filePath = path.join(FIXTURES_DIR, relDir, fileName)
  return registry.parseSession(filePath)
}

// Cline JSON
const clineJson = parseFixture('cline/sessions', 'test-session.json', 'Cline')
assert(clineJson !== null, 'Cline JSON parses')
assert(clineJson.sessionId === 'cline-test-001', 'Cline JSON session_id')
assert(clineJson.title === 'Cline Test Session', 'Cline JSON title')
assert(clineJson.messages.length >= 1, 'Cline JSON has messages')

// Cline JSONL
const clineJsonl = parseFixture('cline/sessions', 'test-session.jsonl', 'Cline')
assert(clineJsonl !== null, 'Cline JSONL parses')
assert(clineJsonl.messages.length === 3, 'Cline JSONL has 3 messages')

// Cursor JSONL
const cursor = parseFixture('cursor/agent-transcripts/abc123', 'abc123.jsonl', 'Cursor')
assert(cursor !== null, 'Cursor JSONL parses')
assert(cursor.messages.length === 2, 'Cursor JSONL has 2 messages')

// Pi JSONL (pretty-printed, multi-object)
const pi = parseFixture('pi/agent/sessions/ws1', 'test-session.jsonl', 'Pi')
assert(pi !== null, 'Pi JSONL parses')
assert(pi.messages.length === 2, 'Pi JSONL has 2 messages')

// Claude Code JSONL
const claude = parseFixture('.claude/projects/ws1', 'test-session.jsonl', 'Claude Code')
assert(claude !== null, 'Claude Code JSONL parses')
assert(claude.messages.length === 2, 'Claude Code JSONL has 2 messages')

// OpenCode JSONL
const opencode = parseFixture('opencode/sessions', 'test-session.jsonl', 'OpenCode')
assert(opencode !== null, 'OpenCode JSONL parses')
assert(opencode.messages.length === 2, 'OpenCode JSONL has 2 messages')

// Windsurf JSON
const windsurf = parseFixture('windsurf', 'test-session.json', 'Windsurf')
assert(windsurf !== null, 'Windsurf JSON parses')
assert(windsurf.title === 'Windsurf Test', 'Windsurf title')

// Continue JSONL
const continueS = parseFixture('continue', 'test-session.jsonl', 'Continue')
assert(continueS !== null, 'Continue JSONL parses')
assert(continueS.messages.length === 2, 'Continue JSONL has 2 messages')

// Zed JSON
const zed = parseFixture('zed', 'test-session.json', 'Zed')
assert(zed !== null, 'Zed JSON parses')
assert(zed.title === 'Zed Test', 'Zed title')

// Roo JSONL
const roo = parseFixture('roo', 'test-session.jsonl', 'Roo')
assert(roo !== null, 'Roo JSONL parses')
assert(roo.messages.length === 2, 'Roo JSONL has 2 messages')

// Aider MD
const aiderMd = parseFixture('aider', 'test-session.md', 'Aider')
assert(aiderMd !== null, 'Aider MD parses')
assert(aiderMd.messages.length >= 1, 'Aider MD has messages')

// Aider JSON
const aiderJson = parseFixture('aider', 'test-session.json', 'Aider')
assert(aiderJson !== null, 'Aider JSON parses')
assert(aiderJson.title === 'Aider JSON Test', 'Aider JSON title')

// Gemini JSONL
const gemini = parseFixture('gemini', 'test-session.jsonl', 'Gemini CLI')
assert(gemini !== null, 'Gemini JSONL parses')
assert(gemini.messages.length === 2, 'Gemini JSONL has 2 messages')

// ── Run all tests inside an async main (top-level await + require conflict) ──
async function main() {
  // ── 3. Graceful failure: corrupted files are skipped ──
  console.log('\n=== Phase 7.3: Graceful failure on corrupted files ===')
  const tmpFixtures = copyFixturesToTmp()
  const corruptedDir = path.join(tmpFixtures, 'cline', 'sessions')
  // Append a clearly corrupted .json file
  fs.writeFileSync(path.join(corruptedDir, 'corrupted-session.json'), '{ not valid json !!!!!')
  // Append a corrupted .jsonl file
  fs.writeFileSync(path.join(corruptedDir, 'corrupted-session.jsonl'), '{ "broken": \n')

  const engine = new IndexingEngine(DB_PATH)
  try { fs.unlinkSync(DB_PATH) } catch (e) {}
  await engine.open()
  const sourceId = engine.addSource(corruptedDir)
  const result = await engine.indexSource(sourceId)
  assert(result.status !== 'error', 'Indexing with corrupted files does not error overall')
  assert(result.indexed >= 2, 'Valid sessions still indexed alongside corrupted files')
  // Corrupted files should be skipped (counted in skipped or just not indexed)
  console.log(`  Indexed: ${result.indexed}, Skipped: ${result.skipped}, Total: ${result.total}`)
  engine.close()

  // ── 4. Incremental indexing ──
  console.log('\n=== Phase 7.4: Incremental indexing ===')
  const tmpFixtures2 = copyFixturesToTmp()
  const incDir = path.join(tmpFixtures2, 'cline', 'sessions')
  const db2 = path.join(os.tmpdir(), 'syn-fixture-inc-test.db')
  try { fs.unlinkSync(db2) } catch (e) {}

  const engine2 = new IndexingEngine(db2)
  await engine2.open()
  const srcId2 = engine2.addSource(incDir)

    // First index (full)
  const r1 = await engine2.indexSource(srcId2)
  assert(r1.indexed >= 2, `First index: indexed ${r1.indexed} session(s)`)

    // Second index — incremental, unchanged files should be skipped
    const incResults2 = await engine2.incrementalIndex()
    const r2 = incResults2[0]
    assert(r2.skipped > 0, `Second index (incremental): skipped ${r2.skipped} unchanged file(s)`)
    assert(r2.indexed === 0, 'Second index (incremental): no new files indexed (all unchanged)')

    // Touch a file (change mtime) → should be re-indexed incrementally
  const clineJsonPath = path.join(incDir, 'test-session.json')
  fs.utimesSync(clineJsonPath, new Date(Date.now() + 60000), new Date(Date.now() + 60000))
    const incResults3 = await engine2.incrementalIndex()
    const r3 = incResults3[0]
    assert(r3.indexed === 1, `Third index (incremental): re-indexed 1 changed file (got ${r3.indexed})`)

  engine2.close()
  try { fs.unlinkSync(db2) } catch (e) {}

  // ── 5. Archive file integrity (read-only) ──
  console.log('\n=== Phase 7.5: Archive file integrity (read-only) ===')
  const tmpFixtures3 = copyFixturesToTmp()
  const integrityDir = path.join(tmpFixtures3, 'cline', 'sessions')

  // Record original hashes
  const originalHashes = {}
  function recordHashes(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isFile()) {
        originalHashes[full] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
      }
    }
  }
  recordHashes(integrityDir)

  const db3 = path.join(os.tmpdir(), 'syn-fixture-integrity-test.db')
  try { fs.unlinkSync(db3) } catch (e) {}
  const engine3 = new IndexingEngine(db3)
  await engine3.open()
  const srcId3 = engine3.addSource(integrityDir)
  await engine3.indexSource(srcId3)
  engine3.close()

  let integrityOk = true
  for (const [full, hash] of Object.entries(originalHashes)) {
    const current = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
    if (current !== hash) {
      console.log(`    FILE MODIFIED: ${full}`)
      integrityOk = false
    }
  }
  assert(integrityOk, 'Original archive files remain unchanged after indexing')

  // ── Summary ──
  console.log(`\n=== Fixture-based tests: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('Test error:', e)
  process.exit(1)
})
