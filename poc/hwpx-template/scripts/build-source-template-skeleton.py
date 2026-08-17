#!/usr/bin/env python3
"""실제 리바랩스/케어클 원본을 훼손하지 않고 슬롯 표식 공양식 초안을 만든다.

이 단계는 원본의 section, 표, 글꼴, 이미지 프레임을 복제한다. 문단 전체를 삭제하지
않고, 직접 편집 가능한 분석 데이터 문단만 표식으로 바꾸며 그래프/워드클라우드 이진
이미지는 같은 크기의 빈 캔버스로 교체한다. 서비스·DB·분석 파이프라인을 호출하지 않는다.
"""
from __future__ import annotations

import argparse
import importlib.util
import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

from lxml import etree
from PIL import Image

NS = {"hp": "http://www.hancom.co.kr/hwpml/2011/paragraph"}


FAMILY_DYNAMIC_SECTIONS = {
    "sw": ("featureBlocks", "featureExperience", "purchaseFactor", "fourValues", "uxQuality", "crossAnalysis", "nps", "recommendations"),
    "physical": ("featureBlocks", "featureSummary", "journeyQuestions", "journeyAnalysis", "purchaseFactor", "fourValues", "nps", "recommendations"),
}
IDENTITY_MARKERS = {
    "companyName": "〈기업명 입력〉",
    "companyProfile": "〈기업 소개 입력〉",
    "serviceOrProductName": "〈서비스·제품명 입력〉",
}
STRUCTURAL_TEXT = {
    "만족도 분포도", "주요 키워드 도출", "주관식 응답 감정 분석", "응답 요약",
    "핵심구매요소", "4대 가치 만족도", "종합 만족도 및 NPS 지수", "주요 의견 종합",
    "기능별 만족도 결과 분석", "고객 여정 기반 경험 평가", "고객 여정 만족도 평가",
    "긍정", "부정", "중립", "No", "순위", "비율", "핵심 기능", "핵심 구매 요소",
}
STRICT_STATIC_TEXT = {
    # 공양식에서도 문서의 길잡이가 되는 장·표 제목과 열 이름은 남긴다.
    "1", "2", "3", "Ⅸ", "종합 결과 및 제언",
    "사용성테스트 결과 요약", "사용성 테스트 결과 요약",
    "개선 아이디어", "개선 전략 제언", "기능별 고객 제언 종합",
    "1사용성테스트 결과 요약", "1. 사용성테스트 결과 요약", "1. 사용성 테스트 결과 요약",
    "2개선 아이디어", "2. 개선 아이디어",
    "2개선 전략 제언", "2. 개선 전략 제언",
    "3기능별 고객 제언 종합", "3. 기능별 고객 제언 종합",
    "항목", "주요 의견", "기능별 고객 경험 평가", "기능별고객 경험 평가",
    "기능명", "평균 만족도(점)", "상대 중요도", "긍정 비율(%)", "중립 비율(%)", "부정 의견(%)",
    "전반적 방향성", "개발 우선순위 제언", "기능 개선 제안",
}
STRICT_STATIC_PATTERNS = (
    "사용성 테스트", "결과보고서", "개요", "제품 소개", "기능별 고객 경험 평가",
    "핵심구매요소", "4대 가치 만족도", "종합 만족도 및 NPS 지수", "종합 결과 및 제언",
    "만족도 분포도", "주요 키워드 도출", "응답 요약",
    "주관식 응답 감정 분석", "순위", "비율", "평균", "표준편차", "No",
)


