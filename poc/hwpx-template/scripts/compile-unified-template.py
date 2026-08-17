#!/usr/bin/env python3
"""통합 공양식의 공통 분석·전략·개선 과제를 한 번에 컴파일하는 로컬 진입점."""
from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path


def run(command: list[str], cwd: Path) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--db-export", type=Path, required=True)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--project-root", type=Path, required=True)
    parser.add_argument("--skill-dir", type=Path, required=True)
    args = parser.parse_args()
    identity = json.loads(args.identity.read_text(encoding="utf-8"))
    if identity.get("templateVariant") != "unified":
        raise SystemExit("통합 컴파일에는 templateVariant: 'unified'가 필요합니다.")
    with tempfile.TemporaryDirectory(prefix="unified-template-compile-") as temp:
        common_output = Path(temp) / "common-analysis.hwpx"
        run([
            "python3", "poc/hwpx-template/scripts/compile-unified-template-poc.py",
            "--source", str(args.source), "--db-export", str(args.db_export),
            "--identity", str(args.identity), "--output", str(common_output),
            "--skill-dir", str(args.skill_dir),
        ], args.project_root)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        run([
            "python3", "poc/hwpx-template/scripts/fill-unified-recommendation-sections.py",
            "--source", str(common_output), "--db-export", str(args.db_export),
            "--output", str(args.output), "--skill-dir", str(args.skill_dir),
        ], args.project_root)
    print(json.dumps({
        "output": str(args.output),
        "variant": "unified",
        "included": ["common feature analysis", "four values base slots", "purchase factor base slots", "NPS base slots", "strategy tasks", "improvement tasks"],
        "pendingTemplateBlocks": ["physical customer journey", "physical product use-context"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
