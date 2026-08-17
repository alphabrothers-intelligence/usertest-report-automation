#!/usr/bin/env python3
"""DB의 기능별 고객 제언을 리바랩스 원본의 '기능별 고객 제언 종합' 슬롯에 배치한다.

원본 표의 각 기능은 고정 개수의 고객 제언 행을 가진다. 이 스크립트는 행에 들어가는
텍스트를 DB 값으로 바꾸고, 남는 제언은 절대 버리지 않고 overflow manifest에 기록한다.
다음 단계의 반복 블록 확장기는 이 manifest를 받아 같은 원본 표 블록을 추가 복제한다.
"""
from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}

# feature name, title slot, ((label slot, content slot), ...). 순서는 원본 HWPX의 표 구조다.
SLOTS = [
    ("펫과의 산책", 1793, ((1795, 1796), (1797, 1798), (1799, 1800), (1801, 1802))),
    ("펫 성장 시스템", 1804, ((1806, 1807), (1808, 1809), (1810, 1811), (1812, 1813))),
    ("실시간 위치 기반 거점형 콘텐츠", 1815, ((1817, 1818), (1819, 1820), (1821, 1822), (1823, 1824))),
    ("펫 꾸미기", 1825, ((1827, 1828), (1829, 1830), (1831, 1832))),
    ("펫 레이싱", 1833, ((1835, 1836), (1837, 1838), (1839, 1840), (1841, 1842))),
    # 원본의 기능 6 제목은 기능 5 표의 복합 컨테이너에 들어 있어 직접 수정하면 안 된다.
    ("펫 교배", None, ((1844, 1845), (1846, 1847), (1848, 1849))),
]


def text_of(paragraph):
    return "".join(paragraph.xpath(".//hp:t//text()", namespaces=NS)).strip()


def find_actions(report):
    record = next((item for item in report.get("recommendations", []) if item.get("section") == "feature_customer_recommendations"), None)
    if not record:
        raise SystemExit("feature_customer_recommendations DB 결과가 없습니다.")
    try:
        parsed = json.loads(record["text"])
    except (KeyError, json.JSONDecodeError) as exc:
        raise SystemExit(f"기능별 고객 제언 JSON을 읽지 못했습니다: {exc}")
    result = {}
    for feature in parsed.get("features", []):
        name = feature.get("featureName")
        actions = [str(action).strip() for action in feature.get("actions", []) if str(action).strip()]
        if name:
            result[name] = actions
    return result


def patch(section, paragraphs, index, text, source):
    old = text_of(paragraphs[index])
    if not old:
        raise SystemExit(f"P{index} 원본 문단이 비어 있습니다.")
    return {
        "sectionIndex": section,
        "paragraphIndex": index,
        "expectedText": old,
        "text": text,
        "source": source,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--db-export", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--overflow-output", type=Path, required=True)
    args = parser.parse_args()

    report = json.loads(args.db_export.read_text(encoding="utf-8"))
    actions_by_feature = find_actions(report)
    with zipfile.ZipFile(args.source) as archive:
        root = etree.fromstring(archive.read("Contents/section1.xml"))
    paragraphs = root.xpath(".//hp:p", namespaces=NS)

    patches = []
    overflow = []
    for feature, title_slot, action_slots in SLOTS:
        actions = actions_by_feature.get(feature, [])
        if title_slot is not None:
            patches.append(patch(1, paragraphs, title_slot, f"[기능] {feature}", "stored-db-feature-name"))
        for number, (label_slot, content_slot) in enumerate(action_slots, start=1):
            if number > len(actions):
                # 원본의 남는 행은 원본 그대로 둔다. 빈 텍스트/임의 문구로 덮지 않는다.
                continue
            patches.append(patch(1, paragraphs, label_slot, f"고객 제언 {number}", "stored-db-recommendation-label"))
            patches.append(patch(1, paragraphs, content_slot, actions[number - 1], "stored-db-recommendation-action"))
        if len(actions) > len(action_slots):
            overflow.append({
                "feature": feature,
                "unplacedActions": actions[len(action_slots):],
                "requiredAction": "원본 기능별 고객 제언 표 블록을 복제해 추가 행으로 배치",
            })

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(patches, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.overflow_output.parent.mkdir(parents=True, exist_ok=True)
    args.overflow_output.write_text(json.dumps({
        "totalFeatures": len(SLOTS),
        "overflowFeatureCount": len(overflow),
        "overflow": overflow,
        "integrity": "초과 제언을 요약하거나 삭제하지 않았습니다.",
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"patches": len(patches), "overflowFeatures": len(overflow), "output": str(args.output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
