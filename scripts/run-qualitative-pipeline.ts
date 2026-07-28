// 리바랩스 골든 테스트셋으로 14문항 정성 파이프라인을 실제로 돌려
// 처리시간·원문 인용·clause_count 정합성을 검증한다.
// 기본 고속 모드는 문항당 1회 호출이며, 상세 감사 모드만 Stage1/Stage2 두 단계를 사용한다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateWallaHeaderRow } from "../lib/walla/schema";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { buildQuestionSpecs } from "../lib/pipeline/questions";
import { runQualitativePipeline } from "../lib/pipeline/orchestrate";
import { isVerbatimClause } from "../lib/pipeline/stage1";

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
const sourceReasonsByQuestion = new Map(
  specs.map((spec) => [spec.id, spec.inputs.map((input) => input.reason)]),
);
console.log(`문항 ${specs.length}개, 응답자 ${records.length}명. 파이프라인 시작...`);

// 장시간 실행 중 터미널 연결이 끊겨도 최종 검증 결과를 회수할 수 있도록
// 실행 상태와 결과를 tmp에 남긴다. 원본 응답 전문·API 키는 기록하지 않는다.
const outputDir = resolve(process.cwd(), "tmp");
const resultPath = resolve(outputDir, "qualitative-full-run-latest.json");
mkdirSync(outputDir, { recursive: true });

function writeRunArtifact(payload: Record<string, unknown>) {
  writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const startedAt = new Date().toISOString();
  const completedQuestions: Array<{ id: string; label: string; status: "complete" | "failed" }> = [];
  writeRunArtifact({
    event: "qualitative_full_run_started",
    status: "running",
    startedAt,
    questionCount: specs.length,
    respondentCount: records.length,
  });

  const result = await runQualitativePipeline(specs, {
    onQuestionComplete: (question) => {
      completedQuestions.push({
        id: question.id,
        label: question.label,
        status: "failed" in question && question.failed ? "failed" : "complete",
      });
      writeRunArtifact({
        event: "qualitative_full_run_progress",
        status: "running",
        startedAt,
        questionCount: specs.length,
        respondentCount: records.length,
        completedQuestionCount: completedQuestions.length,
        completedQuestions,
      });
    },
  });

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

    const lowConfidence = q.clauses.filter((c) => c.confidence === "low").length;
    const sourceReasons = sourceReasonsByQuestion.get(q.id) ?? [];

    for (const polarity of ["positive", "negative", "neutral"] as const) {
      const stage2 = q.stage2ByPolarity[polarity];
      if (!stage2) continue;
      const catSum = stage2.categories.reduce((a, c) => a + c.clause_count, 0);
      const countOk = catSum === stage2.total_clause_count;
      if (!countOk) clauseCountMismatch += 1;

      const quotesOk = stage2.categories.every((c) =>
        c.quotes.every((quote) => sourceReasons.some((reason) => isVerbatimClause(reason, quote))),
      );
      if (!quotesOk) verbatimFail += 1;

      console.log(
        `- [${q.id}/${polarity}] 카테고리 ${stage2.categories.length}개, clause_count 합계: ${countOk ? "PASS" : `FAIL(${catSum}≠${stage2.total_clause_count})`}, quotes verbatim: ${quotesOk ? "PASS" : "FAIL"}`,
      );
    }
    console.log(`  ${q.clauses.length > 0 ? `절 ${q.clauses.length}건, 검수필요(low confidence) ${lowConfidence}건` : "고속 보고서 모드(개별 절 미저장)"}`);
  }

  console.log(
    `\n=== 요약: verbatim FAIL ${verbatimFail}건, clause_count 불일치 ${clauseCountMismatch}건 ===`,
  );
  writeRunArtifact({
    event: "qualitative_full_run_complete",
    status: verbatimFail > 0 || clauseCountMismatch > 0 ? "failed_validation" : "complete",
    startedAt,
    completedAt: new Date().toISOString(),
    questionCount: specs.length,
    respondentCount: records.length,
    completedQuestions,
    elapsedMs: result.elapsedMs,
    verbatimFail,
    clauseCountMismatch,
    result,
  });
  if (verbatimFail > 0 || clauseCountMismatch > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  writeRunArtifact({
    event: "qualitative_full_run_failed",
    status: "failed",
    completedAt: new Date().toISOString(),
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
  });
  process.exitCode = 1;
});
