#!/usr/bin/env python3
"""케어클 원본 기반 공양식에 리바랩스 공통 정성 분석 프레임을 삽입한다.

문서의 분석 데이터는 넣지 않는다. 이미 비워진 리바랩스 SW 공양식의 첫 번째 공통
정성 분석 표만 복제해, 케어클의 각 기능 블록에 있던 '키워드 도출 및 비율' 표를
대체한다. 이 도구는 로컬 HWPX POC 전용이며 서비스·DB·분석 파이프라인을 건드리지 않는다.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import sys
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}
CARECL_MODULE_CONTAINERS = (321, 416, 500, 582, 650, 697, 753, 811)
RIVALABS_MODULE_CONTAINER = 238


def load_editor(skill_dir: Path):
    script = skill_dir / "scripts" / "edit_hwpx.py"
    sys.path.insert(0, str(script.parent))
    spec = importlib.util.spec_from_file_location("hwpx_template_editor", script)
    if spec is None or spec.loader is None:
        raise SystemExit("HWPX 편집기를 불러오지 못했습니다.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _style_map(header: etree._Element, local_name: str) -> dict[str, etree._Element]:
    return {element.get("id"): element for element in header.xpath(f".//*[local-name()='{local_name}']") if element.get("id")}


def _append_styles(
    source_header: etree._Element,
    target_header: etree._Element,
    local_name: str,
    source_ids: set[str],
) -> tuple[dict[str, str], list[etree._Element]]:
    """Copy named header styles with fresh IDs and return source→target mapping."""
    if not source_ids:
        return {}, []
    source_styles = _style_map(source_header, local_name)
    target_styles = list(_style_map(target_header, local_name).values())
    target_parent = target_styles[0].getparent() if target_styles else None
    if target_parent is None:
        raise SystemExit(f"케어클 header.xml에 {local_name} 목록이 없습니다.")
    next_id = max((int(item.get("id", "0")) for item in target_styles if item.get("id", "").isdigit()), default=0) + 1
    remap: dict[str, str] = {}
    copied: list[etree._Element] = []
    for source_id in sorted(source_ids, key=int):
        source_style = source_styles.get(source_id)
        if source_style is None:
            raise SystemExit(f"리바랩스 header.xml에 {local_name} ID {source_id}가 없습니다.")
        clone = copy.deepcopy(source_style)
        clone.set("id", str(next_id))
        target_parent.append(clone)
        remap[source_id] = str(next_id)
        copied.append(clone)
        next_id += 1
    if "itemCnt" in target_parent.attrib:
        target_parent.set("itemCnt", str(len(target_parent)))
    return remap, copied


def _append_fonts(
    source_header: etree._Element,
    target_header: etree._Element,
    font_ids_by_language: dict[str, set[str]],
) -> dict[str, dict[str, str]]:
    """Copy each font in every language family: font IDs are document-local too."""
    source_families = {item.get("lang"): item for item in source_header.xpath(".//*[local-name()='fontface']")}
    target_families = {item.get("lang"): item for item in target_header.xpath(".//*[local-name()='fontface']")}
    remaps: dict[str, dict[str, str]] = {}
    for language, source_ids in font_ids_by_language.items():
        if not source_ids:
            continue
        source_family = source_families.get(language)
        target_family = target_families.get(language)
        if source_family is None or target_family is None:
            raise SystemExit(f"{language} 글꼴 목록을 찾지 못했습니다.")
        source_fonts = {item.get("id"): item for item in source_family.xpath("./*[local-name()='font']")}
        existing = [item for item in target_family.xpath("./*[local-name()='font']") if item.get("id", "").isdigit()]
        next_id = max((int(item.get("id")) for item in existing), default=-1) + 1
        remap: dict[str, str] = {}
        for source_id in sorted(source_ids, key=int):
            source_font = source_fonts.get(source_id)
            if source_font is None:
                raise SystemExit(f"리바랩스 {language} 글꼴 ID {source_id}를 찾지 못했습니다.")
            clone = copy.deepcopy(source_font)
            clone.set("id", str(next_id))
            target_family.append(clone)
            remap[source_id] = str(next_id)
            next_id += 1
        target_family.set("fontCnt", str(len(target_family.xpath("./*[local-name()='font']"))))
        remaps[language] = remap
    return remaps


def import_style_dependencies(prototype: etree._Element, source_header: etree._Element, target_header: etree._Element) -> None:
    """리바랩스 표와 그 서식 의존성 전체를 케어클 ID 체계로 이식한다.

    HWPX의 글꼴·문단·테두리·탭 ID는 문서마다 독립적이다. 표의 직접 참조만 바꾸면
    같은 ID가 케어클의 다른 글꼴/테두리를 가리켜 '묘하게 다른' 화면이 된다.
    """
    char_ids = {element.get("charPrIDRef") for element in prototype.xpath(".//*[@charPrIDRef]") if element.get("charPrIDRef")}
    para_ids = {element.get("paraPrIDRef") for element in prototype.xpath(".//*[@paraPrIDRef]") if element.get("paraPrIDRef")}
    direct_border_ids = {element.get("borderFillIDRef") for element in prototype.xpath(".//*[@borderFillIDRef]") if element.get("borderFillIDRef")}
    source_chars = _style_map(source_header, "charPr")
    source_paras = _style_map(source_header, "paraPr")

    # Styles may themselves refer to borders and tabs, so import that closure too.
    nested_border_ids = set(direct_border_ids)
    tab_ids: set[str] = set()
    font_ids_by_language: dict[str, set[str]] = {}
    for source_id in char_ids:
        style = source_chars[source_id]
        if style.get("borderFillIDRef"):
            nested_border_ids.add(style.get("borderFillIDRef"))
        for font_ref in style.xpath(".//*[local-name()='fontRef']"):
            for language, font_id in font_ref.attrib.items():
                font_ids_by_language.setdefault(language.upper(), set()).add(font_id)
    for source_id in para_ids:
        style = source_paras[source_id]
        if style.get("tabPrIDRef"):
            tab_ids.add(style.get("tabPrIDRef"))
        nested_border_ids.update(
            item.get("borderFillIDRef")
            for item in style.xpath(".//*[@borderFillIDRef]")
            if item.get("borderFillIDRef")
        )

    border_map, _ = _append_styles(source_header, target_header, "borderFill", nested_border_ids)
    tab_map, _ = _append_styles(source_header, target_header, "tabPr", tab_ids)
    font_maps = _append_fonts(source_header, target_header, font_ids_by_language)
    char_map, copied_chars = _append_styles(source_header, target_header, "charPr", char_ids)
    para_map, copied_paras = _append_styles(source_header, target_header, "paraPr", para_ids)

    # Remap references inside the newly imported styles, not just inside the table.
    for style in copied_chars:
        if style.get("borderFillIDRef") in border_map:
            style.set("borderFillIDRef", border_map[style.get("borderFillIDRef")])
        for font_ref in style.xpath(".//*[local-name()='fontRef']"):
            for language, old_font_id in list(font_ref.attrib.items()):
                mapped = font_maps.get(language.upper(), {}).get(old_font_id)
                if mapped:
                    font_ref.set(language, mapped)
    for style in copied_paras:
        if style.get("tabPrIDRef") in tab_map:
            style.set("tabPrIDRef", tab_map[style.get("tabPrIDRef")])
        for item in style.xpath(".//*[@borderFillIDRef]"):
            old_border_id = item.get("borderFillIDRef")
            if old_border_id in border_map:
                item.set("borderFillIDRef", border_map[old_border_id])

    for element in prototype.xpath(".//*[@borderFillIDRef]"):
        old = element.get("borderFillIDRef")
        if old in border_map:
            element.set("borderFillIDRef", border_map[old])
    for element in prototype.xpath(".//*[@charPrIDRef]"):
        old = element.get("charPrIDRef")
        if old in char_map:
            element.set("charPrIDRef", char_map[old])
    for element in prototype.xpath(".//*[@paraPrIDRef]"):
        old = element.get("paraPrIDRef")
        if old in para_map:
            element.set("paraPrIDRef", para_map[old])


def remove_picture_objects(prototype: etree._Element) -> None:
    """빈 이미지 객체 대신 실제 빈 셀을 남긴다."""
    for picture in prototype.xpath(".//hp:pic", namespaces=NS):
        picture.getparent().remove(picture)


def normalize_summary_heading_weight(prototype: etree._Element) -> None:
    """긍정·부정·중립 의견 요약 제목을 동일한 볼드 서식으로 맞춘다.

    리바랩스 원본은 중립 제목만 별도 일반체 charPr를 사용한다. 공통 양식에서는
    세 범주가 동등한 제목이므로 긍정 제목의 charPr을 기준으로 통일한다.
    """
    title_runs = {
        "".join(run.xpath(".//hp:t/text()", namespaces=NS)): run
        for run in prototype.xpath(".//hp:run", namespaces=NS)
    }
    reference = title_runs.get("[긍정 의견 요약]")
    neutral = title_runs.get("[중립 의견 요약]")
    if reference is None or neutral is None:
        raise SystemExit("의견 요약 제목의 글자 서식을 찾지 못했습니다.")
    neutral.set("charPrIDRef", reference.get("charPrIDRef"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--carecl-source", type=Path, required=True)
    parser.add_argument("--rivalabs-module-source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skill-dir", type=Path, required=True)
    args = parser.parse_args()

    with zipfile.ZipFile(args.rivalabs_module_source) as archive:
        rivalabs_root = etree.fromstring(archive.read("Contents/section1.xml"))
        rivalabs_header = etree.fromstring(archive.read("Contents/header.xml"))
    rivalabs_paragraphs = rivalabs_root.xpath(".//hp:p", namespaces=NS)
    prototype_tables = rivalabs_paragraphs[RIVALABS_MODULE_CONTAINER].xpath(".//hp:tbl", namespaces=NS)
    if len(prototype_tables) != 1:
        raise SystemExit("리바랩스 공통 정성 분석 표를 찾지 못했습니다.")
    prototype = prototype_tables[0]

    with zipfile.ZipFile(args.carecl_source) as archive:
        original = archive.read("Contents/section1.xml")
        original_header = archive.read("Contents/header.xml")
    parser_xml = etree.XMLParser(remove_blank_text=False, resolve_entities=False)
    tree = etree.parse(__import__("io").BytesIO(original), parser_xml)
    header_tree = etree.parse(__import__("io").BytesIO(original_header), parser_xml)
    paragraphs = tree.getroot().xpath(".//hp:p", namespaces=NS)
    targets = [paragraphs[index] for index in CARECL_MODULE_CONTAINERS]

    # Import once, then reuse the fully remapped frame. Re-importing it per feature
    # produced eight duplicate style sets and made later comparison unreliable.
    prototype = copy.deepcopy(prototype)
    remove_picture_objects(prototype)
    normalize_summary_heading_weight(prototype)
    import_style_dependencies(prototype, rivalabs_header, header_tree.getroot())

    for ordinal, target in enumerate(targets, start=1):
        old_tables = [table for table in target.xpath(".//hp:tbl", namespaces=NS)
                      if table.get("rowCnt") == "3" and table.get("colCnt") == "2"]
        if len(old_tables) != 1:
            raise SystemExit(f"케어클 기능 {ordinal}의 기존 키워드 표를 찾지 못했습니다.")
        old = old_tables[0]
        replacement = copy.deepcopy(prototype)
        # 표 ID는 문서 안에서 유일해야 한다. 원본 스타일 참조와 표 셀 구조는 유지한다.
        replacement.set("id", str(880000000 + ordinal))
        old.getparent().replace(old, replacement)

    editor = load_editor(args.skill_dir)
    output_xml = editor._serialize_xml_like_source(tree, original)
    output_header = editor._serialize_xml_like_source(header_tree, original_header)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    editor.write_raw_preserving_zip(args.carecl_source, args.output, {"Contents/section1.xml": output_xml, "Contents/header.xml": output_header})
    print(f"INSERTED: {args.output} ({len(targets)} common polarity modules)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