def load_editor(skill_dir: Path):
    script = skill_dir / "scripts" / "edit_hwpx.py"
    sys.path.insert(0, str(script.parent))
    spec = importlib.util.spec_from_file_location("hwpx_template_editor", script)
    if spec is None or spec.loader is None:
        raise SystemExit("HWPX 편집기를 불러오지 못했습니다.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def ranges_from_value(value: object) -> list[tuple[str, int, int]]:
    values = value if isinstance(value, list) else [value]
    ranges: list[tuple[str, int, int]] = []
    for item in values:
        if not isinstance(item, str) or ":P" not in item:
            continue
        section, suffix = item.rsplit(":P", 1)
        suffix = suffix.replace(" onward", "")
        if "-P" in suffix:
            first, last = suffix.split("-P", 1)
        else:
            first = last = suffix
        if first.isdigit() and last.isdigit():
            ranges.append((section, int(first), int(last)))
    return ranges


def in_ranges(section: str, index: int, ranges: list[tuple[str, int, int]]) -> bool:
    return any(range_section == section and start <= index <= end for range_section, start, end in ranges)


def marker_for(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("Q"):
        return "Q. 〈문항 입력〉"
    if any(token in cleaned for token in ("\"", "“", "”", "➜", "→", "▶", "[")):
        return "- 〈인용문·분석 입력〉"
    if any(char.isdigit() for char in cleaned):
        return "- 〈수치·표 입력〉"
    return "- 〈분석 결과 입력〉"


def should_keep(text: str) -> bool:
    cleaned = text.strip()
    return not cleaned or cleaned in STRUCTURAL_TEXT or cleaned in {str(number) for number in range(0, 11)}


def should_keep_in_strict_template(text: str) -> bool:
    """원본의 사례 데이터가 아닌 최소한의 양식 레이블만 유지한다."""
    cleaned = " ".join(text.split())
    if not cleaned:
        return True
    if cleaned in STRICT_STATIC_TEXT:
        return True
    for label in ("[긍정 의견 요약]", "[부정 의견 요약]", "[중립 의견 요약]"):
        if cleaned.startswith(label):
            return cleaned == label
    # 수치가 섞인 문장은 결과값·일정·목차 쪽의 사례 정보다. 양식 제목에 '평균' 같은
    # 단어가 포함됐다는 이유만으로 원본 점수가 남으면 안 된다.
    if any(char.isdigit() for char in cleaned):
        return False
    if cleaned in STRUCTURAL_TEXT:
        return True
    if any(pattern in cleaned for pattern in STRICT_STATIC_PATTERNS):
        # 회사/제품명·수치·질문이 섞인 복합 문장은 사례 데이터이므로 보존하지 않는다.
        return not any(marker in cleaned for marker in ("리바랩스", "케어클", "캣독런", "테크핏", "Q", "2024", "2025"))
    return False


def strict_blank_value(text: str) -> str:
    """값은 지우되, 한 문단에 합쳐진 극성 요약 제목은 양식 레이블로 보존한다."""
    for label in ("[긍정 의견 요약]", "[부정 의견 요약]", "[중립 의견 요약]"):
        if text.strip().startswith(label):
            return label
    return ""


def image_placeholder(original: bytes, filename: str) -> bytes:
    with Image.open(io.BytesIO(original)) as source:
        mode = "RGBA" if "A" in source.getbands() else "RGB"
        canvas = Image.new(mode, source.size, (255, 255, 255, 0) if mode == "RGBA" else (255, 255, 255))
        output = io.BytesIO()
        image_format = "BMP" if filename.lower().endswith(".bmp") else "PNG"
        canvas.save(output, format=image_format)
        return output.getvalue()


def images_used_in_dynamic_ranges(source: Path, ranges: list[tuple[str, int, int]]) -> set[str]:
    """분석 범위의 그림을 모두 찾는다.

    기능별 그래프뿐 아니라 극성 요약·종합 분석 도표도 동일한 이전 보고서 데이터이므로
    공양식에서는 남기지 않는다. 표지/제품 사진처럼 범위 밖의 정적 이미지는 보존한다.
    """
    items: set[str] = set()
    with zipfile.ZipFile(source) as archive:
        for section, start, end in ranges:
            if section not in archive.namelist():
                continue
            root = etree.fromstring(archive.read(section))
            paragraphs = root.xpath(".//hp:p", namespaces=NS)
            for paragraph in paragraphs[start:end + 1]:
                for element in paragraph.xpath(".//*[@binaryItemIDRef]", namespaces=NS):
                    ref = element.get("binaryItemIDRef")
                    if ref:
                        items.add(ref)
    return items


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--slots", type=Path, required=True)
    parser.add_argument("--bindings", type=Path, required=True)
    parser.add_argument("--family", choices=("sw", "physical"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest-output", type=Path, required=True)
    parser.add_argument("--skill-dir", type=Path, required=True)
    parser.add_argument("--strict-blank", action="store_true", help="개요·설문·결과의 사례 데이터도 지워 완전 공양식으로 만든다.")
    args = parser.parse_args()

    slots = json.loads(args.slots.read_text(encoding="utf-8"))
    bindings = json.loads(args.bindings.read_text(encoding="utf-8"))["families"][args.family]
    section_slots = slots["sections"]
    patches: list[dict] = []

    # 표지와 개요의 핵심 신원 정보만 별도 표식 처리한다.
    for field, anchor in bindings["identity"].items():
        section, paragraph = anchor.split(":P")
        slot = next((item for item in section_slots[section]["paragraphSlots"] if item["paragraphIndex"] == int(paragraph)), None)
        if not slot or slot["nestedParagraphCount"]:
            raise SystemExit(f"안전한 신원 슬롯이 아닙니다: {anchor}")
        patches.append({"sectionIndex": int(section.removeprefix("Contents/section").removesuffix(".xml")), "paragraphIndex": int(paragraph), "expectedText": slot["text"], "text": "" if args.strict_blank else IDENTITY_MARKERS[field], "source": "template-identity-marker"})

    # 분석 범위의 leaf paragraph만 표식 처리한다. strict 모드에서는 개요·설문을 포함한
    # 전체 본문의 사례 데이터도 지운다. 표/섹션의 구조 제목과 축 레이블은 남긴다.
    dynamic_ranges = []
    for key in FAMILY_DYNAMIC_SECTIONS[args.family]:
        dynamic_ranges.extend(ranges_from_value(bindings.get("featurePrototype", {}).get(key)))
        dynamic_ranges.extend(ranges_from_value(bindings.get("sections", {}).get(key)))
    for section_name, section in section_slots.items():
        for slot in section["paragraphSlots"]:
            index = slot["paragraphIndex"]
            eligible = args.strict_blank or in_ranges(section_name, index, dynamic_ranges)
            keep = should_keep_in_strict_template(slot["text"]) if args.strict_blank else should_keep(slot["text"])
            if not eligible or slot["nestedParagraphCount"] or keep:
                continue
            section_index = int(section_name.removeprefix("Contents/section").removesuffix(".xml"))
            # 완전 공양식은 좁은 셀에도 같은 안내 문구를 억지로 넣지 않는다. 텍스트가
            # 세로로 밀려 표·제목이 깨지는 문제를 막기 위해 값 영역은 빈 문단으로만 둔다.
            replacement = strict_blank_value(slot["text"]) if args.strict_blank else marker_for(slot["text"])
            patches.append({"sectionIndex": section_index, "paragraphIndex": index, "expectedText": slot["text"], "text": replacement, "source": "template-dynamic-marker"})

    # 그래프와 워드클라우드는 원본 수치가 남지 않도록 같은 크기의 빈 이미지로 교체한다.
    declared_graphs = {item for frame in bindings["featurePrototype"].get("graphFrames", []) for item in frame["binaryItems"]}
    if args.strict_blank:
        with zipfile.ZipFile(args.source) as archive:
            binary_items = {Path(name).stem for name in archive.namelist() if name.startswith("BinData/image")}
            # 표지의 제작사 로고는 양식 고정 요소로 남긴다. 그 외 사진·그래프는 빈 프레임으로 둔다.
            binary_items.discard("image1")
    else:
        binary_items = declared_graphs | images_used_in_dynamic_ranges(args.source, dynamic_ranges)
    editor = load_editor(args.skill_dir)
    with tempfile.TemporaryDirectory(prefix="hwpx-skeleton-") as temp_dir:
        text_filled = Path(temp_dir) / "text-marked.hwpx"
        grouped: dict[int, list] = {}
        for patch in patches:
            grouped.setdefault(patch["sectionIndex"], []).append(patch)
        current = args.source
        for order, section_index in enumerate(sorted(grouped)):
            next_file = text_filled if order == len(grouped) - 1 else Path(temp_dir) / f"section-{section_index}.hwpx"
            editor.SECTION_PATH = f"Contents/section{section_index}.xml"
            targets = [editor.ParagraphTarget(index=item["paragraphIndex"], text=item["text"]) for item in grouped[section_index]]
            editor._pack_from_original(current, next_file, {}, [], targets)
            current = next_file
        with zipfile.ZipFile(current) as archive:
            replacements = {}
            for item in binary_items:
                entry = next((name for name in archive.namelist() if Path(name).stem == item and name.startswith("BinData/")), None)
                if not entry:
                    raise SystemExit(f"그래프 이진 항목을 찾을 수 없습니다: {item}")
                replacements[entry] = image_placeholder(archive.read(entry), entry)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        editor.write_raw_preserving_zip(current, args.output, replacements)

    manifest = {
        "source": str(args.source), "output": str(args.output), "family": args.family,
        "kind": "strict blank template draft" if args.strict_blank else "slot-marked template draft", "textMarkers": len(patches),
        "blankedGraphAssets": sorted(binary_items),
        "blankingRule": "모든 동적 분석 범위에서 참조된 그래프·도표·워드클라우드 이미지를 비운다. 표지/제품 사진 등 범위 밖 정적 이미지는 보존한다.",
        "preserved": ["HWPX package", "section/page settings", "tables", "style IDs", "picture frames", "static headings"],
        "removedImageScope": "모든 원본 데이터 이미지(그래프·워드클라우드·제품 사진 포함), 제작사 로고 image1 제외" if args.strict_blank else "동적 분석 범위의 그래프·도표·워드클라우드만",
        "notFinal": "사용자용 공양식 확정 전 Hancom 렌더링·페이지 흐름·각 표식의 편집 슬롯 검수가 필요합니다."
    }
    args.manifest_output.parent.mkdir(parents=True, exist_ok=True)
    args.manifest_output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
