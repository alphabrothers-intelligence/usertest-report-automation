#!/usr/bin/env python3
"""리바랩스 첫 기능의 부정·중립 DB 정성 결과를 원본 슬롯에 안전하게 배치한다.

고정 원본의 슬롯 수를 넘는 카테고리/인용문은 절대 잘라 넣지 않고 overflow JSON에
기록한다. 최종 공양식에서는 이 목록을 반복 블록/다음 페이지로 그대로 확장한다.
"""
from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}
DISPLAY_LABELS = {
    "GPS 및 걸음 수 측정 부정확성 문제": "GPS·걸음 수 측정 부정확성",
    "지도 확대·축소 및 조작감 불편": "지도 조작감 불편",
    "보물상자·영역 획득 범위 불명확": "보물상자 획득 범위 불명확",
    "산책 시작 수동 조작의 번거로움": "산책 시작 수동 조작 불편",
    "보상 및 콘텐츠 매력 부족": "보상·콘텐츠 매력 부족",
    "지도 정보 표시 개선 요청": "지도 정보 표시 개선 요청",
}

# (카테고리, 인용문 슬롯, 인사이트 슬롯) — 원본의 기존 문단만 사용.
NEGATIVE_BLOCKS = (
    (279, (280, 281, 282, 283), 284),
    (286, (287, 288), 289),
    (291, (292, 293), 295),
    (297, (298, 299), 300),
    (302, (303, 304), 305),
)
NEUTRAL_BLOCKS = ((328, (329, 330), 331),)


def text_of(paragraph: etree._Element) -> str:
    return "".join(paragraph.xpath(".//hp:t//text()", namespaces=NS)).strip()


def compact_len(text: str) -> int:
    return len("".join(text.split()))


def quote(text: str) -> str:
    return f'“{text.strip().strip(chr(34)).strip("“”")}”'


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--db-export", type=Path, required=True)
    parser.add_argument("--patches", type=Path, required=True)
    parser.add_argument("--overflow", type=Path, required=True)
    args = parser.parse_args()

    report = json.loads(args.db_export.read_text(encoding="utf-8"))
    question = next(item for item in report["questions"] if item["question_key"] == "feature:펫과의 산책")
    with zipfile.ZipFile(args.source) as archive:
        root = etree.fromstring(archive.read("Contents/section1.xml"))
    paragraphs = root.xpath(".//hp:p", namespaces=NS)
    patches: list[dict] = []
    overflow: list[dict] = []

    def add(slot: int, text: str, source: str, multiplier: float = 1.5) -> bool:
        old = text_of(paragraphs[slot])
        if compact_len(text) > compact_len(old) * multiplier:
            overflow.append({"slot": slot, "reason": "length", "text": text, "source": source})
            return False
        patches.append({
            "sectionIndex": 1, "paragraphIndex": slot, "expectedText": old,
            "text": text, "source": source,
        })
        return True

    def apply_polarity(name: str, title_slot: int, blocks: tuple[tuple[int, tuple[int, ...], int], ...]) -> None:
        categories = sorted(
            (item for item in question["categories"] if item.get("polarity") == name),
            key=lambda item: (-int(item.get("clauseCount", 0)), item["label"]),
        )
        total = sum(int(item.get("clauseCount", 0)) for item in question["categories"])
        count = sum(int(item.get("clauseCount", 0)) for item in categories)
        ordinal = "2" if name == "negative" else "3"
        korean = "부정" if name == "negative" else "중립"
        add(title_slot, f"{ordinal}. {korean} 의견 ({count / total * 100:.1f}%)", f"qualitative-db-{name}-title")

        for category, (category_slot, quote_slots, insight_slot) in zip(categories, blocks):
            label = DISPLAY_LABELS.get(category["label"], category["label"])
            if not add(category_slot, f"[{label}]", "qualitative-db-category"):
                overflow.append({"category": category["label"], "reason": "category-label-length"})
                continue
            placed = 0
            for source_quote, quote_slot in zip(category.get("quotes", []), quote_slots):
                if add(quote_slot, quote(source_quote), "qualitative-db-quote"):
                    placed += 1
                else:
                    overflow.append({"category": category["label"], "reason": "quote-length", "quote": source_quote})
            for source_quote in (category.get("quotes", []) or [])[len(quote_slots):]:
                overflow.append({"category": category["label"], "reason": "quote-slot-count", "quote": source_quote})
            add(insight_slot, f"→ {category['insight']}", "qualitative-db-insight")

        for category in categories[len(blocks):]:
            overflow.append({
                "category": category["label"],
                "reason": "category-slot-count",
                "polarity": name,
                "quotes": category.get("quotes", []),
                "insight": category.get("insight"),
            })

    apply_polarity("negative", 278, NEGATIVE_BLOCKS)
    apply_polarity("neutral", 327, NEUTRAL_BLOCKS)
    args.patches.parent.mkdir(parents=True, exist_ok=True)
    args.patches.write_text(json.dumps(patches, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.overflow.write_text(json.dumps(overflow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"patches": len(patches), "overflow": len(overflow)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
