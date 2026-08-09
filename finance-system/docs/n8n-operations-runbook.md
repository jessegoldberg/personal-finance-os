# n8n Operations Runbook — Family Finance System

## Purpose

This system automates observation and analysis of family finances via n8n
workflows connected to Plaid. It never moves money and never acts on
financial accounts directly. AI and automation *analyze and recommend*;
a human *executes*.

## Infrastructure

- n8n: self-hosted, Docker, on host `atlas`, reachable via zero-trust access
- SSH alias: `finance-n8n` (user `finance-codex`, key-based auth only)
- n8n plan: free/community — no multi-environment promotion, no built-in
  secrets manager beyond the credential store
- Webhooks are available on the instance and are used by the Plaid Link
  flow (see "Linking a Plaid item" below)
- This n8n instance also runs ~51 workflows unrelated to this project
  (home-lab automation, monitoring, etc.) on the same container. Treat
  container restarts as something that affects more than just finance
  workflows.

## Hard boundaries (never violate)

1. Never print, commit, log, or transmit: Plaid secrets, access tokens,
   account IDs, routing/account numbers, balances tied to real accounts,
   raw transaction payloads, n8n API keys, webhook URLs with tokens, or
   execution payloads.
2. Never activate a finance workflow without synthetic (sandbox)
   validation first.
3. Never enable money movement of any kind. No workflow may call a Plaid
   Transfer, Payment Initiation, or equivalent money-movement endpoint.
4. Plaid **sandbox** environment only, until explicitly told to switch to
   development/production.
5. All deployed workflows start `active: false`. A human flips them on
   after reviewing a redacted test run.

## Credential store

Credentials live in n8n's built-in credential store — never in workflow
JSON, never in this repo, never in shell history.

| Credential name | Type | Used by |
|---|---|---|
| `Plaid Client ID` | Header Auth | Retired — superseded by `Plaid Sandbox Custom Auth` |
| `Plaid Secret Sandbox` | Header Auth | Retired — superseded by `Plaid Sandbox Custom Auth` |
| `Plaid Sandbox Custom Auth` | Custom Auth | Plaid API calls (sandbox only) |
| `Anthropic API Key` | Custom Auth | Analysis workflows (holds `{ "headers": { "x-api-key": "sk-ant-..." } }`) |

### Resolved: Plaid auth uses a Custom Auth credential

Two things were tried and ruled out live against the n8n instance on
`finance-n8n` (v2.23.3) before landing on the current approach:

1. **Two Header Auth credentials on one node.** n8n's `Header Auth`
   credential type auto-injects exactly one name/value pair as a header
   when selected as a node's Generic Credential Type — a node can only
   bind one such credential, so `Plaid Client ID` and `Plaid Secret
   Sandbox` couldn't both be attached as auto-injected headers.
2. **Pulling both values into the JSON body via `$credentials.<name>.value`
   expressions.** Confirmed broken in the n8n editor: the expression only
   resolves for the credential actively bound as the node's own
   Authentication setting, not for a credential merely referenced
   elsewhere on the node. Both values came back `undefined`.

**Current, confirmed-working approach:** a single `httpCustomAuth`
("Custom Auth") credential named `Plaid Sandbox Custom Auth`, holding
```json
{ "headers": { "PLAID-CLIENT-ID": "...", "PLAID-SECRET": "..." } }
```
Both header names are Plaid's own documented auth headers. The HTTP
Request node sets `authentication: genericCredentialType`,
`genericAuthType: httpCustomAuth`, and references this credential by
name. n8n injects both headers natively — no expression access to
credential values needed at all. The request body now only carries
non-auth params (`count`, `offset`, `country_codes`).

**Confirmed (2026-07-08): Custom Auth injects `body` fields too, not just
headers.** The per-item credential pattern (see below) relies on this — a
credential holding `{ "headers": {...}, "body": { "access_token": "..." } }`
successfully injects the access_token into the POST body of
`/transactions/sync`. First successful transactions sync confirmed this
against n8n v2.23.3. This is the mechanism that lets a per-item access
token stay in the encrypted credential store instead of in workflow JSON.

The old `Plaid Client ID` / `Plaid Secret Sandbox` Header Auth credentials
are no longer used by this workflow and can be deleted once you're
comfortable nothing else references them.

## Plaid Link and Access Token Storage

