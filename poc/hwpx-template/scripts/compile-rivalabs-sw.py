#!/usr/bin/env python3
"""리바랩스 원본을 최소 수정해 DB 분석 결과를 넣는 로컬 SW HWPX 컴파일러.

원본 ZIP의 변경하지 않는 모든 엔트리는 그대로 보존한다. 이 도구는 서비스 API가 아니라
POC 전용이며, 정성 파이프라인을 호출하거나 DB를 수정하지 않는다.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree


def load_editor(skill_dir: Path):
    script = skill_dir / "scripts" / "edit_hwpx.py"
    sys.path.insert(0, str(script.parent))
    spec = importlib.util.spec_from_file_location("hwpx_editor", script)
    if spec is None or spec.loader is None:
        raise SystemExit("HWPX 편집기를 불러오지 못했습니다.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def apply_identity(source: Path, output: Path, company: str, service: str, skill_dir: Path) -> None:
    editor = load_editor(skill_dir)
    replacements: dict[str, bytes] = {}
    with zipfile.ZipFile(source) as archive:
        header = archive.read("Contents/header.xml")
        char_styles = editor._parse_char_styles(header)
        entries = [name for name in archive.namelist() if name.startswith("Contents/section") and name.endswith(".xml")]
        for entry in entries:
            original = archive.read(entry)
            tree = editor._parse_xml(original)
            editor.replace_text(tree.getroot(), {"리바랩스": company, "캣독런": service}, char_styles)
            replacements[entry] = editor._serialize_xml_like_source(tree, original)
    editor.write_raw_preserving_zip(source, output, replacements)


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
    company = identity["companyName"]
    service = identity["serviceOrProductName"]
    if identity.get("productType") != "sw":
        raise SystemExit("이 컴파일러는 SW 리바랩스 원본 전용입니다.")

    with tempfile.TemporaryDirectory(prefix="rivalabs-sw-compile-") as temp:
        temp_dir = Path(temp)
        content_plan = temp_dir / "content-plan.json"
        qualitative_patches = temp_dir / "qualitative-patches.json"
        recommendation_patches = temp_dir / "recommendation-patches.json"
        recommendation_overflow = temp_dir / "recommendation-overflow.json"
        qualitative_out = temp_dir / "qualitative-filled.hwpx"
        recommendation_fitted = temp_dir / "recommendation-fitted.hwpx"
        recommendation_expanded = temp_dir / "recommendation-expanded.hwpx"
        run([
            "node", "poc/hwpx-template/scripts/build-content-plan.cjs",
            str(args.db_export), str(content_plan),
        ], args.project_root)
        run([
            "python3", "poc/hwpx-template/scripts/build-rivalabs-qualitative-patches.py",
            "--source", str(args.source), "--plan", str(content_plan), "--output", str(qualitative_patches),
        ], args.project_root)
        run([
            "python3", "scripts/apply-hwpx-template-patches.py", str(args.source),
            "--output", str(qualitative_out), "--patches", str(qualitative_patches),
            "--skill-dir", str(args.skill_dir),
        ], args.project_root)
        run([
            "python3", "poc/hwpx-template/scripts/build-rivalabs-recommendation-patches.py",
            "--source", str(args.source), "--db-export", str(args.db_export),
            "--output", str(recommendation_patches), "--overflow-output", str(recommendation_overflow),
        ], args.project_root)
        run([
            "python3", "scripts/apply-hwpx-template-patches.py", str(qualitative_out),
            "--output", str(recommendation_fitted), "--patches", str(recommendation_patches),
            "--skill-dir", str(args.skill_dir),
        ], args.project_root)
        run([
            "python3", "poc/hwpx-template/scripts/expand-rivalabs-recommendation-blocks.py",
            "--source", str(recommendation_fitted), "--db-export", str(args.db_export),
            "--output", str(recommendation_expanded), "--skill-dir", str(args.skill_dir),
        ], args.project_root)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        apply_identity(recommendation_expanded, args.output, company, service, args.skill_dir)
    # HWPX와 같은 입력 스냅샷에서 제언의 근거 manifest도 함께 만든다. 웹 UI는 이 파일을
    # '분석 근거' 패널로 표시할 수 있고, 문서 컴파일은 이 파일을 읽기만 한다.
    rationale_output = args.output.with_suffix(".analysis-rationale.json")
    run([
        "node", "poc/hwpx-template/scripts/build-recommendation-rationale.cjs",
        str(args.db_export), str(rationale_output),
    ], args.project_root)
    print(json.dumps({
        "output": str(args.output),
        "analysisRationale": str(rationale_output),
        "company": company,
        "service": service,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
