#!/usr/bin/env python3
"""원본 '기능별 고객 제언' 표를 복제하여 DB의 초과 제언을 빠짐없이 수용한다.

새 표·스타일·HTML을 만들지 않는다. 리바랩스 원본 HWPX에 이미 있는 제목 문단과
2열 고객 제언 표를 deep-copy한 뒤 남은 DB 제언 행만 보존한다. 이 작업은 지면을
의도적으로 늘릴 수 있으므로 원본과 동일 페이지 수를 강제하지 않는 공양식 확장 단계다.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import sys
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}

# feature, title P, table P, table의 기본 행 수
BLOCKS = [
    ("펫과의 산책", 1793, 1794, 4),
    ("펫 성장 시스템", 1804, 1805, 4),
    ("실시간 위치 기반 거점형 콘텐츠", 1815, 1816, 4),
    ("펫 꾸미기", 1825, 1826, 3),
    ("펫 레이싱", 1833, 1834, 4),
    # 기능 6 제목은 원본의 복합 컨테이너라 직접 편집할 수 없다. 제목 스타일만 기능 5에서 복제한다.
    ("펫 교배", 1833, 1843, 3),
]


def load_editor(skill_dir: Path):
    source = skill_dir / "scripts" / "edit_hwpx.py"
    sys.path.insert(0, str(source.parent))
    spec = importlib.util.spec_from_file_location("hwpx_editor", source)
    if spec is None or spec.loader is None:
        raise SystemExit("HWPX 편집기를 불러오지 못했습니다.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def set_plain(paragraph, text: str) -> None:
    text_nodes = paragraph.xpath("./hp:run/hp:t", namespaces=NS)
    if not text_nodes:
        raise SystemExit("복제한 원본 블록의 편집 가능한 문단을 찾지 못했습니다.")
    for node in paragraph.xpath(".//hp:t", namespaces=NS):
        node.text = ""
        for child in node:
            child.tail = ""
    text_nodes[0].text = text
    for line_seg in paragraph.xpath(".//hp:linesegarray", namespaces=NS):
        line_seg.getparent().remove(line_seg)


def feature_actions(report):
    record = next((item for item in report.get("recommendations", []) if item.get("section") == "feature_customer_recommendations"), None)
    if not record:
        raise SystemExit("feature_customer_recommendations DB 결과가 없습니다.")
    data = json.loads(record["text"])
    return {
        item["featureName"]: [str(action).strip() for action in item.get("actions", []) if str(action).strip()]
        for item in data.get("features", []) if item.get("featureName")
    }


def keep_rows(table, count: int) -> list:
    rows = table.xpath("./hp:tr", namespaces=NS)
    if count < 1 or count > len(rows):
        raise SystemExit(f"표 행 수가 올바르지 않습니다: {count}/{len(rows)}")
    for row in rows[count:]:
        table.remove(row)
    table.set("rowCnt", str(count))
    size = table.find("hp:sz", namespaces=NS)
    if size is not None:
        height = sum(int(row.xpath("./hp:tc/hp:cellSz/@height", namespaces=NS)[0]) for row in rows[:count])
        size.set("height", str(height))
    return rows[:count]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--db-export", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skill-dir", type=Path, required=True)
    args = parser.parse_args()

    editor = load_editor(args.skill_dir)
    report = json.loads(args.db_export.read_text(encoding="utf-8"))
    actions_by_feature = feature_actions(report)
    with zipfile.ZipFile(args.source) as archive:
        section_bytes = archive.read("Contents/section1.xml")
    tree = etree.parse(__import__("io").BytesIO(section_bytes))
    root = tree.getroot()
    paragraphs = root.xpath(".//hp:p", namespaces=NS)
    insertions = []
    added_blocks = 0
    added_actions = 0

    for feature, title_index, table_index, capacity in BLOCKS:
        overflow = actions_by_feature.get(feature, [])[capacity:]
        if not overflow:
            continue
        original_title = paragraphs[title_index]
        original_table = paragraphs[table_index]
        title_copy = copy.deepcopy(original_title)
        set_plain(title_copy, f"[기능] {feature} · 추가 고객 제언")
        table_copy = copy.deepcopy(original_table)
        table = table_copy.xpath("./hp:run/hp:tbl", namespaces=NS)
        if len(table) != 1:
            raise SystemExit(f"{feature} 원본 고객 제언 표를 찾지 못했습니다.")
        rows = keep_rows(table[0], len(overflow))
        for number, (row, action) in enumerate(zip(rows, overflow), start=capacity + 1):
            cell_paragraphs = row.xpath("./hp:tc/hp:subList/hp:p", namespaces=NS)
            if len(cell_paragraphs) != 2:
                raise SystemExit(f"{feature} 원본 표 행의 셀 구조가 예상과 다릅니다.")
            set_plain(cell_paragraphs[0], f"고객 제언 {number}")
            set_plain(cell_paragraphs[1], action)
        insertions.append((original_table, title_copy, table_copy))
        added_blocks += 1
        added_actions += len(overflow)

    # 각 표 바로 뒤에 제목과 표를 넣는다. 원본 다음 기능 제목보다 앞에 배치되어 읽는 순서가 유지된다.
    for original_table, title_copy, table_copy in insertions:
        parent = original_table.getparent()
        position = parent.index(original_table) + 1
        parent.insert(position, title_copy)
        parent.insert(position + 1, table_copy)

    output_bytes = editor._serialize_xml_like_source(tree, section_bytes)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    editor.write_raw_preserving_zip(args.source, args.output, {"Contents/section1.xml": output_bytes})
    print(json.dumps({"addedBlocks": added_blocks, "addedActions": added_actions, "output": str(args.output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
