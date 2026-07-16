// PRD 9.2절: "카테고리 커버리지 — 실제 보고서에 등장한 [카테고리명]과 생성 결과 카테고리의
// 주제 일치율"을 확인하기 위해, 6개 기능 문항만 실제 파이프라인으로 돌려 카테고리 목록을 뽑는다
// (14문항 전체보다 저렴). 정확 문자열 일치가 아니라 주제 매칭이 필요한 지표라 이 스크립트는
// 자동으로 %를 계산하지 않고 결과만 출력한다 — 실제 보고서 카테고리 목록과의 대조·판정은
// 이 출력을 보고 사람(또는 분석 에이전트)이 수행한다.
// 사용법: npm run check:category-coverage (ANTHROPIC_API_KEY 필요, 약 20회 호출)
import { readFileSync } from "node:fs";
import { validateWallaHeaderRow } from "../lib/walla/schema";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { buildQuestionSpecs } from "../lib/pipeline/questions";
import { runQualitativePipeline } from "../lib/pipeline/orchestrate";

async function main() {
  const path = new URL("../data/[리바랩스]사용성테스트 raw data.xlsx", import.meta.url);
  const buffer = readFileSync(path);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
  const parsed = parseWallaWorkbook(arrayBuffer);
  const validation = validateWallaHeaderRow(parsed.headerRow);
  if (!validation.valid) {
    console.error("validateInput 실패:", validation.errors);
    process.exit(1);
  }

  const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
  const allSpecs = buildQuestionSpecs(records);
  const featureSpecs = allSpecs.filter((s) => s.id.startsWith("feature:"));
  console.log(`기능 문항 ${featureSpecs.length}개만 실행합니다:`, featureSpecs.map((s) => s.label));

  const result = await runQualitativePipeline(featureSpecs);
  console.log(`\n처리시간: ${(result.elapsedMs / 1000).toFixed(1)}초\n`);

  for (const q of result.questions) {
    if (q.kind !== "standard") continue;
    console.log(`\n=== ${q.label} ===`);
    for (const polarity of ["positive", "negative", "neutral"] as const) {
      const stage2 = q.stage2ByPolarity[polarity];
      if (!stage2) continue;
      console.log(`\n[${polarity}] (${stage2.categories.length}개 카테고리)`);
      for (const c of stage2.categories) {
        console.log(`  - ${c.label} (${c.clause_count}건) → ${c.insight}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
