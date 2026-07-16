// 리바랩스 골든 테스트셋으로 14문항 Stage1/Stage2 병렬 파이프라인을 실제로 돌려
// 처리시간(4.2절 병렬 처리 요구사항, PRD 10장 300초 제한)과 verbatim/clause_count 정합성을 검증한다.
// 사용법: npm run check:qualitative  (ANTHROPIC_API_KEY 필요, 실제 과금 발생 — 약 32회 API 호출)
import { readFileSync } from "node:fs";
import { validateWallaHeaderRow } from "../lib/walla/schema";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { buildQuestionSpecs } from "../lib/pipeline/questions";
import { runQualitativePipeline } from "../lib/pipeline/orchestrate";

const path = new URL(
  "../data/[리바랩스]사용성테스트 raw data.xlsx",
  import.meta.url,
);
const buffer = readFileSync(path);
const arrayBuffer = buffer.buffer.slice(
  buffer.byteOffset,
  buffer.byteOffset + buffer.byteLength,
) as ArrayBuffer;

const parsed = parseWallaWorkbook(arrayBuffer);
const validation = validateWallaHeaderRow(parsed.headerRow);
if (!validation.valid) {
  console.error("validateInput 실패, 정성 파이프라인을 실행할 수 없습니다.", validation.errors);
  process.exit(1);
}

const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
const specs = buildQuestionSpecs(records);
console.log(`문항 ${specs.length}개, 응답자 ${records.length}명. 파이프라인 시작...`);

function normalizeForSubstring(s: string): string {
  return s.replace(/\s+/g, "");
}

async function main() {
  const result = await runQualitativePipeline(specs);

  console.log(`\n=== 처리시간: ${(result.elapsedMs / 1000).toFixed(1)}초 (Vercel 300초 제한 대비) ===`);

  let verbatimFail = 0;
  let clauseCountMismatch = 0;

  for (const q of result.questions) {
    if (q.kind === "improvement") {
      const catSum = q.stage2.categories.reduce((a, c) => a + c.clause_count, 0);
      const countOk = catSum === q.stage2.total_clause_count;
      if (!countOk) clauseCountMismatch += 1;
      console.log(
        `- [${q.id}] 카테고리 ${q.stage2.categories.length}개, clause_count 합계 일치: ${countOk ? "PASS" : `FAIL(${catSum}≠${q.stage2.total_clause_count})`}`,
      );
      continue;
    }

    const allClauseText = normalizeForSubstring(
      q.clauses.map((c) => c.clause).join(" "),
    );
    const lowConfidence = q.clauses.filter((c) => c.confidence === "low").length;

    for (const polarity of ["positive", "negative", "neutral"] as const) {
      const stage2 = q.stage2ByPolarity[polarity];
      if (!stage2) continue;
      const catSum = stage2.categories.reduce((a, c) => a + c.clause_count, 0);
      const countOk = catSum === stage2.total_clause_count;
      if (!countOk) clauseCountMismatch += 1;

      const quotesOk = stage2.categories.every((c) =>
        c.quotes.every((quote) => allClauseText.includes(normalizeForSubstring(quote))),
      );
      if (!quotesOk) verbatimFail += 1;

      console.log(
        `- [${q.id}/${polarity}] 카테고리 ${stage2.categories.length}개, clause_count 합계: ${countOk ? "PASS" : `FAIL(${catSum}≠${stage2.total_clause_count})`}, quotes verbatim: ${quotesOk ? "PASS" : "FAIL"}`,
      );
    }
    console.log(`  clause 총 ${q.clauses.length}건, 검수필요(low confidence) ${lowConfidence}건`);
  }

  console.log(
    `\n=== 요약: verbatim FAIL ${verbatimFail}건, clause_count 불일치 ${clauseCountMismatch}건 ===`,
  );
  if (verbatimFail > 0 || clauseCountMismatch > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
