#!/usr/bin/env python3
"""통합 공양식의 전략 과제/개선 과제 표에 저장된 DB 제언을 배치한다.

문구는 저장된 `feature_customer_recommendations`와 `dev_priority`에서만 취한다.
새 분석을 만들지 않고, 공양식의 3개 전략 영역과 개선 과제 표 스타일을 복제한다.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import io
import json
import sys
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}


def load_editor(skill_dir: Path):
    path = skill_dir / "scripts" / "edit_hwpx.py"
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location("hwpx_editor", path)
    if spec is None or spec.loader is None:
        raise SystemExit("HWPX 편집기를 불러오지 못했습니다.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def set_plain(paragraph, text: str) -> None:
    targets = paragraph.xpath("./hp:run/hp:t", namespaces=NS)
    if not targets:
        current = "".join(paragraph.xpath(".//hp:t//text()", namespaces=NS)).strip()
        raise SystemExit(f"공양식의 편집 가능한 문단을 찾지 못했습니다: {current!r}")
    for node in paragraph.xpath(".//hp:t", namespaces=NS):
        node.text = ""
        for child in node:
            child.tail = ""
    targets[0].text = text
    for lines in paragraph.xpath(".//hp:linesegarray", namespaces=NS):
        lines.getparent().remove(lines)


def actions_by_feature(report):
    record = next((item for item in report.get("recommendations", []) if item.get("section") == "feature_customer_recommendations"), None)
    if not record:
        raise SystemExit("feature_customer_recommendations가 없습니다.")
    parsed = json.loads(record["text"])
    return {item["featureName"]: item.get("actions", []) for item in parsed.get("features", [])}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--db-export", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skill-dir", type=Path, required=True)
    args = parser.parse_args()
    editor = load_editor(args.skill_dir)
    report = json.loads(args.db_export.read_text(encoding="utf-8"))
    actions = actions_by_feature(report)
    with zipfile.ZipFile(args.source) as archive:
        source_bytes = archive.read("Contents/section2.xml")
    tree = etree.parse(io.BytesIO(source_bytes))
    root = tree.getroot()
    paragraphs = root.xpath(".//hp:p", namespaces=NS)

    # 각 영역은 원본 표에 3개의 열(전략방향/과제/수행방안)과 두 줄을 갖는다.
    # 실제 문구는 기능별 고객 제언 JSON에서 가져온다.
    rows = [
        ("사용성 개선", "핵심 기능 신뢰도 확보", actions["펫과의 산책"][0], actions["펫과의 산책"][1]),
        ("신규 개발 기능", "성장·보상 체감 강화", actions["펫 성장 시스템"][1], actions["펫 성장 시스템"][4]),
        ("고객 확보", "온보딩 및 재참여 기반 마련", actions["펫 레이싱"][1], actions["펫 교배"][5]),
    ]
    # row starts: 26,45,64. 각 영역의 1/2번 항목에 '과제', '수행 방안'을 적는다.
    for start, (area, direction, task, delivery) in zip((26, 45, 64), rows):
        set_plain(paragraphs[start], area)
        # 빈 셀(P33/P34 등)은 건드리지 않고, 원본에서 실제 '-' 표식이 들어 있는
        # 문단만 수정한다. 각 두 행은 표의 세 열(방향/과제/수행방안)에 대응한다.
        for label_index, value_index, label, value in (
            (start + 3, start + 4, "1.", direction),
            (start + 5, start + 6, "2.", task),
            (start + 9, start + 10, "1.", task),
            (start + 11, start + 12, "2.", delivery),
            (start + 15, start + 16, "1.", direction),
            (start + 17, start + 18, "2.", delivery),
        ):
            set_plain(paragraphs[label_index], label)
            set_plain(paragraphs[value_index], f"- {value}")

    # 개선 과제 원형 표는 원본 P86 하나다. 3개의 우선 기능 과제로 스타일을 복제한다.
    prototype = paragraphs[86]
    task_specs = [
        ("개선 과제 1. 펫과의 산책", actions["펫과의 산책"][0], actions["펫과의 산책"][2]),
        ("개선 과제 2. 펫 성장 시스템", actions["펫 성장 시스템"][2], actions["펫 성장 시스템"][4]),
        ("개선 과제 3. 펫 교배", actions["펫 교배"][2], actions["펫 교배"][0]),
    ]
    task_blocks = [prototype] + [copy.deepcopy(prototype) for _ in task_specs[1:]]
    for block, (title, as_is, to_be) in zip(task_blocks, task_specs):
        parts = block.xpath(".//hp:p", namespaces=NS)
        if len(parts) < 12:
            raise SystemExit("개선 과제 원형 표 구조가 예상과 다릅니다.")
        set_plain(parts[0], title)
        set_plain(parts[1], "As Is")
        set_plain(parts[2], "To Be")
        set_plain(parts[5], f"[ {as_is} ]")
        set_plain(parts[8], f"[ {to_be} ]")
        set_plain(parts[11], "[ 저장된 DB 기능별 고객 제언 기반 ]")
    parent = prototype.getparent()
    insertion_point = parent.index(prototype) + 1
    for block in task_blocks[1:]:
        parent.insert(insertion_point, block)
        insertion_point += 1

    output = editor._serialize_xml_like_source(tree, source_bytes)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    editor.write_raw_preserving_zip(args.source, args.output, {"Contents/section2.xml": output})
    print(json.dumps({"output": str(args.output), "strategyAreas": len(rows), "improvementTasks": len(task_specs)}, ensure_ascii=False))


if __name__ == "__main__":
    raise SystemExit(main())
