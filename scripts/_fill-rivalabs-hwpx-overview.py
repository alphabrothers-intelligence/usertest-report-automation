#!/usr/bin/env python3
"""First vertical slice of "fill the hwpx 공양식 with real pipeline data".

Scope on purpose (per user direction, 2026-08-04): 리바랩스 only, Ⅰ장 "제품 및
서비스 개요" info table + "3. 사용성 테스트 설문 항목" table's question column.
Everything numeric/chart-dependent (Ⅱ~Ⅸ) is a separate later phase -- those
need embedded chart images and the qualitative pipeline's DB output, which
this slice deliberately does not touch. This never edits lib/pdf/ or any
existing rendering code; it only fills the blank 02_SW template built by
build-report-templates-from-source.py.

Usage:
    npx tsx scripts/_dump-rivalabs-quant-stats.ts /tmp/rivalabs-stats.json
    python3 scripts/_fill-rivalabs-hwpx-overview.py /tmp/rivalabs-stats.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _hwpx_style import estimate_required_cell_height  # noqa: E402

import importlib.util

_build_path = Path(__file__).resolve().parent / "build-report-templates-from-source.py"
_spec = importlib.util.spec_from_file_location("_hwpx_build_base", _build_path)
_build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_build)  # type: ignore[union-attr]

HP = _build.HP
copy_info = _build.copy_info
_text_segments = _build._text_segments
_segment_text = _build._segment_text
_set_segment_text = _build._set_segment_text

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "output" / "report-templates" / "02_SW_사용성테스트_보고서_템플릿_리바랩스원본.hwpx"
OUTPUT = ROOT / "output" / "report-templates" / "02_SW_리바랩스_실데이터_채움_Ⅰ장.hwpx"
NS = {"hp": HP}

# 제품 및 서비스 개요 label -> value. 리바랩스 자신의 실제 제품 정보다(원본 문서에서 그대로
# 재확인, 2026-08-04) -- lib/productInfo/ DB에 아직 저장된 값이 없어 여기서는 원본과 같은 값을
# 직접 공급한다. 다른 회사로 확장할 땐 이 dict를 lib/productInfo 저장값에서 읽어오면 된다.
OVERVIEW_LABEL_VALUES = {
    "기업명": "리바랩스",
    "홈페이지": "https://rebalabs.qshop.ai/",
    "대표자": "정 동 성",
    "업무 담당자": "정 동 성",
    "서비스 명": "캣독런",
    "서비스 요약": (
        "걸음 수 측정 및 위치 트래킹 기술을 기반으로 사용자의 실제 활동량과 이동 거리를 "
        "측정하고, 이를 경험치로 변환하여 캐릭터를 육성하는 게임형 헬스케어 서비스"
    ),
    "사업 영역": "B2C",
    "산업 분야": "정보 통신",
    "운영 환경": "Web (Mobile)",
    "사업화 단계": "시장 검증 단계",
}


def _row_cells(row: etree._Element) -> list[etree._Element]:
    return row.xpath("./hp:tc", namespaces=NS)


def _cell_paragraphs(cell: etree._Element) -> list[etree._Element]:
    return cell.xpath(".//hp:p", namespaces=NS)


def _cell_text(cell: etree._Element) -> str:
    parts = []
    for p in _cell_paragraphs(cell):
        parts.append("".join(_segment_text(k, n) for k, n in _text_segments(p)))
    return "".join(parts).strip()


def _grow_row_height_if_needed(cell: etree._Element, text: str) -> None:
    """Grow this cell's (and its row siblings') cellSz height if `text` would
    overflow the original fixed height. hwpx cells don't auto-grow like
    react-pdf flex boxes do -- without this, longer real content than the
    original document's own value gets visually clipped (2026-08-04 user
    report). Only ever grows, never shrinks; only touches cells that already
    have a cellSz (leaves rowSpan/colSpan geometry itself untouched)."""
    cell_sz = cell.find("hp:cellSz", namespaces=NS)
    if cell_sz is None:
        return
    width = int(cell_sz.get("width", "0"))
    current_height = int(cell_sz.get("height", "0"))
    required = estimate_required_cell_height(text, cell_width_hwpunit=width)
    if required <= current_height:
        return
    row = cell.getparent()
    siblings = row.xpath("./hp:tc", namespaces=NS) if row is not None else [cell]
    for sibling in siblings:
        sib_sz = sibling.find("hp:cellSz", namespaces=NS)
        if sib_sz is not None and int(sib_sz.get("height", "0")) < required:
            sib_sz.set("height", str(required))


def _fill_cell(cell: etree._Element, value: str) -> bool:
    paragraphs = _cell_paragraphs(cell)
    if not paragraphs:
        return False
    segments = _text_segments(paragraphs[0])
    if not segments:
        return False
    kind0, node0 = segments[0]
    _set_segment_text(kind0, node0, value)
    for kind, node in segments[1:]:
        _set_segment_text(kind, node, "")
    for cache in paragraphs[0].xpath("./hp:linesegarray", namespaces=NS):
        paragraphs[0].remove(cache)
    _grow_row_height_if_needed(cell, value)
    return True


def fill_overview_table(root: etree._Element) -> int:
    # This info table mixes 2-cell rows (label, value) and 4-cell rows (two
    # label/value pairs side by side, e.g. 기업명|리바랩스|홈페이지|URL on one
    # row) -- row-grouping isn't a reliable unit. But document order always
    # puts a label cell immediately before its value cell regardless of which
    # row they're in, so pair by flattened cell adjacency instead.
    # "기업명"/"제품명" are the blanking pass's own placeholder words (it
    # substitutes 리바랩스/캣독런 -> these before deciding keep/blank, so a
    # mid-sentence mention still reads). That means the value cell for the
    # "기업명"/"서비스 명" rows already *contains* that placeholder word --
    # treat it as still-blank for our purposes, not as real content.
    placeholder_values = {"기업명", "제품명"}
    cells = root.xpath(".//hp:tc", namespaces=NS)
    filled = 0
    for i, cell in enumerate(cells[:-1]):
        label = _cell_text(cell)
        if label not in OVERVIEW_LABEL_VALUES:
            continue
        value_cell = cells[i + 1]
        current = _cell_text(value_cell)
        if current and current not in placeholder_values:
            continue  # already has real content (e.g. the image-only "주요 기능" row)
        if _fill_cell(value_cell, OVERVIEW_LABEL_VALUES[label]):
            filled += 1
    return filled


def fill_survey_question_table(root: etree._Element, survey_questions: list[dict]) -> int:
    filled = 0
    q_index = 0
    for row in root.xpath(".//hp:tr", namespaces=NS):
        cells = _row_cells(row)
        if len(cells) < 2:
            continue
        # The Q-number marker sits in some cell of this row (bare "Q<N>" or
        # "Q<N>."); the last cell is the (currently blank) question-text cell.
        qnum_text = None
        for cell in cells[:-1]:
            t = _cell_text(cell)
            if _build.QNUM_RE.match(t):
                qnum_text = t
                break
        if qnum_text is None:
            continue
        value_cell = cells[-1]
        if _cell_text(value_cell):
            continue
        if q_index >= len(survey_questions):
            print(f"WARN: {qnum_text} 행이 있는데 surveyQuestions가 {len(survey_questions)}개뿐입니다", file=sys.stderr)
            continue
        if _fill_cell(value_cell, survey_questions[q_index]["question"]):
            filled += 1
        q_index += 1
    return filled


def main() -> None:
    stats_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/rivalabs-stats.json")
    stats = json.loads(stats_path.read_text(encoding="utf-8"))
    survey_questions = stats["surveyQuestions"]

    with ZipFile(TEMPLATE, "r") as src:
        entries = {}
        infos = {}
        for info in src.infolist():
            entries[info.filename] = src.read(info.filename)
            infos[info.filename] = info

    section1_name = "Contents/section1.xml"
    parser = etree.XMLParser(remove_blank_text=False)
    root = etree.fromstring(entries[section1_name], parser)

    overview_filled = fill_overview_table(root)
    question_filled = fill_survey_question_table(root, survey_questions)

    entries[section1_name] = etree.tostring(root, xml_declaration=True, encoding="UTF-8")

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(OUTPUT, "w") as dst:
        for name, info in infos.items():
            data = entries[name]
            new_info = copy_info(info)
            if name == "mimetype":
                new_info.compress_type = ZIP_STORED
            dst.writestr(new_info, data)

    print(f"WROTE: {OUTPUT}")
    print(f"  overview cells filled: {overview_filled} / {len(OVERVIEW_LABEL_VALUES)}")
    print(f"  survey question cells filled: {question_filled} / {len(survey_questions)}")


if __name__ == "__main__":
    main()
