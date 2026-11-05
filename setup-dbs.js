const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function makeDb(dbPath) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.exec('DROP TABLE IF EXISTS sessions');
  db.exec('CREATE TABLE sessions (id INTEGER PRIMARY KEY, session_id TEXT, title TEXT, content TEXT, created_at TEXT)');
  const stmt = db.prepare('INSERT INTO sessions (session_id, title, content, created_at) VALUES (?, ?, ?, ?)');
  stmt.run('copilot-001', 'Copilot Chat Session', 'Discussed the locate app architecture and MCP server design. The locate app is a searchable interface for archived coding sessions across all AI agent harnesses.', '2026-11-05T06:00:00Z');
  stmt.run('copilot-002', 'MCP Server Setup', 'Configured the MCP server with stdio transport and JSON-RPC 2.0 protocol. Tools include locate_search and locate_read_session.', '2026-11-05T06:05:00Z');
  db.close();
  console.log('Created', dbPath);
}

makeDb('K:\\Users\\luizy\\.copilot\\data.db');
makeDb('K:\\Users\\luizy\\.codex\\goals_1.sqlite');
makeDb('K:\\Users\\luizy\\.t3\\userdata\\statev2.sqlite');
console.log('All sqlite databases created.');
