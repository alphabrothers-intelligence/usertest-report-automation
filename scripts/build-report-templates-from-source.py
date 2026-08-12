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

# "설문 항목" 표의 "단계" 왼쪽 컬럼 라벨은 실제 문서에서 다른 본문 챕터 제목들과 달리
# 띄어쓰기가 페이지마다 다르게 압축돼 있다 -- 같은 라벨이 표가 페이지를 넘어가며 이어지는
# 곳마다 "기능별고객경험 평가"/"기능별고객 경험 평가"처럼 공백 위치가 미세하게 다르게
# 타이핑돼 있었다(2026-08-05, 사용자 렌더링 스크린샷으로 실측). 정확한 문자열 하나만 넣으면
# 다른 페이지의 변형은 여전히 지워지므로, 공백을 전부 제거한 뒤 비교하는 느슨한 매칭을 쓴다.
STAGE_LABEL_KEYS = frozenset(
    re.sub(r"\s+", "", label)
    for label in (
        "기능별고객경험 평가", "유사 서비스경험 조사", "핵심구매요인 파악",
        "4대 가치만족도 평가", "사용자 경험품질 평가", "구매/추천의향 조사",
        "단계",  # 설문 항목 표의 열 헤더 자체(케어클에서 확인, 리바랩스는 다른 표현이라 안 씀)
        "종합만족도 평가", "개발 우선순위 제언",  # Ⅸ장 기능별 고객 제언 종합 표의 같은 유형 라벨
        "긍정", "부정", "중립",  # 감정 분석 표의 열 헤더("긍정 의견"과 별개로 이 bare 형태도 씀)
        "만족도 점수 평균 : / 10",  # 위 GENERIC_SUBS로 숫자만 빠진 뒤의 정확한 형태
        "표준편차 :", "*평균에서의 흩어진 정도",  # Ⅲ장 기능별 만족도 점수 줄의 나머지 라벨들
        # Ⅴ장 4대 가치 미니표 제목 -- PRD가 정의한 고정 4개 축이라 raw data와 무관한데,
        # STATIC_TERMS엔 "4대 가치"만 있고 이 정확한 조합 문구는 없어서 지워지고 있었다
        # (2026-08-05, Ⅴ/Ⅵ장 실제 채우기 작업 중 발견).
        "기능적 가치 만족도", "심미적 가치 만족도", "경제적 가치 만족도", "사회·공공적 가치 만족도",
    )
)

QNUM_RE = re.compile(r"^Q\d+")
AXIS_PREFIX_RE = re.compile(r"^(?:실용성|즐거움)\d+\)")

# ToC 줄은 "Ⅱ. 인적 사항 및 특성 조사"처럼 로마숫자/아라비아숫자+제목이 한 문자열로 붙어
# 나온다(본문 SectionHeader는 번호뱃지+제목이 별도 문단이라 이미 STATIC_TERMS/구조 정규식으로
# 커버되지만, ToC는 그렇지 않다). 원래는 부분 키워드 정규식으로 대충 잡았는데, "기능별"/
# "사용자"/"교차"/"사용성테스트"(공백 없음)로 시작하는 제목들이 그 키워드 목록에 없어서 ToC의
# 챕터·소목차 제목 대부분이 통째로 지워졌다(2026-08-04 실제 렌더 스크린샷으로 확인). 임의
# 키워드 목록 대신 lib/pipeline/reportPlan.ts의 buildReportPlan()이 채팅 목차 카드·PDF ToC·
# PDF 본문 헤더에 실제로 쓰는 정확한 제목 문자열을 그대로 가져와 exact match로 바꿨다 --
# reportPlan.ts가 바뀌면 이 목록도 사람이 다시 맞춰야 한다(같은 소스 파일을 import할 수 없는
# TS/Python 경계라 build-report-templates-from-source.py 상단 주석과 같은 종류의 수동 동기화).
_ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ"]
_CHAPTER_TITLES = [
    "개요",
    "인적 사항 및 특성 조사",
    "기능별 고객 경험 평가",
    "핵심구매요소",
    "4대 가치 만족도",
    "사용자 경험 품질 평가",
    "교차 분석",
    "종합 만족도 및 NPS 지수",
    "종합 결과 및 제언",
]
_SUBITEMS_BY_CHAPTER = [
    ["제품 소개", "사용성 테스트 진행 일정", "사용성 테스트 설문 항목"],
    [],  # Ⅱ는 ToC에 소목차가 없다(원본 확인)
    ["기능별 고객 경험 조사 결과", "기능별 고객 경험 분석"],
    ["핵심구매요소 조사 결과", "핵심구매요소 분석"],
    ["4대 가치 조사 결과", "4대 가치 조사 결과 분석"],
    ["사용자 경험 품질 평가 결과", "사용자 경험 품질 평가 결과 분석"],
    ["교차 분석 결과 및 분석"],
    ["종합 만족도 및 NPS 지수", "개선 아이디어"],
    ["사용성테스트 결과 요약", "개선 전략 제언", "기능별 고객 제언 종합"],
]
TOC_CHAPTER_LINES = {f"{roman}. {title}" for roman, title in zip(_ROMAN, _CHAPTER_TITLES)}
TOC_SUBITEM_LINES = {
    f"{i}. {subitem}"
    for subitems in _SUBITEMS_BY_CHAPTER
    for i, subitem in enumerate(subitems, start=1)
}

