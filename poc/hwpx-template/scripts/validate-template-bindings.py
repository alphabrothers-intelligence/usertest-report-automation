#!/usr/bin/env python3
"""실제 원본 HWPX에 대한 템플릿 바인딩의 존재 여부를 읽기 전용으로 검증한다.

이 도구는 POC 공양식이 아닌 --source로 명시한 원본 HWPX만 검사한다. 실제 문단을
변경하지 않으며, 동적 범위를 비우거나 복제하기 전에 앵커가 유효한지 확인하는 관문이다.
"""
from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}
ANCHOR = re.compile(
    r"(?P<section>Contents/section\d+\.xml):P(?P<start>\d+)(?:-P?(?P<end>\d+)| onward)?"
)


def paragraph_text(paragraph: etree._Element) -> str:
    return "".join(paragraph.xpath(".//hp:t//text()", namespaces=NS)).strip()


def walk(value, path=""):
    if isinstance(value, dict):
        for key, child in value.items():
            yield from walk(child, f"{path}.{key}" if path else key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk(child, f"{path}[{index}]")
    elif isinstance(value, str):
        match = ANCHOR.search(value)
        if match:
            yield path, value, match


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--bindings", type=Path, required=True)
    parser.add_argument("--family", choices=("sw", "physical"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    bindings = json.loads(args.bindings.read_text(encoding="utf-8"))
    family = bindings["families"][args.family]
    with zipfile.ZipFile(args.source) as archive:
        section_paragraphs = {
            name: etree.fromstring(archive.read(name)).xpath(".//hp:p", namespaces=NS)
            for name in archive.namelist()
            if name.startswith("Contents/section") and name.endswith(".xml")
        }

    checks = []
    for path, declared, match in walk(family):
        section = match["section"]
        start = int(match["start"])
        end = int(match["end"] or start)
        paragraphs = section_paragraphs.get(section)
        if paragraphs is None:
            checks.append({"path": path, "declared": declared, "status": "missing-section"})
            continue
        if start >= len(paragraphs) or end >= len(paragraphs):
            checks.append({
                "path": path, "declared": declared, "status": "out-of-range",
                "paragraphCount": len(paragraphs), "requested": [start, end],
            })
            continue
        samples = []
        for index in sorted({start, end}):
            samples.append({"paragraphIndex": index, "text": paragraph_text(paragraphs[index])[:180]})
        checks.append({
            "path": path, "declared": declared, "status": "valid",
            "section": section, "paragraphRange": [start, end], "samples": samples,
        })

    invalid = [check for check in checks if check["status"] != "valid"]
    result = {
        "readOnly": True,
        "source": str(args.source),
        "family": args.family,
        "summary": {"checked": len(checks), "valid": len(checks) - len(invalid), "invalid": len(invalid)},
        "checks": checks,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result["summary"], ensure_ascii=False))
    return 1 if invalid else 0


if __name__ == "__main__":
    raise SystemExit(main())
