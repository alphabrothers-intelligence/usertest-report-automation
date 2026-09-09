/**
 * raw data 5종을 데모 경로로 렌더해 **빈 블록(그 데이터에 없는 문항의 껍데기)** 이 남는지 본다.
 * LLM·과금 없음(역할 분류는 파일당 1회만 하고 DB에 캐시된다) — `npm run check:empty-blocks`.
 * 로컬 dev 서버(:3000)와 `data/` 원본이 필요하다.
 *
 * "정성 대기"는 정성 분석을 안 돌린 상태라 정상이므로 세지 않는다.
 */
import type { ReportBlock, ReportSectionContent } from "../lib/report/sections";

const DATASETS = ["rivalabs", "carecl", "ezenauto", "cleanhabit", "twoblock"];
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";

/** 비어 있으면 이유를, 아니면 null. 배너·제목은 원래 내용이 짧으므로 대상에서 뺀다. */
function emptyReason(block: ReportBlock): string | null {
  switch (block.kind) {
    case "chart": return block.items.length === 0 ? "차트 항목 0개" : null;
    case "table": return block.rows.length === 0 ? "표 행 0개" : null;
    case "rank-composition":
    case "stacked-bar": return block.rows.length === 0 ? "행 0개" : null;
    case "grouped-bar": {
      if (block.series.length === 0 || block.categories.length === 0) return "그룹/항목 0개";
      const values = block.categories.flatMap((category) => category.values.map((value) => value.value));
      return values.every((value) => value === 0) ? "값이 전부 0" : null;
    }
    case "radar": {
      if (block.series.length === 0 || block.indicators.length === 0) return "축/시리즈 0개";
      return block.series.every((series) => series.values.every((value) => value === 0)) ? "값이 전부 0" : null;
    }
    default: return null;
  }
}

async function main() {
  let failures = 0;
  for (const dataset of DATASETS) {
    const response = await fetch(`${BASE}/api/report-workspace/demo?dataset=${dataset}`);
    const payload = await response.json() as { ok: boolean; error?: string; workspace?: { sections: ReportSectionContent[] } };
    if (!payload.ok || !payload.workspace) {
      failures += 1;
      console.error(`FAIL ${dataset}: 렌더 실패 — ${payload.error}`);
      continue;
    }
    const sections = payload.workspace.sections;
    const empty = sections.flatMap((section) => section.blocks.flatMap((block) => {
      const reason = emptyReason(block);
      return reason ? [`${section.numeral}장 ${block.id}(${block.kind}): ${reason}`] : [];
    }));
    // 블록이 하나도 없는 장은 제목만 남은 빈 장이다 — 목차에도 나오므로 같이 잡는다.
    for (const section of sections.filter((item) => item.blocks.length === 0)) {
      empty.push(`${section.numeral}장 "${section.title}": 블록 0개(빈 장)`);
    }
    const blocks = sections.reduce((count, section) => count + section.blocks.length, 0);
    if (empty.length === 0) {
      console.log(`PASS ${dataset} — 장 ${sections.length}개 / 블록 ${blocks}개 / 빈 블록 없음`);
      continue;
    }
    failures += 1;
    console.error(`FAIL ${dataset} — 빈 블록 ${empty.length}개`);
    for (const line of empty) console.error(`       ${line}`);
  }
  console.log(failures === 0 ? "\n모든 raw data에서 빈 블록 없음" : `\n${failures}종에 빈 블록이 남아 있습니다.`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
