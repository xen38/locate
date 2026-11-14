/**
 * Validator precision test.
 * Verifies per-harness session file validators produce:
 *   - No false positives (non-session files excluded)
 *   - No false negatives (real session files included)
 */

const path = require('path')
const { detectHarness, getSessionValidator } = require('../packages/adapters/registry')

const registry = new (require('../packages/adapters/registry').AdapterRegistry)()

const cases = [
  // [harness, filePath, expectedIsSession, description]
  // ── Cline ──
  ['Cline', 'C:/Users/u/.cline/sessions/abc123.json', true, 'cline session json'],
  ['Cline', 'C:/Users/u/.cline/sessions/abc123.md', true, 'cline session md'],
  ['Cline', 'C:/Users/u/.cline/sessions/abc123.jsonl', true, 'cline session jsonl'],
  ['Cline', 'C:/Users/u/.cline/sessions/abc123.txt', true, 'cline session txt'],
  ['Cline', 'C:/Users/u/.cline/sessions/abc123.messages.json', false, 'cline companion messages file'],
  ['Cline', 'C:/Users/u/.cline/settings.json', false, 'cline settings config'],
  ['Cline', 'C:/Users/u/.cline/config.json', false, 'cline config'],
  ['Cline', 'C:/Users/u/.cline/sessions/README.md', true, 'cline md in sessions dir (edge, accepted)'],
  ['Cline', 'C:/Users/u/other/sessions/abc.json', false, 'json in sessions dir but not under .cline'],
  // ── Codex ──
  ['Codex', 'C:/Users/u/.codex/goals_1.sqlite', false, 'codex goals db (system table, not session)'],
  ['Codex', 'C:/Users/u/.codex/logs_2.sqlite', false, 'codex logs db (system table, not session)'],
  ['Codex', 'C:/Users/u/.codex/queue_1.sqlite', false, 'codex queue db (system table, not session)'],
  ['Codex', 'C:/Users/u/.codex/memories_1.sqlite', false, 'codex memories db (system table, not session)'],
  ['Codex', 'C:/Users/u/.codex/state_5.sqlite', false, 'codex state db (system table, not session)'],
  ['Codex', 'C:/Users/u/.codex/models_cache.json', false, 'codex models cache'],
  ['Codex', 'C:/Users/u/.codex/auth.json', false, 'codex auth'],
  ['Codex', 'C:/Users/u/.codex/config.toml', false, 'codex config'],
  ['Codex', 'C:/Users/u/.codex/goals.sqlite', false, 'codex goals without number'],
  // ── GitHub Copilot ──
  ['GitHub Copilot', 'C:/Users/u/.copilot/data.db', true, 'copilot data.db at root'],
  ['GitHub Copilot', 'C:/Users/u/.copilot/session-store.db', true, 'copilot session-store.db at root'],
  ['GitHub Copilot', 'C:/Users/u/.copilot/session-state/uuid123/session.db', true, 'copilot session.db in session-state'],
  ['GitHub Copilot', 'C:/Users/u/.copilot/chats/data.db', false, 'copilot data.db inside chats (excluded)'],
  ['GitHub Copilot', 'C:/Users/u/.copilot/platform-cache.db', false, 'copilot platform cache db'],
  ['GitHub Copilot', 'C:/Users/u/.copilot/repo-metadata-cache.db', false, 'copilot repo metadata cache db'],
  ['GitHub Copilot', 'C:/Users/u/.copilot/data.db.bak', false, 'copilot data.db.bak (not exact match)'],
  // ── Cursor ──
  ['Cursor', 'C:/Users/u/.cursor/projects/wkspc/agent-transcripts/uuid/uuid.jsonl', true, 'cursor agent-transcript jsonl'],
  ['Cursor', 'C:/Users/u/.cursor/agents/coder.md', false, 'cursor agent definition md (not session)'],
  ['Cursor', 'C:/Users/u/.cursor/telemetry.jsonl', false, 'cursor telemetry jsonl not in agent-transcripts'],
  // ── Pi ──
  ['Pi', 'C:/Users/u/.pi/agent/sessions/ws1/20240101_abc.jsonl', true, 'pi session jsonl'],
  ['Pi', 'C:/Users/u/.pi/agent/sessions/ws1/20240101_abc.ndjson', true, 'pi session ndjson'],
  ['Pi', 'C:/Users/u/.pi/auth.json', false, 'pi auth'],
  ['Pi', 'C:/Users/u/.pi/models-store.json', false, 'pi models store'],
  ['Pi', 'C:/Users/u/.pi/agent/config.json', false, 'pi agent config json not in sessions'],
  // ── T3 Code ──
  ['T3 Code', 'C:/Users/u/.t3/userdata/statev2.sqlite', true, 't3 statev2 sqlite'],
  ['T3 Code', 'C:/Users/u/.t3/userdata/statev2.1.sqlite', true, 't3 statev2.1 sqlite'],
  ['T3 Code', 'C:/Users/u/.t3/agent-device/sessions/sess1/events.ndjson', true, 't3 events.ndjson'],
  ['T3 Code', 'C:/Users/u/.t3/events.ndjson', false, 't3 events.ndjson not in agent-device/sessions'],
  ['T3 Code', 'C:/Users/u/.t3/userdata/other.sqlite', false, 't3 non-statev2 sqlite'],
  // ── Claude Code ──
  ['Claude Code', 'C:/Users/u/.claude/projects/ws1/session1.jsonl', true, 'claude project session'],
  ['Claude Code', 'C:/Users/u/.claude/settings.json', false, 'claude settings json'],
  ['Claude Code', 'C:/Users/u/other/projects/ws1/session.jsonl', false, 'not under .claude'],
  // ── OpenCode / Crush ──
  ['OpenCode', 'C:/Users/u/.opencode/conversations.db', true, 'opencode conversations sqlite'],
  ['OpenCode', 'C:/Users/u/.opencode/cache.db', false, 'opencode cache db (non-session name)'],
  ['OpenCode', 'C:/Users/u/.opencode/config.db', false, 'opencode config db (non-session name)'],
  ['OpenCode', 'C:/Users/u/.opencode/sessions/sess1.jsonl', true, 'opencode session jsonl'],
  ['OpenCode', 'C:/Users/u/.opencode/native-item.jsonl', false, 'opencode native-item not in sessions'],
  ['OpenCode / Crush', 'C:/Users/u/.crush/conversations.db', true, 'crush conversations sqlite'],
  // ── Windsurf ──
  ['Windsurf', 'C:/Users/u/.windsurf/session.json', true, 'windsurf session json'],
  ['Windsurf', 'C:/Users/u/.windsurf/config.json', true, 'windsurf any json under dir (edge)'],
  ['Windsurf', 'C:/Users/u/other/session.json', false, 'not under .windsurf'],
  // ── Continue ──
  ['Continue', 'C:/Users/u/.continue/history.jsonl', true, 'continue history jsonl'],
  ['Continue', 'C:/Users/u/.continue/config.json', true, 'continue config json (edge)'],
  ['Continue', 'C:/Users/u/other/history.jsonl', false, 'not under .continue'],
  // ── Zed ──
  ['Zed', 'C:/Users/u/.zed/session.json', true, 'zed session json'],
  ['Zed', 'C:/Users/u/.zed/config.json', true, 'zed any json under dir (edge)'],
  ['Zed', 'C:/Users/u/other/session.json', false, 'not under .zed'],
  // ── Roo ──
  ['Roo', 'C:/Users/u/.roo/session.jsonl', true, 'roo session jsonl'],
  ['Roo', 'C:/Users/u/other/session.jsonl', false, 'not under .roo'],
  // ── Aider ──
  ['Aider', 'C:/Users/u/.aider/chat.json', true, 'aider chat json'],
  ['Aider', 'C:/Users/u/.aider/session.md', true, 'aider session md'],
  ['Aider', 'C:/Users/u/other/chat.json', false, 'not under .aider'],
  // ── Gemini CLI ──
  ['Gemini CLI', 'C:/Users/u/.gemini/session.jsonl', true, 'gemini session jsonl'],
  ['Gemini CLI', 'C:/Users/u/.gemini/history.json', true, 'gemini history json'],
  ['Gemini CLI', 'C:/Users/u/other/session.jsonl', false, 'not under .gemini'],
  // ── Unknown ──
  ['Unknown', 'C:/Users/u/random/file.txt', false, 'unknown harness discovers nothing'],
]

let passed = 0
let failed = 0

for (const [harness, filePath, expected, desc] of cases) {
  const validator = getSessionValidator(harness)
  const result = validator(filePath)
  const ok = result === expected
  if (ok) { passed++; console.log(`  PASS: ${desc}`) }
  else { failed++; console.log(`  FAIL: ${desc} — harness=${harness} path=${filePath} expected=${expected} got=${result}`) }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
