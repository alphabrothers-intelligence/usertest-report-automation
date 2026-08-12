// 리바랩스 raw data를 실제 파이프라인(lib/quant/compute.ts, lib/pipeline/surveyQuestions.ts)
// 그대로 통과시켜 QuantStats + surveyQuestions를 JSON으로 떨군다. lib/pdf/나 lib/quant/는
// 전혀 수정하지 않는다 -- 순수 재사용(check-golden-sample.ts와 같은 로딩 패턴).
//
// hwpx 공양식(output/report-templates/02_SW_...)에 실제 데이터를 채우는 새 실험 파이프라인의
// 입력으로 쓴다. 사용법: npx tsx scripts/_dump-rivalabs-quant-stats.ts > /tmp/rivalabs-stats.json
import { readFileSync, writeFileSync } from "node:fs";
import { validateWallaHeaderRow } from "../lib/walla/schema";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { computeQuantStats } from "../lib/quant/compute";

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
const stats = computeQuantStats(records, parsed.headerRow);

const outPath = process.argv[2] ?? "/tmp/rivalabs-stats.json";
writeFileSync(outPath, JSON.stringify(stats, null, 2), "utf-8");
console.log(`WROTE: ${outPath}`);
console.log(`respondentCount: ${stats.respondentCount}`);
console.log(`featureSatisfaction: ${stats.featureSatisfaction.length}`);
console.log(`surveyQuestions: ${stats.surveyQuestions.length}`);
