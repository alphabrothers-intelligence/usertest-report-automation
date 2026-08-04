#!/usr/bin/env python3
"""Hydrate the Rivalabs reference HWPX with deterministic values from a DB snapshot."""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path
from zipfile import ZipFile

from lxml import etree


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SKILL_SCRIPTS = Path("/Users/a111-04-2310-01/.codex/skills/hwpxskill/scripts")
sys.path.insert(0, str(SKILL_SCRIPTS))
from edit_hwpx import _serialize_xml_like_source, write_raw_preserving_zip  # noqa: E402

HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
NS = {"hp": HP}


def reference() -> Path:
    return next(
        p for p in DATA.glob("*.hwpx")
        if "리바랩스_사용성테스트_결과보고서" in unicodedata.normalize("NFC", p.name)
    )


def replace_number_after(label: str, value: float | int, text: str) -> str:
    return re.sub(
        rf"({re.escape(label)}\s*[:：]?\s*)[-+−–]?\d+(?:\.\d+)?",
        lambda match: f"{match.group(1)}{value}",
        text,
        count=1,
    )


def hydrate_section(data: bytes, snapshot: dict) -> tuple[bytes, int]:
    report = snapshot["report"]
    stats = report["quant_stats"]
    root = etree.fromstring(data, etree.XMLParser(remove_blank_text=False))
    changed = 0
    active_feature: str | None = None
    active_value: str | None = None
    active_ux: str | None = None
    feature = {row["name"]: row for row in stats["featureSatisfaction"]}
    four = {
        "기능적 가치": stats["fourValues"]["functional"],
        "심미적 가치": stats["fourValues"]["aesthetic"],
        "경제적 가치": stats["fourValues"]["economic"],
        "사회": stats["fourValues"]["social"],
    }
    ux = {row["name"]: row for row in stats["uxQuality"]["usability"] + stats["uxQuality"]["fun"]}

    for para in root.xpath(".//hp:p", namespaces=NS):
        nodes = para.xpath("./hp:run/hp:t", namespaces=NS)
        if not nodes:
            continue
        original = "".join("".join(node.itertext()) for node in nodes)
        if not original.strip():
            continue
        is_atomic = len(original) < 180
        for name in feature:
            if is_atomic and name in original and "Q" in original:
                active_feature = name
                active_value = None
                active_ux = None
        for name in four:
            if is_atomic and name in original and "Q" in original:
                active_value = name
                active_feature = None
                active_ux = None
        for name in ux:
            if is_atomic and name in original and "Q" in original:
                active_ux = name
                active_feature = None
                active_value = None

        updated = original
        if active_feature and "만족도 점수 평균" in updated:
            updated = replace_number_after("만족도 점수 평균", feature[active_feature]["mean"], updated)
        if active_feature and "표준편차" in updated:
            updated = replace_number_after("표준편차", feature[active_feature]["sd"], updated)
        if active_value and "평균" in updated and len(updated) < 80:
            updated = replace_number_after("평균", four[active_value]["mean"], updated)
        if active_value and "표준편차" in updated:
            updated = replace_number_after("표준편차", four[active_value]["sd"], updated)
        if active_ux and "평균" in updated and len(updated) < 80:
            updated = replace_number_after("평균", ux[active_ux]["mean"], updated)
        if active_ux and "표준편차" in updated:
            updated = replace_number_after("표준편차", ux[active_ux]["sd"], updated)
        if is_atomic and "종합 만족도 평균" in updated:
            updated = replace_number_after("종합 만족도 평균", stats["overallSatisfaction"]["mean"], updated)
        if is_atomic and "평균 구매 의향" in updated:
            updated = replace_number_after("평균 구매 의향", stats["nps"]["rawMean"], updated)
        if is_atomic and "NPS 지수" in updated and re.search(r"NPS 지수\s*[-:：]\s*-?\d+", updated):
            updated = re.sub(r"(NPS 지수\s*[-:：]?\s*)-?\d+", rf"\g<1>{stats['nps']['npsScore']}", updated)

        # Make the proof artifact distinguishable without changing the TOC/survey tables.
        if "Usability Test Proposal for" in updated and "DB 채움 검증본" not in updated:
            updated = updated.replace("Usability Test Proposal for", "DB 채움 검증본 · Usability Test Proposal for")

        if updated == original:
            continue
        nodes[0].text = updated
        for child in nodes[0]:
            child.tail = ""
        for node in nodes[1:]:
            node.text = ""
            for child in node:
                child.tail = ""
        changed += 1

    return _serialize_xml_like_source(etree.ElementTree(root), data), changed


def main() -> None:
    snapshot_path = Path(sys.argv[1] if len(sys.argv) > 1 else "tmp/rivalabs-db-snapshot.json")
    output = Path(sys.argv[2] if len(sys.argv) > 2 else "output/db-filled-hwpx/리바랩스_DB_채움_검증본.hwpx")
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
    source = reference()
    replacements: dict[str, bytes] = {}
    changed = 0
    with ZipFile(source) as archive:
        for name in archive.namelist():
            if name.startswith("Contents/section") and name.endswith(".xml"):
                rendered, count = hydrate_section(archive.read(name), snapshot)
                if count:
                    replacements[name] = rendered
                    changed += count
    output.parent.mkdir(parents=True, exist_ok=True)
    write_raw_preserving_zip(source, output, replacements)
    print(json.dumps({"source": str(source), "output": str(output), "changedParagraphs": changed}, ensure_ascii=False))


if __name__ == "__main__":
    main()
