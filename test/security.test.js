// Phase 8 — Privacy & Security tests
// Secret redaction + path exclusions

const path = require('path')
const fs = require('fs')
const os = require('os')
const { IndexingEngine } = require('../packages/core/index')

function makeTempDb() {
  return path.join(os.tmpdir(), 'syn-security-test-' + Date.now() + '.db')
}
function cleanupDb(dbPath) {
  try { fs.unlinkSync(dbPath) } catch (e) {}
  try { fs.unlinkSync(dbPath + '-wal') } catch (e) {}
  try { fs.unlinkSync(dbPath + '-shm') } catch (e) {}
}
function cleanupDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.readdirSync(dirPath).forEach(f => {
        const fp = path.join(dirPath, f)
        if (fs.statSync(fp).isDirectory()) cleanupDir(fp)
        else fs.unlinkSync(fp)
      })
      fs.rmdirSync(dirPath)
    }
  } catch (e) {}
}

let passed = 0
let failed = 0

function assert(condition, name) {
  if (condition) { passed++; console.log(`  PASS: ${name}`) }
  else { failed++; console.log(`  FAIL: ${name}`) }
}

async function main() {
  console.log('=== Phase 8.1: Secret redaction ===')

  // Cline-style directory: .cline/sessions/<file>.jsonl
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-sec-'))
  const clineDir = path.join(baseDir, '.cline', 'sessions')
  fs.mkdirSync(clineDir, { recursive: true })

  const secretFile = path.join(clineDir, 'test-session.jsonl')
  const secretLines = [
    { session_id: 'sec-001', title: 'Secret test session', role: 'user', content: 'My GitHub token is ghp_abcdefghijklmnopqrstuvwxyz1234567890' },
    { session_id: 'sec-001', title: 'Secret test session', role: 'assistant', content: 'I can help with that AWS key AKIAIOSFODNN7EXAMPLE' },
    { session_id: 'sec-001', title: 'Secret test session', role: 'user', content: 'Normal message without secrets' }
  ]
  fs.writeFileSync(secretFile, secretLines.map(l => JSON.stringify(l)).join('\n') + '\n')

  const TEST_DB = makeTempDb()
  const engine = new IndexingEngine(TEST_DB, { redactSecrets: true, excludedPaths: [] })
  await engine.open()

  const sourceId = engine.addSource(baseDir, 'Cline')
  const result = await engine.indexSource(sourceId)
  assert(result.indexed >= 1, 'Indexed secret-containing session')

  const sessions = engine.listSessions()
  const secSession = sessions.find(s => s.content && s.content.includes('[REDACTED_GITHUB_TOKEN]'))
  assert(secSession != null, 'Secret session found in index')
  if (secSession) {
    const full = engine.getSession(secSession.session_id)
    const userMsg = full.messages.find(m => m.role === 'user' && m.content.includes('[REDACTED_GITHUB_TOKEN]'))
    const assistantMsg = full.messages.find(m => m.role === 'assistant' && m.content.includes('[REDACTED_AWS_KEY]'))
    const normalMsg = full.messages.find(m => m.content === 'Normal message without secrets')
    assert(userMsg && !userMsg.content.includes('ghp_'), 'GitHub token redacted from user message')
    assert(userMsg && userMsg.content.includes('[REDACTED_GITHUB_TOKEN]'), 'GitHub token replaced with redaction marker')
    assert(assistantMsg && !assistantMsg.content.includes('AKIA'), 'AWS key redacted from assistant message')
    assert(assistantMsg && assistantMsg.content.includes('[REDACTED_AWS_KEY]'), 'AWS key replaced with redaction marker')
    assert(normalMsg != null, 'Normal message preserved unchanged')
  }

  // Verify original file on disk is untouched
  const originalContent = fs.readFileSync(secretFile, 'utf8')
  assert(originalContent.includes('ghp_'), 'Original file on disk still contains GitHub token')
  assert(originalContent.includes('AKIA'), 'Original file on disk still contains AWS key')

  engine.close()
  cleanupDb(TEST_DB)
  cleanupDir(baseDir)

  // Engine with redaction disabled
  const TEST_DB2 = makeTempDb()
  const engine2 = new IndexingEngine(TEST_DB2, { redactSecrets: false, excludedPaths: [] })
  await engine2.open()

  const baseDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-sec-'))
  const clineDir2 = path.join(baseDir2, '.cline', 'sessions')
  fs.mkdirSync(clineDir2, { recursive: true })
  const secretFile2 = path.join(clineDir2, 'test-session.jsonl')
  const lines2 = [
    { session_id: 'sec-002', title: 'No redaction test', role: 'user', content: 'Token: ghp_abcdefghijklmnopqrstuvwxyz1234567890' }
  ]
  fs.writeFileSync(secretFile2, lines2.map(l => JSON.stringify(l)).join('\n') + '\n')

  const sourceId2 = engine2.addSource(baseDir2, 'Cline')
  await engine2.indexSource(sourceId2)
  const sessions2 = engine2.listSessions()
  const secSession2 = sessions2.find(s => s.content && s.content.includes('ghp_'))
  assert(secSession2 != null, 'Session indexed without redaction')
  if (secSession2) {
    const full2 = engine2.getSession(secSession2.session_id)
    const userMsg2 = full2.messages.find(m => m.role === 'user')
    assert(userMsg2 && userMsg2.content.includes('ghp_'), 'Secret NOT redacted when redactSecrets is false')
  }

  engine2.close()
  cleanupDb(TEST_DB2)
  cleanupDir(baseDir2)

  console.log('\n=== Phase 8.2: Path exclusions ===')

  const TEST_DB3 = makeTempDb()
  const engine3 = new IndexingEngine(TEST_DB3, { redactSecrets: false, excludedPaths: [] })
  await engine3.open()

  const baseDir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'syn-sec-'))
  const includedDir = path.join(baseDir3, '.cline', 'sessions', 'included')
  const excludedDir = path.join(baseDir3, '.cline', 'sessions', 'excluded')
  fs.mkdirSync(includedDir, { recursive: true })
  fs.mkdirSync(excludedDir, { recursive: true })

  fs.writeFileSync(path.join(includedDir, 'included-session.jsonl'), JSON.stringify({
    session_id: 'incl-001', title: 'Included Session', role: 'user', content: 'I should be indexed'
  }) + '\n')

  fs.writeFileSync(path.join(excludedDir, 'excluded-session.jsonl'), JSON.stringify({
    session_id: 'excl-001', title: 'Excluded Session', role: 'user', content: 'I should NOT be indexed'
  }) + '\n')

  const sourceId3 = engine3.addSource(baseDir3, 'Cline')
  const result3 = await engine3.indexSource(sourceId3)
  const sessions3 = engine3.listSessions()
  assert(sessions3.length >= 2, 'Both sessions indexed without exclusions (got ' + sessions3.length + ')')

  engine3.close()
  cleanupDb(TEST_DB3)

  const engine3b = new IndexingEngine(TEST_DB3, {
    redactSecrets: false,
    excludedPaths: [excludedDir]
  })
  await engine3b.open()

  const sourceId3b = engine3b.addSource(baseDir3, 'Cline')
  const result3b = await engine3b.indexSource(sourceId3b)
  const sessions3b = engine3b.listSessions()
  assert(sessions3b.length === 1, 'Only included session indexed with exclusion (got ' + sessions3b.length + ')')
  const exclSession = sessions3b.find(s => s.session_id === 'excl-001')
  assert(exclSession == null, 'Excluded session not in index')

  engine3b.close()
  cleanupDb(TEST_DB3)
  cleanupDir(baseDir3)

  console.log(`\n=== Security tests: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(e => {
  console.error('Test error:', e)
  process.exit(1)
})