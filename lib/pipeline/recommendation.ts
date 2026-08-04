// 제언 생성 — 헤지 워딩 강제 (PRD 6.5절). Tier 2: AI 초안 + 사용자 필수편집(체크포인트 B 대상②).
// Ⅳ. 핵심구매요소 해석 서술, Ⅸ. 개발우선순위제언·기능개선제안(As-is→To-be)에 재사용된다.
//
// **2026-07-29 사용자 지시로 원본 보고서(리바랩스=SW형, 케어클=실제품형) 대조 결과에 맞춰
// 제언 뉘앙스·제품형 분기를 강화했다.** 핵심 제약: 주관적 판단·명령형("~해라", "~해야 함")
// 절대 금지, 오직 객관적 제언 뉘앙스("~것을 제언함", "~것을 추천함", "~할 필요가 있음",
// "~이 요구됨", "~시급하다고 사료됨")만 사용. 이 보고서는 NIPA 시장성테스트+개선방안 산출물이라
// 근거 없는 주장이 금지된다.
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { logClaudeUsage, toClaudeUsageRecord, type ClaudeUsageRecord } from "@/lib/claudeUsage";
import type { QuantStats } from "@/lib/quant/compute";
import type { QuestionWithApprovedCategories } from "@/lib/db/reports";
import type { ProductType } from "@/lib/report/productType";
import { buildRecommendationSystemPrompt, FEATURE_IMPROVEMENT_SYSTEM } from "./prompts";

const RECOMMENDATION_MODEL = process.env.ANTHROPIC_RECOMMENDATION_MODEL ?? "claude-sonnet-5";

/** 프롬프트 검토·회귀 테스트용 기본(SW형) 스냅샷. */
export const RECOMMENDATION_SYSTEM_PROMPT = buildRecommendationSystemPrompt("sw");

export async function runRecommendation({
  sectionLabel,
  dataSummary,
  productType = "sw",
}: {
  sectionLabel: string;
  dataSummary: unknown;
  productType?: ProductType;
}): Promise<string> {
  const result = await generateText({
    model: anthropic(RECOMMENDATION_MODEL),
    system: buildRecommendationSystemPrompt(productType),
    prompt: `아래는 '${sectionLabel}' 관련 분석 근거입니다. 입력에 있는 사실만 사용하여 원본 Ⅸ장 형식의 보고서 본문 초안을 작성하세요.\n\n${JSON.stringify(dataSummary, null, 2)}`,
    maxOutputTokens: 3000,
    reasoning: "none",
  });
  logClaudeUsage(`recommendation:${sectionLabel}`, result.usage);
  return result.text;
}

/**
 * Ⅸ.2 "개선 전략 제언"(section=dev_priority)의 dataSummary 조립 로직.
 *
 * **2026-07-30 신규 — chat route의 `generateRecommendation` 도구 안에 있던 것과 동일한
 * tier 계산을 재사용 가능한 함수로 뺐다.** 원본 53쪽 구조([전반적 방향성]이 핵심구매요소
 * 상위 순위부터 근거로 삼고, 상위 tier 기능(최대 2개)만 개별 As-is/To-be+insight 블록으로,
 * 나머지는 그룹으로 묶음)에 필요한 tier·부정인사이트를 여기서 미리 계산해 넘긴다(모델이
 * 스스로 우선순위를 재해석하지 않도록, STRATEGY_BLOCK_SW 참고). 이 함수를 기본 정성 분석
 * 흐름(runDevPriorityRecommendation)과 채팅 도구(generateRecommendation) 양쪽에서 공유해
 * 로직이 두 곳에서 따로 어긋나지 않게 한다.
 */
export function buildDevPriorityDataSummary(stats: QuantStats, qualitative: QuestionWithApprovedCategories[]) {
  const ranked = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const total = ranked.length;
  const firstGroupSize = Math.ceil(total / 3);
  const secondGroupSize = Math.ceil((total - firstGroupSize) / 2);
  const withTier = ranked.map((item, index) => {
    const satisfaction = stats.featureSatisfaction.find((f) => f.name === item.name)?.mean ?? 0;
    const negatives = qualitative
      .find((q) => q.question_key === `feature:${item.name}`)
      ?.categories.filter((c) => c.polarity === "negative")
      .map((c) => c.label) ?? [];
    return {
      기능명: item.name,
      순위: index + 1,
      상대중요도: item.score,
      만족도: satisfaction,
      tier: index < firstGroupSize ? "우선" : index < firstGroupSize + secondGroupSize ? "차우선" : "비우선",
      부정인사이트: negatives,
    };
  });
  return {
    핵심구매요소: [...stats.keyFactorDistribution].sort((a, b) => b.percentage - a.percentage),
    우선_tier_기능: withTier.filter((f) => f.tier === "우선"),
    차우선_tier_기능: withTier.filter((f) => f.tier === "차우선"),
    nps: stats.nps,
    overallSatisfaction: stats.overallSatisfaction,
  };
}

