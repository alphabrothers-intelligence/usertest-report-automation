// 사용성테스트 결과 요약 생성 (Ⅸ장 "1. 사용성테스트 결과 요약").
//
// **2026-07-29 사용자 지시로 6.9절 프롬프트를 원본 보고서(리바랩스·케어클) 대조 결과에 맞춰
// 재설계했다.** 원본의 결과 요약은 "각 섹션의 독립 요약"이 아니라, NPS(시장성)가 왜 낮은지 →
// 무엇이 구매 전환을 막는지를 항목별로 입증하는 "논증"이다. 그래서 핵심구매요소는 '구매 결정
// 요인', NPS는 '시장성 판정 + 구매전환 부족 진단'으로 프레이밍한다. 근거는 정량 통계 + 이미
// 저장된 카테고리 인사이트만 쓴다(raw 응답 재분석 없음).
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { logClaudeUsage } from "@/lib/claudeUsage";
import type { QuantStats } from "@/lib/quant/compute";
import type { QuestionWithApprovedCategories } from "@/lib/db/reports";
import { detectProductType, type ProductType } from "@/lib/report/productType";

const SUMMARY_MODEL = process.env.ANTHROPIC_SUMMARY_MODEL ?? "claude-sonnet-5";

const SUMMARY_SYSTEM_PROMPT = `당신은 사용성테스트 결과보고서의 "사용성테스트 결과 요약" 섹션을 작성합니다.
이 보고서는 제품 시장성 테스트 + 개선방안 산출물입니다. 각 항목(섹션)의 정량 수치와 카테고리
인사이트를 항목별 개조식 불릿으로 종합하되, 궁극적으로 "이 결과가 사용자의 구매 전환·시장성에
어떤 의미인지"가 드러나도록 씁니다.

# 항목별 지침
- 기능별 고객 경험 평가: 상대중요도-만족도 gap 관점에서 우선/차우선 개선 대상을 짚는다.
  (예: "높은 상대 중요도와 낮은 만족도를 가지므로 우선 개선 필요.")
- 핵심구매요소: 상위 요인(순위·비율)을 '구매 결정 요인'으로 서술하고, 이를 개선하면 구매 전환
  제고로 이어질 수 있음을 연결한다.
- 4대 가치 만족도: 가치별로 긍정 평가 요지 + 개선 필요 요소를 한 불릿으로 종합한다.
- 종합 만족도·NPS: NPS 부호로 시장성 수준을 진단하고(음수=낮은 시장성), 중립·비추천 비율이
  높으면 '구매 전환을 일으키는 요소가 부족함'으로 해석한다.

# 공통 규칙 (반드시 준수)
- 제공된 정량 수치와 카테고리 인사이트에 있는 내용만 쓴다. 새 사실·수치·외부 시장 기준을
  지어내지 않는다. 수치는 제공된 값을 토씨 그대로 인용한다.
- 결론·권고는 반드시 객관적 제언 뉘앙스로만 끝낸다: "~것을 제언함", "~것을 추천함",
  "~할 필요가 있음", "~이 요구됨", "~시급하다고 사료됨". 명령형("~하라", "~해야 한다")과
  주관적 단정을 절대 쓰지 않는다.
- 개조식 명사형 종결(~함/~됨/~판단됨/~시사함/~확인됨/~도출됨/~필요)을 기본으로 한다.
- "사실 서술 → 함의/제언" 2단으로 쓰고, 도출되는 함의·제언 앞에만 화살표(→)를 붙인다.
  묶음이 필요하면 [대괄호 소제목]으로 그룹핑한다.
- 핵심 키워드·수치에만 굵게(**...**)를 쓴다.

# 출력
- 항목마다 "## 항목명" 소제목 아래 불릿(-)으로 3~5개. 입력에 존재하는 항목만 작성한다.`;

/** 정성 카테고리에서 특정 문항의 상위 부정/개선 인사이트를 뽑는다(결과 요약 근거용). */
function negativeInsights(qualitative: QuestionWithApprovedCategories[], questionKey: string, limit = 3): string[] {
  return qualitative
    .find((q) => q.question_key === questionKey)
    ?.categories.filter((c) => c.polarity === "negative")
    .slice(0, limit)
    .map((c) => c.insight_final ?? c.insight_draft) ?? [];
}
function positiveInsights(qualitative: QuestionWithApprovedCategories[], questionKey: string, limit = 2): string[] {
  return qualitative
    .find((q) => q.question_key === questionKey)
    ?.categories.filter((c) => c.polarity === "positive")
    .slice(0, limit)
    .map((c) => c.insight_final ?? c.insight_draft) ?? [];
}

/** 정량 통계 + 저장된 카테고리 인사이트를 결과 요약 프롬프트 입력(항목별)으로 조립한다.
 * 존재하는 항목만 담으므로 제품형에 따라 항목 집합이 달라진다. */
export function buildResultSummaryInput(
  quantStats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  productType: ProductType,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  input["기능별 고객 경험 평가"] = quantStats.featureSatisfaction.map((f) => {
    const importance = quantStats.relativeImportance.find((r) => r.name === f.name)?.score ?? null;
    return {
      기능명: f.name,
      평균만족도: f.mean,
      상대중요도: importance,
      대표_부정_인사이트: negativeInsights(qualitative, `feature:${f.name}`),
    };
  });

  input["핵심구매요소"] = [...quantStats.keyFactorDistribution]
    .sort((a, b) => b.percentage - a.percentage)
    .map((k, i) => ({ 요인명: k.label, 순위: i + 1, 비율: k.percentage }));

  input["4대 가치 만족도"] = [
    { key: "values:functional", label: "기능적 가치", stat: quantStats.fourValues.functional },
    { key: "values:aesthetic", label: "심미적 가치", stat: quantStats.fourValues.aesthetic },
    { key: "values:economic", label: "경제적 가치", stat: quantStats.fourValues.economic },
    { key: "values:social", label: "사회·공공적 가치", stat: quantStats.fourValues.social },
  ].map((v) => ({
    가치명: v.label,
    평균: v.stat.mean,
    대표_긍정_인사이트: positiveInsights(qualitative, v.key),
    대표_부정_인사이트: negativeInsights(qualitative, v.key),
  }));

  if (productType === "sw") {
    input["사용자 경험 품질 평가"] = {
      실용성: quantStats.uxQuality.usability.map((u) => ({ 항목: u.name, 평균: u.mean })),
      즐거움: quantStats.uxQuality.fun.map((u) => ({ 항목: u.name, 평균: u.mean })),
    };
    input["교차 분석"] = quantStats.crossAnalysis;
  }

  input["종합 만족도 및 NPS 지수"] = {
    종합만족도평균: quantStats.overallSatisfaction.mean,
    NPS점수: quantStats.nps.npsScore,
    구매고객비율: quantStats.nps.promoterPct,
    중립고객비율: quantStats.nps.passivePct,
    비추천고객비율: quantStats.nps.detractorPct,
  };

  return input;
}

export async function runResultSummary(params: {
  quantStats: QuantStats;
  qualitative?: QuestionWithApprovedCategories[];
}): Promise<string> {
  const productType = detectProductType(params.quantStats);
  const input = buildResultSummaryInput(params.quantStats, params.qualitative ?? [], productType);

  const result = await generateText({
    model: anthropic(SUMMARY_MODEL),
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: JSON.stringify(input, null, 2),
    maxOutputTokens: 2500,
    reasoning: "none",
  });
  logClaudeUsage("result-summary", result.usage);
  return result.text;
}
