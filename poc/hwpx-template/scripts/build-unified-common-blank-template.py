#!/usr/bin/env python3
"""공통 기본 공양식에 리바랩스 정성 분석 프레임을 적용한다.

기존 일반 공양식을 단순히 복사하지 않는다. 일반 공양식의 공통 장(개요·기능별 평가·
4대 가치·구매요소·NPS·종합 결과·제언)은 보존하고, 기능별 정성 영역만 현재 확정된
리바랩스 프레임으로 통일한다. SW/실제품 전용 장은 이 파일에 억지로 섞지 않으며,
보고서 생성 때 선택 블록으로 뒤에 삽입하는 기준 공양식이다.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import io
import sys
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}
RIVALABS_BLOCKS = (232, 238, 255, 277, 326)
# 일반 공양식의 기능별 5개 블록: 분포/키워드, 긍정, 부정+중립 순서다.
COMMON_FEATURE_TARGETS = (
    (123, 136, 143),
    (162, 175, 182),
    (201, 214, 221),
    (240, 253, 260),
    (279, 292, 299),
)


def load_module(script: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, script)
    if spec is None or spec.loader is None:
        raise SystemExit(f"도구를 불러오지 못했습니다: {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def only_table(paragraph: etree._Element, expected: tuple[str, str]) -> etree._Element:
    tables = [table for table in paragraph.xpath(".//hp:tbl", namespaces=NS)
              if (table.get("rowCnt"), table.get("colCnt")) == expected]
    if len(tables) != 1:
        raise SystemExit(f"예상한 {expected[0]}×{expected[1]} 표를 찾지 못했습니다.")
    return tables[0]


def set_unique_object_ids(wrapper: etree._Element, sequence: int) -> None:
    """복제된 문단/표 ID가 문서 안에서 충돌하지 않도록 재할당한다."""
    next_id = 910_000_000 + sequence * 10_000
    for element in wrapper.xpath(".//*[local-name()='p' or local-name()='tbl']"):
        element.set("id", str(next_id))
        next_id += 1


def clear_cover_examples(root: etree._Element) -> None:
    """표지에 남은 예시 값만 지우고, '발주처/사업명' 같은 양식 레이블은 남긴다."""
    for text in root.xpath(".//hp:t", namespaces=NS):
        value = text.text or ""
        # 표지의 날짜는 원본에서 두 런으로 나뉘어 있어 개별적으로 비운다.
        if value in {"2024.", "00.00", "기업명"}:
            text.text = ""
        elif value.startswith("발주처 l "):
            text.text = "발주처 l "
        elif value.startswith("사업명 l "):
            text.text = "사업명 l "


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--common-source", type=Path, required=True)
    parser.add_argument("--rivalabs-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skill-dir", type=Path, required=True)
    args = parser.parse_args()

    injector = load_module(Path(__file__).with_name("inject-carecl-shared-polarity-module.py"), "shared_module_injector")
    editor = injector.load_editor(args.skill_dir)
    parser_xml = etree.XMLParser(remove_blank_text=False, resolve_entities=False)

    with zipfile.ZipFile(args.common_source) as archive:
        common_section_bytes = archive.read("Contents/section1.xml")
        common_header_bytes = archive.read("Contents/header.xml")
        cover_bytes = archive.read("Contents/section0.xml")
    with zipfile.ZipFile(args.rivalabs_source) as archive:
        rivalabs_section = etree.fromstring(archive.read("Contents/section1.xml"))
        rivalabs_header = etree.fromstring(archive.read("Contents/header.xml"))

    common_tree = etree.parse(io.BytesIO(common_section_bytes), parser_xml)
    header_tree = etree.parse(io.BytesIO(common_header_bytes), parser_xml)
    cover_tree = etree.parse(io.BytesIO(cover_bytes), parser_xml)
    common_paragraphs = common_tree.getroot().xpath(".//hp:p", namespaces=NS)
    rivalabs_paragraphs = rivalabs_section.xpath(".//hp:p", namespaces=NS)
    distribution, summary, positive, negative, neutral = [copy.deepcopy(rivalabs_paragraphs[index]) for index in RIVALABS_BLOCKS]

    # 한 번만 글꼴/문단/테두리 의존성을 이식한다. 이후 각 기능에는 동일 프레임을 복제한다.
    dependencies = etree.Element("dependencies")
    for block in (distribution, summary, positive, negative, neutral):
        dependencies.append(copy.deepcopy(block))
    injector.remove_picture_objects(dependencies)  # 이전 보고서의 그래프 값이 담긴 bitmap은 남기지 않는다.
    injector.normalize_summary_heading_weight(dependencies)
    injector.import_style_dependencies(dependencies, rivalabs_header, header_tree.getroot())
    prepared = list(dependencies)

    for ordinal, (distribution_index, positive_index, negative_index) in enumerate(COMMON_FEATURE_TARGETS, start=1):
        target_distribution = common_paragraphs[distribution_index]
        target_positive = common_paragraphs[positive_index]
        target_negative = common_paragraphs[negative_index]
        distribution_table = only_table(target_distribution, ("5", "4"))
        positive_table = only_table(target_positive, ("2", "1"))
        negative_tables = [table for table in target_negative.xpath(".//hp:tbl", namespaces=NS)
                           if (table.get("rowCnt"), table.get("colCnt")) == ("2", "1")]
        if len(negative_tables) != 2:
            raise SystemExit("부정/중립 의견 표 2개를 찾지 못했습니다.")

        copied_distribution, copied_summary, copied_positive, copied_negative, copied_neutral = [copy.deepcopy(item) for item in prepared]
        for offset, block in enumerate((copied_distribution, copied_summary, copied_positive, copied_negative, copied_neutral)):
            set_unique_object_ids(block, ordinal * 10 + offset)
        # 분포·워드클라우드 표와 감정/요약 표는 별도 문단이어야 페이지 흐름이 원본처럼 유지된다.
        distribution_table.getparent().replace(distribution_table, copied_distribution.xpath(".//hp:tbl", namespaces=NS)[0])
        target_distribution.addnext(copied_summary)
        positive_table.getparent().replace(positive_table, copied_positive.xpath(".//hp:tbl", namespaces=NS)[0])
        negative_tables[0].getparent().replace(negative_tables[0], copied_negative.xpath(".//hp:tbl", namespaces=NS)[0])
        negative_tables[1].getparent().replace(negative_tables[1], copied_neutral.xpath(".//hp:tbl", namespaces=NS)[0])

    clear_cover_examples(cover_tree.getroot())
    output_section = editor._serialize_xml_like_source(common_tree, common_section_bytes)
    output_header = editor._serialize_xml_like_source(header_tree, common_header_bytes)
    output_cover = editor._serialize_xml_like_source(cover_tree, cover_bytes)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    editor.write_raw_preserving_zip(args.common_source, args.output, {
        "Contents/header.xml": output_header,
        "Contents/section0.xml": output_cover,
        "Contents/section1.xml": output_section,
    })
    print(f"BUILT: {args.output} (common base + 5 Rivalabs-style qualitative frames)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
