import Database = require('better-sqlite3');
import path = require('path');
import fs = require('fs');

const dbPath = process.env.DATABASE_URL?.replace('sqlite:///', '') || path.join(__dirname, '../../data/database.sqlite');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// Initialize schema
const schemaPath = path.join(__dirname, '../db/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
db.exec(schema);

console.log(`📦 Database initialized at ${dbPath}`);

export const database: any = db;

export interface LinkedItem {
  id: string;
  item_id: string;
  access_token: string;
  institution_name: string | null;
}

export interface Account {
  id: string;
  item_id: string;
  account_id: string;
  name: string;
  type: string | null;
  subtype: string | null;
  current_balance: number;
  available_balance: number;
}

export const db_functions = {
  // Linked items
  saveLinkedItem: (item: LinkedItem) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO linked_items (id, item_id, access_token, institution_name)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(item.id, item.item_id, item.access_token, item.institution_name);
  },

  getLinkedItem: (itemId: string): LinkedItem | undefined => {
    const stmt = db.prepare('SELECT * FROM linked_items WHERE item_id = ?');
    return stmt.get(itemId) as LinkedItem | undefined;
  },

  getAllLinkedItems: (): LinkedItem[] => {
    const stmt = db.prepare('SELECT * FROM linked_items ORDER BY linked_at DESC');
    return stmt.all() as LinkedItem[];
  },

  // Accounts
  saveAccounts: (accounts: Account[]) => {
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO accounts
      (id, item_id, account_id, name, type, subtype, current_balance, available_balance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((accs: Account[]) => {
      for (const acc of accs) {
        stmt.run(
          acc.id,
          acc.item_id,
          acc.account_id,
          acc.name,
          acc.type,
          acc.subtype,
          acc.current_balance,
          acc.available_balance
        );
      }
    });

    insertMany(accounts);
  },

  getAccountsByItem: (itemId: string): Account[] => {
    const stmt = db.prepare('SELECT * FROM accounts WHERE item_id = ? ORDER BY name');
    return stmt.all(itemId) as Account[];
  },

  getAllAccounts: (): Account[] => {
    const stmt = db.prepare('SELECT * FROM accounts ORDER BY name');
    return stmt.all() as Account[];
  },
};