/** Ⅸ.2 개선 전략 제언을 정량+정성 자료로 생성한다(기본 정성 분석 흐름에서 자동 실행할 때 사용).
 * 채팅 도구(generateRecommendation, section="dev_priority")와 동일한 dataSummary를 쓴다. */
export async function runDevPriorityRecommendation(
  stats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  productType: ProductType,
  onUsage?: (usage: ClaudeUsageRecord) => void,
): Promise<string> {
  const dataSummary = buildDevPriorityDataSummary(stats, qualitative);
  const label = "recommendation:dev_priority(auto)";
  const startedAt = Date.now();
  const result = await generateText({
    model: anthropic(RECOMMENDATION_MODEL),
    system: buildRecommendationSystemPrompt(productType),
    prompt: `아래는 '개발 우선순위 제언' 관련 분석 근거입니다. 입력에 있는 사실만 사용하여 원본 Ⅸ장 형식의 보고서 본문 초안을 작성하세요.\n\n${JSON.stringify(dataSummary, null, 2)}`,
    maxOutputTokens: 3000,
    reasoning: "none",
  });
  const elapsedMs = Date.now() - startedAt;
  logClaudeUsage(label, result.usage, { elapsedMs });
  if (result.usage) onUsage?.(toClaudeUsageRecord(label, result.usage, { elapsedMs, attempt: 1 }));
  return result.text;
}

/** Ⅸ.2 "기능 개선 제안"(section=`feature_improvement:{기능명}`)의 dataSummary 조립 — 한 기능분.
 * dev_priority(buildDevPriorityDataSummary)와 달리 tier 계산 없이 그 기능 하나만 본다. */
export function buildFeatureImprovementDataSummary(
  stats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  featureName: string,
) {
  const satisfaction = stats.featureSatisfaction.find((f) => f.name === featureName) ?? null;
  const relativeImportance = stats.relativeImportance.find((r) => r.name === featureName) ?? null;
  const negativeCategories = qualitative
    .find((q) => q.question_key === `feature:${featureName}`)
    ?.categories.filter((c) => c.polarity === "negative")
    .map((c) => ({ label: c.label, insight: c.insight_final ?? c.insight_draft })) ?? [];
  return { featureName, satisfaction, relativeImportance, negativeCategories };
}

/** Ⅸ.2 "기능 개선 제안" 한 기능분을 생성한다(As-is/To-be, FEATURE_IMPROVEMENT_SYSTEM 전용
 * 프롬프트 — dev_priority의 buildRecommendationSystemPrompt와는 다른 프롬프트). 채팅 도구
 * (generateFeatureRecommendation)와 기본 정성 분석 흐름의 자동 생성(runAllFeatureImprovement
 * Recommendations) 양쪽에서 공유해 형식이 두 경로에서 어긋나지 않게 한다. */
export async function runFeatureImprovementRecommendation(
  stats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  featureName: string,
  onUsage?: (usage: ClaudeUsageRecord) => void,
): Promise<string> {
  const dataSummary = buildFeatureImprovementDataSummary(stats, qualitative, featureName);
  const label = `recommendation:feature_improvement:${featureName}`;
  const startedAt = Date.now();
  const result = await generateText({
    model: anthropic(RECOMMENDATION_MODEL),
    system: FEATURE_IMPROVEMENT_SYSTEM,
    prompt: `아래는 '${featureName}' 기능의 개선 제안 근거입니다. 입력에 있는 사실만 사용하여 원본 Ⅸ장 "기능 개선 제안" 형식의 항목 하나를 작성하세요.\n\n${JSON.stringify(dataSummary, null, 2)}`,
    maxOutputTokens: 800,
    reasoning: "none",
  });
  const elapsedMs = Date.now() - startedAt;
  logClaudeUsage(label, result.usage, { elapsedMs });
  if (result.usage) onUsage?.(toClaudeUsageRecord(label, result.usage, { elapsedMs, attempt: 1 }));
  return result.text;
}

/** Ⅸ.2 "기능 개선 제안"을 raw data의 전 기능에 대해 자동 생성한다(2026-08-03 신규 — 기존엔
 * 사용자가 채팅에서 기능마다 개별 요청해야만 채워졌는데, 원본 보고서는 이 항목이 항상 채워져
 * 있어 담당자가 "무조건 자동 생성돼야 한다"고 요청했다). dev_priority·기능별 고객 제언 종합과
 * 같은 시점(정성 분석 완료 직후)에 같이 자동 실행된다. 기능 하나가 실패해도 나머지가 유실되지
 * 않도록 allSettled로 각각 독립 처리한다. */
export async function runAllFeatureImprovementRecommendations(
  stats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  onUsage?: (usage: ClaudeUsageRecord) => void,
): Promise<{ featureName: string; draft: string }[]> {
  const results = await Promise.allSettled(
    stats.featureSatisfaction.map(async (f) => ({
      featureName: f.name,
      draft: await runFeatureImprovementRecommendation(stats, qualitative, f.name, onUsage),
    })),
  );
  const fulfilled: { featureName: string; draft: string }[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") fulfilled.push(result.value);
    else console.error("[recommendation] 기능 개선 제안 생성 실패", result.reason);
  }
  return fulfilled;
}
