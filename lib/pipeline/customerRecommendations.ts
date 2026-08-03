// Ⅸ.3 "기능별 고객 제언 종합" 신규 생성기 (2026-07-30).
//
// 원본 55쪽은 [기능 N] 기능명 + "고객 제언 1~4" 짧은 행동 문구 표다(As-is/To-be 프로즈가 아님,
// recommendation.ts의 기능개선제안과는 다른 포맷). 정성 분석이 이미 성공했다면(Stage2 카테고리가
// 저장돼 있다면) 새 LLM 호출 없이 재료가 다 있는 Ⅸ.1과 달리, 이 표는 "행동 문구로 다듬는" 얕은
// 변환이 필요해 가벼운 구조화 LLM 호출 1회로 처리한다(전체 기능 한 번에, 문항 단위가 아니라
// 리포트 단위).
import { anthropic } from "@ai-sdk/anthropic";
import { Output } from "ai";
import { z } from "zod";
import type { QuantStats } from "@/lib/quant/compute";
import type { QuestionWithApprovedCategories } from "@/lib/db/reports";
import { streamStructured, withClaudeGuard } from "./claudeGuard";
import type { ClaudeUsageRecord } from "@/lib/claudeUsage";
import { CUSTOMER_RECOMMENDATIONS_SYSTEM as SYSTEM } from "./prompts";

const MODEL = process.env.ANTHROPIC_CUSTOMER_RECOMMENDATION_MODEL ?? "claude-sonnet-5";

// max(4)로 좁게 잡았다가 실제 raw data(기능당 부정 카테고리 5~6개)에서 스키마 검증 실패가
// 났다(2026-07-30 실측 — NoObjectGeneratedError, "Too big: expected array to have <=4 items").
// 원본 표는 보통 3~4행이지만 raw data가 다르면 더 많은 카테고리가 나올 수 있으므로 max(6)까지 허용한다.
const FeatureCustomerRecommendationSchema = z.object({
  features: z.array(
    z.object({
      featureName: z.string(),
      actions: z.array(z.string()).min(2).max(6),
    }),
  ),
});

export type FeatureCustomerRecommendations = z.infer<typeof FeatureCustomerRecommendationSchema>;

/** 리포트 단위로 전 기능의 고객 제언 표를 한 번에 생성한다(신규 LLM 호출 1회, 저비용). */
export async function runFeatureCustomerRecommendations(
  stats: QuantStats,
  qual: QuestionWithApprovedCategories[],
  onUsage?: (usage: ClaudeUsageRecord) => void,
): Promise<FeatureCustomerRecommendations> {
  // **2026-07-30 정정**: 처음엔 원본 순서(산책→성장→거점형→꾸미기→레이싱→교배)가 "재현 불가능한
  // 임의 배치"라고 보고 raw data 컬럼 순서를 썼는데, 실제 대조해보니 이 순서는 정확히
  // 상대중요도(relativeImportance) 내림차순과 일치했다 — 일반화 가능한 규칙이었다. raw data가
  // 달라져도 항상 계산되는 결정론적 기준이므로 그대로 채택한다(raw 컬럼 순서가 아님).
  const rankedByImportance = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const features = rankedByImportance.map((imp) => {
    const negatives = qual
      .find((q) => q.question_key === `feature:${imp.name}`)
      ?.categories.filter((c) => c.polarity === "negative")
      .map((c) => c.label) ?? [];
    return { 기능명: imp.name, 부정카테고리: negatives };
  });

  const traceLabel = "feature-customer-recommendations";
  const { output } = await withClaudeGuard(
    traceLabel,
    () =>
      streamStructured<FeatureCustomerRecommendations>(
        {
          model: anthropic(MODEL),
          instructions: {
            role: "system",
            content: SYSTEM,
            providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
          },
          prompt: JSON.stringify({ 기능목록: features }, null, 2),
          output: Output.object({ schema: FeatureCustomerRecommendationSchema }),
          hardTimeoutMs: 120_000,
          maxOutputTokens: 3000,
          reasoning: "none",
        },
        traceLabel,
      ),
    { onUsage },
  );

  return output;
}
