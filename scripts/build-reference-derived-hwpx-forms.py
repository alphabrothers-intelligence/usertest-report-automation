#!/usr/bin/env python3
"""Create blank usability-test forms by preserving the supplied HWPX packages."""

from __future__ import annotations

import io
import re
import sys
import unicodedata
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile, ZipInfo

from lxml import etree
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "output" / "hwpx-skill-reference-preserved"
HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
SKILL_SCRIPTS = Path("/Users/a111-04-2310-01/.codex/skills/hwpxskill/scripts")
sys.path.insert(0, str(SKILL_SCRIPTS))
from edit_hwpx import _serialize_xml_like_source, write_raw_preserving_zip  # noqa: E402

STATIC_TERMS = (
    "사용성 테스트", "결과보고서", "목차", "개요", "제품 소개", "기업 개요",
    "기업명", "홈페이지", "대표자", "업무 담당자", "제품 및 서비스 개요", "서비스 명",
    "서비스 요약", "진행 일정", "설문 항목", "조사 항목", "조사일시", "조사 방법",
    "조사대상", "인적 사항", "특성 조사", "성별", "연령", "직업", "거주지역",
    "구매 경험", "사용 경험", "고객 경험", "조사 결과", "분석", "핵심구매요소",
    "4대 가치", "기능성", "신뢰성", "사용성", "매력성", "사용자 경험 품질",
    "교차 분석", "종합 만족도", "NPS", "개선 아이디어", "종합 결과", "제언",
    "결과 요약", "개선 전략", "고객 제언", "만족도 분포도", "중요 키워드",
    "활동 클라우드", "워드클라우드", "키워드 도출", "표준편차", "만족도 점수 평균",
    "긍정 의견", "부정 의견", "중립 의견", "매우 불만족", "불만족", "보통",
    "만족", "매우 만족", "추천 고객", "중립 고객", "비추천 고객", "중요도",
    "만족도", "전체", "평균", "응답자 수", "빈도", "비율", "항목", "구분",
)


def find_named(fragment: str) -> Path:
    return next(p for p in DATA.glob("*.hwpx") if fragment in unicodedata.normalize("NFC", p.name))


def copy_info(info: ZipInfo) -> ZipInfo:
    new = ZipInfo(info.filename, info.date_time)
    for attr in (
        "compress_type", "comment", "extra", "create_system", "create_version",
        "extract_version", "reserved", "flag_bits", "volume", "internal_attr", "external_attr",
    ):
        setattr(new, attr, getattr(info, attr))
    return new


def normalize_static(text: str) -> str:
    text = re.sub(r"케어클", "기업명", text, flags=re.I)
    text = re.sub(r"리바랩스", "기업명", text, flags=re.I)
    text = re.sub(r"캣독런", "제품명", text, flags=re.I)
    text = re.sub(r"CareCL(?:\s+Techfit)?", "제품명", text, flags=re.I)
    text = re.sub(r"테크핏", "제품명", text, flags=re.I)
    text = re.sub(r"주식회사\s+기업명", "기업명", text)
    text = re.sub(r"\(\s*\d+(?:\.\d+)?\s*%\s*\)", "(   %)", text)
    text = re.sub(r"(만족도\s*점수\s*평균\s*:)\s*[-+]?\d+(?:\.\d+)?", r"\1", text)
    text = re.sub(r"표준편차\s*:\s*[-+]?\d+(?:\.\d+)?", "표준편차 :", text)
    text = re.sub(r"20\d{2}[.]\s*\d{1,2}[.]\s*\d{1,2}", "20  .  .  ", text)
    return text


def should_keep(text: str) -> bool:
    s = text.strip()
    if not s:
        return True
    if s in {"Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ"}:
        return True
    if s.startswith("Q") and re.match(r"^Q\d+", s):
        return True
    if re.match(r"^\d+[.]\s+(?:제품 소개|사용성 테스트|긍정 의견|부정 의견|중립 의견|NPS|개선 아이디어|종합|고객 여정|핵심구매요소|4대 가치)", s):
        return True
    if s.startswith("[") and s.endswith("]") and any(k in s for k in ("응답 결과", "조사 결과", "분포도", "클라우드", "만족도 결과", "고객 여정 흐름")):
        return True
    if s.endswith(("입니까?", "인가요?", "나요?", "셨나요?", "해주세요", "무엇인가요?", "어떠셨나요?", "느끼셨나요?")) and len(s) <= 120:
        return True
    if s in STATIC_TERMS:
        return True
    structural = (
        r"^(?:인적 사항|특성 조사|기능별 고객 경험|고객 여정 기반 경험|핵심구매요소|4대 가치|사용자 경험 품질|교차 분석|종합 만족도|NPS 지수|개선 아이디어|종합 결과|결과 종합|기능별 만족도|고객 여정 만족도|고객 여정 기반 경험 결과 분석)",
        r"^(?:만족도 점수 평균|표준편차|키워드 도출 및 비율|주요 키워드 도출|평균 만족도|평균만족도)$",
    )
    return any(re.search(pattern, s) for pattern in structural) and len(s) <= 55


