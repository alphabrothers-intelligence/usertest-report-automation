#!/usr/bin/env python3
"""Third vertical slice: adds Ⅲ장(기능별 고객 경험)의 6개 기능 감정분석 표
(긍정/부정/중립 비율 + 브래킷 요약) + representative-quote groups ("[운동 동기
부여...]" + direct quotes, "N. 긍정/부정/중립 의견 (XX.X%)" 표) on top of the
Ⅰ/Ⅴ/Ⅵ fill. Uses the already-executed Stage1/2 qualitative pipeline result
stored in Supabase (report id 4b8d2cde..., 2026-08-03 run) -- no new LLM calls.

Quote-group count varies per feature/polarity and never matches the original
template's fixed paragraph skeleton (that skeleton is itself just an artifact
of the ORIGINAL author's specific text length, confirmed 2026-08-05 by
diffing the blank template against the real filled doc: identical table
sequence, but each block's blank paragraph count differs per feature).
Instead of relying on the template's paragraph count, `_fill_quote_group_cell`
overwrites existing empty `<hp:p>` nodes in place and, when there are more
lines than the template has slots for, clones the cell's last paragraph
(fresh id) to grow it -- then reuses this project's already-established
`_grow_row_height_if_needed` (see `_fill-rivalabs-hwpx-overview.py`) so the
cell's fixed `cellSz.height` doesn't clip the extra lines.

ponytail: whether a very tall grown row correctly reflows across a page
boundary when opened in real Hancom Office is unverified -- no HWP renderer
is available in this environment (only structural/XML-roundtrip checks were
run). The original document's own tall blocks were saved as separate
`<hp:tbl>` continuation elements per page, which this script does not
attempt to replicate; ceiling is "very long quote blocks might render
awkwardly at a page boundary." Upgrade path: open the generated file in
Hancom Office once available and check the longest block (Q6 negative,
6 categories) for clipping/overlap.

Writes to a NEW output file, starting fresh from the blank template (not
layered on the previously-approved Ⅰ장-only file or the "확장" file).

Usage:
    npx tsx scripts/_dump-rivalabs-quant-stats.ts /tmp/rivalabs-stats.json
    npx tsx --env-file=.env.local scripts/_dump-rivalabs-qualitative.ts /tmp/rivalabs-qualitative.json
    python3 scripts/_fill-rivalabs-hwpx-qualitative.py /tmp/rivalabs-stats.json /tmp/rivalabs-qualitative.json
"""

from __future__ import annotations

import copy
import itertools
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util

_build_path = Path(__file__).resolve().parent / "build-report-templates-from-source.py"
_spec = importlib.util.spec_from_file_location("_hwpx_build_base", _build_path)
_build = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_build)  # type: ignore[union-attr]

_overview_path = Path(__file__).resolve().parent / "_fill-rivalabs-hwpx-overview.py"
_spec2 = importlib.util.spec_from_file_location("_hwpx_fill_overview", _overview_path)
_overview = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(_overview)  # type: ignore[union-attr]

_extended_path = Path(__file__).resolve().parent / "_fill-rivalabs-hwpx-extended.py"
_spec3 = importlib.util.spec_from_file_location("_hwpx_fill_extended", _extended_path)
_extended = importlib.util.module_from_spec(_spec3)
_spec3.loader.exec_module(_extended)  # type: ignore[union-attr]

HP = _build.HP
copy_info = _build.copy_info
NS = {"hp": HP}

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "output" / "report-templates" / "02_SW_사용성테스트_보고서_템플릿_리바랩스원본.hwpx"
OUTPUT = ROOT / "output" / "report-templates" / "02_SW_리바랩스_실데이터_채움_정성분석포함.hwpx"

_cell_text = _overview._cell_text
_fill_cell = _overview._fill_cell
_text_segments = _overview._text_segments
_segment_text = _overview._segment_text
_set_segment_text = _overview._set_segment_text
fill_overview_table = _overview.fill_overview_table
fill_survey_question_table = _overview.fill_survey_question_table
fill_four_values = _extended.fill_four_values
fill_ux_quality = _extended.fill_ux_quality
_grow_row_height_if_needed = _overview._grow_row_height_if_needed

# Document order of the 6 features' Stage1/2 question_key, matching Q6~Q11.
FEATURE_ORDER = [
    "펫과의 산책",
    "펫 성장 시스템",
    "펫 꾸미기",
    "실시간 위치 기반 거점형 콘텐츠",
    "펫 교배",
    "펫 레이싱",
]

