#!/usr/bin/env python3
"""Derive blank (공양식) SW/실제품 report templates directly from the real published
리바랩스/케어클 hwpx files (data/, gitignored).

This is a genuine blank form: table geometry, fonts, ToC, chapter/section labels,
metric column headers (평균/표준편차/긍정 의견 ...), and the survey-item table's
stage/category labels survive verbatim. Everything client-specific -- actual survey
question sentences, product/company names, computed numbers, and every embedded
chart image -- is stripped, because that content gets filled in per-project by this
solution's own report pipeline later. Classification is done once per paragraph
(not per text run), so a sentence can't survive half-blanked/half-kept.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "output" / "report-templates"
HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"

# Labels/headings/section titles common to both report types (from actual report
# structure -- see CLAUDE.md WALLA schema + lib/pdf/ section headers). Anything not
# matched by these (or the structural regexes below) is treated as project-specific
# data and blanked.
STATIC_TERMS = (
    "사용성 테스트", "결과보고서", "목차", "개요", "제품 소개", "기업 개요",
    "기업명", "홈페이지", "대표자", "업무 담당자", "제품 및 서비스 개요", "서비스 명",
    "서비스 요약", "사업 영역", "산업 분야", "운영 환경", "사업화 단계", "주요 기능",
    "제품명", "제품 요약", "진행 일정", "설문 항목", "조사 항목", "조사일시", "조사 방법",
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

QNUM_RE = re.compile(r"^Q\d+")
AXIS_PREFIX_RE = re.compile(r"^(?:실용성|즐거움)\d+\)")

GENERIC_SUBS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\(\s*\d+(?:\.\d+)?\s*%\s*\)"), "(   %)"),
    (re.compile(r"(만족도\s*점수\s*평균\s*:)\s*[-+]?\d+(?:\.\d+)?"), r"\1"),
    (re.compile(r"표준편차\s*:\s*[-+]?\d+(?:\.\d+)?"), "표준편차 :"),
    (re.compile(r"20\d{2}[.]\s*\d{1,2}[.]\s*\d{1,2}"), "20  .  .  "),
]


def find_source(fragment: str) -> Path:
    return next(p for p in DATA.glob("*.hwpx") if fragment in unicodedata.normalize("NFC", p.name))


def copy_info(info: ZipInfo) -> ZipInfo:
    new = ZipInfo(info.filename, info.date_time)
    for attr in (
        "compress_type", "comment", "extra", "create_system", "create_version",
        "extract_version", "reserved", "flag_bits", "volume", "internal_attr", "external_attr",
    ):
        setattr(new, attr, getattr(info, attr))
    return new


def make_paragraph_classifier(specific_subs: list[tuple[re.Pattern, str]]):
    """Return classify(text) -> text to keep for a whole paragraph ("" to blank).

    Runs once per paragraph (not per text run) so a sentence can't survive
    half-kept/half-blanked. Only structural scaffolding survives: chapter
    numerals, subsection titles, table metric headers, the survey-item table's
    stage labels, and bare Q-number/axis-label markers (truncated, sentence
    body dropped -- that wording is this-project-specific, not template).
    """

    subs = specific_subs + GENERIC_SUBS

    def normalize(text: str) -> str:
        for pat, repl in subs:
            text = pat.sub(repl, text)
        return text

    def classify(text: str) -> str:
        s = normalize(text).strip()
        if not s:
            return ""
        if s in {"Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ", "Ⅹ"}:
            return s
        m = QNUM_RE.match(s)
        if m:
            # Keep only the bare marker (Q12 or Q12.) -- drop the question
            # sentence itself, that wording is specific to this one client.
            end = m.end()
            return s[:end] + "." if s[end : end + 1] == "." else s[:end]
        m = AXIS_PREFIX_RE.match(s)
        if m:
            # Keep only the axis-label prefix (실용성1)/즐거움1)); the
            # descriptive suffix after it is derived from raw data per project.
            return s[: m.end()]
        if re.match(
            r"^\d+[.]\s+(?:제품 소개|사용성 테스트|긍정 의견|부정 의견|중립 의견|NPS|개선 아이디어|종합|고객 여정|핵심구매요소|4대 가치)",
            s,
        ):
            return s
        if s.startswith("[") and s.endswith("]") and any(
            k in s for k in ("응답 결과", "조사 결과", "분포도", "클라우드", "만족도 결과", "고객 여정 흐름")
        ):
            return s
        if s in STATIC_TERMS:
            return s
        structural = (
            r"^(?:인적 사항|특성 조사|기능별 고객 경험|고객 여정 기반 경험|핵심구매요소|4대 가치|사용자 경험 품질|교차 분석|종합 만족도|NPS 지수|개선 아이디어|종합 결과|결과 종합|기능별 만족도|고객 여정 만족도|고객 여정 기반 경험 결과 분석)",
            r"^(?:만족도 점수 평균|표준편차|키워드 도출 및 비율|주요 키워드 도출|평균 만족도|평균만족도)$",
        )
        if any(re.search(pattern, s) for pattern in structural) and len(s) <= 55:
            return s
        return ""

    return classify


def _text_segments(paragraph: etree._Element) -> list[tuple[str, etree._Element]]:
    """Every text-bearing location owned directly by this paragraph, in order.

    `./hp:run/hp:t` only matches direct-child runs, so a run that instead holds
    a nested `<hp:tbl>`/`<hp:pic>` is naturally skipped -- that nested content's
    own paragraphs get visited separately when the outer loop reaches them. A
    single <hp:t> run can also hold multiple lines: text before the first
    lineBreak/tab control lives in `t.text`, and each subsequent line lives in
    that control's `.tail`. Missing either case is how project-specific text can
    leak even though the paragraph's own first line looked like a safe label
    (seen live: a caption run sitting next to a table run in the same <hp:p>,
    and a multi-line bulleted cell).
    """
    segments: list[tuple[str, etree._Element]] = []
    for t in paragraph.xpath("./hp:run/hp:t", namespaces={"hp": HP}):
        segments.append(("t", t))
        for child in t:
            segments.append(("tail", child))
    return segments


def _segment_text(kind: str, node: etree._Element) -> str:
    return (node.text if kind == "t" else node.tail) or ""


def _set_segment_text(kind: str, node: etree._Element, text: str) -> None:
    if kind == "t":
        node.text = text
    else:
        node.tail = text


def strip_images(root: etree._Element) -> int:
    removed = 0
    for pic in root.xpath(".//hp:pic", namespaces={"hp": HP}):
        parent = pic.getparent()
        if parent is not None:
            parent.remove(pic)
            removed += 1
    return removed


def blank_section(data: bytes, classify) -> bytes:
    parser = etree.XMLParser(remove_blank_text=False)
    root = etree.fromstring(data, parser)
    strip_images(root)
    ns = {"hp": HP}
    for paragraph in root.xpath(".//hp:p", namespaces=ns):
        segments = _text_segments(paragraph)
        if not segments:
            continue
        original = "".join(_segment_text(kind, node) for kind, node in segments)
        if not original.strip():
            continue
        kept = classify(original)
        if kept == original:
            continue
        first_kind, first_node = segments[0]
        _set_segment_text(first_kind, first_node, kept)
        for kind, node in segments[1:]:
            _set_segment_text(kind, node, "")
        for cache in paragraph.xpath("./hp:linesegarray", namespaces=ns):
            paragraph.remove(cache)
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8")


def build_template(source: Path, output: Path, specific_subs: list[tuple[re.Pattern, str]]) -> None:
    classify = make_paragraph_classifier(specific_subs)
    output.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(source, "r") as src, ZipFile(output, "w") as dst:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename.startswith("Contents/section") and info.filename.endswith(".xml"):
                data = blank_section(data, classify)
            new_info = copy_info(info)
            if info.filename == "mimetype":
                new_info.compress_type = ZIP_STORED
            dst.writestr(new_info, data)


RIVALABS_SUBS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"리바랩스"), "기업명"),
    (re.compile(r"캣독런"), "제품명"),
    (re.compile(r"rebalabs\.qshop\.ai", re.I), "URL"),
]

CARECL_SUBS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"케어클"), "기업명"),
    (re.compile(r"CareCL(?:\s+Techfit)?", re.I), "제품명"),
    (re.compile(r"테크핏"), "제품명"),
    (re.compile(r"주식회사\s+기업명"), "기업명"),
]


def main() -> None:
    rivalabs_src = find_source("리바랩스_사용성테스트")
    carecl_src = find_source("케어클_사용성테스트")
    sw_out = OUT / "02_SW_사용성테스트_보고서_템플릿_리바랩스원본.hwpx"
    physical_out = OUT / "03_실제품_사용성테스트_보고서_템플릿_케어클원본.hwpx"
    build_template(rivalabs_src, sw_out, RIVALABS_SUBS)
    build_template(carecl_src, physical_out, CARECL_SUBS)
    print(sw_out)
    print(physical_out)


if __name__ == "__main__":
    main()
