// flagQuantStatsForReview()가 실제 골든 raw data에서 어떤 플래그를 내는지 눈으로 확인하는
// 스크립트(LLM 재호출 없음). npm run check:review-flags로 실행.
import { readFileSync } from "node:fs";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { validateWallaHeaderRow } from "../lib/walla/schema";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { computeQuantStats } from "../lib/quant/compute";
import { flagQuantStatsForReview } from "../lib/quant/reviewFlags";

const path = new URL("../data/[리바랩스]사용성테스트 raw data.xlsx", import.meta.url);
const buffer = readFileSync(path);
const arrayBuffer = buffer.buffer.slice(
  buffer.byteOffset,
  buffer.byteOffset + buffer.byteLength,
) as ArrayBuffer;

const parsed = parseWallaWorkbook(arrayBuffer);
const validation = validateWallaHeaderRow(parsed.headerRow);
if (!validation.valid) throw new Error("골든 raw data 검증 실패 — check:golden 먼저 확인할 것");

const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
const stats = computeQuantStats(records, parsed.headerRow);
const flags = flagQuantStatsForReview(stats);

console.log(`총 ${flags.length}개 플래그`);
for (const f of flags) {
  console.log(`[${f.severity}] ${f.location} — ${f.message}`);
}
