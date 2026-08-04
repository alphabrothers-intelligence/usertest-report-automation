// 극성별 총평("[긍정 의견 요약]" 박스) 생성.
//
// 2026-07-21부터 2026-08-04까지는 기본 정성 파이프라인과 완전히 분리된 opt-in 전용
// 기능이었다 — lib/pipeline/orchestrate.ts 상단 주석에 그 배경이 있다: 당시엔 문항×극성당
// 최대 3회(14문항 기준 최대 42회) 호출하는 구식 구현을 Stage1+Stage2 파이프라인 안에
// 같이 돌렸더니, 타임아웃 없는 호출 하나가 무한 대기해서 정성 분석 전체가 15분 넘게 멈추는
// 사고가 났었다(크레딧 소진 교란 가능성은 끝내 확정 못함).
//
// 2026-08-04 재검토: 그 사이 두 가지가 바뀌었다 — ① 문항당 호출이 1회로 줄었다
// (runPolaritySummaries가 극성 3개를 구조화 출력 하나로 합침), ② 모든 Claude 호출에
// 60초 타임아웃(withClaudeGuard)이 기본 적용됐다. 이 리포트로 opt-in 경로를 실측한 결과
// (13문항, 동시성 2) 약 80초·$0.14 수준이라 안전하다고 판단해, app/api/qualitative-jobs/
// [jobId]/run-next/route.ts의 "정성 분석 마지막 문항 완료 직후" 자동 배치(Ⅸ.2/Ⅸ.3와 같은
// Promise.allSettled)에도 추가했다 — opt-in 경로(app/api/chat/route.ts의
// generatePolaritySummaries 도구)는 재생성용으로 그대로 남겨뒀다. 이미 저장된 Stage2
// 카테고리만 재료로 쓰므로 Stage1/Stage2를 다시 돌리지 않는다.
import pLimit from "p-limit";
import { runPolaritySummaries, runValueSummary } from "./polaritySummary";
import type { Polarity } from "./stage1";
import {
  getQuestionsWithAllCategories,
  getReportById,
  saveQuestionPolaritySummaries,
  type QuestionWithApprovedCategories,
} from "@/lib/db/reports";
import { detectProductType, type ProductType } from "@/lib/report/productType";
import type { ClaudeUsageRecord } from "@/lib/claudeUsage";

/** 4대 가치 조사 결과 요약 형식이 제품형별로 다르므로, report의 저장된 정량 통계로 판별한다.
 * 정량 통계가 없으면(비정상) SW형으로 폴백한다. */
async function resolveProductType(reportId: string): Promise<ProductType> {
  const report = await getReportById(reportId);
  if (!report?.quant_stats) return "sw";
  return report.product_type ?? detectProductType(report.quant_stats);
}

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
    ? { combined: await runValueSummary({ valueLabel: question.label, byPolarity, productType: await resolveProductType(reportId) }) }
    : await runPolaritySummaries({ questionLabel: question.label, byPolarity });
  await saveQuestionPolaritySummaries(question.id, summaries);
  return summaries;
}

export async function runPolaritySummariesForReport(
  reportId: string,
  onUsage?: (usage: ClaudeUsageRecord) => void,
): Promise<GeneratePolaritySummariesResult> {
  const questions = await getQuestionsWithAllCategories(reportId);
  const productType = await resolveProductType(reportId);
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
            const combined = await runValueSummary({ valueLabel: q.label, byPolarity, productType, onUsage });
            if (combined) summaries = { combined };
          } else {
            summaries = await runPolaritySummaries({ questionLabel: q.label, byPolarity, onUsage });
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
