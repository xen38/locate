/**
 * Real-world integration test against installed harnesses.
 * Tests all 6 harnesses installed on this machine:
 *   .copilot (SQLite .db), .cline (JSON/JSONL/MD/TXT),
 *   .codex (SQLite .sqlite), .cursor (MD), .pi (JSONL), .t3 (SQLite .sqlite)
 *
 * Runs end-to-end through the same IndexingEngine used by MCP server and desktop app.
 */

const path = require('path')
const fs = require('fs')
const { IndexingEngine } = require(path.join(__dirname, '..', 'packages', 'core', 'index'))

const HARNESS_DIRS = [
  { dir: 'K:\\Users\\luizy\\.copilot', harness: 'GitHub Copilot' },
  { dir: 'K:\\Users\\luizy\\.cline', harness: 'Cline' },
  { dir: 'K:\\Users\\luizy\\.codex', harness: 'Codex' },
  { dir: 'K:\\Users\\luizy\\.cursor', harness: 'Cursor' },
  { dir: 'K:\\Users\\luizy\\.pi', harness: 'Pi' },
  { dir: 'K:\\Users\\luizy\\.t3', harness: 'T3 Code' },
]

const TEST_DB = 'K:\\Repos\\locate\\test\\real-world-index.db'

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`)
    passed++
  } else {
    console.log(`  FAIL: ${message}`)
    failed++
  }
}

async function main() {
  // Clean test database
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
  if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal')
  if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm')

  const engine = new IndexingEngine(TEST_DB)
  await engine.open()

  // ── Step 1: Add all harness sources ──
  console.log('\nStep 1: Adding harness sources...')
  for (const { dir, harness } of HARNESS_DIRS) {
    const id = engine.addSource(dir, harness)
    assert(id > 0, `Added source "${harness}" (${dir}) with id ${id}`)
  }

  const sources = engine.listSources()
  assert(sources.length === HARNESS_DIRS.length, `All ${HARNESS_DIRS.length} sources registered`)

  // ── Step 2: Index all sources ──
  console.log('\nStep 2: Indexing all sources...')
  const allResult = await engine.indexAllSources()
  console.log(`  Index result: indexed=${allResult.indexed}, skipped=${allResult.skipped}, total=${allResult.total}`)

  const sourcesAfter = engine.listSources()
  for (const s of sourcesAfter) {
    assert(s.status === 'indexed', `Source "${s.harness}" (${s.path}) status is "indexed"`)
    assert(s.session_count > 0, `Source "${s.harness}" has ${s.session_count} sessions`)
  }

  const totalSessions = engine.countSessions()
  console.log(`\n  Total sessions indexed: ${totalSessions}`)
  assert(totalSessions > 0, 'At least one session indexed across all harnesses')

  // ── Step 3: Cross-harness search ──
  console.log('\nStep 3: Cross-harness search tests...')

  // Search for "JWT" — should find Cline (api-session.json, auth-session.md) and Copilot
  const jwtResults = engine.search('JWT')
  console.log(`  "JWT" search: ${jwtResults.length} results`)
  jwtResults.forEach(r => console.log(`    - ${r.title} (${r.harness}) rank=${r.rank}`))
  const jwtHarnesses = new Set(jwtResults.map(r => r.harness))
  assert(jwtHarnesses.size > 0, '"JWT" search returns at least one result')

  // Search for "meteor" — should find Cursor
  const meteorResults = engine.search('meteor')
  console.log(`  "meteor" search: ${meteorResults.length} results`)
  meteorResults.forEach(r => console.log(`    - ${r.title} (${r.harness}) rank=${r.rank}`))
  const meteorFound = meteorResults.some(r => r.harness === 'Cursor')
  assert(meteorFound, '"meteor" search finds Cursor harness session')

  // Search for "OAuth2" — should find Cline auth-session
  const oauthResults = engine.search('OAuth2')
  console.log(`  "OAuth2" search: ${oauthResults.length} results`)
  oauthResults.forEach(r => console.log(`    - ${r.title} (${r.harness})`))
  const oauthCline = oauthResults.some(r => r.harness === 'Cline')
  assert(oauthCline, '"OAuth2" search finds Cline auth session')

  // Search for "locate app" — should find Copilot and Pi
  const locateResults = engine.search('locate app')
  console.log(`  "locate app" search: ${locateResults.length} results`)
  locateResults.forEach(r => console.log(`    - ${r.title} (${r.harness})`))
  assert(locateResults.length > 0, '"locate app" search returns results')

  // Search for "PostgreSQL" — should find Cline database-session
  const pgResults = engine.search('PostgreSQL')
  console.log(`  "PostgreSQL" search: ${pgResults.length} results`)
  pgResults.forEach(r => console.log(`    - ${r.title} (${r.harness})`))
  const pgCline = pgResults.some(r => r.harness === 'Cline')
  assert(pgCline, '"PostgreSQL" search finds Cline database session')

  // ── Step 4: Search with harness filter ──
  console.log('\nStep 4: Harness-filtered search...')
  const clineOnly = engine.search('session', { harness: 'Cline' })
  console.log(`  Cline-only "session": ${clineOnly.length} results`)
  const allCline = clineOnly.every(r => r.harness === 'Cline')
  assert(allCline && clineOnly.length > 0, 'Harness filter returns only Cline results')

  // ── Step 5: Retrieve individual sessions ──
  console.log('\nStep 5: Individual session retrieval...')
  const allSessions = engine.listSessions()
  assert(allSessions.length > 0, 'listSessions returns sessions')

  for (const s of allSessions) {
    const session = engine.getSession(s.session_id)
    assert(session !== null, `Retrieved session "${session?.title || s.session_id}" (${session?.harness || '?'})`)
    assert(Array.isArray(session?.messages), `Session has messages array (${session?.messages?.length || 0} messages)`)
  }

  // ── Step 6: Archive integrity ──
  console.log('\nStep 6: Archive file integrity (read-only)...')
  // Hash all original archive files before and after
  const archiveFiles = []
  for (const dir of HARNESS_DIRS.map(d => d.dir)) {
    function collect(dirPath) {
      for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const full = path.join(dirPath, entry.name)
        if (entry.isDirectory()) collect(full)
        else archiveFiles.push(full)
      }
    }
    collect(dir)
  }

  const crypto = require('crypto')
  const hashesBefore = {}
  for (const f of archiveFiles) {
    hashesBefore[f] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  }

  // Re-index to confirm no modification
  await engine.indexAllSources()

  const hashesAfter = {}
  for (const f of archiveFiles) {
    hashesAfter[f] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  }

  let integrityOk = true
  for (const f of archiveFiles) {
    if (hashesBefore[f] !== hashesAfter[f]) {
      console.log(`  MODIFIED: ${f}`)
      integrityOk = false
    }
  }
  assert(integrityOk, 'All original archive files remain unchanged after indexing')

  engine.close()

  // Clean up test database
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB)
  if (fs.existsSync(TEST_DB + '-wal')) fs.unlinkSync(TEST_DB + '-wal')
  if (fs.existsSync(TEST_DB + '-shm')) fs.unlinkSync(TEST_DB + '-shm')

  console.log(`\n=== Real-world integration test: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
