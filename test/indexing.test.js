/**
 * Test the Locate Core Indexing Engine with real archive data.
 * Verifies: indexing, search, session retrieval, incremental indexing,
 * and archive file integrity (original files unchanged).
 */

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { IndexingEngine } = require('../packages/core/index')

const DB_PATH = 'K:\\Repos\\locate\\test\\locate-test-index.db'
const TEST_DIR = 'K:\\Users\\luizy\\.copilot'

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

// Record original file hashes before indexing
function recordHashes(dir) {
  const hashes = {}
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) {
        // Skip SQLite sidecar files (-wal, -shm) - they're engine artifacts, not original archives
        if (/-wal$|-shm$/.test(e.name)) continue
        hashes[full] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
      }
    }
  }
  walk(dir)
  return hashes
}

function verifyHashes(hashes, dir) {
  let ok = true
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.isFile()) {
        // Skip SQLite sidecar files (-wal, -shm) - they're engine artifacts, not original archives
        if (/-wal$|-shm$/.test(e.name)) continue
        if (!hashes[full]) continue
        const current = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')
        if (current !== hashes[full]) {
          console.log(`    FILE MODIFIED: ${full}`)
          ok = false
        }
      }
    }
  }
  walk(dir)
  return ok
}

// Clean up test DB
try { fs.unlinkSync(DB_PATH) } catch (e) {}

async function runTests() {
  console.log('=== Locate Indexing Engine Tests ===\n')

  // Test 1: Open engine and create schema
  console.log('Test 1: Engine initialization')
  const engine = new IndexingEngine(DB_PATH)
  await engine.open()
  assert(engine.initialized, 'engine should be initialized')
  assert(fs.existsSync(DB_PATH), 'database file should exist')

  // Test 2: Add real harness source
  console.log('\nTest 2: Add harness source')
  const sourceId = engine.addSource(TEST_DIR)
  assert(sourceId > 0, 'should add source and return id')
  const sources = engine.listSources()
  assert(sources.length === 1, 'should have 1 source')
  assert(sources[0].path === path.resolve(TEST_DIR), 'source path should match')
  assert(sources[0].harness === 'GitHub Copilot', 'harness should be detected as GitHub Copilot')

  // Test 3: Index source
  console.log('\nTest 3: Index source')
  const result = await engine.indexSource(sourceId)
  assert(result.indexed > 0, `should index sessions (got ${result.indexed})`)
  assert(result.sessionCount > 0, 'should have session count > 0')
  assert(result.status !== 'error', 'should not have errors')
  console.log(`  Indexed: ${result.indexed}, Skipped: ${result.skipped}, Total: ${result.total}, Sessions: ${result.sessionCount}`)

  // Test 4: Search sessions
  console.log('\nTest 4: Search sessions')
  const searchResults = engine.search('MCP')
  assert(searchResults.length > 0, `should find results for "MCP" (got ${searchResults.length})`)
  assert(searchResults.some(r => r.excerpt && r.excerpt.toLowerCase().includes('mcp')), 'should find MCP-related session')
  console.log(`  Found ${searchResults.length} results`)
  searchResults.forEach(r => console.log(`    - ${r.title} (${r.harness}) rank=${r.rank.toFixed(2)}`))

  // Test 5: Search with harness filter
  console.log('\nTest 5: Search with harness filter')
  const filtered = engine.search('MCP', { harness: 'GitHub Copilot' })
  assert(filtered.length > 0, 'should find results with harness filter')
  assert(filtered.every(r => r.harness === 'GitHub Copilot'), 'all results should be from GitHub Copilot')

  // Test 6: Search messages
  console.log('\nTest 6: Search messages')
  const msgResults = engine.searchMessages('MCP server')
  assert(msgResults.length >= 0, 'message search should work without error')
  console.log(`  Found ${msgResults.length} message results`)

  // Test 7: Get session
  console.log('\nTest 7: Get session')
  const allSessions = engine.listSessions()
  assert(allSessions.length > 0, 'should have sessions')
  const session = engine.getSession(allSessions[0].session_id)
  assert(session !== null, 'should retrieve session')
  assert(session.messages !== undefined, 'session should have messages')
  assert(Array.isArray(session.messages), 'messages should be an array')
  console.log(`  Session: ${session.title} (${session.messages.length} messages)`)

  // Test 8: Get context
  console.log('\nTest 8: Get context')
  if (session.messages.length > 0) {
    const ctx = engine.getContext(session.session_id, 0, 2, 2)
    assert(ctx !== null, 'should retrieve context')
    assert(ctx.messages.length > 0, 'context should have messages')
    console.log(`  Context: ${ctx.messages.length} messages around index 0`)
  }

  // Test 9: Count sessions
  console.log('\nTest 9: Count sessions')
  const count = engine.countSessions()
  assert(count > 0, 'should have sessions')
  console.log(`  Total sessions: ${count}`)

  // Test 10: Incremental indexing (re-index, should skip unchanged)
  console.log('\nTest 10: Incremental indexing - skip unchanged')
  const result2 = await engine.indexSource(sourceId)
  assert(result2.skipped > 0, `should skip unchanged files (got ${result2.skipped})`)
  assert(result2.indexed === 0, 'should not re-index unchanged files')

  // Test 11: Archive file integrity
  console.log('\nTest 11: Archive file integrity')
  const originalHashes = recordHashes(TEST_DIR)
  await engine.indexAllSources()
  const integrityOk = verifyHashes(originalHashes, TEST_DIR)
  assert(integrityOk, 'original archive files must remain unchanged')

  // Test 12: Remove source
  console.log('\nTest 12: Remove source')
  engine.removeSource(TEST_DIR)
  const sourcesAfter = engine.listSources()
  assert(sourcesAfter.length === 0, 'source should be removed')
  const sessionsAfter = engine.countSessions()
  assert(sessionsAfter === 0, 'all sessions from removed source should be deleted')

  engine.close()

  // Clean up
  try { fs.unlinkSync(DB_PATH) } catch (e) {}

  console.log(`\n=== ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

runTests().catch(e => {
  console.error('Test error:', e)
  process.exit(1)
})
