#!/usr/bin/env python3
"""케어클 원본의 기존 그래프 프레임에 공통 극성 도넛을 넣는 로컬 POC.

Carecl의 section1 XML과 image15.bmp만 교체한다. 새 HWPX 패키지를 만들지 않으며,
기존 이미지 프레임·글꼴·문단 스타일을 그대로 사용한다.
"""
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import math
import struct
import sys
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}


def load_editor(skill_dir: Path):
    path = skill_dir / "scripts" / "edit_hwpx.py"
    sys.path.insert(0, str(path.parent))
    spec = importlib.util.spec_from_file_location("hwpx_editor", path)
    if spec is None or spec.loader is None:
        raise SystemExit("HWPX 편집기를 불러오지 못했습니다.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def donut_bmp(values: list[float], colors: list[tuple[int, int, int]], size: int = 640) -> bytes:
    """외부 그래프 라이브러리 없이 24-bit BMP 도넛을 생성한다."""
    row_bytes = (size * 3 + 3) & ~3
    pixels = bytearray(row_bytes * size)
    center = (size - 1) / 2
    outer, inner = size * 0.45, size * 0.25
    boundaries: list[float] = []
    total, cursor = sum(values), -math.pi / 2
    for value in values:
        cursor += math.tau * value / total
        boundaries.append(cursor)
    for y in range(size):
        for x in range(size):
            dx, dy = x - center, center - y
            radius = math.hypot(dx, dy)
            color = (255, 255, 255)
            if inner <= radius <= outer:
                angle = math.atan2(dy, dx)
                if angle < -math.pi / 2:
                    angle += math.tau
                index = 0
                while index < len(boundaries) - 1 and angle >= boundaries[index]:
                    index += 1
                color = colors[index]
            offset = y * row_bytes + x * 3
            pixels[offset:offset + 3] = bytes((color[2], color[1], color[0]))
    header = struct.pack(
        "<2sIHHI", b"BM", 54 + len(pixels), 0, 0, 54
    ) + struct.pack(
        "<IIIHHIIIIII", 40, size, size, 1, 24, 0, len(pixels), 2835, 2835, 0, 0
    )
    return header + bytes(pixels)


def set_plain(paragraph: etree._Element, text: str) -> None:
    nodes = paragraph.xpath("./hp:run/hp:t", namespaces=NS)
    if not nodes:
        raise SystemExit("공통 모듈 제목 문단을 찾지 못했습니다.")
    for node in paragraph.xpath(".//hp:t", namespaces=NS):
        node.text = ""
        for child in node:
            child.tail = ""
    nodes[0].text = text
    for line_seg in paragraph.xpath(".//hp:linesegarray", namespaces=NS):
        line_seg.getparent().remove(line_seg)


def db_polarity_values(db_export: Path, feature_name: str | None) -> tuple[str, list[float], list[int]]:
    """저장된 DB 절 분류값으로 공통 모듈의 비율을 만든다.

    값은 원문 문장 수가 아니라 현재 정성 분석이 저장한 categories[].clauseCount의
    극성별 합계다. 호출·재분석·DB 변경은 하지 않는다.
    """
    report = json.loads(db_export.read_text(encoding="utf-8"))
    questions = [item for item in report.get("questions", []) if str(item.get("question_key", "")).startswith("feature:")]
    if feature_name:
        question = next((item for item in questions if item["question_key"] == f"feature:{feature_name}"), None)
    else:
        question = questions[0] if questions else None
    if not question:
        raise SystemExit("공통 극성 모듈에 넣을 feature:* DB 정성 결과가 없습니다.")
    counts = []
    for polarity in ("positive", "negative", "neutral"):
        counts.append(sum(int(category.get("clauseCount", 0)) for category in question.get("categories", []) if category.get("polarity") == polarity))
    total = sum(counts)
    if total <= 0:
        raise SystemExit("극성별 clauseCount 합계가 0입니다.")
    return question["question_key"].split(":", 1)[1], [round(count * 100 / total, 1) for count in counts], counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skill-dir", type=Path, required=True)
    parser.add_argument("--db-export", type=Path, help="기존 DB export. 지정하면 원본 표본값 대신 이 값을 사용한다.")
    parser.add_argument("--feature-name", help="DB feature:* 문항명. 생략하면 첫 번째 기능 문항을 사용한다.")
    args = parser.parse_args()
    editor = load_editor(args.skill_dir)
    with zipfile.ZipFile(args.source) as archive:
        source_section = archive.read("Contents/section1.xml")
    tree = etree.parse(io.BytesIO(source_section))
    paragraphs = tree.getroot().xpath(".//hp:p", namespaces=NS)
    feature_label, percentages, counts = ("케어클 원본 표본", [38.0, 22.0, 40.0], [38, 22, 40])
    if args.db_export:
        feature_label, percentages, counts = db_polarity_values(args.db_export, args.feature_name)
    # Carecl 기존 그래프 프레임과 문단 스타일을 재사용한다. DB 입력 시에도 레이아웃만
    # 검증하는 POC이며, SW 결과를 실제품 결과로 표기하지 않는다.
    replacements = {
        322: "주관식 응답 감정 분석",
        323: "긍정·부정·중립 분포",
        326: f"[ 긍정 {percentages[0]:.1f}%({counts[0]}건) · 부정 {percentages[1]:.1f}%({counts[1]}건) · 중립 {percentages[2]:.1f}%({counts[2]}건) ]",
        327: f"[ {feature_label} · 주요 의견 분석 ]",
    }
    for index, text in replacements.items():
        set_plain(paragraphs[index], text)
    section_bytes = editor._serialize_xml_like_source(tree, source_section)
    bitmap = donut_bmp(
        percentages,
        [(92, 115, 170), (255, 185, 185), (240, 240, 240)],
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    editor.write_raw_preserving_zip(
        args.source,
        args.output,
        {"Contents/section1.xml": section_bytes, "BinData/image15.bmp": bitmap},
    )
    print(json.dumps({
        "output": str(args.output),
        "feature": feature_label,
        "percentages": percentages,
        "counts": counts,
        "mode": "DB layout verification" if args.db_export else "Carecl source sample",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