# Each feature's "[긍정/부정/중립 의견 요약]" summary cell holds 3 groups (in
# order) separated by blank paragraphs, but per feature the original author
# sometimes wrote the bracket label and its sentence as one paragraph and
# sometimes as two -- confirmed per-feature against the real document
# (2026-08-05), not inferable from the blanked template (all paragraphs read
# empty once content is stripped, so this can't be autodetected there).
# 1 = "[label]text" combined in one paragraph, 2 = "[label]" then text separately.
GROUP_SIZES_BY_FEATURE = [
    [2, 2, 1],  # 펫과의 산책 (7 paragraphs total incl. 2 blank separators)
    [2, 2, 2],  # 펫 성장 시스템
    [2, 2, 2],  # 펫 꾸미기
    [2, 2, 2],  # 실시간 위치 기반 거점형 콘텐츠
    [1, 1, 1],  # 펫 교배
    [2, 2, 2],  # 펫 레이싱
]


def _polarity_percentages(categories: list[dict]) -> dict[str, tuple[float, int]]:
    sums: dict[str, int] = defaultdict(int)
    for c in categories:
        sums[c["polarity"]] += c["clause_count"]
    total = sum(sums.values()) or 1
    return {p: (sums.get(p, 0) / total * 100, sums.get(p, 0)) for p in ("positive", "negative", "neutral")}


# lib/report/richText.ts's parseRichRuns() only ever produces 3 style combos
# in this data (checked directly, 2026-08-05): plain, bold, bold+underline --
# no bare underline, no italic. Mapped to charPr ids that already exist in
# the real document at height=1100/11pt (163=plain, 162=bold, 186=bold+underline)
# rather than inventing new charPr defs. First cut of this fill stripped the
# markdown markers to plain text instead of honoring them, which lost the
# actual emphasis the original report relies on (2026-08-05 user screenshot:
# "중요한 문장에 볼드/밑줄 처리가 안 되고 있다").
_CONTENT_CHARPR_ID = "163"
_BOLD_CHARPR_ID = "162"
_BOLD_UNDERLINE_CHARPR_ID = "186"


def _charpr_for_run(run: dict) -> str:
    bold = bool(run.get("bold"))
    underline = bool(run.get("underline"))
    if bold and underline:
        return _BOLD_UNDERLINE_CHARPR_ID
    if bold:
        return _BOLD_CHARPR_ID
    return _CONTENT_CHARPR_ID


def _append_rich_runs(p: etree._Element, runs: list[dict], lead_break: bool = False) -> None:
    """Append one <hp:run> per parsed rich-text run (each carrying its own
    bold/underline charPr) as new siblings at the end of paragraph p. If
    lead_break, the first run's text is preceded by an hp:lineBreak (used
    right after an existing label run, so label and content land on separate
    visual lines without a second <hp:p>)."""
    for i, run in enumerate(runs):
        text = run.get("text", "")
        if not text and not (i == 0 and lead_break):
            continue
        # A single parsed run can itself contain literal "\n" (multi-sentence
        # narrative text) -- plain XML text doesn't turn that into a visual
        # break, so split on it and insert hp:lineBreak between segments,
        # all under the same charPr (the newline sits inside one style span,
        # confirmed against the real data: always a plain-text run boundary,
        # never mid-bold).
        segments = text.split("\n")
        new_run = etree.SubElement(p, f"{{{HP}}}run")
        new_run.set("charPrIDRef", _charpr_for_run(run))
        t = etree.SubElement(new_run, f"{{{HP}}}t")
        if i == 0 and lead_break:
            br = etree.SubElement(t, f"{{{HP}}}lineBreak")
            br.tail = segments[0]
        else:
            t.text = segments[0]
        for seg in segments[1:]:
            br = etree.SubElement(t, f"{{{HP}}}lineBreak")
            br.tail = seg


def _set_para_label_then_break(p: etree._Element, label: str, runs: list[dict]) -> None:
    """Put "label<hard line break>rich content" inside a paragraph -- label
    keeps the existing (bold) run, content gets new sibling run(s), one per
    parsed rich-text run so each keeps its own bold/underline. Putting
    everything in the label's single run made the whole content bold too
    (2026-08-05 user screenshot), because a run's charPr applies to
    everything inside it including a lineBreak's tail text. hp:lineBreak
    (confirmed in the real doc, 113 occurrences) still provides the visual
    line break; no second <hp:p> is used since some of these cells only have
    as many paragraphs as groups."""
    nodes = p.xpath("./hp:run/hp:t", namespaces=NS)
    if not nodes:
        return
    first = nodes[0]
    for child in list(first):
        first.remove(child)
    first.text = label
    for run in p.xpath("./hp:run", namespaces=NS)[1:]:
        p.remove(run)
    for cache in p.xpath("./hp:linesegarray", namespaces=NS):
        p.remove(cache)
    _append_rich_runs(p, runs, lead_break=True)


