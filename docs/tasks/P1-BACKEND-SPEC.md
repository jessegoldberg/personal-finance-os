# Task: P1-BACKEND — Express Backend + Plaid Integration

**Phase**: Phase 1 - Foundation + Plaid Integration  
**Difficulty**: Medium  
**Estimated Time**: 4-6 hours  
**Depends On**: P1-DB ✅  
**Owner**: [To be assigned]

---

## Overview

Build the Node.js + Express backend server with:
- SQLite database integration
- API routes for accounts, transactions, debts
- Plaid Link token generation (sandbox)
- Basic error handling and validation

## Deliverables

1. **`backend/server.ts`** — Express app initialization + middleware
2. **`backend/routes/accounts.ts`** — GET /api/accounts
3. **`backend/routes/transactions.ts`** — GET /api/transactions
4. **`backend/routes/debts.ts`** — GET/POST/PUT /api/debts
5. **`backend/routes/plaid.ts`** — POST /api/plaid/link-token
6. **`backend/services/db.ts`** — Database connection + helpers
7. **`backend/services/plaid.ts`** — Plaid API client initialization
8. **`backend/config.ts`** — Env vars + constants
9. **`backend/tsconfig.json`** — TypeScript configuration
10. **`backend/package.json`** — Dependencies

## Requirements

### Stack
- **Runtime**: Node.js 18+
- **Framework**: Express 4.x
- **Language**: TypeScript
- **Database**: Better-sqlite3 (sync SQLite driver)
- **Plaid Client**: `plaid` npm package (v30+)
- **Validation**: `zod` or similar (light validation)

### Endpoints to Implement

#### 1. `GET /api/accounts`
List all accounts with current balances.

Response (200):
```json
{
  "accounts": [
    {
      "id": "acc_123",
      "name": "Chase Checking",
      "type": "checking",
      "balance": 5000,
      "interestRate": null,
      "minPayment": null,
      "lastSync": "2024-01-15T10:30:00Z"
    },
    {
      "id": "cc_456",
      "name": "Chase Sapphire",
      "type": "credit_card",
      "balance": 3200,
      "interestRate": 21.5,
      "minPayment": 100,
      "lastSync": "2024-01-15T10:30:00Z"
    }
  ]
}
```

#### 2. `GET /api/transactions?account_id=acc_123&start_date=2024-01-01&end_date=2024-01-31`
List transactions for an account.

Response (200):
```json
{
  "transactions": [
    {
      "id": "txn_1",
      "accountId": "acc_123",
      "date": "2024-01-14",
      "amount": -52.30,
      "merchant": "Whole Foods",
      "category": "groceries"
    },
    {
      "id": "txn_2",
      "accountId": "acc_123",
      "date": "2024-01-10",
      "amount": -120,
      "merchant": "Utilities Co",
      "category": "utilities"
    }
  ],
  "total": 2
}
```

#### 3. `GET /api/debts`
List all debts.

Response (200):
```json
{
  "debts": [
    {
      "id": "debt_1",
      "accountId": "cc_456",
      "name": "Chase Sapphire",
      "balance": 3200,
      "interestRate": 21.5,
      "minPayment": 100,
      "termMonths": 24
    }
  ]
}
```

#### 4. `POST /api/debts`
Create a new debt.

Request body:
```json
{
  "accountId": "cc_456",
  "debtName": "Chase Sapphire",
  "balance": 3200,
  "interestRate": 21.5,
  "minPayment": 100,
  "termMonths": 24
}
```

Response (201):
```json
{
  "id": "debt_1",
  "message": "Debt created"
}
```

#### 5. `PUT /api/debts/:id`
Update a debt.

Request body: (same as POST, any field optional)
Response (200): Updated debt object

#### 6. `POST /api/plaid/link-token`
Get a Plaid Link token to start account linking.

Request: `{}` (no body needed)

Response (200):
```json
{
  "linkToken": "link-sandbox-abc123...",
  "expiration": "2024-01-16T10:30:00Z"
}
```

Error (400):
```json
{
  "error": "Plaid error",
  "details": "error message"
}
```

#### 7. `GET /health` (bonus)
Health check for Docker.

Response (200): `{ "status": "ok" }`

### Middleware & Setup

