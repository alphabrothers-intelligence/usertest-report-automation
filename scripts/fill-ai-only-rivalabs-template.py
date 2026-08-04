#!/usr/bin/env python3
"""Fill the preserved Rivalabs blank form with DB/AI content only."""

from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile

from lxml import etree

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TEMPLATE = ROOT / "output" / "hwpx-skill-reference-preserved" / "01_SW_원본기반_사용성테스트_공양식.hwpx"
SKILL_SCRIPTS = Path("/Users/a111-04-2310-01/.codex/skills/hwpxskill/scripts")
sys.path.insert(0, str(SKILL_SCRIPTS))
from edit_hwpx import _serialize_xml_like_source, write_raw_preserving_zip  # noqa: E402

HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
NS = {"hp": HP}


def reference() -> Path:
    return next(p for p in DATA.glob("*.hwpx") if "리바랩스_사용성테스트_결과보고서" in unicodedata.normalize("NFC", p.name))


def plain(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"\*\*|__", "", value)
    value = re.sub(r"^#+\s*", "", value, flags=re.M)
    value = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", "", value)
    value = "".join(
        char for char in value
        if ord(char) in (0x9, 0xA, 0xD)
        or 0x20 <= ord(char) <= 0xD7FF
        or 0xE000 <= ord(char) <= 0xFFFD
        or 0x10000 <= ord(char) <= 0x10FFFF
    )
    return value.strip()


def category_text(question: dict, polarity: str | None) -> str:
    rows = [row for row in question["categories"] if row.get("polarity") == polarity]
    parts: list[str] = []
    for row in rows:
        label = plain(row.get("label") or "의견").replace("\x1f", " · ")
        quotes = [plain(str(q)) for q in (row.get("quotes") or []) if plain(str(q))][:2]
        insight = plain(row.get("insight_final") or row.get("insight_draft"))
        block = f"[ {label} ]"
        if quotes:
            block += " " + " ".join(f'“{quote}”' for quote in quotes)
        if insight:
            block += f" ➜ {insight}"
        parts.append(block)
    return " ".join(parts)


