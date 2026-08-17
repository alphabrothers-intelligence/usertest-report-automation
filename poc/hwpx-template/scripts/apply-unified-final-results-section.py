#!/usr/bin/env python3
"""통합 공양식의 낡은 결과 장을 공통 '종합 결과 및 제언' 구조로 교체한다."""
from __future__ import annotations

import argparse
import copy
import importlib.util
import io
import sys
import zipfile
from pathlib import Path

from lxml import etree
from PIL import Image

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}


def load_module(script: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, script)
    if spec is None or spec.loader is None:
        raise SystemExit(f"도구를 불러오지 못했습니다: {script}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def paragraph_text(paragraph: etree._Element) -> str:
    return " ".join("".join(paragraph.xpath(".//hp:t//text()", namespaces=NS)).split())


def reset_ids(element: etree._Element, seed: int) -> None:
    next_id = seed
    for item in element.xpath(".//*[local-name()='p' or local-name()='tbl']"):
        item.set("id", str(next_id))
        next_id += 1


STATIC_TEXT = {
    "Ⅷ", "종합 결과 및 제언", "1", "2", "3",
    "1. 사용성테스트 결과 요약", "1. 사용성 테스트 결과 요약", "사용성테스트 결과 요약",
    "2. 개선 전략 제언", "개선 전략 제언", "개선 전략", "전반적 방향성",
    "3. 기능별 고객 제언 종합", "기능별 고객 제언 종합",
    "항목", "주요 의견", "기능별 고객 경험 평가",
    "기능명", "평균 만족도(점)", "상대 중요도", "긍정 비율(%)", "중립 비율(%)", "부정 의견(%)",
    "전반적 방향성", "개발 우선순위 제언", "기능 개선 제안",
    "고객 제언 1", "고객 제언 2", "고객 제언 3", "고객 제언 4",
}


def blank_dynamic_text(section: etree._Element) -> None:
    """표·페이지 프레임은 보존하고, 케어클 사례 수치/문장/기능명만 비운다."""
    for paragraph in section.xpath(".//hp:p", namespaces=NS):
        # 내부 문단을 가진 컨테이너의 합산 텍스트는 건드리지 않는다.
        if paragraph.xpath(".//hp:p", namespaces=NS):
            continue
        text = paragraph_text(paragraph)
        if text in STATIC_TEXT or text.startswith("고객 제언 ") or text.startswith("[기능 "):
            continue
        for node in paragraph.xpath(".//hp:t", namespaces=NS):
            node.text = ""
            for child in node:
                child.tail = ""


def _set_leaf_paragraph_text(paragraph: etree._Element, value: str) -> None:
    """한글 표 셀의 기존 서식을 유지한 채, 대표 텍스트 런 하나만 채운다."""
    text_nodes = paragraph.xpath("./hp:run/hp:t", namespaces=NS)
    if not text_nodes:
        raise SystemExit("요약 표의 텍스트 런을 찾지 못했습니다.")
    text_nodes[0].text = value
    for node in text_nodes[1:]:
        node.text = ""


def restore_common_summary_frame(summary_table_block: etree._Element) -> None:
    """빈 공양식에서도 결과 요약 표의 의미·열 제목은 보이게 복원한다.

    사례 기능명과 수치는 비워야 하지만, 표의 머리글까지 지우면 사용자가 표의
    용도를 알 수 없다. 이 함수는 원본 리바랩스 2×2 요약표와 내부 7×6 수치표의
    고정 헤더만 명시적으로 복원한다.
    """
    tables = summary_table_block.xpath(".//hp:tbl", namespaces=NS)
    outer = next((t for t in tables if (t.get("rowCnt"), t.get("colCnt")) == ("2", "2")), None)
    metrics = next((t for t in tables if (t.get("rowCnt"), t.get("colCnt")) == ("7", "6")), None)
    if outer is None or metrics is None:
        raise SystemExit("공통 사용성테스트 결과 요약의 2×2/7×6 표 프레임을 찾지 못했습니다.")
    outer_cells = outer.xpath("./hp:tr/hp:tc", namespaces=NS)
    if len(outer_cells) != 4:
        raise SystemExit("공통 결과 요약 표의 셀 구조가 원본과 다릅니다.")

    def set_cell(cell: etree._Element, value: str) -> None:
        leaves = [p for p in cell.xpath(".//hp:p", namespaces=NS) if not p.xpath(".//hp:p", namespaces=NS)]
        if not leaves:
            raise SystemExit("공통 결과 요약 표의 셀 문단을 찾지 못했습니다.")
        _set_leaf_paragraph_text(leaves[0], value)

    set_cell(outer_cells[0], "항목")
    set_cell(outer_cells[1], "주요 의견")
    set_cell(outer_cells[2], "기능별 고객 경험 평가")
    metric_headers = ["기능명", "평균 만족도(점)", "상대 중요도", "긍정 비율(%)", "중립 비율(%)", "부정 의견(%)"]
    for cell, label in zip(metrics.xpath("./hp:tr[1]/hp:tc", namespaces=NS), metric_headers):
        set_cell(cell, label)


def replace_toc_text(section: etree._Element) -> None:
    replacements = {
        "7. 사용성 테스트 분석 결과": "7. 종합 결과 및 제언",
        "Part 4. 결과 종합 및 SW 개선방안": "",
        "1. 전략 과제 및 세부 수행 방안 도출": "2. 개선 전략 제언",
        "2. 개선 과제": "3. 기능별 고객 제언 종합",
    }
    for node in section.xpath(".//hp:t", namespaces=NS):
        if node.text:
            for old, new in replacements.items():
                node.text = node.text.replace(old, new)
    # 1번 항목은 기존 일반 공양식의 빈 목차 행이었다. 같은 문단 서식을 유지해 채운다.
    # 목차 항목은 첫 컨테이너 표 안의 내부 문단이므로 전체 문단에서 찾는다.
    direct = section.xpath(".//hp:p", namespaces=NS)
    overall = next((
        item for item in direct
        if paragraph_text(item).startswith("7.")
        and ("사용성" in paragraph_text(item) or "종합 결과" in paragraph_text(item))
    ), None)
    if overall is None or overall.getnext() is None:
        raise SystemExit("목차의 '종합 결과 및 제언' 행을 찾지 못했습니다.")
    overall_texts = overall.xpath("./hp:run/hp:t", namespaces=NS)
    if not overall_texts:
        raise SystemExit("목차 7번 행의 텍스트 런을 찾지 못했습니다.")
    overall_texts[0].text = " 7. 종합 결과 및 제언 "
    for node in overall_texts[1:]:
        if not node.xpath("./hp:tab", namespaces=NS):
            node.text = ""
    first_item = overall.getnext()
    run = first_item.xpath("./hp:run", namespaces=NS)[0]
    text_node = run.find("{http://www.hancom.co.kr/hwpml/2011/paragraph}t")
    if text_node is None:
        text_node = etree.SubElement(run, "{http://www.hancom.co.kr/hwpml/2011/paragraph}t")
    text_node.text = " 1. 사용성 테스트 결과 요약"


def insert_common_improvement_ideas(
    section1_root: etree._Element,
    rivalabs_section: etree._Element,
    rivalabs_header: etree._Element,
    target_header: etree._Element,
    injector,
) -> None:
    """NPS 장의 공통 '2. 개선 아이디어' 프레임을 리바랩스 원본 기준으로 복원한다."""
    # 원본의 직접 문단을 사용한다. .//hp:p 인덱스는 표 내부 문단까지 포함하므로
    # 섹션 구조가 바뀌면 엉뚱한 블록을 복사할 위험이 있다.
    rivalabs_paragraphs = rivalabs_section.xpath("./hp:p", namespaces=NS)
    heading = copy.deepcopy(rivalabs_paragraphs[167])
    content = copy.deepcopy(rivalabs_paragraphs[168])
    staging = etree.Element("staging")
    staging.extend([heading, content])
    injector.remove_picture_objects(staging)
    injector.import_style_dependencies(staging, rivalabs_header, target_header)
    # 질문·원본 인용문·분석 내용은 지우고 장 제목/표 프레임만 둔다.
    for paragraph in staging.xpath(".//hp:p", namespaces=NS):
        if paragraph.xpath(".//hp:p", namespaces=NS):
            continue
        text = paragraph_text(paragraph)
        if text in {"2", "개선 아이디어", "주요 의견 종합"}:
            continue
        for node in paragraph.xpath(".//hp:t", namespaces=NS):
            node.text = ""
            for child in node:
                child.tail = ""
    direct = section1_root.xpath("./hp:p", namespaces=NS)
    # NPS 제목 바로 뒤가 아니라 NPS의 그래프/결과표 뒤, 다음 장 제목 직전에 둔다.
    # 그래야 '종합 만족도 및 NPS 지수 > 2. 개선 아이디어' 순서가 실제 페이지에서도 유지된다.
    final_heading = next((
        item for item in direct
        if "사용성 테스트 분석 결과" in paragraph_text(item)
        and any((table.get("rowCnt"), table.get("colCnt")) == ("1", "2")
                for table in item.xpath(".//hp:tbl", namespaces=NS))
    ), None)
    if final_heading is None:
        raise SystemExit("개선 아이디어를 삽입할 NPS 다음 장을 찾지 못했습니다.")
    insertion_at = direct.index(final_heading)
    for offset, block in enumerate(staging):
        reset_ids(block, 929_000_000 + offset * 10_000)
        section1_root.insert(insertion_at + offset, block)


def transparent_image(original: bytes, filename: str) -> bytes:
    """원본의 사진/그래프 픽셀만 없애고, HWPX 패키지의 그림 참조는 안전하게 유지한다."""
    with Image.open(io.BytesIO(original)) as source:
        mode = "RGBA" if "A" in source.getbands() else "RGB"
        fill = (255, 255, 255, 0) if mode == "RGBA" else (255, 255, 255)
        canvas = Image.new(mode, source.size, fill)
        output = io.BytesIO()
        canvas.save(output, format="JPEG" if filename.lower().endswith(".jpg") else "PNG")
        return output.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--common-source", type=Path, required=True)
    parser.add_argument("--carecl-source", type=Path, required=True)
    parser.add_argument("--rivalabs-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skill-dir", type=Path, required=True)
    args = parser.parse_args()
    injector = load_module(Path(__file__).with_name("inject-carecl-shared-polarity-module.py"), "common_final_injector")
    editor = injector.load_editor(args.skill_dir)
    xml_parser = etree.XMLParser(remove_blank_text=False, resolve_entities=False)

    with zipfile.ZipFile(args.common_source) as archive:
        section1_bytes = archive.read("Contents/section1.xml")
        section2_bytes = archive.read("Contents/section2.xml")
        header_bytes = archive.read("Contents/header.xml")
    with zipfile.ZipFile(args.rivalabs_source) as archive:
        rivalabs_section1 = etree.fromstring(archive.read("Contents/section1.xml"))
        rivalabs_header = etree.fromstring(archive.read("Contents/header.xml"))

    section1_tree = etree.parse(io.BytesIO(section1_bytes), xml_parser)
    section2_tree = etree.parse(io.BytesIO(section2_bytes), xml_parser)
    header_tree = etree.parse(io.BytesIO(header_bytes), xml_parser)
    rivalabs_direct = rivalabs_section1.xpath("./hp:p", namespaces=NS)
    # 리바랩스 원본의 공통 결과 장은 실제로 다음 구조를 갖는다.
    # 170: 장 제목, 171: 결과 요약 제목, 172: 결과 요약 표,
    # 175: 개선 전략 제언, 176: 기능별 고객 제언 종합, 177~178: 반복 가능한 기능 제언 프레임.
    # 케어클의 6×2 고객여정 표는 실제품 전용이므로 공통 양식에 사용하지 않는다.
    blocks = [copy.deepcopy(rivalabs_direct[index]) for index in (170, 171, 172, 175, 176, 177, 178)]
    staging = etree.Element("staging")
    for block in blocks:
        staging.append(block)
    injector.remove_picture_objects(staging)
    injector.import_style_dependencies(staging, rivalabs_header, header_tree.getroot())
    blank_dynamic_text(staging)

    # 반복 블록의 원본 기능명을 공통 양식의 명확한 슬롯명으로 전환한다.
    feature_label = next((p for p in staging.xpath(".//hp:p", namespaces=NS)
                          if paragraph_text(p).startswith("[기능 1]")), None)
    if feature_label is not None:
        text_node = feature_label.xpath(".//hp:t", namespaces=NS)[0]
        text_node.text = "[기능명]"

    section1_root = section1_tree.getroot()
    direct = section1_root.xpath("./hp:p", namespaces=NS)
    # 목차에도 같은 문구가 있으므로, 실제 본문 장 제목의 1×2 제목표까지 확인한다.
    old_heading = next((
        item for item in direct
        if "사용성 테스트 분석 결과" in paragraph_text(item)
        and any((table.get("rowCnt"), table.get("colCnt")) == ("1", "2")
                for table in item.xpath(".//hp:tbl", namespaces=NS))
    ), None)
    if old_heading is None:
        raise SystemExit("교체할 기존 '사용성 테스트 분석 결과' 장을 찾지 못했습니다.")
    old_summary = old_heading.getnext()
    if old_summary is None or etree.QName(old_summary).localname != "p":
        raise SystemExit("기존 결과 요약 표를 찾지 못했습니다.")
    # 아직 기존 다음 장 제목이 남아 있을 때 삽입 위치를 계산한다.
    insert_common_improvement_ideas(section1_root, rivalabs_section1, rivalabs_header, header_tree.getroot(), injector)
    new_title, new_summary_heading, new_summary_table, *remaining = list(staging)
    restore_common_summary_frame(new_summary_table)
    reset_ids(new_title, 930_000_000)
    reset_ids(new_summary_heading, 930_010_000)
    reset_ids(new_summary_table, 930_020_000)
    old_heading.getparent().replace(old_heading, new_title)
    old_summary.getparent().replace(old_summary, new_summary_heading)
    new_summary_heading.addnext(new_summary_table)
    replace_toc_text(section1_root)

    # 이전 일반 양식 section2의 '전략 과제' 장은 제거하고, 같은 위치에 공통 2·3번 블록을 넣는다.
    section2_root = section2_tree.getroot()
    section2_direct = section2_root.xpath("./hp:p", namespaces=NS)
    if not section2_direct:
        raise SystemExit("통합 공양식의 section2 초기 문단을 찾지 못했습니다.")
    for item in section2_direct[1:]:
        section2_root.remove(item)
    for index, item in enumerate(remaining, start=1):
        reset_ids(item, 931_000_000 + index * 10_000)
        section2_root.append(item)

    output_section1 = editor._serialize_xml_like_source(section1_tree, section1_bytes)
    output_section2 = editor._serialize_xml_like_source(section2_tree, section2_bytes)
    output_header = editor._serialize_xml_like_source(header_tree, header_bytes)
    # 일반 공양식이 가진 예시 서비스의 검은 표지/사진/그래프는 공통 양식에 남기지 않는다.
    with zipfile.ZipFile(args.common_source) as archive:
        image_replacements = {
            name: transparent_image(archive.read(name), name)
            for name in archive.namelist()
            if name.startswith("BinData/image") and Path(name).stem != "image4"  # 제작사 로고만 유지
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    editor.write_raw_preserving_zip(args.common_source, args.output, {
        "Contents/header.xml": output_header,
        "Contents/section1.xml": output_section1,
        "Contents/section2.xml": output_section2,
        **image_replacements,
    })
    print(f"APPLIED: {args.output} (종합 결과 및 제언 1·2·3 구조)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
