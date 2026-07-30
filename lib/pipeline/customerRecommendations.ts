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

const SYSTEM = `당신은 사용성테스트 결과보고서 Ⅸ장 "3. 기능별 고객 제언 종합" 표를 작성합니다.
입력은 기능마다 확인된 부정 카테고리 라벨(정성, Stage2 결과)입니다. 각 기능에 표에 넣을
짧은 행동형 고객 제언을 작성하세요 — **원칙적으로 3~4개**를 목표로 하되, 입력 부정 카테고리가
5개 이상이면 최대 6개까지 늘려도 된다(카테고리 수보다 항목을 많이 만들지 말 것).

# 형식 (원본 55쪽 "고객 제언" 표 셀과 동일 — 반드시 이 스타일을 따를 것)
각 항목은 **명사형으로 끝나는 짧은 행동 문구**입니다(문장 종결어미·설명·이유 없음). 예:
- "GPS 오차 최소화를 위한 위치 정확도 개선"
- "산책 시작 시 자동 실행 기능 제공"
- "보상 아이템의 다양화 및 난이도별 차등 보상 체계 구축"
- "교배 과정 소요 시간 단축 및 접근성 개선"
- "'교배'라는 용어·세계관을 대체할 수 있는 새로운 콘셉트 기획"

# 절대 규칙
- 입력에 제공된 부정 카테고리에서 확인된 문제만 개선 동작으로 바꾼다. 입력에 없는 기능·문제·수치를 지어내지 않는다.
- 문장은 "~개선", "~제공", "~구축", "~도입", "~강화", "~마련", "~기획", "~검토"처럼 명사형으로 끝낸다.
  "~합니다", "~해야 함", "~하십시오" 같은 서술형·명령형을 쓰지 않는다.
- 굵게·밑줄·화살표·번호 매김을 넣지 않는다 — 표 셀에 들어갈 순수 텍스트 문구만 출력한다.
- 같은 기능 안에서 항목끼리 서로 다른 문제를 다뤄 중복되지 않게 한다.
- 입력에 제공된 기능은 전부(featureName을 정확히 그대로) 포함한다. 순서는 입력 순서를 유지한다.`;

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
