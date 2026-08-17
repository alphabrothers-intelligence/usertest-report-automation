#!/usr/bin/env python3
"""원본 HWPX의 여러 section 문단을 최소 수정으로 채운다.

프로젝트의 출력 워커용 어댑터다. HWPX 스킬의 raw-ZIP 보존 편집기를 그대로 사용하되,
section0 한 곳만 고정하는 제약을 풀어 승인된 문단 패치만 순서대로 적용한다.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}


def load_editor(skill_dir: Path):
    script_dir = skill_dir / "scripts"
    if not (script_dir / "edit_hwpx.py").is_file():
        raise SystemExit(f"HWPX 편집기를 찾을 수 없습니다: {script_dir}")
    sys.path.insert(0, str(script_dir))
    spec = importlib.util.spec_from_file_location("hwpx_template_editor", script_dir / "edit_hwpx.py")
    if not spec or not spec.loader:
        raise SystemExit("HWPX 편집기를 불러올 수 없습니다.")
    module = importlib.util.module_from_spec(spec)
    # dataclass가 __module__을 통해 모듈 namespace를 찾을 수 있게 먼저 등록한다(Python 3.9 호환).
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def paragraph_text(paragraph) -> str:
    return "".join(paragraph.xpath(".//hp:t//text()", namespaces=NS)).strip()


def is_directly_editable(paragraph) -> bool:
    return not paragraph.xpath(".//hp:p", namespaces=NS) and bool(
        paragraph.xpath("./hp:run/hp:t", namespaces=NS)
    )


def validate_patches(input_path: Path, grouped: dict[int, list[dict]]) -> None:
    with ZipFile(input_path) as archive:
        for section_index, patches in grouped.items():
            entry = f"Contents/section{section_index}.xml"
            if entry not in archive.namelist():
                raise SystemExit(f"원본에 없는 섹션입니다: {entry}")
            root = etree.fromstring(archive.read(entry))
            paragraphs = root.xpath(".//hp:p", namespaces=NS)
            for patch in patches:
                index = patch["paragraphIndex"]
                if not isinstance(index, int) or index < 0 or index >= len(paragraphs):
                    raise SystemExit(f"{entry} 문단 위치가 올바르지 않습니다: {index}")
                paragraph = paragraphs[index]
                if not is_directly_editable(paragraph):
                    raise SystemExit(f"{entry} P{index}는 컨테이너 문단이라 직접 수정할 수 없습니다.")
                actual = paragraph_text(paragraph)
                if actual != patch["expectedText"]:
                    raise SystemExit(
                        f"{entry} P{index} 원본 앵커 불일치\n"
                        f"예상: {patch['expectedText']!r}\n실제: {actual!r}"
                    )


def main() -> int:
    parser = argparse.ArgumentParser(description="원본 HWPX 문단 안전 패치")
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--patches", required=True, type=Path)
    parser.add_argument(
        "--skill-dir",
        type=Path,
        default=os.environ.get("HWPX_SKILL_DIR"),
        help="HWPX 스킬 디렉터리. 워커 배포 시 환경변수 HWPX_SKILL_DIR로 지정한다.",
    )
    args = parser.parse_args()
    if not args.input.is_file() or not args.patches.is_file():
        raise SystemExit("원본 HWPX 또는 패치 JSON을 찾을 수 없습니다.")
    if not args.skill_dir:
        raise SystemExit("--skill-dir 또는 HWPX_SKILL_DIR가 필요합니다.")

    patches = json.loads(args.patches.read_text(encoding="utf-8"))
    if not isinstance(patches, list) or not patches:
        raise SystemExit("패치 JSON은 비어 있지 않은 배열이어야 합니다.")
    grouped: dict[int, list[dict]] = defaultdict(list)
    for patch in patches:
        if not all(key in patch for key in ("sectionIndex", "paragraphIndex", "expectedText", "text")):
            raise SystemExit("패치에 필수 키가 없습니다.")
        if not isinstance(patch["text"], str) or not patch["text"].strip():
            raise SystemExit("빈 문단 패치는 허용하지 않습니다.")
        grouped[patch["sectionIndex"]].append(patch)

    validate_patches(args.input, grouped)
    editor = load_editor(Path(args.skill_dir))
    args.output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="hwpx-template-") as temp_dir:
        current = args.input
        ordered_sections = sorted(grouped)
        for order, section_index in enumerate(ordered_sections):
            is_last = order == len(ordered_sections) - 1
            next_path = args.output if is_last else Path(temp_dir) / f"section{section_index}.hwpx"
            editor.SECTION_PATH = f"Contents/section{section_index}.xml"
            paragraph_targets = [
                editor.ParagraphTarget(index=patch["paragraphIndex"], text=patch["text"])
                for patch in grouped[section_index]
            ]
            editor._pack_from_original(current, next_path, {}, [], paragraph_targets)
            current = next_path
        if current != args.output:
            shutil.copyfile(current, args.output)

    print(f"PATCHED: {args.output}")
    print(f"  sections: {', '.join(str(index) for index in ordered_sections)}")
    print(f"  paragraphs: {sum(len(items) for items in grouped.values())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
