// Stage2(카테고리·대표 인용·인사이트) 스트리밍 전환의 최소 검증.
// Stage1을 다시 호출하지 않고, Stage1이 생성하는 것과 같은 형태의 절 목록 하나만 보낸다.
// 사용법: npm run check:stage2-stream
// 주의: Anthropic API 1회 호출이 발생한다.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runStage2, type Stage2ClauseInput } from "../lib/pipeline/stage2";

const resultPath = join(process.cwd(), "tmp", "stage2-streaming-smoke-latest.json");

function writeRunState(state: Record<string, unknown>) {
  mkdirSync(join(process.cwd(), "tmp"), { recursive: true });
  writeFileSync(resultPath, `${JSON.stringify({ updatedAt: new Date().toISOString(), ...state }, null, 2)}\n`);
}

// 실제 Stage1의 negative 그룹과 같은 입력 구조를 재현한 고정 검증용 절 목록이다.
// 검증 자체를 위해 만들어진 fixture이며 보고서·DB에는 저장하지 않는다.
const clauseTexts = [
  "걸음 수가 실제보다 적게 측정되어 보상을 받기 어려웠어요.",
  "GPS 위치가 도로가 아닌 건물 쪽으로 표시될 때가 있었습니다.",
  "산책 경로가 중간에 끊겨서 이동 거리가 제대로 기록되지 않았습니다.",
  "상자를 먹으려면 어디까지 가까이 가야 하는지 기준이 명확하지 않았습니다.",
  "보상 상자가 생기는 위치가 위험한 도로 근처여서 불편했습니다.",
  "산책 중 앱이 멈춰서 처음부터 다시 시작한 적이 있습니다.",
  "로딩 시간이 길어서 산책을 시작하기까지 기다려야 했습니다.",
  "펫 성장 조건이 화면에서 바로 이해되지 않았습니다.",
  "다음에 무엇을 해야 하는지 안내가 부족해서 헤맸습니다.",
  "보상 종류가 반복되어 계속 사용할 동기가 줄었습니다.",
  "교배 기능을 이용하는 방법이 복잡하게 느껴졌습니다.",
  "친구와 함께 하지 않으면 일부 기능을 쓰기 어려웠습니다.",
];
const clauses: Stage2ClauseInput[] = clauseTexts.map((clause, index) => ({
  respondent_id: index + 1,
  analysis_clause: clause,
  quote_verified: true,
}));

async function main() {
  const questionLabel = "‘펫과의 산책’ 기능 만족도";
  console.info(`[smoke] Stage2 스트리밍 단일 호출 시작 — ${questionLabel}, 부정 절 ${clauses.length}건`);
  writeRunState({ status: "started", question: questionLabel, polarity: "negative", apiCalls: 1, clausesSent: clauses.length });

  const startedAt = Date.now();
  // CLI에서 스트림 완료를 기다리도록 하는 검증 전용 keep-alive다. 서버 런타임에는 적용하지 않는다.
  const keepAlive = setInterval(() => undefined, 1_000);
  let result;
  try {
    result = await runStage2({ questionLabel, polarity: "negative", clauses });
  } catch (error) {
    writeRunState({
      status: "failed",
      question: questionLabel,
      polarity: "negative",
      apiCalls: 1,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearInterval(keepAlive);
  }

  const inputSet = new Set(
    clauses.flatMap((clause) => (clause.quote_verified ? [clause.raw_clause ?? clause.analysis_clause] : [])),
  );
  const quoteViolations = result.categories.flatMap((category) =>
    category.quotes.filter((quote) => !inputSet.has(quote)).map((quote) => ({ category: category.label, quote })),
  );
  const categorizedClauseCount = result.categories.reduce((sum, category) => sum + category.clause_count, 0);
  const summary = {
    event: "stage2_streaming_smoke_complete",
    status: "completed",
    question: questionLabel,
    polarity: "negative",
    apiCalls: 1,
    clausesSent: clauses.length,
    categoriesReturned: result.categories.length,
    totalClauseCount: result.total_clause_count,
    categorizedClauseCount,
    clauseCountMatches: result.total_clause_count === categorizedClauseCount,
    quoteViolations,
    elapsedMs: Date.now() - startedAt,
  };
  writeRunState(summary);
  console.info(JSON.stringify(summary, null, 2));
  if (!summary.clauseCountMatches || quoteViolations.length > 0) process.exitCode = 1;
}

// 이 스크립트는 CommonJS로 실행되므로 top-level await를 쓸 수 없다. 실행기 전체에
// ref된 타이머를 두고, main Promise가 종료될 때만 해제해 스트림 완료 전 프로세스가
// 종료되는 일을 방지한다.
const entryKeepAlive = setInterval(() => undefined, 1_000);
void main()
  .catch((error) => {
    console.error("[smoke] Stage2 스트리밍 검증 실패", error);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(entryKeepAlive));
