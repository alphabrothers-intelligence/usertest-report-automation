// Ⅸ.3 "기능별 고객 제언 종합" 신규 생성기 (2026-07-30).
//
// 원본 55쪽은 [기능 N] 기능명 + "고객 제언 1~4" 짧은 행동 문구 표다(As-is/To-be 프로즈가 아님,
// recommendation.ts의 기능개선제안과는 다른 포맷). 정성 분석이 이미 성공했다면(Stage2 카테고리가
// 저장돼 있다면) 새 LLM 호출 없이 재료가 다 있는 Ⅸ.1과 달리, 이 표는 "행동 문구로 다듬는" 얕은
// 변환이 필요해 가벼운 구조화 LLM 호출 1회로 처리한다(전체 기능 한 번에, 문항 단위가 아니라
// 리포트 단위).
import { anthropic } from "@/lib/anthropic";
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
//
// **min(2)도 뺐다(2026-09-10 실측).** 주관식이 없어 부정 카테고리가 하나도 없는 기능에 모델이
// `"actions": []`를 냈고, min(2) 때문에 **응답 전체가 스키마 검증에 걸려** 잘 만든 9개 기능까지
// 통째로 버려졌다(정리습관 — Ⅸ.3이 아예 저장되지 않은 원인). 한 기능이 비었다고 나머지를 잃는
// 구조가 잘못이다. 비어 있는 기능은 아래에서 **코드가 걸러낸다** — 판단은 모델, 정리는 코드.
export const FeatureCustomerRecommendationSchema = z.object({
  features: z.array(
    z.object({
      featureName: z.string(),
      actions: z.array(z.string()).max(6),
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
  // 순위 문항이 없는 raw data(이젠오토 실측)는 relativeImportance가 비어 있다. 그 데이터에도
  // 기능 만족도 문항은 있으므로, 없으면 만족도 내림차순으로 같은 순서 규칙을 이어간다.
  const rankedByImportance = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  // 같은 기능명이 여러 컬럼에 걸쳐 있는 raw data가 있다(이젠오토 "셀프 정비 콘텐츠" 3개 실측).
  // 재료(`feature:이름`)는 어차피 하나뿐이라 그대로 두면 **똑같은 행이 여러 번** 나온다.
  const orderedNames = [...new Set(
    rankedByImportance.length > 0
      ? rankedByImportance.map((item) => item.name)
      : [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean).map((item) => item.name),
  )];
  // **재료가 없는 기능은 아예 묻지 않는다**(2026-09-10). 부정 카테고리가 하나도 없으면 쓸 말이
  // 없어 모델이 빈 배열을 내고, 그 하나 때문에 응답 전체가 스키마 검증에 걸렸다. 지어내지 않는
  // 것이 맞으므로(6.5절 헤지 원칙) 입력에서 빼는 것이 옳다.
  const features = orderedNames
    .map((name) => {
      const negatives = qual
        .find((q) => q.question_key === `feature:${name}`)
        ?.categories.filter((c) => c.polarity === "negative")
        .map((c) => c.label) ?? [];
      return { 기능명: name, 부정카테고리: negatives };
    })
    .filter((feature) => feature.부정카테고리.length > 0);
  // 쓸 재료가 하나도 없으면 만들 표가 없다 — 빈 목록으로 Claude를 부르면 비용만 쓴다.
  if (features.length === 0) return { features: [] };

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

  // 모델이 그래도 빈 기능을 냈다면 여기서 걸러낸다 — 한 기능 때문에 나머지를 잃지 않는다.
  return dropEmptyFeatures(output);
}

/** 제언이 하나도 없는 기능은 표에 넣지 않는다(빈 행이 된다). `check:customer-recommendations`가 고정. */
export function dropEmptyFeatures(output: FeatureCustomerRecommendations): FeatureCustomerRecommendations {
  return { features: output.features.filter((feature) => feature.actions.length > 0) };
}
