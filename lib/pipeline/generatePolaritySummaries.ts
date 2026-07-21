// 극성별 총평("[긍정 의견 요약]" 박스) 생성 — 2026-07-21부터 기본 정성 파이프라인과 분리된
// 별도 opt-in 기능이다. lib/pipeline/orchestrate.ts 상단 주석에 이유가 있다: Stage1+Stage2
// 파이프라인 안에서 같이 돌렸더니 실사용 중 API 호출량 증가로 레이트리밋에 걸려 멈추거나
// 대량 타임아웃이 나는 게 실측으로 확인됐다. 이 함수는 사용자가 명시적으로 요청했을 때만
// (app/api/chat/route.ts의 generatePolaritySummaries 도구) 별도로, 이미 저장된 카테고리를
// 재료로 호출한다 — Stage1/Stage2를 다시 돌리지 않으므로 그 자체로 훨씬 가볍다.
import pLimit from "p-limit";
import { runPolaritySummary } from "./polaritySummary";
import type { Polarity } from "./stage1";
import {
  getQuestionsWithAllCategories,
  saveQuestionPolaritySummaries,
  type QuestionWithApprovedCategories,
} from "@/lib/db/reports";

const CONCURRENCY = Number(process.env.PIPELINE_CONCURRENCY ?? 8);

export interface GeneratePolaritySummariesResult {
  questionsProcessed: number;
  summariesGenerated: number;
  summariesFailed: number;
}

function groupCategoriesByPolarity(
  categories: QuestionWithApprovedCategories["categories"],
): Partial<Record<Polarity, QuestionWithApprovedCategories["categories"]>> {
  const groups: Partial<Record<Polarity, QuestionWithApprovedCategories["categories"]>> = {};
  for (const c of categories) {
    if (!c.polarity) continue; // improvement 문항 카테고리는 polarity가 null — 요약 대상 아님
    const arr = groups[c.polarity] ?? (groups[c.polarity] = []);
    arr.push(c);
  }
  return groups;
}

export async function runPolaritySummariesForReport(
  reportId: string,
): Promise<GeneratePolaritySummariesResult> {
  const questions = await getQuestionsWithAllCategories(reportId);
  const limit = pLimit(CONCURRENCY);

  let summariesGenerated = 0;
  let summariesFailed = 0;

  await Promise.all(
    questions.map((q) =>
      limit(async () => {
        if (q.kind !== "standard" || q.categories.length === 0) return;
        const grouped = groupCategoriesByPolarity(q.categories);
        const summaries: Partial<Record<Polarity, string>> = {};

        for (const polarity of Object.keys(grouped) as Polarity[]) {
          const categories = grouped[polarity];
          if (!categories || categories.length === 0) continue;
          try {
            summaries[polarity] = await runPolaritySummary({
              questionLabel: q.label,
              polarity,
              categories: categories.map((c) => ({
                label: c.label,
                insight: c.insight_final ?? c.insight_draft,
                clause_count: c.clause_count,
              })),
            });
            summariesGenerated += 1;
          } catch (err) {
            console.error(`[polaritySummary] failed for ${q.label}/${polarity}:`, err);
            summariesFailed += 1;
          }
        }

        if (Object.keys(summaries).length > 0) {
          await saveQuestionPolaritySummaries(q.id, summaries);
        }
      }),
    ),
  );

  return {
    questionsProcessed: questions.filter((q) => q.kind === "standard" && q.categories.length > 0).length,
    summariesGenerated,
    summariesFailed,
  };
}