1. **CORS**: Allow requests from localhost:5173 (frontend)
2. **JSON body parser**: `express.json()`
3. **Error handling**: Catch 404s, return `{ error: "Not found" }`
4. **Database init**: Open SQLite connection on startup
5. **Plaid client**: Initialize with env vars (PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV)

### Validation

Use `zod` or similar for light input validation:
- Debt balance must be positive
- Interest rate must be 0-100
- Account ID must exist when creating debts

Return 400 with `{ error: "validation error", details: [...] }` on invalid input.

### Error Handling

All endpoints should handle errors gracefully:
- Missing required fields → 400 Bad Request
- Resource not found → 404 Not Found
- Database error → 500 Internal Server Error
- Plaid API error → 400 or 500 with Plaid error message

Response format: `{ error: "string", details?: "string" }`

## Acceptance Criteria

- [ ] Express server starts on PORT 3000
- [ ] GET /api/accounts returns list (empty on first run, populates with seed data)
- [ ] POST /api/debts creates a debt; debt persists across server restart
- [ ] GET /api/transactions filters by account_id and date range
- [ ] POST /api/plaid/link-token calls Plaid and returns valid link token
- [ ] All routes return proper HTTP status codes (200, 201, 400, 404, 500)
- [ ] All routes return JSON (never HTML)
- [ ] TypeScript compiles without errors
- [ ] Database connection closes gracefully on server shutdown

## Testing

```bash
cd backend

# Install deps
npm install

# Compile TypeScript
npm run build

# Run dev server
npm run dev:backend
# Should print: "Server running on http://localhost:3000"

# Test endpoints in another terminal
curl http://localhost:3000/api/accounts
curl -X POST http://localhost:3000/api/debts \
  -H "Content-Type: application/json" \
  -d '{"accountId": "acc_1", "debtName": "Test", "balance": 1000, "interestRate": 21, "minPayment": 50}'

curl http://localhost:3000/api/plaid/link-token
# Should return { "linkToken": "link-sandbox-...", ... }
```

## Dependencies to Add

In `backend/package.json`, add:

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "better-sqlite3": "^9.0.0",
    "plaid": "^30.0.0",
    "zod": "^3.22.0",
    "dotenv": "^16.0.3"
  },
  "devDependencies": {
    "@types/express": "^4.17.17",
    "@types/node": "^20.0.0",
    "@types/better-sqlite3": "^7.6.5",
    "typescript": "^5.0.0",
    "tsx": "^4.0.0",
    "ts-node": "^10.0.0"
  }
}
```

## File Structure

```
backend/
├── server.ts              # Express app + middleware + startup
├── config.ts              # Env vars, constants, validation
├── routes/
│   ├── accounts.ts        # GET /api/accounts
│   ├── transactions.ts    # GET /api/transactions
│   ├── debts.ts          # GET/POST/PUT /api/debts
│   └── plaid.ts          # POST /api/plaid/link-token
├── services/
│   ├── db.ts             # Database connection + helpers
│   └── plaid.ts          # Plaid client + helper functions
├── tsconfig.json
├── package.json
└── dist/                 # Compiled JS (generated)
```

## Notes for Agent

- Keep code organized; separate routes into their own files
- Use TypeScript for type safety
- Don't hardcode secrets; read from `process.env`
- Plaid initialization will fail without valid credentials in `.env`—that's OK for now; error should be clear
- Database schema from P1-DB should already exist; just open the connection and query
- Seed sample data (3 accounts, 2 debts, 10 transactions) on first run if DB is empty
- Response times should be < 200ms for these queries; no optimization needed yet

## Input

- Completed `backend/db/schema.sql` from P1-DB task ✅
- Environment variables in `.env` file

## Output

Backend server that:
- Compiles without TypeScript errors
- Starts on http://localhost:3000
- Serves all 6 routes with correct status codes
- Validates input and returns proper error messages
- Integrates with SQLite database
- Initializes Plaid client (ready for Phase 3 actual account linking)

## How to Submit

1. Create branch: `git checkout -b P1-BACKEND`
2. Create `backend/` files listed above
3. Run tests from "Testing" section above
4. Commit and push
5. Create PR; include test results in description

---

**Questions?** See [ARCHITECTURE.md](../ARCHITECTURE.md) API section or ask in PR.
