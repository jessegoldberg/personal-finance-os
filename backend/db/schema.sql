CREATE TABLE IF NOT EXISTS items (
  item_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  products TEXT,
  tx_cursor TEXT,
  status TEXT DEFAULT 'ok',
  error TEXT,
  last_synced_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  official_name TEXT,
  mask TEXT,
  type TEXT,
  subtype TEXT,
  current_balance REAL,
  available_balance REAL,
  credit_limit REAL,
  hidden INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  name TEXT,
  merchant_name TEXT,
  category TEXT,
  detailed_category TEXT,
  pending INTEGER DEFAULT 0,
  logo_url TEXT,
  payment_channel TEXT
);

CREATE TABLE IF NOT EXISTS recurring_streams (
  stream_id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL REFERENCES items(item_id) ON DELETE CASCADE,
  account_id TEXT,
  direction TEXT NOT NULL,
  description TEXT,
  merchant_name TEXT,
  category TEXT,
  frequency TEXT,
  average_amount REAL,
  last_amount REAL,
  last_date TEXT,
  predicted_next_date TEXT,
  is_active INTEGER,
  status TEXT
);

CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  account_id TEXT UNIQUE REFERENCES accounts(account_id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  name TEXT NOT NULL,
  kind TEXT DEFAULT 'credit',
  balance REAL NOT NULL DEFAULT 0,
  apr REAL,
  min_payment REAL,
  next_due_date TEXT,
  statement_balance REAL,
  credit_limit REAL,
  is_overdue INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS income_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'salary',
  monthly_amount REAL NOT NULL DEFAULT 0,
  taxes_withheld INTEGER DEFAULT 1,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS budgets (
  category TEXT PRIMARY KEY,
  monthly_limit REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ai_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  report TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_tx_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_accounts_item ON accounts(item_id);