def _set_para_richtext(p: etree._Element, runs: list[dict]) -> None:
    """Replace a paragraph's single existing run with one run per parsed
    rich-text run (no label, no lineBreak) -- used for the 4대가치 combined
    insight paragraph, which has no bracket-label prefix of its own."""
    for run in list(p.xpath("./hp:run", namespaces=NS)):
        p.remove(run)
    for cache in p.xpath("./hp:linesegarray", namespaces=NS):
        p.remove(cache)
    _append_rich_runs(p, runs)


def _set_para(p: etree._Element, text: str) -> None:
    segments = _text_segments(p)
    if not segments:
        return
    kind0, node0 = segments[0]
    _set_segment_text(kind0, node0, text)
    for kind, node in segments[1:]:
        _set_segment_text(kind, node, "")


def _fill_emotion_table(tbl: etree._Element, feature_data: dict, group_sizes: list[int]) -> bool:
    by_addr: dict[tuple[str, str], etree._Element] = {}
    for tc in tbl.xpath(".//hp:tc", namespaces=NS):
        addr = tc.find("hp:cellAddr", namespaces=NS)
        by_addr[(addr.get("colAddr"), addr.get("rowAddr"))] = tc

    pct = _polarity_percentages(feature_data["categories"])
    pct_cells = [("0", "3"), ("1", "3"), ("2", "3")]
    for (col, row), polarity in zip(pct_cells, ("positive", "negative", "neutral")):
        cell = by_addr.get((col, row))
        if cell is None:
            return False
        value, count = pct[polarity]
        _fill_cell(cell, f"{value:.1f}%({count}건)")

    summary_cell = by_addr.get(("3", "1"))
    if summary_cell is None:
        return False
    paras = summary_cell.xpath(".//hp:p", namespaces=NS)
    if len(paras) != sum(group_sizes) + 2:  # +2 blank separators between 3 groups
        return False
    summaries = feature_data["polaritySummaries"] or {}

    labels = ["[긍정 의견 요약]", "[부정 의견 요약]", "[중립 의견 요약]"]
    runs_by_polarity = [
        (summaries.get("positive") or {}).get("runs", []),
        (summaries.get("negative") or {}).get("runs", []),
        (summaries.get("neutral") or {}).get("runs", []),
    ]
    idx = 0
    for size, label, runs in zip(group_sizes, labels, runs_by_polarity):
        if size == 1:
            _set_para_label_then_break(paras[idx], label, runs)
        else:
            _set_para(paras[idx], label)
            _set_para_richtext(paras[idx + 1], runs)
        idx += size + 1  # skip the blank separator after this group
    return True


def fill_feature_qualitative(root: etree._Element, qualitative: dict) -> int:
    tables = root.xpath(".//hp:tbl", namespaces=NS)
    # Find candidate "감정 분석" tables by their surviving structural cells
    # (긍정/부정/중립 bare labels at row2, col0~2) -- the bracket content
    # itself is blanked in the template so can't be matched by text.
    candidates = []
    for tbl in tables:
        by_addr = {}
        for tc in tbl.xpath(".//hp:tc", namespaces=NS):
            addr = tc.find("hp:cellAddr", namespaces=NS)
            by_addr[(addr.get("colAddr"), addr.get("rowAddr"))] = tc
        if (
            by_addr.get(("0", "2")) is not None
            and _cell_text(by_addr[("0", "2")]) == "긍정"
            and _cell_text(by_addr.get(("1", "2"))) == "부정"
            and _cell_text(by_addr.get(("2", "2"))) == "중립"
        ):
            candidates.append(tbl)

    filled = 0
    for i, tbl in enumerate(candidates):
        if i >= len(FEATURE_ORDER):
            print(f"WARN: unexpected extra emotion table at index {i}", file=sys.stderr)
            continue
        feature_name = FEATURE_ORDER[i]
        feature_data = qualitative.get(f"feature:{feature_name}")
        if feature_data is None:
            continue
        if _fill_emotion_table(tbl, feature_data, GROUP_SIZES_BY_FEATURE[i]):
            filled += 1
        else:
            print(f"WARN: emotion table for {feature_name!r} didn't match expected structure", file=sys.stderr)
    return filled


