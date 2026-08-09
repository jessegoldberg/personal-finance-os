# Personal Finance OS — Architecture & Project Plan

This document contains the complete project plan, tech decisions, and task breakdown. See the main [README.md](../README.md) for quick start.

## Project Vision

Build a secure, visually-driven personal finance dashboard that uses Claude AI to generate optimal debt payoff strategies. The system consolidates all financial accounts, transactions, debts, and savings into one place and recommends specific payment actions ranked by payoff impact.

### Goals

1. **Debt elimination**: Provide Claude-powered recommendations on what to pay, when, and by how much to escape debt fastest
2. **Security**: All real financial data stays local; Claude analysis happens server-side, never exposed to UI
3. **Visibility**: One visual dashboard showing net worth, debt payoff timeline, monthly budget vs actual
4. **Validation, not automation**: Recommend payments but never move money; user executes and logs outcomes

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (React + TypeScript + Tailwind)                    │
│ - Dashboard: net worth, debts, savings, monthly spending   │
│ - Plaid Link integration                                    │
│ - Recommendations widget                                   │
│ - Payment logging form                                     │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS/JSON API
                      │ (CloudFront ZTNA proxies)
                      ↓
┌─────────────────────────────────────────────────────────────┐
│ Backend (Node.js + Express + TypeScript)                   │
│ - Routes: /api/accounts, /debts, /transactions, /analyze  │
│ - Services: Claude analysis, Plaid sync, DB operations    │
│ - Authentication: Trusts CloudFront headers               │
└─────────────────────┬───────────────────────────────────────┘
                      │
        ┌─────────────┼─────────────┐
        ↓             ↓             ↓
    ┌────────┐   ┌──────────┐  ┌──────────┐
    │ SQLite │   │  Claude  │  │  Plaid   │
    │   DB   │   │   API    │  │   API    │
    └────────┘   └──────────┘  └──────────┘
