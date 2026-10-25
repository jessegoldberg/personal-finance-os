# Credit-free debt analysis and paid AI controls

Owner: Jesse. Finance issue #1. Prepared October 24, 2026.

## Using the app

Open **AI Advisor**. The **Your debt action plan** card recalculates from current
accounts, income, debt minimums and planned expenses without calling any model.
It shows the monthly gap or surplus, protected cash-buffer contribution and
conditional extra-payment capacity. When inputs are complete, it compares
highest-interest-first and smallest-balance-first payoff estimates for non-home
secured debt. All housing/other debt minimums stay in the affordability budget.

Resolve the displayed missing-data items first. Missing APRs are never treated
as zero. Missing/zero minimums, unconfirmed detected income, overdue accounts,
promotional/deferred-interest terms, thin spending history, stale account data
and unbudgeted planned expenses suppress extra-payment recommendations and
projections. With no non-home debts, the card does not claim the mortgage is gone.

Expand **Confirm your cash buffer and tax set-aside** to explicitly save planning
assumptions. Blank cash target uses one month of observed living costs, at least
$1,000. This is an editable provisional assumption, not a universal target. An
additional tax set-aside is required when income has no withholding; enter zero
only if it is already covered elsewhere. Use take-home income. Saving changes
settings only; it never changes balances, transactions, budgets or payments.

Monthly estimates use fixed APRs, rounded monthly interest, entered statement
minimums and no new charges/fees. Freed minimums roll into remaining debts. The
first modeled payment is one month after the plan date, avoiding end-of-month
calendar rollover. Extra capacity stays constant; future reserve contributions
are not silently redirected. No payoff within 600 months returns an unknown
date/interest total. Confirm actual paydays, due dates and statements before any
payment. The current engine does not optimize daily cash-flow timing, variable
rates or promotional/deferred-interest schedules. Those remain explicit gaps.

The planning principles are consistent with CFPB's
[debt action plan](https://www.consumerfinance.gov/archive/blog/how-reduce-your-debt/)
and [emergency savings guidance](https://www.consumerfinance.gov/an-essential-guide-to-building-an-emergency-fund/).
Household-specific costs, tax reserves and buffer targets still require review.

## Paid AI defaults and limits

`PAID_AI_MONTHLY_BUDGET_USD` defaults to **0** in both compose files. No API-key
change or account funding is needed for the free plan. A separate authenticated
app endpoint, `GET /api/ai/budget`, displays the application allowance; it is not
the provider's available-credit balance or invoice.

Every Anthropic inference call goes through `paidMessage`. It checks allowance
before sending, restricts the model to the existing `claude-opus-5-5`, caps
serialized request size at 12,000 UTF-8 bytes and output at 4,096 tokens. Plans
use at most 4,096 output tokens, chat 1,024 and formatting 2,048. The SDK has
zero automatic retries and a 120-second timeout. Automatic model fallback and
server research tools are disabled. A failed local feature cannot silently spend
paid credits. Paid plan generation no longer refreshes market research.
Existing saved market data remains historical, not newly researched evidence.

The budget ledger is an additive SQLite table, `ai_budget_reservations`, indexed
by UTC month. Before each call, an integer-microdollar maximum reservation is
committed in a `BEGIN IMMEDIATE` transaction, preventing concurrent requests
from reusing the same allowance. Reservations survive errors and restarts.
There is deliberately no automatic refund, since a failed transport can still
have incurred provider usage. A process crash can leave `reserved` state;
its full amount continues to count. Completed/unknown states do not erase cost.

Reservations use the serialized input-byte envelope plus a 2,048-token margin,
at $8/M input (covering even 1-hour cache writes), and maximum output at $20/M.
These rates were checked against official
[Opus 5.5 pricing](https://platform.claude.com/docs/en/about-claude/pricing) on
October 24, 2026. This is conservative application accounting, not exact billed
usage or a guarantee about provider tokenization, pricing changes, taxes or usage
outside this app. Keep a provider-side spend limit too. Unknown models/tools or
oversized requests fail closed. Review pricing and the envelope before enabling
paid usage; the release remains at $0. No bank credentials or prompts are stored
in the new ledger.

## Optional paid reasoning

A future explicitly funded allowance is set by the operator in the existing
production environment and requires container recreation. Do not raise it as
part of this release. No UI can silently enable or increase paid spending.

Optional analysis receives a compact calculated debt brief and existing
household notes, rather than the full raw transaction/account history. A same-day
unchanged brief reuses the saved report. Chat is limited to four recent messages.
Provider prompt caching remains enabled for chat; the budget still reserves
conservatively without assuming a cache hit. The app refuses an AI report that
contradicts calculated surplus, extra-payment capacity, planned-expense reserves
or the chosen payoff date. New reports do not invent health scores, home options
or interest-savings estimates that were not calculated. This validation does
not prove every sentence is correct; human review remains required. Existing
AI reports are retained as historical analysis.

## Build and validate

The repository now includes separate backend/frontend lockfiles and Docker uses
`npm ci`. Local setup can use `npm --prefix backend ci --workspaces=false` and
`npm --prefix frontend ci --workspaces=false`. Build with `npm run build` and
run acceptance tests with `npm test`. SQLite tests use Node's built-in SQLite
when available, otherwise the app's existing better-sqlite3 dependency. Tests
create only synthetic databases and a loopback mock provider. They require no
provider account, financial records or actual model inference.

Production still uses the existing Node 18 image. Validate inside that image,
with no network or production mounts, before rollout. Follow-up issue #2 tracks the separate
runtime/build-tool upgrade should address the existing build-only advisories;
Vite, Tailwind and esbuild are not shipped as servers in the runtime image.
The existing frontend bundle-size warning remains outside this feature.

## Deployment and rollback

Preserve `.env.production`, including existing uncommitted edits, and all data
volumes. Build a candidate image before replacing the running container. Keep
`personal-finance-os:before-debt-budget-issue1` as the previous-image rollback tag.
A private SQLite online backup and manifest were created on Hermes under
`/home/jesse/pfo-release-backups/issue1-2a612c00a0fc4942adac5ad43f40ce56`.
The manifest records the prior image/source revision, environment hash and backup
hash. No database or environment contents were copied to the development Mac.
This is a local deployment recovery point, not proof of off-site backup health.

For this release use `FINANCE_STARTUP_REFRESH_ENABLED=false` to skip the existing
startup reclassification and immediate Plaid refresh. Manual sync and the existing
six-hour refresh interval remain available. The switch defaults to the previous
startup behavior for other deployments.

After recreating the app, verify container health, frontend delivery, the free
analysis endpoint, a $0 disabled paid allowance and unchanged `.env.production`
hash. Confirm no model calls were made during acceptance. The only automatic
schema change is the AI accounting table/index; existing accounts, debts,
transactions and saved plans are not altered by migration.

For rollback, tag the preserved image with the production compose image name
`personal-finance-os-personal-finance-os`, then recreate only this app with the
existing compose file and environment, using `--no-build --no-deps`. Leave data
volumes and the additive ledger in place. Do not restore a database snapshot
unless there is a separately verified need, since doing so can discard newer
transactions. No backup retention changes, model downloads or network changes
are part of this deployment.
