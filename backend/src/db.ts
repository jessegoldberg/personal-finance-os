import Database = require('better-sqlite3');
import path = require('path');
import fs = require('fs');

const dbPath = process.env.DATABASE_URL?.replace('sqlite:///', '') || path.join(__dirname, '../../data/database.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db: any = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA_VERSION = 2;
if (db.pragma('user_version', { simple: true }) < SCHEMA_VERSION) {
  // v1 tables had incompatible shapes and only held stale data
  for (const t of ['payment_logs', 'recommendations', 'income', 'debts', 'transactions', 'accounts', 'linked_items']) {
    db.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}
db.exec(fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf-8'));
// Columns added after first deploy; CREATE TABLE IF NOT EXISTS won't add them to existing tables.
function addColumn(table: string, column: string, type: string) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c: any) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
addColumn('properties', 'escrow_monthly', 'REAL');

// Container for accounts Plaid can't reach; their data comes from statement imports.
db.prepare("INSERT OR IGNORE INTO items (item_id, access_token, institution_name, products) VALUES ('manual', '', 'Manual & imported', 'manual')").run();

console.log(`📦 Database initialized at ${dbPath}`);

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