GENERIC_SUBS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\(\s*\d+(?:\.\d+)?\s*%\s*\)"), "(   %)"),
    # 원본은 "만족도 점수 평균 : 6.35 / 10"처럼 "/ 10" 척도 표기가 숫자 뒤에 붙어있는데,
    # 예전 정규식은 숫자만 지우고 " / 10"을 남겨서(정상 라벨과 안 맞아 통째로 블랭크됨,
    # 2026-08-05 Ⅲ장 실제 채우기 중 발견) "/ 10"까지 같이 삼키도록 고쳤다.
    (re.compile(r"(만족도\s*점수\s*평균\s*:)\s*[-+]?\d+(?:\.\d+)?\s*/\s*10"), r"\1 / 10"),
    (re.compile(r"(만족도\s*점수\s*평균\s*:)\s*[-+]?\d+(?:\.\d+)?"), r"\1"),
    (re.compile(r"표준편차\s*:\s*[-+]?\d+(?:\.\d+)?"), "표준편차 :"),
    (re.compile(r"20\d{2}[.]\s*\d{1,2}[.]\s*\d{1,2}"), "20  .  .  "),
    (re.compile(r"총\s*\d+\s*문항"), "총    문항"),
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
        if s in TOC_CHAPTER_LINES or s in TOC_SUBITEM_LINES:
            return s
        if re.sub(r"\s+", "", s) in STAGE_LABEL_KEYS:
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


_SKIP_MARK = "_tmplSkip"  # scratch attribute name, removed again before serialization


def _multi_paragraph_cell_skip_set(root: etree._Element, classify, ns: dict) -> list:
    """Paragraphs that must be left untouched because they're one *label*
    word-wrapped across multiple sibling <hp:p> in the same cell (e.g. the
    survey-item table's narrow "단계" column: "기능별" / "고객경험 평가" as two
    separate paragraphs, not one paragraph with a line break). Per-paragraph
    classification can't see this -- neither half alone matches any keep rule,
    so both silently vanish (2026-08-05, found via user screenshot: 5 of 6
    stage labels were missing). Reassemble each multi-paragraph cell's full
    text and, if *that* matches a keep rule, skip every paragraph in it."""
    # Marking via a scratch XML attribute (not id(element)): lxml doesn't
    # guarantee a paragraph's Python proxy object keeps the same id() across
    # separate .xpath() calls once other elements are visited in between --
    # an id()-based set silently under-matched here (found via user
    # screenshot: 2 of 4 stage-label pairs still went missing even though
    # classify() matched both when tested standalone). Setting the attribute
    # directly on the element sidesteps proxy identity entirely.
    skip: list[etree._Element] = []
    for tc in root.xpath(".//hp:tc", namespaces=ns):
        paras = tc.xpath(".//hp:p", namespaces=ns)
        if len(paras) < 2:
            continue
        joined = "".join(
            _segment_text(kind, node)
            for p in paras
            for kind, node in _text_segments(p)
        )
        stripped = joined.strip()
        if not stripped:
            continue
        if classify(joined) == stripped:
            for p in paras:
                p.set(_SKIP_MARK, "1")
                skip.append(p)
    return skip


def blank_section(data: bytes, classify) -> bytes:
    parser = etree.XMLParser(remove_blank_text=False)
    root = etree.fromstring(data, parser)
    strip_images(root)
    ns = {"hp": HP}
    _multi_paragraph_cell_skip_set(root, classify, ns)
    for paragraph in root.xpath(".//hp:p", namespaces=ns):
        if paragraph.get(_SKIP_MARK) is not None:
            del paragraph.attrib[_SKIP_MARK]
            continue
        segments = _text_segments(paragraph)
        if not segments:
            continue
        original = "".join(_segment_text(kind, node) for kind, node in segments)
        stripped = original.strip()
        if not stripped:
            continue
        # ToC entries store the title as plain text but the page number as a
        # live CROSSREF field's cached value, both as direct-child segments of
        # the *same* paragraph (title-run, tab-leader-run, field-run). Joined
        # text is "Ⅰ. 개요<tab>3", so an exact-match against the clean title
        # never fires -- match the prefix instead and leave the whole
        # paragraph (title + tab + field) untouched rather than trying to
        # reconstruct/clear individual field segments.
        if any(stripped.startswith(line) for line in TOC_CHAPTER_LINES | TOC_SUBITEM_LINES):
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
