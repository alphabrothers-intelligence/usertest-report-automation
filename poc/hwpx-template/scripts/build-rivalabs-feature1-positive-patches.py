#!/usr/bin/env python3
"""첫 번째 기능의 긍정 의견 블록을 DB 정성분석 결과로 채우는 로컬 POC.

리바랩스 원본이 이미 가진 네 개의 긍정 카테고리와 각 세 개의 인용문 슬롯을 그대로
사용한다. 표, 문단 수, 페이지 구분, charPr/paraPr은 새로 만들지 않는다.
"""
from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}

TITLE_SLOT = 256
CATEGORY_SLOTS = (257, 262, 267, 272)
QUOTE_SLOTS = ((258, 259, 260), (263, 264, 265), (268, 269, 270), (273, 274, 275))
DISPLAY_LABELS = {
    "보상 시스템을 통한 흥미 유발": "보상 시스템 흥미 유발",
    "펫과 함께하는 산책 경험의 정서적 만족": "펫 동반 산책의 정서적 만족",
}


def paragraph_text(paragraph: etree._Element) -> str:
    return "".join(paragraph.xpath(".//hp:t//text()", namespaces=NS)).strip()


def normalized_length(text: str) -> int:
    return len("".join(text.split()))


def quoted(text: str) -> str:
    return f'“{text.strip().strip(chr(34)).strip("“”")}”'


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--db-export", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    report = json.loads(args.db_export.read_text(encoding="utf-8"))
    question = next(
        (item for item in report["questions"] if item["question_key"] == "feature:펫과의 산책"),
        None,
    )
    if question is None:
        raise SystemExit("DB 내 '펫과의 산책' 기능 분석을 찾지 못했습니다.")
    categories_by_label = {
        item["label"]: item
        for item in question.get("categories", [])
        if item.get("polarity") == "positive"
    }
    # 원본의 각 묶음이 가진 문장 예산에 맞춰, DB 카테고리 순서를 배치한다.
    # 이 순서는 의미가 바뀌는 것이 아니라 같은 긍정 의견 내부의 표시 순서다.
    display_order = (
        "산책 동기부여 및 운동 효과",
        "보상 시스템을 통한 흥미 유발",
        "펫과 함께하는 산책 경험의 정서적 만족",
        "경로·기록 표시 기능 만족",
    )
    categories = [categories_by_label[label] for label in display_order if label in categories_by_label]
    if len(categories) != 4:
        raise SystemExit(f"원본의 긍정 의견 슬롯은 4개입니다. 현재 DB 카테고리: {len(categories)}")

    with zipfile.ZipFile(args.source) as archive:
        root = etree.fromstring(archive.read("Contents/section1.xml"))
    paragraphs = root.xpath(".//hp:p", namespaces=NS)
    patches: list[dict] = []

    positives = sum(int(item.get("clauseCount", 0)) for item in categories)
    all_clauses = sum(int(item.get("clauseCount", 0)) for item in question.get("categories", []))
    title = f"1. 긍정 의견 ({(positives / all_clauses * 100) if all_clauses else 0:.1f}%)"

    def add(slot: int, text: str, source: str, multiplier: float = 1.35) -> None:
        old = paragraph_text(paragraphs[slot])
        if not old:
            raise SystemExit(f"P{slot}가 비어 있어 안전한 앵커가 아닙니다.")
        # 새 문장이 원본 슬롯보다 너무 길어져 레이아웃이 달라지는 것을 미리 차단한다.
        if normalized_length(text) > normalized_length(old) * multiplier:
            raise SystemExit(
                f"P{slot} 글자 예산 초과: 새 {normalized_length(text)} / 원본 {normalized_length(old)}. "
                "문서를 깨뜨리지 않도록 이 POC에서는 자동 축약하지 않습니다."
            )
        patches.append({
            "sectionIndex": 1,
            "paragraphIndex": slot,
            "expectedText": old,
            "text": text,
            "source": source,
        })

    add(TITLE_SLOT, title, "qualitative-db-positive-title")
    for category, category_slot, quote_slots in zip(categories, CATEGORY_SLOTS, QUOTE_SLOTS):
        # 소제목은 한 줄 고정 영역이어서 길이 여유를 조금만 더 허용한다.
        display_label = DISPLAY_LABELS.get(category["label"], category["label"])
        add(category_slot, f"[{display_label}]", "qualitative-db-category", 1.5)
        quotes = [quoted(quote) for quote in category.get("quotes") or []]
        if len(quotes) > len(quote_slots):
            raise SystemExit(f"{category['label']}: 인용문 슬롯 부족")
        # 인용문은 원문 표시 순서를 지킨다. 다음 단계의 반복 블록에서는 빈 셋째 줄 자체를
        # 숨길 수 있지만, 이 고정 원본 POC에서는 구조 보존을 위해 안내문으로 남긴다.
        for index, quote_slot in enumerate(quote_slots):
            text = quotes[index] if index < len(quotes) else "※ 대표 인용문 2건 선정"
            old = paragraph_text(paragraphs[quote_slot])
            if normalized_length(text) > normalized_length(old) * 1.5:
                text = "※ 대표 인용문 2건 선정"
            add(
                quote_slot,
                text,
                "qualitative-db-quote" if index < len(quotes) and text == quotes[index] else "qualitative-db-quote-note",
                1.5,
            )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(patches, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"patches": len(patches), "output": str(args.output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
