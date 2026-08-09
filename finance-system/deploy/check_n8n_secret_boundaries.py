#!/usr/bin/env python3
"""
Scans n8n workflow JSON files for accidentally embedded secrets before
they are committed or deployed.

Never prints matched secret values — only the file, node, and field where
a violation was found. See docs/n8n-operations-runbook.md.

Exit codes: 0 = clean, 1 = violations found, 2 = usage/parse error.
"""

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SCAN_DIRS = [REPO_ROOT / "n8n", REPO_ROOT / "deploy"]

# Field names that must never hold a literal (non-expression) value.
SENSITIVE_FIELD_NAMES = {
    "client_id",
    "clientid",
    "secret",
    "access_token",
    "accesstoken",
    "api_key",
    "apikey",
    "password",
    "token",
    "authorization",
}

# Token-shaped strings that indicate a real credential leaked into a file,
# regardless of which field they're in.
TOKEN_PATTERNS = [
    re.compile(r"\baccess-(sandbox|development|production)-[a-f0-9-]{20,}\b"),
    re.compile(r"\bsandbox-[a-f0-9]{24,}\b"),
    re.compile(r"\bpublic-(sandbox|development|production)-[a-f0-9-]{20,}\b"),
    re.compile(r"\bitem-(sandbox|development|production)-[a-f0-9-]{20,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"),  # generic API-key shape (e.g. Anthropic)
    re.compile(r"\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b"),  # JWT-shaped
]

N8N_EXPRESSION_PREFIX = "={{"


def is_expression(value: object) -> bool:
    return isinstance(value, str) and value.strip().startswith(N8N_EXPRESSION_PREFIX)


def find_token_shaped_string(value: str) -> str | None:
    for pattern in TOKEN_PATTERNS:
        if pattern.search(value):
            return pattern.pattern
    return None


def scan_node(node: dict, file_label: str, violations: list[str]) -> None:
    node_name = node.get("name", "<unnamed node>")
    params = node.get("parameters", {})

    def walk(obj, path):
        if isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, f"{path}.{k}" if path else k)
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                walk(v, f"{path}[{i}]")
        elif isinstance(obj, str):
            field_leaf = path.rsplit(".", 1)[-1].split("[")[0].lower()
            if field_leaf in SENSITIVE_FIELD_NAMES and obj.strip() and not is_expression(obj):
                violations.append(
                    f"{file_label}: node '{node_name}' field '{path}' holds a literal "
                    f"value in a sensitive field (must be an n8n expression, not a hardcoded value)"
                )
            match = find_token_shaped_string(obj)
            if match:
                violations.append(
                    f"{file_label}: node '{node_name}' field '{path}' contains a "
                    f"token-shaped string (matched pattern: {match})"
                )

    walk(params, "")

    # Credential blocks should only ever contain id/name references, never values.
    creds = node.get("credentials", {})
    for cred_type, cred_ref in creds.items():
        if isinstance(cred_ref, dict):
            for k, v in cred_ref.items():
                if k not in ("id", "name") and isinstance(v, str) and v.strip():
                    violations.append(
                        f"{file_label}: node '{node_name}' credential '{cred_type}' "
                        f"has unexpected field '{k}' (credentials must be id/name references only)"
                    )


def scan_file(path: Path, violations: list[str]) -> None:
    label = str(path.relative_to(REPO_ROOT)) if path.is_relative_to(REPO_ROOT) else str(path)
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as e:
        violations.append(f"{label}: could not parse as JSON ({e.msg} at line {e.lineno})")
        return

    if isinstance(data, dict) and "nodes" in data:
        for node in data.get("nodes", []):
            scan_node(node, label, violations)
    else:
        # Not a workflow export (e.g. a deploy manifest) — still scan for
        # token-shaped strings anywhere in the file.
        def walk_any(obj, path):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    walk_any(v, f"{path}.{k}" if path else k)
            elif isinstance(obj, list):
                for i, v in enumerate(obj):
                    walk_any(v, f"{path}[{i}]")
            elif isinstance(obj, str):
                match = find_token_shaped_string(obj)
                if match:
                    violations.append(
                        f"{label}: field '{path}' contains a token-shaped string "
                        f"(matched pattern: {match})"
                    )

        walk_any(data, "")


def main(argv: list[str]) -> int:
    targets: list[Path] = []
    if argv:
        targets = [Path(a) for a in argv]
    else:
        for d in DEFAULT_SCAN_DIRS:
            if d.exists():
                targets.extend(sorted(d.glob("*.json")))

    if not targets:
        print("No workflow JSON files found to scan.")
        return 0

    violations: list[str] = []
    for t in targets:
        if not t.exists():
            print(f"error: {t} does not exist", file=sys.stderr)
            return 2
        scan_file(t, violations)

    if violations:
        print(f"SECRET BOUNDARY CHECK FAILED — {len(violations)} violation(s):\n")
        for v in violations:
            print(f"  - {v}")
        print(
            "\nNo secret values are shown above by design. Fix the referenced "
            "field to use an n8n credential expression, then re-run this check."
        )
        return 1

    print(f"Secret boundary check passed for {len(targets)} file(s):")
    for t in targets:
        label = t.relative_to(REPO_ROOT) if t.is_relative_to(REPO_ROOT) else t
        print(f"  - {label}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
