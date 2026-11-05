const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SERVER = path.join('K:', 'Repos', 'locate', 'mcp-server.js');
const CONFIG_FILE = path.join(process.env.APPDATA || process.env.HOME || os.homedir(), 'locate-mcp-config.json');

let passed = 0;
let failed = 0;
const results = [];

function assert(condition, message) {
  if (condition) { passed++; results.push('PASS: ' + message); console.log('  PASS:', message); }
  else { failed++; results.push('FAIL: ' + message); console.log('  FAIL:', message); }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdoutBuf = '';
    proc.stdout.on('data', d => { stdoutBuf += d.toString(); });
    proc.stderr.on('data', d => { /* server logs go here */ });
    proc.on('error', reject);
    // Wait a tick for server to start
    setTimeout(() => resolve(proc), 500);
  });
}

function send(proc, obj) {
  return new Promise((resolve, reject) => {
    const line = JSON.stringify(obj) + '\n';
    proc.stdin.write(line);
    // We need to read the matching response. Use a one-shot listener on stdout.
    const handler = d => {
      const text = d.toString();
      // stdoutBuf may contain multiple lines; find the one whose id matches (for requests)
      // Simplest: accumulate and parse complete lines
      // We'll handle buffering outside via a reader.
      resolve(text);
    };
    proc.stdout.once('data', handler);
    setTimeout(() => {
      proc.stdout.removeListener('data', handler);
      reject(new Error('timeout waiting for response to ' + obj.method));
    }, 5000);
  });
}

// Better: a proper reader that buffers stdout and resolves pending promises by id.
function createReader(proc) {
  let buf = '';
  const pending = new Map(); // id -> resolve
  proc.stdout.on('data', d => {
    buf += d.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)(msg);
          pending.delete(msg.id);
        }
      } catch (e) { /* ignore unparseable */ }
    }
  });
  return function sendReq(obj) {
    return new Promise((resolve, reject) => {
      proc.stdin.write(JSON.stringify(obj) + '\n');
      if (obj.id !== undefined) {
        pending.set(obj.id, resolve);
        setTimeout(() => {
          if (pending.has(obj.id)) { pending.delete(obj.id); reject(new Error('timeout: ' + obj.method)); }
        }, 10000);
      } else {
        resolve({ notification: true });
      }
    });
  };
}

