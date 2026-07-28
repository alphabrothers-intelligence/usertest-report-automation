// 극성별 총평("[긍정 의견 요약]" 박스) 생성 — 2026-07-21부터 기본 정성 파이프라인과 분리된
// 별도 opt-in 기능이다. lib/pipeline/orchestrate.ts 상단 주석에 이유가 있다: Stage1+Stage2
// 파이프라인 안에서 같이 돌렸더니 실사용 중 API 호출량 증가로 레이트리밋에 걸려 멈추거나
// 대량 타임아웃이 나는 현상이 관측됐다(크레딧 소진 교란 가능성은 별도 검증 대상). 이 함수는 사용자가 명시적으로 요청했을 때만
// (app/api/chat/route.ts의 generatePolaritySummaries 도구) 별도로, 이미 저장된 카테고리를
// 재료로 호출한다 — Stage1/Stage2를 다시 돌리지 않고 세 극성을 문항당 한 번의 구조화된 호출로 묶는다.
import pLimit from "p-limit";
import { runPolaritySummaries, runValueSummary } from "./polaritySummary";
import type { Polarity } from "./stage1";
import {
  getQuestionsWithAllCategories,
  saveQuestionPolaritySummaries,
  type QuestionWithApprovedCategories,
} from "@/lib/db/reports";

// 극성 총평은 부가 기능이며, 기본 분석과 경쟁하지 않도록 보수적으로 두 개만 동시에 실행한다.
// 환경변수로만 조정할 수 있고 PIPELINE_CONCURRENCY와 분리해 둔다.
const CONCURRENCY = Number(process.env.POLARITY_SUMMARY_CONCURRENCY ?? 2);

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

/** 웹의 "AI 요약 생성" 버튼용 단일 문항 처리.
 * 이미 저장된 Stage2 카테고리·인사이트만 읽으므로 raw data/Stage1/Stage2를 재실행하지 않으며,
 * 사용자가 선택한 박스 하나에 대해서만 Claude 호출 1회를 사용한다. */
export async function runPolaritySummariesForQuestion(
  reportId: string,
  questionKey: string,
): Promise<Partial<Record<Polarity | "combined", string>>> {
  const question = (await getQuestionsWithAllCategories(reportId)).find((item) => item.question_key === questionKey);
  if (!question) throw new Error("요약할 문항을 찾을 수 없습니다.");
  // 요약 가능 여부는 문항의 화면 분류(standard/improvement)가 아니라 실제로 저장된
  // 정성 카테고리와 극성 정보로 판단한다. 기존에는 improvement로 저장된 문항도 일괄
  // 차단되어, 화면에는 'AI 요약 생성' 버튼이 보이지만 아무 결과도 만들 수 없었다.
  if (question.categories.length === 0) {
    throw new Error("저장된 정성 카테고리가 없어 요약을 생성할 수 없습니다.");
  }
  const grouped = groupCategoriesByPolarity(question.categories);
  const byPolarity = Object.fromEntries(
    (Object.keys(grouped) as Polarity[]).flatMap((polarity) => {
      const categories = grouped[polarity];
      if (!categories?.length) return [];
      return [[polarity, categories.map((c) => ({
        label: c.label,
        insight: c.insight_final ?? c.insight_draft,
        clause_count: c.clause_count,
      }))]];
    }),
  ) as Partial<Record<Polarity, { label: string; insight: string; clause_count: number }[]>>;
  if (Object.keys(byPolarity).length === 0) {
    throw new Error("이 문항에는 긍정·부정·중립으로 분류된 정성 카테고리가 없어 요약을 만들 수 없습니다.");
  }
  const summaries = question.question_key.startsWith("values:")
    ? { combined: await runValueSummary({ valueLabel: question.label, byPolarity }) }
    : await runPolaritySummaries({ questionLabel: question.label, byPolarity });
  await saveQuestionPolaritySummaries(question.id, summaries);
  return summaries;
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
        const byPolarity = Object.fromEntries(
          (Object.keys(grouped) as Polarity[]).flatMap((polarity) => {
            const categories = grouped[polarity];
            if (!categories?.length) return [];
            return [[polarity, categories.map((c) => ({
              label: c.label,
              insight: c.insight_final ?? c.insight_draft,
              clause_count: c.clause_count,
            }))]];
          }),
        ) as Partial<Record<Polarity, { label: string; insight: string; clause_count: number }[]>>;

        // 4대 가치 문항(values:*)은 Ⅴ장 "[ … 조사 결과 ]" 박스용 한 단락(존댓말) 요약을
        // combined 키에 저장하고, 그 외 문항(기능·NPS 등)은 Ⅲ장 응답 요약용 극성별 짧은
        // 개조식 총평을 저장한다(2026-07-28 사용자 요청, 두 형식 분리).
        const isValueQuestion = q.question_key.startsWith("values:");
        let summaries: Partial<Record<Polarity | "combined", string>> = {};
        try {
          if (isValueQuestion) {
            const combined = await runValueSummary({ valueLabel: q.label, byPolarity });
            if (combined) summaries = { combined };
          } else {
            summaries = await runPolaritySummaries({ questionLabel: q.label, byPolarity });
          }
          summariesGenerated += Object.keys(summaries).length;
        } catch (err) {
          // 한 문항의 요약이 하나의 호출이므로 실패도 한 건으로 기록한다. 나머지는 계속 진행.
          console.error(`[polaritySummary] failed for ${q.label}:`, err);
          summariesFailed += 1;
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
