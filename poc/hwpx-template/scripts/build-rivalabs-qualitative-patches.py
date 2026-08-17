#!/usr/bin/env python3
"""DB 기반 정성 요약/비율을 리바랩스 원본의 안전한 표시 문단에 배치한다.

원본의 복합 서식 문단(제목과 본문이 같은 run에 섞인 곳)은 건드리지 않는다. 그 영역은
공양식에서 제목·본문 슬롯을 분리한 뒤 확장한다. 이 POC 단계는 원본의 실제 독립 본문 문단과
비율 셀만 대상으로, DB 정성 결과가 원본 내용과 다르게 HWPX에 반영되는지를 검증한다.
"""
from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}

# (긍정 요약, 부정 요약, 중립 요약) — None은 제목·본문 혼합 문단이라 이 단계에서는 보존.
SUMMARY_SLOTS = [
    (243, 246, None),
    (348, 351, 354),
    (444, 447, 450),
    (524, 527, 530),
    (None, None, None),
    (723, 726, 729),
]
# (긍정 비율, 부정 비율, 중립 비율)
COUNT_SLOTS = [
    (252, 253, 254), (358, 359, 360), (454, 455, 456),
    (534, 535, 536), (638, 639, 640), (733, 734, 735),
]
POLARITIES = ("positive", "negative", "neutral")
LABELS = {"positive": "긍정", "negative": "부정", "neutral": "중립"}


def text_of(paragraph):
    return "".join(paragraph.xpath(".//hp:t//text()", namespaces=NS)).strip()


def category_summary(group: dict) -> str:
    names = [item["label"].strip() for item in group.get("categories", []) if item.get("label")]
    return f"{group['label']}에서는 {', '.join(names)}이(가) 주요 반응으로 확인됨."


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    pages = plan.get("featurePages", [])
    if len(pages) != 6:
        raise SystemExit(f"리바랩스 SW POC는 기능 6개가 필요합니다. 현재: {len(pages)}")

    with zipfile.ZipFile(args.source) as archive:
        root = etree.fromstring(archive.read("Contents/section1.xml"))
    paragraphs = root.xpath(".//hp:p", namespaces=NS)
    patches: list[dict] = []

    for feature_index, page in enumerate(pages):
        analysis = page.get("polarityAnalysis")
        if not analysis:
            continue
        groups = {group["polarity"]: group for group in analysis["groups"]}
        counts = {row["label"]: row for row in analysis["summaryTable"]}
        for polarity, paragraph_index in zip(POLARITIES, SUMMARY_SLOTS[feature_index]):
            if paragraph_index is None:
                continue
            old = text_of(paragraphs[paragraph_index])
            if not old or old.startswith("["):
                raise SystemExit(f"P{paragraph_index}는 독립 본문 슬롯이 아닙니다: {old!r}")
            patches.append({
                "sectionIndex": 1,
                "paragraphIndex": paragraph_index,
                "expectedText": old,
                "text": category_summary(groups[polarity]),
                "source": "qualitative-db-summary",
            })
        for polarity, paragraph_index in zip(POLARITIES, COUNT_SLOTS[feature_index]):
            old = text_of(paragraphs[paragraph_index])
            row = counts[LABELS[polarity]]
            patches.append({
                "sectionIndex": 1,
                "paragraphIndex": paragraph_index,
                "expectedText": old,
                "text": f"{row['percentage']:.1f}%({row['count']}건)",
                "source": "qualitative-db-polarity-count",
            })

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(patches, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"patches": len(patches), "output": str(args.output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
