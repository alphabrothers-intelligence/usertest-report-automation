#!/usr/bin/env python3
"""원본 HWPX에서 편집 가능한 문단·표·이미지 프레임을 읽기 전용으로 추출한다.

웹뷰와 HWPX 컴파일러가 동일한 anchor를 쓰도록 돕는 분석 도구다. 원본 파일을 수정하지
않고, style ID나 HWPX 내부 XML을 다른 문서에 복사하지도 않는다.
"""
from __future__ import annotations

import argparse
import json
import zipfile
from pathlib import Path

from lxml import etree

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}


def text_of(paragraph) -> str:
    return "".join(paragraph.xpath(".//hp:t//text()", namespaces=NS)).strip()


def direct_text_nodes(paragraph):
    return paragraph.xpath("./hp:run/hp:t", namespaces=NS)


def parent_context(paragraph) -> str:
    current = paragraph.getparent()
    names = []
    while current is not None and len(names) < 4:
        names.append(etree.QName(current).localname)
        current = current.getparent()
    return "/".join(names)


def section_slots(root, section_name: str) -> dict:
    paragraphs = root.xpath(".//hp:p", namespaces=NS)
    paragraph_slots = []
    for index, paragraph in enumerate(paragraphs):
        direct_nodes = direct_text_nodes(paragraph)
        if not direct_nodes:
            continue
        paragraph_slots.append({
            "anchor": f"{section_name}:P{index}",
            "paragraphIndex": index,
            "text": text_of(paragraph),
            "directTextNodeCount": len(direct_nodes),
            "charPrIDs": [node.getparent().get("charPrIDRef") for node in direct_nodes],
            "paraPrID": paragraph.get("paraPrIDRef"),
            "styleID": paragraph.get("styleIDRef"),
            "context": parent_context(paragraph),
            "containsTable": bool(paragraph.xpath("./hp:run/hp:tbl", namespaces=NS)),
            "containsPicture": bool(paragraph.xpath(".//hp:pic", namespaces=NS)),
            "nestedParagraphCount": len(paragraph.xpath(".//hp:p", namespaces=NS))
        })
    tables = []
    for table_index, table in enumerate(root.xpath(".//hp:tbl", namespaces=NS)):
        tables.append({
            "anchor": f"{section_name}:T{table_index}",
            "rows": int(table.get("rowCnt", "0")),
            "columns": int(table.get("colCnt", "0")),
            "width": table.find("hp:sz", namespaces=NS).get("width") if table.find("hp:sz", namespaces=NS) is not None else None,
            "parentContext": parent_context(table)
        })
    pictures = []
    for picture_index, picture in enumerate(root.xpath(".//hp:pic", namespaces=NS)):
        image = picture.find(".//hp:img", namespaces=NS)
        pictures.append({
            "anchor": f"{section_name}:I{picture_index}",
            "binaryItemIDRef": image.get("binaryItemIDRef") if image is not None else None,
            "width": picture.find("hp:sz", namespaces=NS).get("width") if picture.find("hp:sz", namespaces=NS) is not None else None,
            "height": picture.find("hp:sz", namespaces=NS).get("height") if picture.find("hp:sz", namespaces=NS) is not None else None
        })
    return {"paragraphSlots": paragraph_slots, "tables": tables, "pictures": pictures}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--template-family", choices=["sw", "physical"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    with zipfile.ZipFile(args.source) as archive:
        sections = {}
        for entry in sorted(name for name in archive.namelist() if name.startswith("Contents/section") and name.endswith(".xml")):
            root = etree.fromstring(archive.read(entry))
            sections[entry] = section_slots(root, entry)
        result = {
            "templateFamily": args.template_family,
            "source": str(args.source),
            "readOnly": True,
            "sections": sections,
            "summary": {
                "paragraphSlots": sum(len(section["paragraphSlots"]) for section in sections.values()),
                "tables": sum(len(section["tables"]) for section in sections.values()),
                "pictures": sum(len(section["pictures"]) for section in sections.values())
            }
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"templateFamily": args.template_family, **result["summary"], "output": str(args.output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
