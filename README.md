# Personal Finance OS

A secure, visually-driven personal finance dashboard that uses Claude AI to generate optimal debt payoff strategies. Consolidate all your accounts, get monthly payment recommendations ranked by payoff impact.

## Quick Start

### Prerequisites
- Node.js 18+
- Docker (for containerized deployment)
- Plaid API credentials (sandbox for dev)
- Anthropic API key

### Local Development

```bash
# Clone and install
git clone <repo-url> && cd personal-finance-os
npm install

# Copy env template
cp .env.example .env
# Edit .env with your keys: PLAID_CLIENT_ID, PLAID_SECRET, ANTHROPIC_API_KEY

# Start backend + frontend in dev mode
npm run dev

# Backend runs on http://localhost:3000
# Frontend runs on http://localhost:5173 (React dev server)
```

Visit `http://localhost:5173` to see the dashboard.

## Features

- **Unified Dashboard**: See net worth, debts, savings, monthly spending at a glance
- **Plaid Integration**: Link real bank accounts; transactions sync automatically
- **Claude Analysis**: AI recommends what to pay, when, based on interest rates & balances
- **Payment Tracking**: Log payments you make; Claude learns your behavior
- **Secure**: All data stays on your server; Claude analysis is server-side only

## Project Structure

```
├── backend/               # Node.js + Express API
│   ├── server.ts         # Express app entry
│   ├── routes/           # API endpoints
│   ├── services/         # Business logic (Claude, Plaid, analysis)
│   ├── db/               # SQLite schema + migrations
│   └── config.ts         # Environment + constants
├── frontend/             # React + TypeScript + Tailwind
│   ├── src/
│   │   ├── components/   # React components
│   │   ├── pages/        # Page components
│   │   ├── hooks/        # Custom React hooks
│   │   ├── types/        # TypeScript interfaces
│   │   └── App.tsx       # Main app component
│   └── public/           # Static assets
├── docs/                 # Documentation
│   ├── ARCHITECTURE.md   # Tech decisions + design
│   ├── API.md           # API endpoint docs
│   ├── CLAUDE_PROMPT.md # Debt analysis prompt
│   └── DEPLOYMENT.md    # How to deploy
├── Dockerfile           # Container image
├── docker-compose.yml   # Local dev + prod compose
└── package.json         # Node dependencies
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for:
- Tech stack rationale
- Phase breakdown
- Task delegation strategy
- Security model

## Development Workflow

1. **Phases**: Work happens in 5-week phases (see ARCHITECTURE.md)
2. **Tasks**: Each feature is a GitHub issue with clear acceptance criteria
3. **Agents**: Tasks are delegated to specialist agents; context kept small
4. **PR reviews**: Main dev reviews, merges, updates status

## Deployment

### Local (Development)

```bash
docker-compose -f docker-compose.yml up
# Backend: http://localhost:3000
# Frontend: http://localhost:5173
```

### Production (Your Server)

```bash
docker build -t personal-finance-os:latest .
# Then run behind CloudFront ZTNA with proper env vars
```

See [DEPLOYMENT.md](./docs/DEPLOYMENT.md) for full instructions.

## Security & Privacy

- **No money movement**: Recommendations only; you execute payments
- **Server-side analysis**: Claude never sees raw data in browser
- **Local database**: SQLite file on your server, backed up daily
- **Secrets in env vars**: API keys not in repo; all secrets encrypted at rest
- **ZTNA**: CloudFront handles authentication; backend trusts reverse proxy

## API Overview

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/accounts` | GET | List linked accounts + balances |
| `/api/transactions` | GET | List transactions (date range, account) |
| `/api/debts` | GET/POST/PUT | Manage debts |
| `/api/analyze` | POST | Get Claude's debt payoff strategy |
| `/api/recommendations` | GET | List past recommendations |
| `/api/log-payment` | POST | Log a payment you made |
| `/api/plaid/link-token` | POST | Get Plaid Link token for account linking |

See [docs/API.md](./docs/API.md) for full spec.

## Cost Estimation

- **Claude API**: ~$5-10/month (1-2 analyses/week at Opus pricing)
- **Plaid**: ~$0 (sandbox) / $25-50/month (production, depending on account count)
- **Hosting**: Your existing server (assume ~$50/month if on AWS)

## Contributing

Tasks are tracked in GitHub issues. To work on a task:

1. Pick an issue labeled `P{phase}-{name}`
2. Create a branch: `git checkout -b P1-DB`
3. Submit a PR with acceptance criteria met
4. Main dev reviews + merges

## FAQ

**Q: Is my data safe?**
A: Yes. Data stays on your server behind ZTNA. Claude analysis happens server-side; your browser never sees raw financial data.

**Q: Can this make payments automatically?**
A: No, by design. We recommend; you execute. This prevents accidental overpayments or mistakes.

**Q: How do I move from sandbox to real Plaid accounts?**
A: In Phase 5, we swap Plaid credentials from sandbox → production. Your existing schema doesn't change; just the data source.

## Roadmap

- **Phase 1** (Weeks 1-3): Foundation + Plaid sandbox integration
- **Phase 2** (Weeks 3-4): Claude debt analysis
- **Phase 3** (Weeks 4-5): Payment tracking + learning
- **Phase 4** (Weeks 5-6): Mobile + polish
- **Phase 5** (Weeks 6-8): Production Plaid + deployment

## License

Private.

---

**Next Steps**: See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full project plan and how to contribute.