def fill_feature_mean_sd(root: etree._Element, feature_satisfaction: list[dict]) -> int:
    """Fill each feature's "만족도 점수 평균 : X.XX / 10" / "표준편차 : X.XX"
    line (Ⅲ장, one small 2-cell table per feature, document order = Q6~Q11)."""
    tables = []
    for tbl in root.xpath(".//hp:tbl", namespaces=NS):
        by_addr = {}
        for tc in tbl.xpath(".//hp:tc", namespaces=NS):
            addr = tc.find("hp:cellAddr", namespaces=NS)
            by_addr[(addr.get("colAddr"), addr.get("rowAddr"))] = tc
        c00 = by_addr.get(("0", "0"))
        if c00 is not None and _cell_text(c00) == "만족도 점수 평균 : / 10":
            tables.append(by_addr)

    filled = 0
    for i, by_addr in enumerate(tables):
        if i >= len(feature_satisfaction):
            print(f"WARN: unexpected extra mean/sd table at index {i}", file=sys.stderr)
            continue
        stat = feature_satisfaction[i]
        mean_cell = by_addr.get(("0", "0"))
        sd_cell = by_addr.get(("1", "0"))
        if mean_cell is None or sd_cell is None:
            continue
        _fill_cell(mean_cell, f"만족도 점수 평균 : {stat['mean']:.2f} / 10")
        sd_paras = sd_cell.xpath(".//hp:p", namespaces=NS)
        if sd_paras:
            _set_para(sd_paras[0], f"표준편차 : {stat['sd']:.2f}")
        filled += 1
    return filled


# Representative-quote group tables ("1. 긍정 의견 (XX.X%)" etc, one per
# polarity per feature). Title text pattern confirmed against both the blank
# template ("1. 긍정 의견 (   %)") and the real filled doc ("1. 긍정 의견 (28.7%)").
_POLARITY_TITLE_RE = re.compile(r"^(\d+)\.\s*(긍정|부정|중립)\s*의견")
_POLARITY_KR = {"positive": "긍정", "negative": "부정", "neutral": "중립"}
_KR_TO_POLARITY = {v: k for k, v in _POLARITY_KR.items()}

# charPr ids reused from the template's own quote-group paragraphs (table 26,
# para 0 = label "[...]" run charPrIDRef=105 / bold 11pt; para 1 = quote run
# charPrIDRef=174 / plain 10pt; table 27 para 5 = "→ ..." arrow-insight run
# charPrIDRef=177 / bold 10pt -- confirmed via header.xml charPr defs,
# 2026-08-05). Real per-table styling is slightly inconsistent (hand-typed
# original used 171/173/176/162 variants for labels across different blocks)
# -- these three ids are used uniformly everywhere instead of chasing that.
_QUOTE_ROLE_CHARPR = {"label": "105", "quote": "174", "arrow": "177"}

# Fresh paragraph ids for cloned <hp:p> nodes must not collide with the
# document's existing ids (observed clustering around ~3.01 billion, e.g.
# 3012710919) -- start well clear of that band, still under the 32-bit
# unsigned ceiling HWPUNIT ids appear to use.
_next_para_id = itertools.count(3_800_000_000)


def _quote_group_specs(categories: list[dict], include_arrow: bool) -> list[tuple[str, str]]:
    """One (role, text) per paragraph needed to render `categories` as
    representative-quote groups: "[label]", each verbatim quote, an optional
    "→ insight" line, and a blank separator between groups (not after the
    last one) -- matches the real document's own layout (Ⅲ장 긍정 groups
    omit the arrow line, 부정/중립 include it; confirmed 2026-08-05 by
    reading the real filled doc directly)."""
    specs: list[tuple[str, str]] = []
    for i, cat in enumerate(categories):
        specs.append(("label", f"[{cat['label']}]"))
        for quote in cat["quotes"]:
            specs.append(("quote", f'"{quote}"'))
        if include_arrow:
            insight = cat.get("insight_final") or cat.get("insight_draft")
            if insight:
                specs.append(("arrow", f"→ {insight}"))
        if i < len(categories) - 1:
            specs.append(("blank", ""))
    return specs


