const path = require('path')
const fs = require('fs')
const os = require('os')

// Test the search logic by simulating what main.js does
function buildSessionsFromDir(dirPath) {
  const supportedExts = ['.md', '.txt', '.json']
  const sessions = []
  const entries = fs.readdirSync(dirPath, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const ext = path.extname(entry.name).toLowerCase()
    if (!supportedExts.includes(ext)) continue
    const filePath = path.join(dirPath, entry.name)
    const content = fs.readFileSync(filePath, 'utf8')
    const label = path.basename(entry.name, ext)
    sessions.push({ id: filePath, label, content, harness: path.basename(dirPath) })
  }
  return sessions
}

function searchSessions(sessions, query) {
  const queryLower = query.toLowerCase()
  const results = []
  for (const s of sessions) {
    const labelMatch = s.label.toLowerCase().includes(queryLower)
    const contentMatch = s.content.toLowerCase().includes(queryLower)
    if (!labelMatch && !contentMatch) continue
    let context = ''
    if (contentMatch) {
      const idx = s.content.toLowerCase().indexOf(queryLower)
      const start = Math.max(0, idx - 100)
      const end = Math.min(s.content.length, idx + query.length + 100)
      context = s.content.substring(start, end).replace(/\n/g, ' ')
    }
    results.push({
      id: s.id,
      label: s.label,
      harness: s.harness,
      labelMatch,
      contentMatch,
      context,
      score: (labelMatch ? 2 : 0) + (contentMatch ? 1 : 0)
    })
  }
  results.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
  return results
}

// Setup temp test data
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'locate-test-'))
const harnessDir = path.join(tmpDir, 'test-harness')
fs.mkdirSync(harnessDir, { recursive: true })

fs.writeFileSync(path.join(harnessDir, 'auth-session.md'), '# Authentication\n\nThis session covers OAuth2 token refresh and login flow.\n\n## Error handling\n\nWhen the token expires, the client should retry with a refresh token.')
fs.writeFileSync(path.join(harnessDir, 'database-session.txt'), 'Database migration notes\n\nWe migrated from PostgreSQL 13 to 15. The schema changes included adding indexes on the users table.')
fs.writeFileSync(path.join(harnessDir, 'api-session.md'), '# API Design\n\nREST endpoints for user management. Authentication is handled via JWT.')

// Run tests
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

console.log('Running locate search tests...\n')

// Test 1: Load sessions
const sessions = buildSessionsFromDir(harnessDir)
assert(sessions.length === 3, 'should load 3 session files')
assert(sessions.some(s => s.label === 'auth-session'), 'should have auth-session')
assert(sessions.some(s => s.label === 'database-session'), 'should have database-session')
assert(sessions.some(s => s.label === 'api-session'), 'should have api-session')

// Test 2: Search by title
const titleResults = searchSessions(sessions, 'auth')
assert(titleResults.length === 2, 'search "auth" should return 2 results (auth-session + api-session)')
assert(titleResults[0].label === 'auth-session', 'auth-session should rank first (title match)')

// Test 3: Search by content
const contentResults = searchSessions(sessions, 'PostgreSQL')
assert(contentResults.length === 1, 'search "PostgreSQL" should return 1 result')
assert(contentResults[0].label === 'database-session', 'should find database-session')

// Test 4: Search with no matches
const emptyResults = searchSessions(sessions, 'nonexistentxyz')
assert(emptyResults.length === 0, 'search "nonexistentxyz" should return 0 results')

// Test 5: Context snippet
const ctxResults = searchSessions(sessions, 'refresh token')
assert(ctxResults.length === 1, 'search "refresh token" should return 1 result')
assert(ctxResults[0].context.includes('refresh token'), 'context should contain the match')

// Test 6: Score ranking (title match > content match)
const mixedResults = searchSessions(sessions, 'session')
assert(mixedResults.length === 3, 'search "session" should return all 3 (all have "session" in label)')
assert(mixedResults[0].score >= mixedResults[1].score, 'results should be sorted by score desc')

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true })

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