def blank_text(text: str) -> str:
    s = normalize_static(text)
    if should_keep(s):
        return s
    # Keep the original glyph budget so fixed HWPX line/page geometry does not
    # collapse when result prose is removed. Spaces are visually empty.
    return "".join(ch if ch.isspace() else " " for ch in text)


def preserve_paragraph_text(text: str) -> bool:
    s = normalize_static(text).strip()
    if not s:
        return False
    # Preserve complete survey wording, including questions split across runs.
    if re.search(r"Q\s*\d+", s) or "?" in s or "？" in s:
        return True
    # Preserve the generated table of contents with its original tab/page layout.
    roman_count = len(re.findall(r"[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]", s))
    return roman_count >= 2 and any(term in s for term in ("개요", "기능별 고객 경험", "4대 가치", "NPS"))


def blank_section(data: bytes) -> bytes:
    parser = etree.XMLParser(remove_blank_text=False)
    root = etree.fromstring(data, parser)
    preserve_nodes = set()
    for table in root.xpath(".//hp:tbl", namespaces={"hp": HP}):
        table_text = "".join(table.xpath(".//hp:t//text()", namespaces={"hp": HP}))
        roman_count = len(re.findall(r"[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]", table_text))
        question_count = len(re.findall(r"Q\s*\d+", table_text))
        if roman_count >= 3 or ("설문 항목" in table_text and question_count >= 5):
            preserve_nodes.update(table.xpath(".//hp:t", namespaces={"hp": HP}))
    for para in root.xpath(".//hp:p", namespaces={"hp": HP}):
        full = "".join(para.xpath("./hp:run/hp:t//text()", namespaces={"hp": HP}))
        if preserve_paragraph_text(full):
            preserve_nodes.update(para.xpath("./hp:run/hp:t", namespaces={"hp": HP}))
    for node in root.xpath(".//hp:t", namespaces={"hp": HP}):
        if node in preserve_nodes:
            node.text = normalize_static(node.text or "")
            for child in node:
                child.tail = normalize_static(child.tail or "")
            continue
        changed = False
        original = node.text or ""
        replacement = blank_text(original)
        if replacement != original:
            node.text = replacement
            changed = True
        # A single hp:t can hold many lineBreak/fwSpace controls. Classify each
        # text segment independently so section labels survive while results vanish.
        for child in node:
            original_tail = child.tail or ""
            replacement_tail = blank_text(original_tail)
            if replacement_tail != original_tail:
                child.tail = replacement_tail
                changed = True
        if not changed:
            continue
        # Keep linesegarray: these are reference-authored line/page coordinates.
        # Removing them after mass blanking collapses TOC and survey layouts.
    return _serialize_xml_like_source(etree.ElementTree(root), data)


def blank_image(data: bytes, suffix: str) -> bytes:
    with Image.open(io.BytesIO(data)) as src:
        size = src.size
        if suffix.lower() == ".bmp":
            canvas = Image.new("RGB", size, "white")
            fmt = "BMP"
        else:
            canvas = Image.new("RGBA", size, (248, 250, 252, 255))
            fmt = "PNG"
        target = io.BytesIO()
        canvas.save(target, format=fmt)
        return target.getvalue()


def build_blank(source: Path, output: Path, preserve_images: set[int]) -> None:
    replacements: dict[str, bytes] = {}
    with ZipFile(source, "r") as src:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename.startswith("Contents/section") and info.filename.endswith(".xml"):
                replacements[info.filename] = blank_section(data)
            match = re.fullmatch(r"BinData/image(\d+)\.[^.]+", info.filename, re.I)
            if match and int(match.group(1)) not in preserve_images:
                replacements[info.filename] = blank_image(data, Path(info.filename).suffix)
    write_raw_preserving_zip(source, output, replacements)