```

### Tech Stack (Decisions Made)

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Frontend Framework** | React + TypeScript + Vite | Modern, state management, component reusability |
| **Styling** | Tailwind CSS | Utility-first, responsive, low friction |
| **Backend** | Node.js + Express + TypeScript | Lightweight, good for small teams, easy to containerize |
| **Database** | SQLite | File-based, no server ops, easy backup, perfect for single-user apps |
| **AI** | Claude Opus 5 API | Best reasoning for financial optimization; strong at multi-factor analysis |
| **Plaid** | Direct API integration | Simplified; no n8n needed for this phase |
| **Deployment** | Docker on private server | Your ZTNA + CloudFront handles auth; backend simple & stateless |
| **VCS** | Git + GitHub | Standard workflow, issue tracking, PR reviews |

---

## Project Phases

### Phase 1: Foundation + Plaid Integration (Weeks 1-3)

**Goal**: Build core data model, UI, and wire Plaid sandbox for realistic testing.

**Deliverables**:
- Git repo with Docker setup
- SQLite schema: Accounts, Debts, Transactions, Recommendations, PaymentLogs
- Node.js + Express backend with routes
- React frontend with dashboard layout + Plaid Link
- Plaid sandbox connected: can link test accounts, see transactions
- Manual debt input forms

**Tasks** (each isolated for agent delegation):

1. **P1-DB**: Design & implement SQLite schema + migrations
   - Input: None (greenfield)
   - Output: `backend/db/schema.sql` + migration scripts
   - Acceptance: Schema passes linting; can create/drop tables without errors
   
2. **P1-BACKEND**: Build Express server, routes, Plaid client setup
   - Input: Schema from P1-DB
   - Output: `backend/server.ts`, `backend/routes/`, Plaid client initialization
   - Endpoints: GET /api/accounts, GET /api/transactions, GET/POST /api/debts
   - Acceptance: Can call `/api/accounts` and get empty array; Plaid Link token endpoint works
   
3. **P1-FRONTEND**: React app scaffold, Plaid Link widget, dashboard layout
   - Input: Backend routes from P1-BACKEND
   - Output: `frontend/src/`, Plaid Link component, dashboard mockup
   - Acceptance: Dashboard renders; Plaid Link button works (links to test backend)
   
4. **P1-DOCKER**: Dockerfile, docker-compose for local dev + deployment
   - Input: Completed backend + frontend
   - Output: `Dockerfile`, `docker-compose.yml`
   - Acceptance: `docker-compose up` starts both services; both accessible

**Success Metrics** (end of Phase 1):
- [ ] Docker container builds and runs locally
- [ ] SQLite DB can be seeded with test data
- [ ] Backend serves GET /api/accounts (returns sample data)
- [ ] React dashboard renders without errors
- [ ] Plaid Link component visible on frontend

---

### Phase 2: Claude Integration (Weeks 3-4)

**Goal**: Wire Claude to analyze debt and generate payoff strategies.

**Deliverables**:
- Claude analysis engine: takes account/debt/transaction data, returns optimized payoff plan
- Backend endpoint: `/api/analyze` → processes through Claude Opus
- Recommendation storage: saves Claude's output to DB
- Dashboard widget: displays payoff strategy + monthly action items

**Tasks**:

1. **P2-CLAUDE**: Write prompt engineering for hybrid debt analysis
   - Input: Sample portfolio data (3 debts, 2 accounts, spending patterns)
   - Output: `docs/CLAUDE_PROMPT.md` + tested prompt
   - Spec: Prompt should consider:
     - Interest rates & balance (minimize interest paid)
     - Minimum payments (ensure no missed payments)
     - User's actual spending (maintain lifestyle)
     - Psychological factors (may recommend early "wins" even if suboptimal)
   - Return format: JSON with recommended payment plan, timeline, savings projection
   - Acceptance: Prompt produces valid JSON; costs < $1/run
   
2. **P2-BACKEND**: Add `/api/analyze` endpoint + Anthropic SDK
   - Input: Existing backend from Phase 1
   - Output: `/api/analyze` POST endpoint; integration with Anthropic API
   - Acceptance: Endpoint calls Claude, saves response to DB, returns recommendation
   
3. **P2-FRONTEND**: Build recommendation widget + charts
   - Input: `/api/analyze` endpoint from P2-BACKEND
   - Output: React component displaying payoff strategy, timeline, charts
   - Acceptance: Widget displays Claude's recommendations; has "Refresh Analysis" button

**Success Metrics** (end of Phase 2):
- [ ] Claude analysis endpoint works with 2-3 test portfolios
- [ ] Costs < $5 total for all testing
- [ ] Dashboard displays recommended payoff strategy
- [ ] Can manually edit debts; Claude re-analyzes

---

### Phase 3: Payment Validation & Logging (Weeks 4-5)

**Goal**: Track which recommendations user followed; feedback loop for Claude.

**Deliverables**:
- Payment log: user enters "I paid $X to debt Y on date Z"
- Outcome tracking: did the recommendation succeed? How much interest saved?
- Claude learns: future recommendations factor in user's actual behavior
- Dashboard shows progress: "vs plan" comparison

**Tasks**:
- **P3-BACKEND**: Payment log storage + `/api/log-payment` endpoint
- **P3-FRONTEND**: Payment entry form + progress tracking UI
- **P3-CLAUDE**: Update analysis prompt to include historical follow-through

**Success Metrics**:
- [ ] Can log payments manually
- [ ] Dashboard shows progress vs Claude's plan
- [ ] Claude's v2 analysis mentions historical behavior

---

### Phase 4: Mobile + Polish (Weeks 5-6)

**Goal**: Responsive design, edge cases, security hardening.

**Deliverables**:
- Mobile-friendly React dashboard
- Dark mode (Tailwind CSS)
- Export/backup (SQLite dump, PDF reports)
- Error handling & validation
- Security review (no plaintext storage, secrets in env vars)

---

### Phase 5: Production Plaid + Launch (Weeks 6-8)

**Goal**: Switch to Plaid production; deploy to your server.

**Deliverables**:
- Plaid production credentials (your real accounts)
- Multi-account support (checking, savings, credit cards, loans, mortgage)
- Balance snapshots + net worth tracking
- Docker container deployed on private server behind CloudFront ZTNA
- Monitoring + backup strategy

---

## Task Delegation Strategy

Each task is designed for a single agent to own end-to-end with minimal context:

### Principles

1. **Isolated tasks**: Each task has clear input, output, acceptance criteria
2. **Small context**: Agent reads 1 spec file (< 500 words) + existing code to modify
3. **No project history**: Agent doesn't need to know earlier phases
4. **Standard structure**: PR review, merge, update status; then next task starts

### Example Handoff

```
Task: P1-DB - SQLite Schema

