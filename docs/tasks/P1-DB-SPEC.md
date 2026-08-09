# Task: P1-DB — SQLite Database Schema

**Phase**: Phase 1 - Foundation + Plaid Integration  
**Difficulty**: Medium  
**Estimated Time**: 2-3 hours  
**Owner**: [To be assigned]

---

## Overview

Design and implement the SQLite database schema for the Personal Finance OS. This is the foundation for all backend operations; subsequent tasks depend on this schema.

## Deliverables

1. **`backend/db/schema.sql`** — Complete SQLite schema with all tables, indexes, and constraints
2. **`backend/db/migrations/` directory** — Migration scripts (optional but recommended for Phase 1+)
3. **`backend/db/seed-sample.sql`** — Sample data for testing (3 accounts, 2 debts, 10 transactions)

## Schema Requirements

### Tables to Create

#### 1. `accounts`
Store linked bank/credit accounts (checking, savings, credit cards, loans, etc.)

```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,                    -- Unique identifier
  account_name TEXT NOT NULL,             -- User-friendly name (e.g., "Chase Checking")
  account_type TEXT NOT NULL,             -- 'checking', 'savings', 'credit_card', 'loan', 'mortgage'
  balance REAL NOT NULL,                  -- Current balance
  interest_rate REAL,                     -- APR (NULL for non-debt accounts)
  min_payment REAL,                       -- Monthly minimum (for credit cards/loans)
  last_sync DATETIME,                     -- Last time Plaid synced this account
  plaid_account_id TEXT UNIQUE,           -- Plaid's account ID (for linking later)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_accounts_type ON accounts(account_type);
```

#### 2. `debts`
Track debt details (separate from accounts for clarity and analysis)

```sql
CREATE TABLE debts (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  debt_name TEXT NOT NULL,                -- User-friendly name
  balance REAL NOT NULL,                  -- Outstanding balance
  interest_rate REAL NOT NULL,            -- APR (e.g., 21.5)
  min_payment REAL NOT NULL,              -- Minimum monthly payment
  term_months INTEGER,                    -- Expected payoff timeline (0 = open-ended)
  original_balance REAL,                  -- For tracking progress
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_debts_account ON debts(account_id);
CREATE INDEX idx_debts_rate ON debts(interest_rate);
```

#### 3. `transactions`
Record of all account transactions (populated from Plaid)

```sql
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date DATE NOT NULL,                     -- Transaction date
  amount REAL NOT NULL,                   -- Negative = expense, positive = credit/income
  merchant TEXT,                          -- Where the transaction happened
  category TEXT,                          -- 'groceries', 'utilities', 'entertainment', etc.
  plaid_transaction_id TEXT UNIQUE,       -- Plaid's transaction ID (for idempotency)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_account ON transactions(account_id);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_category ON transactions(category);
```

#### 4. `recommendations`
Store Claude's debt payoff recommendations (one per analysis run)

```sql
CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  analysis_type TEXT DEFAULT 'debt_payoff',  -- Future: 'budget', 'savings'
  strategy_json TEXT NOT NULL,                -- Full Claude response as JSON
  total_savings_projected REAL,               -- Interest saved vs baseline
  payoff_months INTEGER,                      -- Timeline to debt-free
  confidence_score REAL,                      -- 0-1 (how confident in this plan)
  UNIQUE(created_at)                          -- One recommendation per timestamp
);

CREATE INDEX idx_recommendations_type ON recommendations(analysis_type);
```

#### 5. `payment_logs`
Track actual payments user made (for feedback loop with Claude)

```sql
CREATE TABLE payment_logs (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount REAL NOT NULL,                   -- Amount paid
  date DATE NOT NULL,                     -- Payment date
  notes TEXT,                             -- Optional: user notes
  logged_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payment_logs_debt ON payment_logs(debt_id);
CREATE INDEX idx_payment_logs_date ON payment_logs(date);
```

## Acceptance Criteria

- [ ] All 5 tables created with correct column types and constraints
- [ ] All indexes created (listed above)
- [ ] Foreign key constraints enforced (SQLite PRAGMA foreign_keys = ON)
- [ ] Schema file syntax validated: `sqlite3 < schema.sql` runs without errors
- [ ] Can drop and recreate tables from schema without errors
- [ ] Sample seed data script creates test data successfully
- [ ] No hardcoded secrets or sensitive data in schema file

## Testing

Run these commands to verify:

```bash
# 1. Validate syntax
sqlite3 test.db < backend/db/schema.sql

# 2. Check tables exist
sqlite3 test.db ".tables"

# 3. Check indexes
sqlite3 test.db ".indices"

# 4. Seed sample data
sqlite3 test.db < backend/db/seed-sample.sql

# 5. Query sample data
sqlite3 test.db "SELECT COUNT(*) FROM accounts;"
sqlite3 test.db "SELECT COUNT(*) FROM transactions;"

# 6. Clean up
rm test.db
```

## Notes for Agent

- Keep the schema simple and denormalized where it helps queries (e.g., `balance` in `accounts` rather than calculating from transactions)
- Foreign key constraints are optional in SQLite; enable with `PRAGMA foreign_keys = ON` in code
- `id` fields should use TEXT primary keys (UUIDs or short strings like `acc_123`)
- Timestamps use `DATETIME` type; store in UTC
- No passwords, API keys, or secrets in schema
- Consider future needs (Phase 2+) but don't over-engineer

## Spec Details

See [ARCHITECTURE.md](../ARCHITECTURE.md) section "Database Schema" for full details and entity relationships.

## Input

- None (greenfield database design)

## Output

Three files:
1. `backend/db/schema.sql` — The schema
2. `backend/db/seed-sample.sql` — Sample data
3. Brief comment in PR explaining any non-obvious design choices

## How to Submit

1. Create a branch: `git checkout -b P1-DB`
2. Write the schema files
3. Test locally with the commands above
4. Commit: `git add backend/db/ && git commit -m "P1-DB: SQLite schema with 5 tables and indexes"`
5. Push and create a PR to `main`
6. Reference this task in PR description

---

**Questions?** Check [ARCHITECTURE.md](../ARCHITECTURE.md) or ask in the PR comments.
