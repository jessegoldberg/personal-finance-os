# Task: P1-FRONTEND — React Dashboard UI Skeleton

**Phase**: Phase 1 - Foundation + Plaid Integration  
**Difficulty**: Medium  
**Estimated Time**: 4-6 hours  
**Depends On**: P1-BACKEND ✅  
**Owner**: [To be assigned]

---

## Overview

Build the React frontend dashboard with:
- Basic layout + navigation
- Accounts list view
- Debts list view
- Plaid Link integration (component)
- Responsive design (mobile + desktop)
- TypeScript for type safety

This is a skeleton; Phases 2+ will add analysis widgets, charts, etc.

## Deliverables

1. **`frontend/src/App.tsx`** — Main app component + routing
2. **`frontend/src/components/AccountsList.tsx`** — Accounts display
3. **`frontend/src/components/DebtsList.tsx`** — Debts display
4. **`frontend/src/components/PlaidLink.tsx`** — Plaid Link widget
5. **`frontend/src/pages/Dashboard.tsx`** — Dashboard page
6. **`frontend/src/types/index.ts`** — TypeScript interfaces
7. **`frontend/src/api/client.ts`** — API client (fetch wrapper)
8. **`frontend/src/hooks/useAccounts.ts`** — Fetch accounts hook
9. **`frontend/src/hooks/useDebts.ts`** — Fetch debts hook
10. **`frontend/Dockerfile`** — Docker build for frontend
11. **`frontend/package.json`** — React + dependencies
12. **`frontend/vite.config.ts`** — Vite configuration
13. **`frontend/tailwind.config.js`** — Tailwind styling
14. **`frontend/index.html`** — HTML entry point

## Requirements

### Stack
- **Framework**: React 18.2+
- **Build**: Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **State**: React hooks (no Redux needed for MVP)
- **HTTP**: Fetch API (native) or Axios
- **Package Manager**: npm

### Layout

```
┌──────────────────────────────────────────┐
│  Logo    Dashboard    Plaid Link  Settings │  <- Header
├──────────────────────────────────────────┤
│                                          │
│  [ ACCOUNTS SECTION ]                    │
│  - Chase Checking       $5,000           │
│  - Chase Sapphire       $3,200 (CC)      │
│                                          │
│  [ DEBTS SECTION ]                       │
│  - Chase Sapphire       $3,200  21.5%    │
│                                          │
│  [ ADD DEBT FORM ]                       │
│  Debt Name: [    ]                       │
│  Balance: [    ]                         │
│  Rate: [    ]  Min Payment: [    ]       │
│  [ Add Debt Button ]                     │
│                                          │
└──────────────────────────────────────────┘
```

### Components to Build

#### 1. **AccountsList** (`components/AccountsList.tsx`)
- Display fetched accounts from backend
- Show: name, type, balance, last sync time
- Loading state: spinner or skeleton
- Error state: error message + retry button
- Empty state: "No accounts linked"

#### 2. **DebtsList** (`components/DebtsList.tsx`)
- Display debts fetched from backend
- Show: name, balance, interest rate, min payment
- Sort by interest rate (highest first)
- Loading + error + empty states

#### 3. **PlaidLink** (`components/PlaidLink.tsx`)
- Button: "Link Account with Plaid"
- On click:
  1. Fetch link token from backend (`POST /api/plaid/link-token`)
  2. Open Plaid Link in modal/iframe
  3. On success, refresh accounts list
  4. On error, show error message
- Use `react-plaid-link` package

#### 4. **AddDebtForm** (inline in Dashboard or separate component)
- Form fields: debt name, balance, interest rate, min payment, term months
- Validation: non-empty, positive numbers
- Submit: `POST /api/debts`
- On success: refresh debts list, clear form
- On error: show error message

#### 5. **Dashboard** (`pages/Dashboard.tsx`)
- Layout with header + sections
- AccountsList component
- PlaidLink component
- DebtsList component
- AddDebtForm component
- All tied together with state management

#### 6. **App** (`App.tsx`)
- Router setup (if multi-page; can be simple for MVP)
- Error boundary
- Global styles/theme provider (if using theme)
- Route to Dashboard page

### API Client

