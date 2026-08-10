-- Linked Plaid items (banks/institutions)
CREATE TABLE IF NOT EXISTS linked_items (
  id TEXT PRIMARY KEY,
  item_id TEXT UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  institution_name TEXT,
  linked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bank accounts linked via Plaid
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  subtype TEXT,
  current_balance REAL,
  available_balance REAL,
  last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES linked_items(item_id),
  UNIQUE(item_id, account_id)
);

-- Transactions (to be synced from Plaid)
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  amount REAL NOT NULL,
  date DATE NOT NULL,
  merchant_name TEXT,
  category TEXT,
  pending BOOLEAN DEFAULT 0,
  synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id),
  FOREIGN KEY (item_id) REFERENCES linked_items(item_id)
);

-- Debts (manual entry or from Plaid liabilities)
CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  balance REAL NOT NULL,
  interest_rate REAL,
  min_payment REAL,
  due_date TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Claude analysis recommendations
CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY,
  analysis_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  recommendation_text TEXT NOT NULL,
  priority INTEGER,
  monthly_action TEXT
);

-- Payment log (track user actions)
CREATE TABLE IF NOT EXISTS payment_logs (
  id TEXT PRIMARY KEY,
  debt_id TEXT,
  amount REAL NOT NULL,
  date DATE NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (debt_id) REFERENCES debts(id)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_accounts_item_id ON accounts(item_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