def _set_paragraph_role(p: etree._Element, role: str, text: str) -> None:
    for child in list(p):
        p.remove(child)
    run = etree.SubElement(p, f"{{{HP}}}run")
    run.set("charPrIDRef", _QUOTE_ROLE_CHARPR.get(role, "174"))
    if text:
        t = etree.SubElement(run, f"{{{HP}}}t")
        t.text = text


def _fill_quote_group_cell(content_cell: etree._Element, specs: list[tuple[str, str]]) -> None:
    sublist = content_cell.find("hp:subList", namespaces=NS)
    existing = sublist.xpath("./hp:p", namespaces=NS)
    template_p = existing[-1] if existing else None
    for i, (role, text) in enumerate(specs):
        if i < len(existing):
            _set_paragraph_role(existing[i], role, text)
        else:
            new_p = copy.deepcopy(template_p)
            new_p.set("id", str(next(_next_para_id)))
            _set_paragraph_role(new_p, role, text)
            sublist.append(new_p)
    _grow_row_height_if_needed(content_cell, "\n".join(text for _, text in specs))


def _find_polarity_content_cells(
    tables: list[etree._Element], start_index: int
) -> tuple[dict[str, tuple[etree._Element, etree._Element]], list[etree._Element]] | None:
    """Scan forward from `start_index` (right after a feature's 감정 분석
    table) for the 3 "N. 긍정/부정/중립 의견" tables, returning each
    polarity's (title_cell, content_cell) plus the continuation table(s) the
    original author split off when their content overflowed a page
    (single-cell, no title match, sandwiched between two polarity matches) --
    this script grows the main content cell's height instead of using that
    leftover capacity, so the caller removes these to avoid a dangling empty
    box (see module docstring)."""
    found: dict[str, tuple[etree._Element, etree._Element]] = {}
    unused: list[etree._Element] = []
    for tbl in tables[start_index : start_index + 12]:
        tcs = tbl.xpath(".//hp:tc", namespaces=NS)
        matched = False
        if len(tcs) == 2:
            by_addr = {}
            for tc in tcs:
                addr = tc.find("hp:cellAddr", namespaces=NS)
                by_addr[(addr.get("colAddr"), addr.get("rowAddr"))] = tc
            title_cell = by_addr.get(("0", "0"))
            content_cell = by_addr.get(("0", "1"))
            if title_cell is not None and content_cell is not None:
                m = _POLARITY_TITLE_RE.match(_cell_text(title_cell))
                if m:
                    found[_KR_TO_POLARITY[m.group(2)]] = (title_cell, content_cell)
                    matched = True
        if not matched and found:
            unused.append(tbl)
        if len(found) == 3:
            break
    return (found, unused) if len(found) == 3 else None


def _remove_table(tbl: etree._Element) -> None:
    """Remove a whole `<hp:tbl>` (and its anchor `<hp:p>`) from the document
    flow -- confirmed safe for these continuation tables: their anchor
    paragraph is a plain direct child of `<hp:sec>`, in-line with every other
    paragraph/table in the body (not a floating/anchored object), so this is
    an ordinary "remove this paragraph" edit."""
    run = tbl.getparent()
    anchor_p = run.getparent() if run is not None else None
    parent = anchor_p.getparent() if anchor_p is not None else None
    if parent is not None and anchor_p is not None:
        parent.remove(anchor_p)


def fill_feature_quote_groups(root: etree._Element, qualitative: dict) -> int:
    tables = root.xpath(".//hp:tbl", namespaces=NS)
    index_by_id = {id(t): i for i, t in enumerate(tables)}

    # Same 감정 분석 table detection as fill_feature_qualitative -- reused as
    # the anchor to know where each feature's quote-group tables start.
    emotion_tables = []
    for tbl in tables:
        by_addr = {}
        for tc in tbl.xpath(".//hp:tc", namespaces=NS):
            addr = tc.find("hp:cellAddr", namespaces=NS)
            by_addr[(addr.get("colAddr"), addr.get("rowAddr"))] = tc
        if (
            by_addr.get(("0", "2")) is not None
            and _cell_text(by_addr[("0", "2")]) == "긍정"
            and _cell_text(by_addr.get(("1", "2"))) == "부정"
            and _cell_text(by_addr.get(("2", "2"))) == "중립"
        ):
            emotion_tables.append(tbl)

    filled = 0
    for i, emotion_tbl in enumerate(emotion_tables):
        if i >= len(FEATURE_ORDER):
            continue
        feature_name = FEATURE_ORDER[i]
        feature_data = qualitative.get(f"feature:{feature_name}")
        if feature_data is None:
            continue
        found = _find_polarity_content_cells(tables, index_by_id[id(emotion_tbl)] + 1)
        if found is None:
            print(f"WARN: quote-group tables for {feature_name!r} not found", file=sys.stderr)
            continue
        cells_by_polarity, unused_tables = found

        pct = _polarity_percentages(feature_data["categories"])
        categories_by_polarity: dict[str, list[dict]] = defaultdict(list)
        for cat in feature_data["categories"]:
            categories_by_polarity[cat["polarity"]].append(cat)

        for order, polarity in enumerate(("positive", "negative", "neutral"), start=1):
            title_cell, content_cell = cells_by_polarity[polarity]
            value, count = pct[polarity]
            _fill_cell(title_cell, f"{order}. {_POLARITY_KR[polarity]} 의견 ({value:.1f}%)")
            cats = categories_by_polarity.get(polarity, [])
            if not cats:
                continue
            specs = _quote_group_specs(cats, include_arrow=polarity != "positive")
            _fill_quote_group_cell(content_cell, specs)
        for tbl in unused_tables:
            _remove_table(tbl)
        filled += 1
    return filled


