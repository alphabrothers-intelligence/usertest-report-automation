#!/usr/bin/env python3
"""원본 HWPX의 확정 BinData 그래프 자산만 DB 생성 PNG로 교체한다.

문단·표·그림 위치 XML은 수정하지 않는다. manifest에 명시된 image14~31만 교체하고,
그 외 모든 ZIP 엔트리는 HWPX 스킬의 raw-ZIP 보존 writer로 그대로 복제한다.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path


def load_editor(skill_dir: Path):
    script = skill_dir / "scripts" / "edit_hwpx.py"
    sys.path.insert(0, str(script.parent))
    spec = importlib.util.spec_from_file_location("hwpx_chart_asset_editor", script)
    if spec is None or spec.loader is None:
        raise SystemExit("HWPX raw-ZIP 편집기를 불러오지 못했습니다.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--skill-dir", type=Path, required=True)
    args = parser.parse_args()
    manifest_path = args.assets / "manifest.json"
    if not args.source.is_file() or not manifest_path.is_file():
        raise SystemExit("원본 HWPX 또는 그래프 manifest를 찾을 수 없습니다.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    replacements: dict[str, bytes] = {}
    for asset in manifest.get("assets", []):
        filename = asset.get("filename")
        binary_id = asset.get("binaryItemID")
        if not isinstance(filename, str) or not isinstance(binary_id, str):
            raise SystemExit("그래프 manifest 형식이 올바르지 않습니다.")
        if binary_id != Path(filename).stem or not binary_id.startswith("image"):
            raise SystemExit(f"허용되지 않은 그래프 자산: {binary_id}/{filename}")
        image_number = int(binary_id.removeprefix("image"))
        if image_number < 14 or image_number > 31:
            raise SystemExit(f"원본 그래프 슬롯 밖의 자산은 교체할 수 없습니다: {binary_id}")
        asset_path = args.assets / filename
        if not asset_path.is_file() or asset_path.stat().st_size < 100:
            raise SystemExit(f"그래프 PNG가 없거나 비어 있습니다: {asset_path}")
        replacements[f"BinData/{filename}"] = asset_path.read_bytes()
    if len(replacements) != 18:
        raise SystemExit(f"기능별 그래프 18개가 필요합니다. 현재 {len(replacements)}개입니다.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    load_editor(args.skill_dir).write_raw_preserving_zip(args.source, args.output, replacements)
    print(json.dumps({"output": str(args.output), "replacedAssets": sorted(replacements)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