Input: None (greenfield database design)

Output: File schema.sql with:
- Table: accounts (id, account_name, account_type, balance, last_sync)
- Table: debts (id, debt_name, balance, interest_rate, min_payment, term_months)
- Table: transactions (id, account_id, date, amount, merchant, category)
- Table: recommendations (id, created_at, strategy_json, total_savings_projected)
- Table: payment_logs (id, debt_id, amount, date, logged_at)

Acceptance Criteria:
- Schema passes sqlite3 syntax check
- All tables have primary keys + foreign key constraints
- Indexes on frequently queried columns (account_id, debt_id, date)
- Can drop all tables and re-create from schema without errors

Spec Details: [Link to database spec doc]

---

Agent Task:
1. Read the spec
2. Write schema.sql
3. Test with sqlite3 < schema.sql
4. Submit PR to branch `P1-DB`
5. Main dev reviews + merges
```

### How Reviews Work

- **Main dev** (you) reviews PRs
- Look for: correctness, adherence to spec, no secrets in code
- Request changes or approve + merge
- Update project status in README

---

## Database Schema

### Tables

#### `accounts`
```sql
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL, -- 'checking', 'savings', 'credit_card', 'loan', 'mortgage'
  balance REAL NOT NULL,
  interest_rate REAL,           -- NULL for non-debt accounts
  min_payment REAL,             -- Monthly minimum (for credit cards / loans)
  last_sync DATETIME,
  plaid_account_id TEXT,        -- Maps to Plaid account ID (if linked)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `debts`
```sql
CREATE TABLE debts (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id),
  debt_name TEXT NOT NULL,
  balance REAL NOT NULL,
  interest_rate REAL NOT NULL,
  min_payment REAL NOT NULL,
  term_months INTEGER,          -- Expected payoff in months (0 = open-ended)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

#### `transactions`
```sql
CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id),
  date DATE NOT NULL,
  amount REAL NOT NULL,         -- Negative = expense, positive = credit
  merchant TEXT,
  category TEXT,                -- 'groceries', 'utilities', 'entertainment', etc.
  plaid_transaction_id TEXT UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_transactions_account ON transactions(account_id);