async function run() {
  console.log('Starting Locate MCP server...\n');
  const proc = await startServer();
  const sendReq = createReader(proc);

  // ── initialize ──
  console.log('--- initialize ---');
  const initResp = await sendReq({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' }
    }
  });
  console.log('initialize response:', JSON.stringify(initResp));
  assert(initResp.result && initResp.result.capabilities, 'server returns initialize result with capabilities');
  assert(initResp.result && initResp.result.serverInfo && initResp.result.serverInfo.name === 'locate', 'serverInfo.name === locate');

  // initialized notification
  await sendReq({ jsonrpc: '2.0', method: 'initialized', params: {} });
  console.log('initialized notification sent');

  // ── tools/list ──
  console.log('\n--- tools/list ---');
  const listResp = await sendReq({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  const tools = listResp.result && listResp.result.tools ? listResp.result.tools : [];
  const toolNames = tools.map(t => t.name);
  console.log('Tools:', toolNames.join(', '));
  const expected = ['locate_search', 'locate_read_session', 'locate_list_sessions', 'locate_list_harnesses', 'locate_add_harness'];
  for (const t of expected) assert(toolNames.includes(t), 'tool ' + t + ' is exposed');

  // ── locate_list_harnesses (initially empty) ──
  console.log('\n--- locate_list_harnesses (initial) ---');
  const lh1 = await sendReq({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'locate_list_harnesses', arguments: {} } });
  console.log('list_harnesses result:', lh1.result ? lh1.result.content[0].text : JSON.stringify(lh1));
  const h1 = JSON.parse(lh1.result.content[0].text);
  assert(Array.isArray(h1.harnesses), 'list_harnesses returns harnesses array');

  // ── locate_add_harness ──
  console.log('\n--- locate_add_harness ---');
  const ah = await sendReq({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'locate_add_harness', arguments: { dirPath: 'K:\\\\Users\\\\luizy\\\\.cline' } } });
  console.log('add_harness result:', ah.result ? ah.result.content[0].text : JSON.stringify(ah));
  const ahBody = JSON.parse(ah.result.content[0].text);
  assert(ahBody.added === 'K:\\Users\\luizy\\.cline' || ahBody.added === 'K:\\\\Users\\\\luizy\\\\.cline', 'add_harness echoes added dir');
  assert(Array.isArray(ahBody.harnesses) && ahBody.harnesses.length > 0, 'harnesses array non-empty after add');

  // Add a second harness (pi)
  const ah2 = await sendReq({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'locate_add_harness', arguments: { dirPath: 'K:\\\\Users\\\\luizy\\\\.pi' } } });
  const ah2Body = JSON.parse(ah2.result.content[0].text);
  assert(ah2Body.harnesses.length >= 2, 'second harness added (now >=2 harnesses)');

  // Add remaining harnesses so .db/.sqlite formats get scanned too
  for (const extra of ['K:\\\\Users\\\\luizy\\\\.copilot', 'K:\\\\Users\\\\luizy\\\\.codex', 'K:\\\\Users\\\\luizy\\\\.t3']) {
    await sendReq({ jsonrpc: '2.0', id: 100, method: 'tools/call', params: { name: 'locate_add_harness', arguments: { dirPath: extra } } });
  }

  // ── locate_list_harnesses after adds ──
  console.log('\n--- locate_list_harnesses (after adds) ---');
  const lh2 = await sendReq({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'locate_list_harnesses', arguments: {} } });
  const h2 = JSON.parse(lh2.result.content[0].text);
  console.log('harnesses:', JSON.stringify(h2.harnesses));
  assert(h2.harnesses.some(h => h.toLowerCase().includes('.cline')), '.cline harness listed');
  assert(h2.harnesses.some(h => h.toLowerCase().includes('.pi')), '.pi harness listed');

  // ── locate_list_sessions ──
  console.log('\n--- locate_list_sessions ---');
  const ls = await sendReq({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'locate_list_sessions', arguments: {} } });
  const lsBody = JSON.parse(ls.result.content[0].text);
  console.log('totalSessions:', lsBody.totalSessions);
  console.log('sessions:', JSON.stringify(lsBody.sessions, null, 2));
  assert(typeof lsBody.totalSessions === 'number' && lsBody.totalSessions > 0, 'lists >0 sessions across harnesses');
  assert(lsBody.sessions.some(s => s.id.toLowerCase().endsWith('.md')), 'has .md session');
  assert(lsBody.sessions.some(s => s.id.toLowerCase().endsWith('.txt')), 'has .txt session');
  assert(lsBody.sessions.some(s => s.id.toLowerCase().endsWith('.json')), 'has .json session');
  assert(lsBody.sessions.some(s => s.id.toLowerCase().endsWith('.jsonl')), 'has .jsonl session');
  assert(lsBody.sessions.some(s => s.id.toLowerCase().endsWith('.db') || s.id.toLowerCase().endsWith('.sqlite')), 'has .db/.sqlite session');
  // each session has expected fields
  if (lsBody.sessions.length > 0) {
    const s0 = lsBody.sessions[0];
    assert(typeof s0.id === 'string' && typeof s0.label === 'string', 'session has id and label');
    assert(typeof s0.harness === 'string', 'session has harness');
    assert(typeof s0.preview === 'string', 'session has preview');
  }
  const mdSession = lsBody.sessions.find(s => s.label === 'auth-session');
  assert(mdSession, 'auth-session.md found in listing');
  const mdPath = mdSession ? mdSession.id : null;

  // ── locate_search ──
  console.log('\n--- locate_search ---');
  // title match search: 'auth' should match auth-session.md (title) and api-session.json (title has API... no 'auth'? title is API Design Session - no). Actually auth-session title match.
  const searchAuth = await sendReq({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'locate_search', arguments: { query: 'auth', batchSize: 10 } } });
  const searchAuthBody = JSON.parse(searchAuth.result.content[0].text);
  console.log('search "auth":', JSON.stringify(searchAuthBody.results.map(r => ({ label: r.label, score: r.score, labelMatch: r.labelMatch, contentMatch: r.contentMatch })), null, 2));
  assert(searchAuthBody.totalResults >= 1, 'search "auth" returns >=1 result');
  assert(searchAuthBody.results.some(r => r.label === 'auth-session'), 'auth-session found');
  // auth-session should have labelMatch (title contains 'auth')
  const authRes = searchAuthBody.results.find(r => r.label === 'auth-session');
  assert(authRes && authRes.labelMatch === true, 'auth-session labelMatch is true (title match)');

  // content match search: 'PostgreSQL' should match database-session.txt content only (score 1)
  const searchPg = await sendReq({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'locate_search', arguments: { query: 'PostgreSQL', batchSize: 10 } } });
  const searchPgBody = JSON.parse(searchPg.result.content[0].text);
  console.log('search "PostgreSQL":', JSON.stringify(searchPgBody.results.map(r => ({ label: r.label, score: r.score, labelMatch: r.labelMatch, contentMatch: r.contentMatch })), null, 2));
  assert(searchPgBody.results.some(r => r.label === 'database-session'), 'database-session found by content');
  const pgRes = searchPgBody.results.find(r => r.label === 'database-session');
  assert(pgRes && pgRes.contentMatch === true && pgRes.labelMatch === false, 'database-session: contentMatch true, labelMatch false (score 1)');
  assert(pgRes && pgRes.score === 1, 'content-only match score === 1');
  assert(pgRes && typeof pgRes.context === 'string' && pgRes.context.includes('PostgreSQL'), 'context snippet contains the match');

  // title+content combined search: 'session' appears in all labels -> score 2 each
  const searchSession = await sendReq({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'locate_search', arguments: { query: 'session', batchSize: 10 } } });
  const searchSessionBody = JSON.parse(searchSession.result.content[0].text);
  console.log('search "session" count:', searchSessionBody.results.length);
  // Verify ranking: highest score first
  let sorted = true;
  for (let i = 1; i < searchSessionBody.results.length; i++) {
    if (searchSessionBody.results[i].score > searchSessionBody.results[i - 1].score) sorted = false;
  }
  assert(sorted, 'results sorted by score descending (title match=2 > content match=1)');
  // top result should be a title match (score 2) if any
  if (searchSessionBody.results.length > 0) {
    assert(searchSessionBody.results[0].score >= 1, 'top result has score >=1');
  }

  // no-match search
  const searchNone = await sendReq({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'locate_search', arguments: { query: 'zzzzyyyynomatch', batchSize: 10 } } });
  const searchNoneBody = JSON.parse(searchNone.result.content[0].text);
  assert(searchNoneBody.totalResults === 0, 'search with no matches returns 0 results');

  // ── locate_read_session ──
  console.log('\n--- locate_read_session ---');
  if (mdPath) {
    const read = await sendReq({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'locate_read_session', arguments: { filePath: mdPath } } });
    const readBody = JSON.parse(read.result.content[0].text);
    console.log('read_session path:', readBody.path, 'size:', readBody.size, 'modified:', readBody.modified);
    assert(readBody.path === mdPath, 'read_session returns the requested path');
    assert(typeof readBody.content === 'string' && readBody.content.length > 0, 'read_session returns content');
    assert(readBody.content.includes('OAuth2'), 'content contains OAuth2 (auth-session.md)');
    assert(typeof readBody.modified === 'number', 'read_session returns modified timestamp');
    assert(typeof readBody.size === 'number', 'read_session returns size');
  } else {
    assert(false, 'no mdSession path to read');
  }

  // Read a jsonl session
  const jsonlSession = lsBody.sessions.find(s => s.id.toLowerCase().endsWith('.jsonl'));
  if (jsonlSession) {
    const readJ = await sendReq({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'locate_read_session', arguments: { filePath: jsonlSession.id } } });
    const readJBody = JSON.parse(readJ.result.content[0].text);
    console.log('read jsonl:', jsonlSession.label, 'content length:', readJBody.content.length);
    assert(typeof readJBody.content === 'string' && readJBody.content.length > 0, 'read_session works for .jsonl');
  }

  // Read a .db (sqlite) session
  const sqliteSession = lsBody.sessions.find(s => s.id.toLowerCase().endsWith('.db'));
  if (sqliteSession) {
    const readS = await sendReq({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'locate_read_session', arguments: { filePath: sqliteSession.id } } });
    const readSBody = JSON.parse(readS.result.content[0].text);
    console.log('read sqlite:', sqliteSession.label, 'content length:', readSBody.content.length);
    assert(typeof readSBody.content === 'string' && readSBody.content.length > 0, 'read_session works for .db/.sqlite');
    assert(readSBody.content.includes('Copilot Chat Session') || readSBody.content.includes('MCP Server Setup'), 'sqlite content extracted (title or message)');
  }

  // Read a .sqlite session too (different extension, same parser)
  const sqlite2Session = lsBody.sessions.find(s => s.id.toLowerCase().endsWith('.sqlite'));
  if (sqlite2Session) {
    const readS2 = await sendReq({ jsonrpc: '2.0', id: 141, method: 'tools/call', params: { name: 'locate_read_session', arguments: { filePath: sqlite2Session.id } } });
    const readS2Body = JSON.parse(readS2.result.content[0].text);
    console.log('read sqlite2:', sqlite2Session.label, 'content length:', readS2Body.content.length);
    assert(typeof readS2Body.content === 'string' && readS2Body.content.length > 0, 'read_session works for .sqlite');
  }

  // read nonexistent file -> error
  const readBad = await sendReq({ jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'locate_read_session', arguments: { filePath: 'K:\\\\Users\\\\luizy\\\\nonexistent.md' } } });
  const isError = readBad.result && readBad.result.isError === true;
  assert(isError, 'read_session on nonexistent file returns isError');

  // ── Config file verification ──
  console.log('\n--- config file (%APPDATA%/locate-mcp-config.json) ---');
  const configExists = fs.existsSync(CONFIG_FILE);
  console.log('CONFIG_FILE:', CONFIG_FILE, 'exists:', configExists);
  assert(configExists, 'config file exists at %APPDATA%/locate-mcp-config.json');
  if (configExists) {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    console.log('config content:', JSON.stringify(cfg));
    assert(Array.isArray(cfg.harnessDirectories) && cfg.harnessDirectories.length >= 2, 'config has harnessDirectories with >=2 entries');
    assert(cfg.harnessDirectories.some(h => h.toLowerCase().includes('.cline')), 'config includes .cline');
    assert(cfg.harnessDirectories.some(h => h.toLowerCase().includes('.pi')), 'config includes .pi');
  }

  // ── Format coverage summary ──
  console.log('\n--- Format coverage ---');
  const hasExt = e => lsBody.sessions.some(s => s.id.toLowerCase().endsWith(e));
  const required = ['.md', '.txt', '.json', '.jsonl', '.db', '.sqlite'];
  for (const e of required) assert(hasExt(e), 'format ' + e + ' is represented in sessions');

  proc.stdin.end();
  proc.kill();

  console.log('\n========================================');
  console.log('RESULTS: ' + passed + ' passed, ' + failed + ' failed');
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('TEST HARNESS ERROR:', err);
  process.exit(2);
});
