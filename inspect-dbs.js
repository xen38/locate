const Database = require('better-sqlite3');
const fs = require('fs');
for (const f of ['K:\\Users\\luizy\\.copilot\\data.db', 'K:\\Users\\luizy\\.codex\\goals_1.sqlite', 'K:\\Users\\luizy\\.t3\\userdata\\statev2.sqlite']) {
  console.log('===== ' + f + ' =====');
  const db = new Database(f, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  console.log('tables:', tables);
  for (const t of tables) {
    const cols = db.prepare('PRAGMA table_info(' + t + ')').all().map(c => c.name);
    console.log('  table ' + t + ' cols:', cols);
    try {
      const rows = db.prepare('SELECT * FROM ' + t + ' LIMIT 2').all();
      console.log('  rows:', JSON.stringify(rows).slice(0, 800));
    } catch (e) { console.log('  err:', e.message); }
  }
  db.close();
}