def fill_four_values_insight(root: etree._Element, qualitative: dict) -> int:
    """Fill the "[ XXX 가치 조사 결과 ]" banner's insight paragraph for each of
    the 4 4대가치 sections, using polaritySummaries.combined (a single
    flowing pos+neg narrative -- unlike Ⅲ장's separate bracket-per-polarity
    format). The representative-quote groups ("긍정 주요 의견"/"부정 주요
    의견" + quotes) right above it are the same variable-length problem as
    Ⅲ장's quote groups -- still out of scope, left blank."""
    tables = root.xpath(".//hp:tbl", namespaces=NS)
    filled = 0
    for i, tbl in enumerate(tables):
        tcs = tbl.xpath(".//hp:tc", namespaces=NS)
        title = _cell_text(tcs[0]) if tcs else ""
        key = next((k for k, v in _extended.FOUR_VALUES_TITLES.items() if v == title), None)
        if key is None or i + 1 >= len(tables):
            continue
        data = qualitative.get(f"values:{key}")
        if data is None:
            continue
        combined_runs = ((data.get("polaritySummaries") or {}).get("combined") or {}).get("runs", [])
        if not combined_runs:
            continue
        insight_tbl = tables[i + 1]
        by_addr = {}
        for tc in insight_tbl.xpath(".//hp:tc", namespaces=NS):
            addr = tc.find("hp:cellAddr", namespaces=NS)
            by_addr[(addr.get("colAddr"), addr.get("rowAddr"))] = tc
        insight_cell = by_addr.get(("0", "3"))
        if insight_cell is None:
            continue
        paras = insight_cell.xpath(".//hp:p", namespaces=NS)
        if not paras:
            continue
        _set_para_richtext(paras[0], combined_runs)
        filled += 1
    return filled


def main() -> None:
    stats_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/rivalabs-stats.json")
    qual_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("/tmp/rivalabs-qualitative.json")
    stats = json.loads(stats_path.read_text(encoding="utf-8"))
    qualitative = json.loads(qual_path.read_text(encoding="utf-8"))

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
    question_filled = fill_survey_question_table(root, stats["surveyQuestions"])
    four_values_filled = fill_four_values(root, stats["fourValues"])
    ux_quality_filled = fill_ux_quality(root, stats["uxQuality"])
    feature_mean_sd_filled = fill_feature_mean_sd(root, stats["featureSatisfaction"])
    feature_qual_filled = fill_feature_qualitative(root, qualitative)
    quote_groups_filled = fill_feature_quote_groups(root, qualitative)
    four_values_insight_filled = fill_four_values_insight(root, qualitative)

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
    print(f"  overview cells filled: {overview_filled} / 10")
    print(f"  survey question cells filled: {question_filled} / {len(stats['surveyQuestions'])}")
    print(f"  4대 가치 tables filled: {four_values_filled} / 4")
    print(f"  UX quality tables filled: {ux_quality_filled} / 8")
    print(f"  feature mean/sd tables filled: {feature_mean_sd_filled} / 6")
    print(f"  feature emotion tables filled: {feature_qual_filled} / 6")
    print(f"  feature quote-group blocks filled: {quote_groups_filled} / 6")
    print(f"  4대 가치 insight paragraphs filled: {four_values_insight_filled} / 4")


if __name__ == "__main__":
    main()
