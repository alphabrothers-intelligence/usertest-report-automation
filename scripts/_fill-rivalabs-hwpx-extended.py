#!/usr/bin/env python3
"""Second vertical slice: extends the Ⅰ장-only fill to also cover Ⅴ장(4대 가치)
and Ⅵ장(UX 품질)'s 평균/표준편차 mini-tables -- still quant-only, no
qualitative/chart content (same scope boundary as the first slice).

Writes to a NEW output file. Does not touch 02_SW_리바랩스_실데이터_채움_Ⅰ장.hwpx
(already reviewed/approved) or any lib/pdf/ rendering code.

Usage:
    npx tsx scripts/_dump-rivalabs-quant-stats.ts /tmp/rivalabs-stats.json
    python3 scripts/_fill-rivalabs-hwpx-extended.py /tmp/rivalabs-stats.json
"""

from __future__ import annotations

import json
import sys
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

HP = _build.HP
copy_info = _build.copy_info
NS = {"hp": HP}

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "output" / "report-templates" / "02_SW_사용성테스트_보고서_템플릿_리바랩스원본.hwpx"
OUTPUT = ROOT / "output" / "report-templates" / "02_SW_리바랩스_실데이터_채움_확장.hwpx"

_cell_text = _overview._cell_text
_fill_cell = _overview._fill_cell
fill_overview_table = _overview.fill_overview_table
fill_survey_question_table = _overview.fill_survey_question_table


def _cells_by_addr(tbl: etree._Element) -> dict[tuple[str, str], etree._Element]:
    by_addr = {}
    for tc in tbl.xpath(".//hp:tc", namespaces=NS):
        addr = tc.find("hp:cellAddr", namespaces=NS)
        by_addr[(addr.get("colAddr"), addr.get("rowAddr"))] = tc
    return by_addr


def _find_table_by_title(root: etree._Element, title_text: str) -> etree._Element | None:
    for tbl in root.xpath(".//hp:tbl", namespaces=NS):
        by_addr = _cells_by_addr(tbl)
        title_cell = by_addr.get(("0", "0"))
        if title_cell is not None and _cell_text(title_cell) == title_text:
            return tbl
    return None


def fill_meansd_table(
    root: etree._Element,
    current_title: str,
    mean: float,
    sd: float,
    new_title: str | None = None,
) -> bool:
    """Fill the "전체 / 평균 / 표준편차" mini-table matched by its current title
    text (row0/col0). Structure confirmed against the real document (both
    4대가치 and UX-quality tables share it): row0=title(colSpan3), row1=blank
    header row (평균/표준편차 labels already survive blanking), row2=전체 +
    mean + sd."""
    tbl = _find_table_by_title(root, current_title)
    if tbl is None:
        print(f"WARN: table not found for title {current_title!r}", file=sys.stderr)
        return False
    by_addr = _cells_by_addr(tbl)
    mean_cell = by_addr.get(("1", "2"))
    sd_cell = by_addr.get(("2", "2"))
    if mean_cell is None or sd_cell is None:
        print(f"WARN: mean/sd cells not found for {current_title!r}", file=sys.stderr)
        return False
    _fill_cell(mean_cell, f"{mean:.2f}")
    _fill_cell(sd_cell, f"{sd:.2f}")
    if new_title is not None:
        title_cell = by_addr[("0", "0")]
        _fill_cell(title_cell, new_title)
    return True


FOUR_VALUES_TITLES = {
    "functional": "기능적 가치 만족도",
    "aesthetic": "심미적 가치 만족도",
    "economic": "경제적 가치 만족도",
    "social": "사회·공공적 가치 만족도",
}


def fill_four_values(root: etree._Element, four_values: dict) -> int:
    filled = 0
    for key, title in FOUR_VALUES_TITLES.items():
        stat = four_values[key]
        if fill_meansd_table(root, title, stat["mean"], stat["sd"]):
            filled += 1
    return filled


def fill_ux_quality(root: etree._Element, ux_quality: dict) -> int:
    filled = 0
    for axis, items in (("실용성", ux_quality["usability"]), ("즐거움", ux_quality["fun"])):
        for i, item in enumerate(items, start=1):
            current_title = f"{axis}{i})"
            new_title = f"{axis}{i}) {item['name']} 점수"
            if fill_meansd_table(root, current_title, item["mean"], item["sd"], new_title):
                filled += 1
    return filled


def main() -> None:
    stats_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/tmp/rivalabs-stats.json")
    stats = json.loads(stats_path.read_text(encoding="utf-8"))

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


if __name__ == "__main__":
    main()