def direct_text(p: etree._Element) -> str:
    return "".join(p.xpath("./hp:run/hp:t//text()", namespaces={"hp": HP})).strip()


def set_paragraph_text(p: etree._Element, value: str) -> None:
    nodes = p.xpath("./hp:run/hp:t", namespaces={"hp": HP})
    if not nodes:
        run = etree.SubElement(p, f"{{{HP}}}run", charPrIDRef="0")
        nodes = [etree.SubElement(run, f"{{{HP}}}t")]
    nodes[0].text = value
    for index, node in enumerate(nodes):
        if index:
            node.text = ""
        for child in node:
            child.tail = ""
    for cache in p.xpath("./hp:linesegarray", namespaces={"hp": HP}):
        p.remove(cache)


def add_integrated_extension(data: bytes) -> bytes:
    parser = etree.XMLParser(remove_blank_text=False)
    root = etree.fromstring(data, parser)
    paragraphs = root.xpath(".//hp:p", namespaces={"hp": HP})
    simple = [p for p in paragraphs if not p.xpath(".//hp:tbl|.//hp:pic", namespaces={"hp": HP})]
    heading_src = next((p for p in simple if direct_text(p) == "2. 종합 전략 제언"), simple[0])
    body_src = next((p for p in simple if direct_text(p) in {"개선 전략", "항목"}), heading_src)
    blocks = [
        ("Ⅸ. SW 특화 분석", True),
        ("1. 기능별 상대 중요도-만족도 분석", False),
        ("[ 기능별 상대 중요도-만족도 그래프 삽입 영역 ]", False),
        ("[ 기능별 우선순위 및 개선 필요성 분석 입력 영역 ]", False),
        ("2. 사용자 경험 품질 평가", False),
        ("[ 실용성·즐거움 및 UX 품질 평가 그래프 삽입 영역 ]", False),
        ("[ 사용자 경험 품질 종합·세부 해석 입력 영역 ]", False),
        ("3. 교차 분석", False),
        ("[ 인적 특성별 기능 만족도·4대 가치·UX 품질 교차 분석 영역 ]", False),
        ("Ⅹ. 실제품 특화 분석", True),
        ("1. 고객 여정 기반 경험 평가", False),
        ("[ 수령·개봉·첫 사용·반복 사용·최종 만족도 변화 그래프 영역 ]", False),
        ("2. 물리적 조작·감각·안전 평가", False),
        ("[ 크기·무게·그립·조작력·소음·발열·안전 관찰 결과 영역 ]", False),
        ("3. 패키지·설명서·보관 경험", False),
        ("[ 패키지·온보딩·설명서·세척·보관 개선 분석 영역 ]", False),
    ]
    max_id = max((int(p.get("id")) for p in paragraphs if (p.get("id") or "").isdigit()), default=1000000000)
    for offset, (text, page_break) in enumerate(blocks, start=1):
        clone = deepcopy(heading_src if text[:1] in {"Ⅸ", "Ⅹ"} or re.match(r"^\d+[.]", text) else body_src)
        clone.set("id", str(max_id + offset))
        clone.set("pageBreak", "1" if page_break else "0")
        set_paragraph_text(clone, text)
        root.append(clone)
    return _serialize_xml_like_source(etree.ElementTree(root), data)


def build_integrated(physical_blank: Path, output: Path) -> None:
    with ZipFile(physical_blank, "r") as src:
        section = src.read("Contents/section2.xml")
    write_raw_preserving_zip(
        physical_blank,
        output,
        {"Contents/section2.xml": add_integrated_extension(section)},
    )


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sw_source = find_named("리바랩스_사용성테스트")
    physical_source = find_named("케어클_사용성테스트")
    sw_output = OUT / "01_SW_원본기반_사용성테스트_공양식.hwpx"
    physical_output = OUT / "02_실제품_원본기반_사용성테스트_공양식.hwpx"
    integrated_output = OUT / "03_SW_실제품_통합_사용성테스트_공양식.hwpx"
    build_blank(sw_source, sw_output, {1, 2, 3, 4, 46, 47, 48})
    build_blank(physical_source, physical_output, {1, 2, 3, 4, 40, 41, 42})
    build_integrated(physical_output, integrated_output)
    print(sw_output)
    print(physical_output)
    print(integrated_output)


if __name__ == "__main__":
    main()