```

#### `recommendations`
```sql
CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  analysis_type TEXT DEFAULT 'debt_payoff', -- Future: 'budget', 'savings', etc.
  strategy_json TEXT NOT NULL,              -- Full Claude output (JSON)
  total_savings_projected REAL,             -- Interest saved vs baseline
  payoff_months INTEGER,                    -- Months to debt-free
  UNIQUE(created_at)
);
```

#### `payment_logs`
```sql
CREATE TABLE payment_logs (
  id TEXT PRIMARY KEY,
  debt_id TEXT REFERENCES debts(id),
  amount REAL NOT NULL,
  date DATE NOT NULL,
  logged_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payments_debt ON payment_logs(debt_id);
CREATE INDEX idx_payments_date ON payment_logs(date);
```

---

## API Specification

### Base URL
`/api`

### Authentication
All requests include a header set by CloudFront ZTNA; backend trusts reverse proxy.

### Endpoints

#### `GET /api/accounts`
List all linked accounts + current balances.

Response:
```json
{
  "accounts": [
    {
      "id": "acc_123",
      "name": "Chase Checking",
      "type": "checking",
      "balance": 5000,
      "lastSync": "2024-01-15T10:30:00Z"
    },
    {
      "id": "cc_456",
      "name": "Chase Sapphire",
      "type": "credit_card",
      "balance": 3200,
      "interestRate": 21.5,
      "minPayment": 100
    }
  ]
}
```

#### `GET /api/transactions?account_id=X&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`
List transactions.

Response:
```json
{
  "transactions": [
    {
      "id": "txn_1",
      "date": "2024-01-14",
      "amount": -52.30,
      "merchant": "Whole Foods",
      "category": "groceries"
    }
  ]
}
```

#### `GET /api/debts` / `POST /api/debts` / `PUT /api/debts/:id`
Manage debts.

POST body:
```json
{
  "debtName": "Chase Sapphire",
  "balance": 3200,
  "interestRate": 21.5,
  "minPayment": 100,
  "termMonths": 24
}
```

#### `POST /api/analyze`
Get Claude's debt payoff recommendation.

Request:
```json
{
  "recalculate": true
}
```

Response:
```json
{
  "recommendationId": "rec_789",
  "strategy": {
    "payoffPlan": [
      {
        "month": 1,
        "payments": [
          { "debtId": "cc_456", "amount": 500, "reason": "highest APR" },
          { "debtId": "loan_789", "amount": 300 }
        ]
      }
    ],
    "timeline": "18 months to debt-free",
    "totalSavings": 5200,
    "observations": [...]
  }
}
```

#### `POST /api/log-payment`
Log a payment you made.

Request:
```json
{
  "debtId": "cc_456",
  "amount": 500,
  "date": "2024-01-15"
}
```

Response:
```json
{
  "paymentId": "pmt_123",
  "message": "Payment logged. Remaining balance: $2700"
}
```

#### `POST /api/plaid/link-token`
Get Plaid Link token to start account linking.

Response:
```json
{
  "linkToken": "link-sandbox-...",
  "expiration": "2024-01-16T10:30:00Z"
}
```

---

## Security Model

### Data Flow

1. **Frontend → Backend**: HTTPS via CloudFront ZTNA
2. **Backend → Claude**: HTTPS to Anthropic API (encrypted, no logging)
3. **Backend → Plaid**: HTTPS to Plaid API (encrypted, no logging)
4. **Backend → Database**: SQLite file on disk (encrypted at rest via server OS)

### Secrets Management

- **Plaid Client ID/Secret**: Environment variables (`PLAID_CLIENT_ID`, `PLAID_SECRET`)
- **Anthropic API Key**: Environment variable (`ANTHROPIC_API_KEY`)
- **Database encryption**: Handled by host OS (full-disk encryption recommended)

### No Money Movement

- Backend has NO capability to move funds
- Claude analysis is recommendation only
- User manually executes payments
- System logs payments after the fact (audit trail)

---

## Development Workflow

1. **Pick a task**: Look at GitHub issues labeled `P{N}-{name}`
2. **Create branch**: `git checkout -b P1-DB`
3. **Do the work**: Follow the spec in the issue
4. **Test locally**: `docker-compose up` to verify
5. **Submit PR**: Link to the issue; describe what you did
6. **Main dev reviews**: Checks correctness, accepts or requests changes
7. **Merge**: Branch deleted; status updated in README

---

## Deployment

### Local Development

```bash
docker-compose -f docker-compose.yml up
```

Backend: http://localhost:3000
Frontend: http://localhost:5173

### Production (Your Server)

```bash
docker build -t personal-finance-os:latest .
# Push to your registry
docker run -e PLAID_CLIENT_ID=... -e PLAID_SECRET=... -e ANTHROPIC_API_KEY=... \
  --name pfo --restart always personal-finance-os:latest
```

Then expose via CloudFront ZTNA (your responsibility).

---

## Cost Estimation

| Service | Usage | Cost/Month |
|---------|-------|-----------|
| Claude API | 1-2 analyses/week (Opus) | $5-10 |
| Plaid | Sandbox (free) / Prod (per account) | $0 / $25-50 |
| Server hosting | Your existing infra | ~$50 |
| **Total** | | ~$60-110 |

---

## Success Metrics (End of Phase 2)

- [ ] Docker container builds and runs locally
- [ ] SQLite DB can be populated with Plaid test data
- [ ] React dashboard displays net worth, debts, spending
- [ ] Plaid Link integration works (can link sandbox accounts)
- [ ] Claude analysis works (tested with 2-3 portfolios, < $5 cost)
- [ ] Dashboard displays recommended payoff strategy

---

## Next Steps

1. Initialize git repo ✅
2. Write README + ARCHITECTURE ✅
3. Create GitHub issues for Phase 1 tasks
4. Delegate P1-DB task to first agent
5. Review PR, merge, move to P1-BACKEND
6. Continue through Phase 1

See [README.md](../README.md) for quick start.