The Plaid Link flow (in n8n workflows and the web page) is built for n8n's
Community/free plan, which does not support environment variables or the
Public API for creating credentials programmatically.

**Workflow approach:**

1. **Plaid Link Token Create** — webhook that calls `/link/token/create`,
   returns a short-lived `link_token` to the webpage. Uses `Plaid Sandbox
   Custom Auth` credential only.
2. **Plaid Public Token Exchange** — webhook that receives the public_token
   from Link, exchanges it via `/item/public_token/exchange` for a real
   `access_token` and `item_id`, and returns both to the caller. Does NOT
   store the token in n8n (no Public API available on free tier). The
   access_token is ephemeral — it only lives in the response.
3. **Web page (plaid-link.html)** — displays the access_token with a
   "copy to clipboard" button and instructions to save it securely in a
   password manager or encrypted file. Future workflows will read this
   token from wherever you store it (e.g., a local encrypted JSON file,
   1Password, a secure notes app).

**Why this design?** n8n's free tier cannot:
- Read environment variables (so no `N8N_API_KEY` for the Public API)
- Programmatically create credentials via its own REST API (free tier has
  no Public API, or it's restricted)
- Write files to the host directly (would need volume mounts or SSH)

**Accessing tokens in future workflows:**

When you build transaction-sync or balance-check workflows, you'll provide
the access_token by one of:
- Hardcoding it into the workflow (simplest, least secure, suitable for
  single-use test workflows)
- Creating a manual credential in n8n for each item (tedious but secure)
- Reading from an encrypted file you manage externally (requires a helper
  script or SSH node to fetch it)

For now, store the access_token securely and let me know the best approach
when you're ready to build the next workflow.

## Linking a Plaid item (sandbox)

Three pieces work together: `web/plaid-link.html` (a static page you open
directly in your browser), and two webhook-triggered n8n workflows
(`plaid-link-token-create.json`, `plaid-public-token-exchange.json`).

### Why this needed a different secrets approach

n8n's credential store is **write-only from a workflow's perspective** —
a credential's secret fields can be auto-injected into a request by the
node that has it bound as its own Authentication, but that value can
never be read back out via an expression to build something else (this
was confirmed empirically: `typeOptions.redactJsonLeaves` / `password`
fields are simply never expression-readable, in any node). That breaks
the naive plan of "read the existing Plaid credential and use its value
to build a new per-item credential."

The resolution is to use **environment variables** instead of credentials
for the values that need composing at runtime, since `$env.*` access in
expressions is enabled on this instance (`N8N_BLOCK_ENV_ACCESS_IN_NODE:
"false"` in `/opt/docker/n8n-stack/docker-compose.yml`) and env vars are
not subject to the same masking. The container loads env vars from:
```
env_file:
  - /opt/docker/shared/secrets.env
  - /opt/docker/shared/urls.env
  - /opt/docker/shared/hosts.env
```
`/config/.codex-deploy/finance-n8n.env` (the file with placeholder keys
like `PLAID_CLIENT_ID=`, `N8N_API_KEY=`) is **not** wired into the
container via that `env_file` list — it's inert until either added to
the compose file or its values are moved into one of the three files
already loaded. The decision made here: use `secrets.env`, which already
exists and is permission-locked from the `finance-codex` SSH user (it
returns "permission denied" even for key names — by design).

### Required env vars (in `/opt/docker/shared/secrets.env`)

| Key | Used by |
|---|---|
| `PLAID_CLIENT_ID` | Exchange workflow, composing per-item credential JSON |
| `PLAID_SECRET` | Exchange workflow, composing per-item credential JSON |
| `N8N_API_KEY` | Exchange workflow, authenticating to n8n's own Public API |

`sandbox.plaid.com` is hardcoded in the workflow URLs rather than driven
by `PLAID_ENV`, since sandbox-only is a hard boundary right now, not a
runtime toggle — no need for that indirection yet.

**The n8n container must be restarted after these are set**, since env
vars are process-level. This container also runs ~51 unrelated
workflows — restart deliberately, not automatically.

### Per-item access token storage

After exchanging a `public_token` for an `access_token`, the exchange
workflow calls n8n's own Public API (`POST http://localhost:5678/api/v1/credentials`,
loopback — no external routing needed) to create a **new Custom Auth
credential per linked item**, named `Plaid Item - <item_id>`, containing:
```json
{ "headers": { "PLAID-CLIENT-ID": "...", "PLAID-SECRET": "..." }, "body": { "access_token": "..." } }
```
This duplicates `PLAID-CLIENT-ID`/`PLAID-SECRET` into every item's
credential (unavoidable — Custom Auth credentials are self-contained,
can't reference each other), but keeps the access token itself out of
workflow JSON entirely and inside n8n's encrypted-at-rest credential
store.

**Known limitation, deliberately deferred:** a future "sync transactions
for item X" workflow will need this credential bound as *that node's*
Authentication, which is a design-time binding — not something a single
generic workflow can pick dynamically per item at runtime. For now this
just means: when you build the next workflow that calls a per-item Plaid
endpoint, you'll bind it explicitly to the relevant `Plaid Item - <id>`
credential in the editor. If/when there are enough linked items that this
becomes painful, that's the point to revisit — not before.

### Inbound webhook protection

Both webhook-triggered workflows require a `Header Auth` credential named
`Finance Webhook Signing Secret` (create it yourself in the n8n editor;
pick any header name/value — e.g. `X-Finance-Webhook-Secret`). This is a
shared secret between the static HTML page and n8n, not a mechanism against
a determined attacker — the same value has to live in the HTML file's
JS, so anyone with the file can read it. It's meant to block casual
scanning/discovery of the webhook URLs, not to withstand a serious
attack. `web/plaid-link.html` has placeholders for this header name/value
plus the two production webhook URLs — fill those in directly in that
file (not tracked with real values here).

### Setup checklist (all manual, all yours)

1. Add `PLAID_CLIENT_ID`, `PLAID_SECRET`, `N8N_API_KEY` to
   `/opt/docker/shared/secrets.env`
2. Restart the `n8n` container (`docker restart n8n` on `atlas`, or your
   preferred compose command) — when you're ready, not automatically
3. Create an n8n API key (Settings → API) matching what you put in
   `N8N_API_KEY`
4. Create the `Finance Webhook Signing Secret` Header Auth credential
5. Fill in the four placeholders in `web/plaid-link.html`
6. Deploy the two new workflows (same `deploy_n8n_workflows_remote.py`
   flow as always) — they'll import inactive
7. Activate both webhook workflows (webhooks only fire once a workflow
   is active, or while using "Listen for test event" in the editor for a
   one-off test)
8. Open `plaid-link.html` locally, click through with Plaid's sandbox
   test credentials (`user_good` / `pass_good`)

## Safe discovery rules (SSH to finance-n8n)

Allowed:
- `docker ps`, `docker version`, container name/image/status listing
- `python3 --version`, `which python3`
- Locating the protected env file *path* and listing key *names* only
  (e.g. `grep -o '^[A-Z_]*=' path/to/file` style — names, never values)
- `n8n --version` / checking the n8n CLI is reachable inside the container

Never run:
- `docker inspect` (can dump env vars including secrets)
- Any command that prints an env file's contents
- Any command that logs or echoes a credential value, token, or execution
  payload
- Any workflow execution against non-sandbox Plaid data

## Deployment flow

1. `deploy/check_n8n_secret_boundaries.py` — scans workflow JSON for
   hardcoded secrets, token-shaped strings, or non-expression credential
   values. Must pass before anything else runs.
2. `deploy/check_n8n_workflows.py` — validates workflow structure: valid
   JSON, required keys present, `active: false`, no money-movement node
   types, credentials referenced by name only.
3. `deploy/deploy_n8n_workflows_remote.py` — deploys via SSH, gated behind
   both checks above plus an explicit `--confirm` flag. Defaults to
   dry-run. Verifies post-deploy that the workflow is still inactive.
4. Manual test execution, triggered by a human (or requested by AI, run
   by human) inside the n8n editor using **sandbox** data only.
5. Human reviews the redacted execution summary and decides whether to
   activate.

## Output rules for AI-run discovery/deploy steps

Only ever output:
- Workflow names, workflow IDs, active state
- Node types present (not node parameter values)
- Hash/parity confirmation (e.g. "local hash matches deployed hash")
- Redacted error *categories* (e.g. "auth error", "timeout", "4xx from
  Plaid") — never raw error bodies, which may contain request echoes

## Escalation

If a safe-discovery command reveals something outside the allowed list
(e.g. a secret value on screen, an active workflow that shouldn't be),
stop, do not act further, and report the situation to the human without
repeating the sensitive content back.
