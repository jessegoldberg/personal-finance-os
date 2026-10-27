# Private local inference for Finance

Owner: Jesse. Finance issue #3, infrastructure issue #214.

The app supports native `ollama` and authenticated OpenAI-compatible `gateway`
providers. Local inference never falls back to Claude. Paid analysis remains at
$0 unless separately configured by the operator; this integration does not
change that allowance or run financial classification during deployment. The
gateway overlay explicitly pins paid allowance to $0 and startup refresh to
false, so those protections do not depend on transient shell variables.

## Production configuration

Use both compose files and the existing production environment:

```sh
cd /home/jesse/personal-finance-os
docker compose --env-file .env.production \
  -f docker-compose.prod.yml -f docker-compose.gateway.yml \
  up -d --no-build --no-deps --force-recreate personal-finance-os
```

Build and validate a candidate first. The gateway overlay selects `local-pc` at
`https://192.168.60.20:8443/v1`. It mounts the existing per-app JSON credential
and public CA as read-only files under `/run/local-ai/`. Missing host files fail
the deployment rather than silently creating directories. No credential values
belong in compose, environment templates, source control, images, UI status, or
logs. Preserve the existing `.env.production` edits; it contains production
secrets and must never be committed. Keep `FINANCE_STARTUP_REFRESH_ENABLED=false`
for this rollout to avoid startup reclassification and immediate Plaid refresh.

The deployment wrapper accepts `--gateway` for initial enrollment and retains an
existing gateway overlay on subsequent deployments. It uses the production env
file and recreates only the app without removing its Docker network. Preserve
that network: the existing UFW rule allows only source `172.19.0.2` on `br-pfo`
to the gateway's `8443` port. If the address changes, diagnose and review the
existing scoped rule instead of widening access or using host networking.

## Behavior and limits

- Gateway requests use explicit CA trust and hostname verification per request.
  Plain HTTP, URL credentials/query strings, redirects, retries, and global TLS
  bypasses are not accepted by the gateway adapter.
- The gateway retains its existing 2,048-byte prompt/schema limit, 1,024-token
  output maximum, credential scope/expiry, quotas and single inference slot.
  The app uses one local request at a time with a small queue. Expired keys,
  outages and quota errors produce local errors; none enable paid usage.
- Quick chat sends a short deterministic debt-plan summary plus the current
  question. It excludes account details, raw transactions and previous messages.
  It explains calculated facts; payment decisions stay in the free debt plan.
  Oversized questions fail with a shorter-question prompt.
- Transaction sorting stays operator-invoked. It sends merchant, description and
  amount in batches sized together with their JSON schema. Results must have
  exactly one valid index/category per purchase and must not be truncated before
  a batch is applied. Previous successful batches remain if a later request
  reaches the gateway quota; the existing UI reports partial progress.
- The AI & Usage tab distinguishes the private gateway from native Ollama,
  displays permitted model aliases, and records actual local prompt/output token
  counts under that alias. Reachability checks the gateway's model list; the
  test button performs inference without reading financial facts. No prompt or
  answer is stored in the usage ledger.

## Validation and recovery

```sh
npm run build
npm test
```

Tests use synthetic records and loopback mock providers, including TLS/auth
failures, oversized responses/prompts, timeouts, structured output, native Ollama
compatibility, and the existing $0 paid guard. The TLS tests generate temporary
certificates with OpenSSL; a disposable production-image test can instead mount
pre-generated synthetic certificates at `LOCAL_GATEWAY_TEST_TLS_DIR`.

Before deployment, preserve the running image as
`personal-finance-os:before-local-gateway-issue3`. Take a SQLite online backup,
record the environment hash and financial-table integrity digests privately on
Hermes, and preserve `.env.production` and all data volumes. Recovery evidence
belongs under `/home/jesse/pfo-release-backups/issue3-*`, mode `0700`.

After deployment, check `/health`, `/api/ai/local/status` and `/api/ai/budget`.
Run only `/api/ai/local/test` and poll its returned job ID, without printing its
raw response. Verify the local test succeeded, paid allowance/reservations did
not change, environment hash matches, and financial-table digests are unchanged.
Do not run the production chat or categorize endpoints as a smoke test.

To disable gateway integration while retaining the updated code, recreate the
app with only `docker-compose.prod.yml`; the preserved production env defaults
local inference to `none`. To restore the previous application image, retag the
rollback image to the compose image name, use only the original compose file,
and recreate with `--no-build --no-deps`. Keep data volumes and the unchanged
environment. A database restore could discard new activity and needs a
separately verified reason.

The implementation uses Node's documented
[HTTPS request CA and TLS options](https://nodejs.org/docs/latest-v18.x/api/https.html#httpsrequestoptions-callback).

## Verified rollout

Feature `eb987d5` and safety overlay `f29daec` were deployed on October 26,
2026. The app is healthy, the scoped `local-pc` connection and a synthetic JSON
schema completion passed, and local token accounting was verified. Paid allowance
remains $0, startup refresh is false, and the financial-table digests and existing
production environment file remained unchanged. Both secret mounts are read-only.

All 26 tests passed locally and inside the production Node 18 image. A separate
network-disabled HTTP acceptance container passed without production mounts or
provider credentials. The standalone frontend type check still reports the same
two baseline errors in Advisor/Dashboard, tracked in #4; the production Vite build
passes. Existing frontend dependency upgrade work remains in #2. Full evidence
is summarized in `release-validation-issue3.json`; sensitive integrity manifests
and the online backup stay only in the private Hermes backup directory.