Create `src/api/client.ts`:
```typescript
export const apiClient = {
  async getAccounts() {
    const res = await fetch(`${API_BASE}/accounts`);
    if (!res.ok) throw new Error("Failed to fetch accounts");
    return res.json();
  },
  
  async getDebts() {
    const res = await fetch(`${API_BASE}/debts`);
    if (!res.ok) throw new Error("Failed to fetch debts");
    return res.json();
  },
  
  async addDebt(debt) {
    const res = await fetch(`${API_BASE}/debts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(debt)
    });
    if (!res.ok) throw new Error("Failed to add debt");
    return res.json();
  },
  
  async getPlaidLinkToken() {
    const res = await fetch(`${API_BASE}/plaid/link-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    if (!res.ok) throw new Error("Failed to get Plaid link token");
    return res.json();
  }
};
```

### Custom Hooks

Create `src/hooks/`:

- **`useAccounts()`** — Fetches accounts, returns `{ accounts, loading, error, refetch }`
- **`useDebts()`** — Fetches debts, returns `{ debts, loading, error, refetch }`

Use `useEffect` + `useState` for state management.

### Styling with Tailwind

Use Tailwind utility classes for responsive design:
- Mobile-first: `md:` prefix for desktop adjustments
- Spacing: `p-4`, `m-2`, etc.
- Layout: `flex`, `grid`, `grid-cols-2`
- Colors: Use Tailwind defaults (gray, blue, red for errors, green for success)
- Dark mode: Not required for Phase 1

### TypeScript Types

In `src/types/index.ts`:

```typescript
export interface Account {
  id: string;
  name: string;
  type: 'checking' | 'savings' | 'credit_card' | 'loan' | 'mortgage';
  balance: number;
  interestRate?: number;
  minPayment?: number;
  lastSync?: string;
}

export interface Debt {
  id: string;
  name: string;
  balance: number;
  interestRate: number;
  minPayment: number;
  termMonths?: number;
}

export interface PlaidLinkResponse {
  linkToken: string;
  expiration: string;
}
```

## Acceptance Criteria

- [ ] React app starts on http://localhost:5173
- [ ] Dashboard page displays with header + sections
- [ ] AccountsList renders and fetches from backend GET /api/accounts
- [ ] DebtsList renders and fetches from backend GET /api/debts
- [ ] PlaidLink button exists and calls POST /api/plaid/link-token
- [ ] AddDebtForm can submit POST /api/debts with validation
- [ ] All API calls have loading states
- [ ] All API calls have error handling (display error message)
- [ ] Responsive: works on mobile (375px) and desktop (1280px)
- [ ] TypeScript compiles without errors

## Testing

```bash
cd frontend

# Install deps
npm install

# Dev server
npm run dev
# Should print: "Local: http://localhost:5173"

# In browser, visit http://localhost:5173
# Should see:
# - Dashboard title
# - Accounts section (may be empty or show fetched accounts)
# - Debts section
# - Plaid Link button
# - Add Debt form

# Open browser console; check for errors
# Test each interaction:
# - Plaid Link button → click → should fetch link token
# - Add Debt form → fill + submit → should POST to backend
# - Refresh page → data persists (from backend)
```

## Dependencies to Add

In `frontend/package.json`:

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-plaid-link": "^4.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.0.0",
    "@types/react-dom": "^18.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^5.0.0",
    "typescript": "^5.0.0",
    "tailwindcss": "^3.3.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0"
  }
}
```

## File Structure

```
frontend/
├── src/
│   ├── App.tsx              # Main app + routing
│   ├── main.tsx             # React mount point
│   ├── pages/
│   │   └── Dashboard.tsx    # Dashboard page
│   ├── components/
│   │   ├── AccountsList.tsx
│   │   ├── DebtsList.tsx
│   │   ├── PlaidLink.tsx
│   │   └── AddDebtForm.tsx
│   ├── hooks/
│   │   ├── useAccounts.ts
│   │   └── useDebts.ts
│   ├── types/
│   │   └── index.ts
│   ├── api/
│   │   └── client.ts
│   └── index.css            # Global Tailwind imports
├── public/
│   └── index.html
├── Dockerfile
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.js
└── postcss.config.js
```

## Notes for Agent

- Keep components small and focused
- Use React hooks for data fetching (useEffect)
- Plaid Link will open in a modal; handles auth/token flow for you
- Tailwind is utility-first; no custom CSS needed for MVP
- Don't build charts, graphs, or complex widgets yet (Phase 2+)
- Focus on functionality over polish; Phase 4 is for styling perfection
- Mock data is OK for development while backend is being built

## Input

- Completed backend from P1-BACKEND task ✅
- Backend running on http://localhost:3000

## Output

React app that:
- Compiles without TypeScript errors
- Runs on http://localhost:5173
- Displays accounts, debts, and Plaid Link button
- Can add debts via form
- Calls backend endpoints and displays results
- Has proper loading + error states

## How to Submit

1. Create branch: `git checkout -b P1-FRONTEND`
2. Create `frontend/` directory and files listed above
3. Run dev server; test manually in browser
4. Commit and push
5. Create PR; include browser screenshot in description

---

**Questions?** See component examples in React docs or ask in PR.
