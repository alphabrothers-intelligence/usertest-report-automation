#!/usr/bin/env python3
"""HWPX 내부 중립 의견 표 블록을 복제해 가변 카테고리를 수용하는 구조 POC.

원본의 표·문단·글자 스타일을 복사한다. 새 HTML이나 새 표 정의를 만들지 않는다.
이 파일은 페이지 수가 의도적으로 늘어나는 '공양식 확장' 실험이며, 기존 원본과
동일 쪽수를 지켜야 하는 결과물에는 사용하지 않는다.
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


def load_editor(skill_dir: Path):
    path = skill_dir / "scripts" / "edit_hwpx.py"
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location("hwpx_editor", path)
    if spec is None or spec.loader is None:
        raise SystemExit("HWPX 편집 스크립트를 불러오지 못했습니다.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def all_text(node: etree._Element) -> str:
    return "".join(node.xpath(".//hp:t//text()", namespaces=NS)).strip()


def set_plain(paragraph: etree._Element, text: str) -> None:
    nodes = paragraph.xpath("./hp:run/hp:t", namespaces=NS)
    if not nodes:
        raise SystemExit("복제 블록의 편집 가능한 문단을 찾지 못했습니다.")
    for node in paragraph.xpath(".//hp:t", namespaces=NS):
        node.text = ""
        for child in node:
            child.tail = ""
    nodes[0].text = text
    for line_seg in paragraph.xpath(".//hp:linesegarray", namespaces=NS):
        line_seg.getparent().remove(line_seg)


def quote(text: str) -> str:
    return f'“{text.strip().strip(chr(34)).strip("“”")}”'


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--db-export", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skill-dir", type=Path, required=True)
    args = parser.parse_args()

    editor = load_editor(args.skill_dir)
    report = json.loads(args.db_export.read_text(encoding="utf-8"))
    question = next(item for item in report["questions"] if item["question_key"] == "feature:펫과의 산책")
    categories = sorted(
        (item for item in question["categories"] if item.get("polarity") == "neutral"),
        key=lambda item: (-int(item.get("clauseCount", 0)), item["label"]),
    )
    if len(categories) < 2:
        raise SystemExit("확장할 중립 카테고리가 2개 이상 필요합니다.")

    with zipfile.ZipFile(args.source) as archive:
        source_section = archive.read("Contents/section1.xml")
    tree = etree.parse(__import__("io").BytesIO(source_section))
    root = tree.getroot()
    direct_paragraphs = root.xpath("./hp:p", namespaces=NS)
    prototype = next(
        paragraph for paragraph in direct_paragraphs
        if all_text(paragraph).startswith("3. 중립 의견 (21.7%)")
    )
    parent = prototype.getparent()
    insert_at = parent.index(prototype) + 1

    # 첫 블록은 이미 source에 있고, 남은 DB 카테고리만 같은 HWPX 표 블록으로 복제한다.
    for sequence, category in enumerate(categories[1:], start=2):
        block = copy.deepcopy(prototype)
        nested = block.xpath(".//hp:p", namespaces=NS)
        if len(nested) < 5:
            raise SystemExit("중립 의견 원형 블록의 내부 문단 구조가 예상과 다릅니다.")
        quotes = list(category.get("quotes") or [])
        set_plain(nested[0], f"3. 중립 의견 · 추가 분석 {sequence}")
        set_plain(nested[1], f"[{category['label']}]")
        set_plain(nested[2], quote(quotes[0]) if quotes else "대표 인용문 없음")
        set_plain(nested[3], quote(quotes[1]) if len(quotes) > 1 else "대표 인용문 없음")
        set_plain(nested[4], f"→ {category['insight']}")
        parent.insert(insert_at, block)
        insert_at += 1

    section_bytes = editor._serialize_xml_like_source(tree, source_section)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    editor.write_raw_preserving_zip(args.source, args.output, {"Contents/section1.xml": section_bytes})
    print(json.dumps({"addedBlocks": len(categories) - 1, "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
