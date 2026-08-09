# deploy/

Scripts for validating and deploying n8n workflows to `finance-n8n`. Read
[docs/n8n-operations-runbook.md](../docs/n8n-operations-runbook.md) first —
these scripts enforce that runbook's hard boundaries, they don't replace it.

## Files

- `n8n-workflows.json` — manifest of workflows that are allowed to deploy.
  Adding a workflow here is a deliberate, reviewable step; the deploy
  script only ever touches files listed in this manifest.
- `check_n8n_secret_boundaries.py` — scans workflow JSON for hardcoded
  secrets or token-shaped strings. Never prints matched values.
- `check_n8n_workflows.py` — validates workflow structure: required keys,
  `active: false`, no money-movement endpoints, credentials referenced by
  name only.
- `deploy_n8n_workflows_remote.py` — runs both checks above, then deploys
  over SSH via `docker exec ... n8n import:workflow`, and verifies the
  deployed workflow is still inactive.

## Order of operations

```
python3 deploy/check_n8n_secret_boundaries.py
python3 deploy/check_n8n_workflows.py
python3 deploy/deploy_n8n_workflows_remote.py                # dry run
python3 deploy/deploy_n8n_workflows_remote.py --confirm --container <name>
```

The deploy script runs the first two checks itself before doing anything
remote, so running them standalone first is optional but useful for a
faster feedback loop while editing a workflow.

## Flags

`deploy_n8n_workflows_remote.py`:

| Flag | Default | Notes |
|---|---|---|
| `--ssh-host` | `finance-n8n` | Must match your SSH config alias |
| `--container` | *(none)* | n8n Docker container name; required with `--confirm`. Get this from the safe-discovery step (`docker ps`) — never guessed. |
| `--remote-tmp-dir` | `/tmp/n8n-deploy` | Scratch path on the remote host |
| `--confirm` | off | Without it, the script only validates + checks SSH reachability. Nothing is transferred. |

## Safety notes

- Dry-run is the default. You have to explicitly ask for a real deploy.
- Every workflow in the manifest must pass both checks or the whole
  deploy is aborted — no partial deploys.
- After import, the script re-exports workflows from the container and
  confirms `active: false` before declaring success. If it can't confirm
  that, it fails loudly rather than assuming the deploy is safe.
- The exact `n8n` CLI flags used here (`import:workflow`,
  `export:workflow --all --separate`) are a best-effort draft and are
  flagged in the script's docstring as needing live verification against
  whatever n8n version is actually running on `finance-n8n` — confirm
  during the discovery step before trusting a real `--confirm` run.
- This script never activates a workflow. Activation is a manual step a
  human takes in the n8n editor after reviewing a redacted test run.
