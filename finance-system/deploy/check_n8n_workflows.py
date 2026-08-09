#!/usr/bin/env python3
"""
Validates n8n workflow JSON structure and enforces deployment boundaries:
  - valid JSON with required top-level keys
  - active must be false (all deployed workflows start inactive)
  - no node may call a known money-movement Plaid endpoint
  - all node credentials are referenced by name/id, never inline

Prints only workflow name, node types, active state, and pass/fail —
never node parameter values. See docs/n8n-operations-runbook.md.

Exit codes: 0 = all valid, 1 = one or more workflows failed, 2 = usage error.
"""

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SCAN_DIR = REPO_ROOT / "n8n"

REQUIRED_KEYS = {"id", "name", "nodes", "connections", "active", "settings"}

# Plaid endpoint path fragments that move money or initiate transfers.
# Any HTTP Request node whose URL contains one of these fails validation.
MONEY_MOVEMENT_FRAGMENTS = [
    "/transfer/",
    "/payment_initiation/",
    "/deposit/",
    "/wallet/transaction",
]


def fail(msg: str, errors: list[str]) -> None:
    errors.append(msg)


def validate_workflow(path: Path) -> tuple[bool, dict]:
    label = str(path.relative_to(REPO_ROOT)) if path.is_relative_to(REPO_ROOT) else str(path)
    errors: list[str] = []
    report = {
        "file": label,
        "name": None,
        "active": None,
        "node_types": [],
    }

    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        fail(f"invalid JSON ({e.msg} at line {e.lineno})", errors)
        report["errors"] = errors
        return False, report

    missing = REQUIRED_KEYS - data.keys()
    if missing:
        fail(f"missing required key(s): {sorted(missing)}", errors)

    report["name"] = data.get("name")
    report["active"] = data.get("active")

    if data.get("active") is not False:
        fail(
            f"active must be false at deploy time, got {data.get('active')!r}",
            errors,
        )

    nodes = data.get("nodes", [])
    if not isinstance(nodes, list) or not nodes:
        fail("workflow has no nodes", errors)

    for node in nodes:
        node_type = node.get("type", "<unknown>")
        node_name = node.get("name", "<unnamed>")
        report["node_types"].append(node_type)

        if node_type == "n8n-nodes-base.httpRequest":
            url = node.get("parameters", {}).get("url", "")
            if isinstance(url, str):
                for fragment in MONEY_MOVEMENT_FRAGMENTS:
                    if fragment in url:
                        fail(
                            f"node '{node_name}' calls a money-movement endpoint "
                            f"(matched '{fragment}') — money movement is never allowed",
                            errors,
                        )

        creds = node.get("credentials", {})
        for cred_type, cred_ref in creds.items():
            if not isinstance(cred_ref, dict) or not cred_ref.get("name"):
                fail(
                    f"node '{node_name}' credential '{cred_type}' is not a "
                    f"named reference",
                    errors,
                )

    if errors:
        report["errors"] = errors
        return False, report

    return True, report


def main(argv: list[str]) -> int:
    if argv:
        targets = [Path(a) for a in argv]
    else:
        targets = sorted(DEFAULT_SCAN_DIR.glob("*.json")) if DEFAULT_SCAN_DIR.exists() else []

    if not targets:
        print("No workflow JSON files found to validate.")
        return 0

    all_ok = True
    for t in targets:
        if not t.exists():
            print(f"error: {t} does not exist", file=sys.stderr)
            return 2

        ok, report = validate_workflow(t)
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {report['file']}")
        print(f"  name:        {report['name']}")
        print(f"  active:      {report['active']}")
        print(f"  node types:  {', '.join(report['node_types']) or '(none)'}")
        if not ok:
            all_ok = False
            for err in report.get("errors", []):
                print(f"  ERROR: {err}")
        print()

    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