def split_to_capacities(text: str, capacities: list[int]) -> list[str]:
    remaining = text.strip()
    result: list[str] = []
    for cap in capacities:
        if not remaining or cap <= 0:
            result.append("")
            continue
        if len(remaining) <= cap:
            result.append(remaining)
            remaining = ""
            continue
        cut = remaining.rfind(" ", 0, cap + 1)
        if cut < max(10, cap // 2):
            cut = cap
        result.append(remaining[:cut].rstrip())
        remaining = remaining[cut:].lstrip()
    return result


def hydrate_section(template_data: bytes, reference_data: bytes, snapshot: dict) -> tuple[bytes, int]:
    template_root = etree.fromstring(template_data, etree.XMLParser(remove_blank_text=False))
    reference_root = etree.fromstring(reference_data, etree.XMLParser(remove_blank_text=False))
    targets = template_root.xpath(".//hp:t", namespaces=NS)
    refs = reference_root.xpath(".//hp:t", namespaces=NS)
    if len(targets) != len(refs):
        raise RuntimeError(f"템플릿/원본 텍스트 노드 불일치: {len(targets)} != {len(refs)}")

    questions = snapshot["questions"]
    by_feature = {q["question_key"].split(":", 1)[1]: q for q in questions if q["question_key"].startswith("feature:")}
    by_value = {q["question_key"].split(":", 1)[1]: q for q in questions if q["question_key"].startswith("values:")}
    improvement = next((q for q in questions if q["question_key"] == "improvementIdea"), None)
    section_analyses = snapshot["report"].get("section_analyses") or {}
    recommendations = snapshot.get("recommendations") or []

    current_question: dict | None = None
    current_polarity: str | None = None
    current_section = ""
    groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    analysis_slots: dict[str, list[int]] = defaultdict(list)
    improvement_slots: list[int] = []
    recommendation_slots: list[int] = []

    for index, (target, ref) in enumerate(zip(targets, refs)):
        original = "".join(ref.itertext()).strip()
        current = "".join(target.itertext())
        if original in {"Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ", "Ⅸ"}:
            current_section = original
            current_question = None
            current_polarity = None
        for name, question in by_feature.items():
            if name in original and "Q" in original:
                current_question = question
                current_polarity = None
        for key, question in by_value.items():
            labels = {"functional": "기능적 가치", "aesthetic": "심미적 가치", "economic": "경제적 가치", "social": "사회"}
            if labels.get(key, key) in original and "Q" in original:
                current_question = question
                current_polarity = None
        if improvement and ("Q27" in original or "개선이 필요" in original):
            current_question = improvement
            current_polarity = None
        if "긍정 의견" in original:
            current_polarity = "positive"
        elif "부정 의견" in original:
            current_polarity = "negative"
        elif "중립 의견" in original:
            current_polarity = "neutral"

        is_blank = not current.strip()
        if not is_blank or not original:
            continue
        if current_question and current_question["kind"] == "standard" and current_polarity and len(original) >= 30:
            groups[(current_question["question_key"], current_polarity)].append(index)
        elif current_question and current_question["kind"] == "improvement" and len(original) >= 30:
            improvement_slots.append(index)
        elif current_section == "Ⅲ" and "종합 해석" in original:
            analysis_slots["featureExperience"].append(index)
        elif current_section == "Ⅳ" and len(original) >= 80:
            analysis_slots["corePurchaseFactor"].append(index)
        elif current_section == "Ⅴ" and "종합 해석" in original:
            analysis_slots["fourValues"].append(index)
        elif current_section == "Ⅵ" and len(original) >= 80:
            analysis_slots["uxQuality"].append(index)
        elif current_section == "Ⅶ" and len(original) >= 80:
            analysis_slots["crossAnalysis"].append(index)
        elif current_section == "Ⅸ" and len(original) >= 80:
            recommendation_slots.append(index)

    changed = 0
    for (question_key, polarity), indices in groups.items():
        question = next(q for q in questions if q["question_key"] == question_key)
        content = category_text(question, polarity)
        values = split_to_capacities(content, [len("".join(refs[i].itertext())) for i in indices])
        for index, value in zip(indices, values):
            if value:
                targets[index].text = value
                changed += 1
    if improvement and improvement_slots:
        content = category_text(improvement, None)
        values = split_to_capacities(content, [len("".join(refs[i].itertext())) for i in improvement_slots])
        for index, value in zip(improvement_slots, values):
            if value:
                targets[index].text = value
                changed += 1
    for key, indices in analysis_slots.items():
        content = plain(section_analyses.get(key))
        values = split_to_capacities(content, [len("".join(refs[i].itertext())) for i in indices])
        for index, value in zip(indices, values):
            if value:
                targets[index].text = value
                changed += 1
    if recommendation_slots and recommendations:
        content = "\n\n".join(plain(row.get("final") or row.get("draft")) for row in recommendations)
        values = split_to_capacities(content, [len("".join(refs[i].itertext())) for i in recommendation_slots])
        for index, value in zip(recommendation_slots, values):
            if value:
                targets[index].text = value
                changed += 1

    return _serialize_xml_like_source(etree.ElementTree(template_root), template_data), changed


def main() -> None:
    snapshot = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    output = Path(sys.argv[2])
    source = reference()
    replacements: dict[str, bytes] = {}
    changed = 0
    with ZipFile(TEMPLATE) as template_zip, ZipFile(source) as reference_zip:
        for name in template_zip.namelist():
            if name.startswith("Contents/section") and name.endswith(".xml"):
                rendered, count = hydrate_section(template_zip.read(name), reference_zip.read(name), snapshot)
                if count:
                    replacements[name] = rendered
                    changed += count
    output.parent.mkdir(parents=True, exist_ok=True)
    write_raw_preserving_zip(TEMPLATE, output, replacements)
    print(json.dumps({"output": str(output), "changedTextSlots": changed, "source": "DB/AI only"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
