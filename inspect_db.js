const initSqlJs = require('sql.js')
const { wrapDb } = require('./packages/core/db-compat')
const fs = require('fs')
const path = require('path')

async function main() {
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  })
  const dbPath = 'K:\\Users\\luizy\\.copilot\\data.db'
  const buffer = fs.readFileSync(dbPath)
  const db = wrapDb(new SQL.Database(buffer))
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  console.log('Tables:', tables);
  for (const t of tables) {
    const count = db.prepare('SELECT COUNT(*) as c FROM ' + t).get().c;
    console.log(t + ': ' + count + ' rows');
    const cols = db.prepare('PRAGMA table_info(' + t + ')').all().map(c => c.name);
    console.log('  columns:', cols.join(', '));
    const row = db.prepare('SELECT * FROM ' + t + ' LIMIT 3').all();
    for (const r of row) {
      for (const k of Object.keys(r)) {
        const v = r[k];
        const s = String(v).substring(0, 150);
        console.log('  ' + k + ':', s.replace(/\n/g, '\\n'));
      }
      console.log('  ---');
    }
  }
  db.close();
}

main().catch(e => console.error(e));
