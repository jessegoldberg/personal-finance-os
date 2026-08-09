#!/usr/bin/env python3
"""
Deploys workflows listed in deploy/n8n-workflows.json to the n8n instance
on finance-n8n, via SSH + `docker exec ... n8n import:workflow`.

Safety model:
  - Both check_n8n_secret_boundaries.py and check_n8n_workflows.py must
    pass for every workflow before anything touches the remote host.
  - Defaults to --dry-run: validates, checks SSH reachability, and prints
    what *would* happen. Nothing is transferred or imported.
  - Real deployment requires --confirm plus an explicit --container name
    (the n8n Docker container name is host-specific and must be supplied
    by whoever ran the safe-discovery step — this script never guesses it).
  - Every deployed workflow is verified post-import to still have
    active: false. If verification can't confirm that, the script fails
    loudly rather than assuming success.

Output is restricted to workflow names/IDs, active state, and hash/parity
— never file contents, env values, or command output that might contain
secrets. See docs/n8n-operations-runbook.md.

ASSUMPTIONS THAT NEED LIVE VERIFICATION (do not trust blindly):
  - Exact `n8n` CLI subcommand names/flags (import:workflow, export:workflow)
    for the n8n version actually running in the container.
  - That `docker exec` is reachable for the `finance-codex` SSH user without
    additional sudo/group setup.
Confirm both during the discovery step before relying on this script.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "deploy" / "n8n-workflows.json"
CHECK_SECRETS = REPO_ROOT / "deploy" / "check_n8n_secret_boundaries.py"
CHECK_STRUCTURE = REPO_ROOT / "deploy" / "check_n8n_workflows.py"

DEFAULT_SSH_HOST = "finance-n8n"
DEFAULT_REMOTE_TMP_DIR = "/tmp/n8n-deploy"


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def load_manifest() -> list[Path]:
    data = json.loads(MANIFEST_PATH.read_text())
    files = [REPO_ROOT / w["file"] for w in data["workflows"]]
    missing = [f for f in files if not f.exists()]
    if missing:
        raise SystemExit(f"error: manifest references missing file(s): {missing}")
    return files


def run_gate_checks(files: list[Path]) -> bool:
    print("== Running secret boundary check ==")
    r1 = run([sys.executable, str(CHECK_SECRETS), *[str(f) for f in files]])
    print(r1.stdout)
    if r1.returncode != 0:
        print(r1.stderr, file=sys.stderr)
        return False

    print("== Running structure/boundary check ==")
    r2 = run([sys.executable, str(CHECK_STRUCTURE), *[str(f) for f in files]])
    print(r2.stdout)
    if r2.returncode != 0:
        print(r2.stderr, file=sys.stderr)
        return False

    return True


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_ssh_reachable(ssh_host: str) -> bool:
    r = run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", ssh_host, "true"])
    if r.returncode != 0:
        print(f"SSH reachability check FAILED for host '{ssh_host}':", file=sys.stderr)
        print(r.stderr.strip(), file=sys.stderr)
        return False
    print(f"SSH reachability check OK for host '{ssh_host}'.")
    return True


def deploy_one(
    ssh_host: str,
    container: str,
    remote_tmp_dir: str,
    local_path: Path,
) -> bool:
    filename = local_path.name
    remote_path = f"{remote_tmp_dir}/{filename}"
    local_hash = sha256_of(local_path)

    print(f"-- Deploying {local_path.relative_to(REPO_ROOT)} --")

    r = run(["ssh", ssh_host, "mkdir", "-p", remote_tmp_dir])
    if r.returncode != 0:
        print(f"  FAILED to create remote tmp dir: {r.stderr.strip()}", file=sys.stderr)
        return False

    r = run(["scp", str(local_path), f"{ssh_host}:{remote_path}"])
    if r.returncode != 0:
        print(f"  FAILED to copy workflow file: {r.stderr.strip()}", file=sys.stderr)
        return False

    r = run(["ssh", ssh_host, "sha256sum", remote_path])
    if r.returncode != 0:
        print(f"  FAILED to hash remote file: {r.stderr.strip()}", file=sys.stderr)
        return False
    remote_hash = r.stdout.split()[0] if r.stdout.strip() else ""
    if remote_hash != local_hash:
        print(f"  HASH MISMATCH — local {local_hash[:12]}... vs remote {remote_hash[:12]}...", file=sys.stderr)
        return False
    print(f"  hash/parity OK ({local_hash[:12]}...)")

    r = run(["ssh", ssh_host, "docker", "cp", remote_path, f"{container}:/tmp/{filename}"])
    if r.returncode != 0:
        print(f"  FAILED to copy into container: {r.stderr.strip()}", file=sys.stderr)
        return False

    r = run(
        [
            "ssh",
            ssh_host,
            "docker",
            "exec",
            container,
            "n8n",
            "import:workflow",
            f"--input=/tmp/{filename}",
        ]
    )
    print(f"  import result: {r.stdout.strip() or '(no stdout)'}")
    if r.returncode != 0:
        print(f"  IMPORT FAILED: {r.stderr.strip()}", file=sys.stderr)
        return False

    return verify_inactive(ssh_host, container, local_path)


def verify_inactive(ssh_host: str, container: str, local_path: Path) -> bool:
    """Export the just-imported workflow by id and confirm it is active: false."""
    wf_local = json.loads(local_path.read_text())
    workflow_id = wf_local["id"]
    workflow_name = wf_local["name"]

    container_tmp = f"/tmp/n8n-deploy-verify-{workflow_id}.json"
    host_tmp = f"/tmp/n8n-deploy-verify-{workflow_id}.json"

    run(["ssh", ssh_host, "docker", "exec", container, "rm", "-f", container_tmp])
    r = run(
        [
            "ssh",
            ssh_host,
            "docker",
            "exec",
            container,
            "n8n",
            "export:workflow",
            f"--id={workflow_id}",
            f"--output={container_tmp}",
        ]
    )
    if r.returncode != 0:
        print(f"  VERIFY FAILED — could not export workflow {workflow_id} for confirmation: {r.stderr.strip()}", file=sys.stderr)
        return False

    r = run(["ssh", ssh_host, "docker", "cp", f"{container}:{container_tmp}", host_tmp])
    if r.returncode != 0:
        print(f"  VERIFY FAILED — could not copy export out of container: {r.stderr.strip()}", file=sys.stderr)
        return False

    ok = True
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            local_tmp = Path(tmpdir) / "verify.json"
            r = run(["scp", f"{ssh_host}:{host_tmp}", str(local_tmp)])
            if r.returncode != 0:
                print(f"  VERIFY FAILED — could not retrieve export for confirmation: {r.stderr.strip()}", file=sys.stderr)
                return False

            wf_remote = json.loads(local_tmp.read_text())
            if isinstance(wf_remote, list):
                wf_remote = wf_remote[0] if wf_remote else {}
            active = wf_remote.get("active")
            print(f"  post-deploy state: name={workflow_name!r} active={active} id={workflow_id}")
            if active is not False:
                print(f"  VERIFY FAILED — workflow is active={active}, expected False", file=sys.stderr)
                ok = False
    finally:
        run(["ssh", ssh_host, "docker", "exec", container, "rm", "-f", container_tmp])
        run(["ssh", ssh_host, "rm", "-f", host_tmp])

    if ok:
        print("  verified inactive.")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ssh-host", default=DEFAULT_SSH_HOST)
    parser.add_argument("--container", help="n8n Docker container name (required for --confirm)")
    parser.add_argument("--remote-tmp-dir", default=DEFAULT_REMOTE_TMP_DIR)
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Actually deploy. Without this flag the script only validates and checks SSH reachability.",
    )
    args = parser.parse_args()

    files = load_manifest()
    print(f"Manifest lists {len(files)} workflow(s):")
    for f in files:
        print(f"  - {f.relative_to(REPO_ROOT)}")
    print()

    if not run_gate_checks(files):
        print("\nGate checks FAILED — refusing to proceed.", file=sys.stderr)
        return 1

    if not check_ssh_reachable(args.ssh_host):
        return 1

    if not args.confirm:
        print(
            "\nDry run complete: manifest is valid, gate checks passed, SSH is "
            "reachable. Re-run with --confirm --container <name> to deploy."
        )
        return 0

    if not args.container:
        print("\nerror: --container is required when using --confirm", file=sys.stderr)
        return 1

    all_ok = True
    for f in files:
        ok = deploy_one(args.ssh_host, args.container, args.remote_tmp_dir, f)
        all_ok = all_ok and ok
        print()

    if not all_ok:
        print("One or more workflows FAILED to deploy or verify. See above.", file=sys.stderr)
        return 1

    print("All workflows deployed and verified inactive.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
