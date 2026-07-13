#!/usr/bin/env python3
"""Validate and install the product-owned code-agent skill."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import sys
import tempfile


SKILL_NAME = "finagent-workstation-service"
SOURCE = Path(__file__).resolve().parents[1] / "skills" / SKILL_NAME


def default_root(agent: str) -> Path:
    home = Path.home()
    if agent == "codex": return Path(os.environ.get("CODEX_HOME", home / ".codex")) / "skills"
    if agent == "claude": return Path(os.environ.get("CLAUDE_CONFIG_DIR", home / ".claude")) / "skills"
    if agent == "opencode": return Path(os.environ.get("OPENCODE_CONFIG_DIR", home / ".config" / "opencode")) / "skills"
    raise ValueError(f"unsupported agent: {agent}")


def validate(source: Path) -> None:
    required = [source / "SKILL.md", source / "agents" / "openai.yaml", source / "scripts" / "finagent_client.py"]
    missing = [str(path.relative_to(source)) for path in required if not path.is_file()]
    if missing: raise ValueError(f"invalid skill source; missing: {', '.join(missing)}")
    text = (source / "SKILL.md").read_text(encoding="utf-8")
    if not text.startswith("---\n") or f"name: {SKILL_NAME}\n" not in text: raise ValueError("SKILL.md frontmatter name does not match install name")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent", choices=("codex", "claude", "opencode"))
    parser.add_argument("--destination", type=Path, help="Skill root; install name is appended")
    args = parser.parse_args()
    if args.destination is None and args.agent is None: parser.error("provide --agent or --destination")
    validate(SOURCE)
    root = (args.destination or default_root(args.agent)).expanduser().resolve()
    target = root / SKILL_NAME
    if target.exists():
        existing = target / "SKILL.md"
        if not existing.is_file() or f"name: {SKILL_NAME}\n" not in existing.read_text(encoding="utf-8"):
            raise ValueError(f"refusing to overwrite unrelated install: {target}")
        if file_tree(SOURCE) == file_tree(target):
            print(target); return 0
    root.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{SKILL_NAME}-", dir=root))
    try:
        shutil.copytree(SOURCE, staging / SKILL_NAME)
        if target.exists(): shutil.rmtree(target)
        (staging / SKILL_NAME).replace(target)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    validate(target); print(target); return 0


def file_tree(root: Path):
    return {str(path.relative_to(root)): path.read_bytes() for path in root.rglob("*") if path.is_file()}


if __name__ == "__main__":
    try: raise SystemExit(main())
    except ValueError as error: print(str(error), file=sys.stderr); raise SystemExit(2)
