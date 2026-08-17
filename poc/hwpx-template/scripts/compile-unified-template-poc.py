#!/usr/bin/env python3
"""제공된 통합 공양식 HWPX에 기존 DB 결과를 넣는 로컬 POC.

공양식 자신의 표·문단·글자 스타일만 보존해 사용한다. 다른 HWPX의 style ID를 가져오지
않으며, DB·서비스·분석 파이프라인을 수정하거나 재호출하지 않는다.
"""
from __future__ import annotations

import argparse
import copy
import importlib.util
import io
import json
import sys
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}
POLARITIES = (("positive", "긍정"), ("negative", "부정"), ("neutral", "중립"))


def load_editor(skill_dir: Path):
    source = skill_dir / "scripts" / "edit_hwpx.py"
    sys.path.insert(0, str(source.parent))
    spec = importlib.util.spec_from_file_location("hwpx_editor", source)
    if spec is None or spec.loader is None:
        raise SystemExit("HWPX 편집기를 불러오지 못했습니다.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def set_plain(paragraph, text: str) -> None:
    nodes = paragraph.xpath("./hp:run/hp:t", namespaces=NS)
    if not nodes:
        raise SystemExit("편집 가능한 원본 문단이 아닙니다.")
    for node in paragraph.xpath(".//hp:t", namespaces=NS):
        node.text = ""
        for child in node:
            child.tail = ""
    nodes[0].text = text
    for line in paragraph.xpath(".//hp:linesegarray", namespaces=NS):
        line.getparent().remove(line)


def quote(value: str) -> str:
    return f'“{str(value).strip().strip(chr(34)).strip("“”")}”'


def polarity_data(question):
    groups = {}
    categories = question.get("categories", [])
    counts = {key: sum(int(item.get("clauseCount", 0)) for item in categories if item.get("polarity") == key) for key, _ in POLARITIES}
    total = sum(counts.values())
    if not total:
        raise SystemExit(f"{question['question_key']}: 극성 절 수가 없습니다.")
    for key, label in POLARITIES:
        items = sorted((item for item in categories if item.get("polarity") == key), key=lambda item: -int(item.get("clauseCount", 0)))
        category = items[0] if items else {"label": "분류 결과 없음", "quotes": [], "insight": "대표 의견 없음"}
        groups[key] = {
            "label": label,
            "count": counts[key],
            "pct": counts[key] * 100 / total,
            "category": category.get("label", "분류 결과 없음"),
            "quotes": category.get("quotes", []),
            "insight": category.get("insight", "대표 의견 없음"),
        }
    return groups


def fill_feature_block(outer_question, outer_score, outer_keywords, outer_positive, outer_negative, question, stat):
    """공양식의 Q/요약/긍정-부정-중립 블록 하나를 현재 DB 기능 결과로 채운다."""
    groups = polarity_data(question)
    set_plain(outer_question.xpath(".//hp:p", namespaces=NS)[0], f"‘{stat['name']}’ 기능의 만족도는 몇 점입니까?")
    score_parts = outer_score.xpath(".//hp:p", namespaces=NS)
    set_plain(score_parts[0], f"만족도 점수 평균 : {stat['mean']:.2f} / 10")
    set_plain(score_parts[1], f"표준편차 : {stat['sd']:.2f}")
    keyword_parts = outer_keywords.xpath(".//hp:p", namespaces=NS)
    labels = [item["category"] for item in groups.values()]
    set_plain(keyword_parts[1], "주요 키워드 도출")
    set_plain(keyword_parts[6], f"2. {labels[1]}")
    set_plain(keyword_parts[8], f"3. {labels[2]}")
    for outer, key in ((outer_positive, "positive"), (outer_negative, "negative")):
        parts = outer.xpath(".//hp:p", namespaces=NS)
        data = groups[key]
        set_plain(parts[0], f"{1 if key == 'positive' else 2}. {data['label']} 의견 ({data['pct']:.1f}% / {data['count']}건)")
        set_plain(parts[1], f"[{data['category']}]")
        set_plain(parts[2], quote(data['quotes'][0]) if data['quotes'] else "대표 인용문 없음")
        set_plain(parts[3], quote(data['quotes'][1]) if len(data['quotes']) > 1 else "대표 인용문 없음")
        set_plain(parts[5], f"→ {data['insight']}")
    # 부정 블록의 하위에 중립 블록이 이어진 공양식 구조다.
    parts = outer_negative.xpath(".//hp:p", namespaces=NS)
    data = groups['neutral']
    set_plain(parts[6], f"3. {data['label']} 의견 ({data['pct']:.1f}% / {data['count']}건)")
    set_plain(parts[7], f"[{data['category']}]")
    set_plain(parts[8], quote(data['quotes'][0]) if data['quotes'] else "대표 인용문 없음")
    set_plain(parts[9], quote(data['quotes'][1]) if len(data['quotes']) > 1 else "대표 인용문 없음")
    set_plain(parts[11], f"→ {data['insight']}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--db-export", type=Path, required=True)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skill-dir", type=Path, required=True)
    args = parser.parse_args()
    editor = load_editor(args.skill_dir)
    report = json.loads(args.db_export.read_text(encoding="utf-8"))
    identity = json.loads(args.identity.read_text(encoding="utf-8"))
    if identity.get("templateVariant") != "unified":
        raise SystemExit("통합 공양식에는 templateVariant: 'unified'가 필요합니다.")
    questions = {item["question_key"]: item for item in report.get("questions", [])}
    stats = report["report"]["quant_stats"]["featureSatisfaction"]
    if len(stats) != 6:
        raise SystemExit("이 POC는 현재 6개 기능 DB 결과를 전제로 합니다.")
    with zipfile.ZipFile(args.source) as archive:
        source_bytes = archive.read("Contents/section1.xml")
    tree = etree.parse(io.BytesIO(source_bytes))
    root = tree.getroot()
    direct = root.xpath("./hp:p", namespaces=NS)
    # 공양식의 top-level 기능 블록: Q, 점수표, 키워드표, 긍정표, 부정+중립표
    blocks = []
    for paragraph in direct:
        descendants = paragraph.xpath(".//hp:p", namespaces=NS)
        if descendants and "기능의 만족도는 몇 점입니까?" in "".join(paragraph.xpath('.//hp:t//text()', namespaces=NS)):
            blocks.append([paragraph])
    # top-level 순서는 Q/score/keyword/positive/negative가 반복된다.
    structural = []
    for start in (117, 156, 195, 234, 273):
        all_p = root.xpath(".//hp:p", namespaces=NS)
        outer = [all_p[start], all_p[start + 2], all_p[start + 6], all_p[start + 19], all_p[start + 26]]
        structural.append(outer)
    for index, stat in enumerate(stats[:5]):
        fill_feature_block(*structural[index], questions[f"feature:{stat['name']}"], stat)
    # 6번째 기능: 다섯 번째 공양식의 top-level 5개 블록을 복제해 마지막 기능 뒤에 붙인다.
    prototype = structural[-1]
    copies = [copy.deepcopy(item) for item in prototype]
    fill_feature_block(*copies, questions[f"feature:{stats[5]['name']}"], stats[5])
    anchor = prototype[-1]
    parent = anchor.getparent()
    location = parent.index(anchor) + 1
    for item in copies:
        parent.insert(location, item)
        location += 1
    # 공양식 표지/개요의 식별 가능한 빈 슬롯도 최소로 채운다.
    all_p = root.xpath(".//hp:p", namespaces=NS)
    for index, text in ((58, f"기  업  명 : {identity['companyName']}"), (59, f"제  품  명 : {identity['serviceOrProductName']}"), (60, f"테스트 대상 : {identity['productType']}")):
        set_plain(all_p[index], text)
    output_bytes = editor._serialize_xml_like_source(tree, source_bytes)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    editor.write_raw_preserving_zip(args.source, args.output, {"Contents/section1.xml": output_bytes})
    print(json.dumps({"output": str(args.output), "features": len(stats), "template": "unified blank form"}, ensure_ascii=False))


if __name__ == "__main__":
    raise SystemExit(main())
