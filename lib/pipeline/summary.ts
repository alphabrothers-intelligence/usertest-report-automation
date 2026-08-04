// 사용성테스트 결과 요약 생성 (Ⅸ장 "1. 사용성테스트 결과 요약").
//
// **2026-07-30 원본 페이지(50~52) 재대조로 아키텍처를 바꿨다.** 처음엔(2026-07-29) 이 표를
// 정량+정성 카테고리에서 "새로 다시 분석"하도록 만들었는데, 실제로 재생성해 원본과 대조해보니
// 분량·형식이 크게 달랐다(사용자 지적, 2026-07-30) — 원본을 정밀히 다시 읽어보면 이 표의
// 각 행은 새로운 분석이 아니라 **이미 작성된 Ⅲ.2/Ⅳ.2/Ⅴ.2/Ⅵ.2/Ⅶ의 압축본**이다(예: Ⅳ.2가
// 4문단인데 Ⅸ.1 핵심구매요소 행은 2문장, Ⅵ.2 [종합해석]의 실용성·즐거움 두 문장이 Ⅸ.1
// UX행에 거의 그대로 재사용됨). 그래서 `runResultSummary`는 이제 raw 정량·카테고리가 아니라
// **`lib/pipeline/sectionAnalysis.ts`가 만든 섹션 텍스트를 압축 재료로 받는다** — 새 해석을
// 더하지 않고 이미 확정된 문장에서 핵심만 추린다. sectionAnalyses가 없는 오래된 report(구버전
// 캐시 등)에 대비해 raw 정량+카테고리 fallback 경로도 유지한다.
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { logClaudeUsage, type ClaudeUsageLike } from "@/lib/claudeUsage";
import type { QuantStats } from "@/lib/quant/compute";
import type { QuestionWithApprovedCategories, SectionAnalyses } from "@/lib/db/reports";
import { detectProductType, type ProductType } from "@/lib/report/productType";
import { splitCrossAnalysisText, shortenFactorLabel } from "./sectionAnalysis";
import { SUMMARY_SYSTEM_PROMPT, FALLBACK_SUMMARY_SYSTEM_PROMPT as FALLBACK_SYSTEM_PROMPT } from "./prompts";

const SUMMARY_MODEL = process.env.ANTHROPIC_SUMMARY_MODEL ?? "claude-sonnet-5";

// Ⅸ.1은 Ⅲ.2보다 거친 3단계 표현어를 쓴다(원본 51쪽: 산책 imp 2.96="높은"·sat 6.35="낮은",
// 성장 imp 1.37="높은"·sat 6.81="보통 수준의", 거점 imp 0.26="보통의"·sat 6.35="낮은",
// 꾸미기 imp 0.23="낮은"·sat 7.20="높은"). 표현어를 모델이 즉흥으로 고르지 않게 코드에서 확정한다.
// importanceLabel3의 절대 임계값(1.0/0.25)은 relativeImportance 자체가 FGI 공식으로 항상
// ±5 범위로 정규화되므로(CLAUDE.md 참고) raw data가 달라도 안전하다. **satisfactionLabel3는
// 원래 만족도 원점수(0~10, 정규화 안 됨)에 리바랩스 점수 구간(7.0/6.5)을 절대 임계값으로 썼는데,
// 다른 raw data는 전체 만족도 수준 자체가 다를 수 있어(예: 전 항목 8점대) 그대로 두면 라벨이
// 다 쏠린다 — sectionAnalysis.ts의 satisfactionLabel5와 같은 이유로 순위 기반으로 교체했다.**
function importanceLabel3(score: number): string {
  if (score >= 1.0) return "높은";
  if (score >= 0.25) return "보통의";
  return "낮은";
}
function satisfactionLabel3(rank: number): string {
  if (rank === 1) return "높은";
  if (rank === 2) return "보통 수준의";
  return "낮은";
}

/** Ⅸ.1 "기능별 고객 경험 평가" 행 재료 — Ⅲ.2의 우선/차우선 tier만(비우선 제외). 원본 표현어·판정
 * 후보를 코드에서 확정해 넘기고, 개선 동작으로 바꿀 부정 카테고리 라벨을 재료로 준다. */
function buildFeatureRowMaterial(stats: QuantStats, qualitative: QuestionWithApprovedCategories[]): Record<string, unknown>[] {
  const ranked = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const total = ranked.length;
  const firstGroupSize = Math.ceil(total / 3);
  const secondGroupSize = Math.ceil((total - firstGroupSize) / 2);
  const shown = ranked.slice(0, firstGroupSize + secondGroupSize);
  // 만족도 표현어는 이 표에 실제로 나열되는 기능들 사이의 순위로만 정한다(원본 51쪽도 우선·
  // 차우선 tier 안에서만 상대 비교) — 순위 계산 근거를 sectionAnalysis.ts의 satisfactionLabel5와
  // 같은 이유로 절대 점수에서 순위로 바꿨다.
  const satisfactionRank = new Map(
    [...shown]
      .sort((a, b) => (stats.featureSatisfaction.find((f) => f.name === b.name)?.mean ?? 0) - (stats.featureSatisfaction.find((f) => f.name === a.name)?.mean ?? 0))
      .map((item, i) => [item.name, i + 1]),
  );
  return shown.map((item, index) => {
    const mean = stats.featureSatisfaction.find((f) => f.name === item.name)?.mean ?? 0;
    const tier = index < firstGroupSize ? "우선" : "차우선";
    const negatives = qualitative
      .find((q) => q.question_key === `feature:${item.name}`)
      ?.categories.filter((c) => c.polarity === "negative")
      .slice(0, 3)
      .map((c) => c.label) ?? [];
    return {
      기능명: item.name,
      중요도표현: importanceLabel3(item.score),
      만족도표현: satisfactionLabel3(satisfactionRank.get(item.name) ?? index + 1),
      tier,
      // 우선 tier의 판정 후보 2종, 차우선 tier의 판정 후보 2종(원본 51쪽 문구)
      판정후보: tier === "우선"
        ? ["우선 개선 필요", "핵심 기능 개선 대상으로 설정"]
        : ["차우선 개선 제안", "보완적 차우선 개선 필요"],
      개선항목_후보: negatives,
    };
  });
}

/** Ⅸ.1 "4대 가치 만족도" 행 재료 — 원본 51쪽처럼 가치마다 [가치명]+긍정/개선 요지로 압축하기
 * 위해 per-value 긍정·개선 요지를 준다(원본 순서: 기능적→심미적→경제적→사회·공공적). */
function buildFourValuesRowMaterial(stats: QuantStats, qualitative: QuestionWithApprovedCategories[]): Record<string, unknown>[] {
  const requiredInsights = (questionKey: string, polarity: "positive" | "negative", limit: number) =>
    qualitative.find((q) => q.question_key === questionKey)?.categories
      .filter((c) => c.polarity === polarity).slice(0, limit)
      .map((c) => (c.insight_final ?? c.insight_draft).trim()).filter(Boolean) ?? [];
  return [
    { key: "values:functional", label: "기능적 가치" },
    { key: "values:aesthetic", label: "심미적 가치" },
    { key: "values:economic", label: "경제적 가치" },
    { key: "values:social", label: "사회·공공적 가치" },
  ].map((v) => ({
    가치명: v.label,
    긍정요지: requiredInsights(v.key, "positive", 2),
    개선요지: requiredInsights(v.key, "negative", 3),
  }));
}

/** 정량 통계 + (있으면) 저장된 섹션 텍스트를 결과 요약 프롬프트 입력으로 조립한다.
 * 사용자 경험 품질·교차 분석 행은 LLM이 만들지 않고 runResultSummary가 앞장 종합해석을
 * 그대로 붙이므로 여기 입력에서도 제외한다(원본 52쪽이 이 두 행만 앞장 종합해석 전문을
 * 그대로 옮기기 때문 — 압축하면 원본보다 내용이 크게 줄어든다). */
export function buildResultSummaryInput(
  quantStats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  productType: ProductType,
  sectionAnalyses?: SectionAnalyses | null,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  input["기능별_행_재료"] = buildFeatureRowMaterial(quantStats, qualitative);

  // 핵심구매요소 행: 원본 51쪽처럼 "N명 중 X%가 상위3(요인명(%))을 선택" 문장을 만들 재료.
  const n = quantStats.respondentCount;
  const sortedFactors = [...quantStats.keyFactorDistribution].sort((a, b) => b.percentage - a.percentage);
  input["핵심구매요소_재료"] = {
    응답자수: n,
    상위3: sortedFactors.slice(0, 3).map((k) => ({ 요인명: shortenFactorLabel(k.label), 명: Math.round((k.percentage / 100) * n), 비율: k.percentage })),
    상위3합계비율: Math.round(sortedFactors.slice(0, 3).reduce((s, k) => s + k.percentage, 0) * 10) / 10,
  };
  // 4대 가치 행: per-value 긍정/개선 요지(원본 순서 고정).
  input["4대가치_재료"] = buildFourValuesRowMaterial(quantStats, qualitative);

  // 원본 52쪽 [종합 만족도 개선 필요]의 "중립 고객(39%)"은 NPS passives(35%)가 아니라 종합만족도
  // 7~8점 구간 비율이다(원본 44쪽). 분포가 있으면 그 값을, 없으면(구버전) NPS passives로 대체한다.
  const dist = quantStats.overallSatisfactionDistribution;
  const distTotal = dist?.reduce((s, c) => s + c, 0) ?? 0;
  const 종합만족도중립구간비율 = dist && distTotal > 0
    ? Math.round(((dist[7] ?? 0) + (dist[8] ?? 0)) / distTotal * 100)
    : quantStats.nps.passivePct;
  input["NPS_수치"] = {
    종합만족도평균: quantStats.overallSatisfaction.mean.toFixed(2),
    종합만족도중립구간비율,
    NPS점수: quantStats.nps.npsScore,
    구매고객비율: quantStats.nps.promoterPct,
    중립고객비율: quantStats.nps.passivePct,
    비추천고객비율: quantStats.nps.detractorPct,
  };

  return input;
}

/** UX 품질 섹션 텍스트에서 "[종합 해석]" 블록만 뽑는다([세부 해석] 앞까지). 원본 52쪽 결과요약의
 * "사용자 경험 품질 평가" 행은 이 종합해석 전문을 그대로 옮긴다. */
function uxOverviewOnly(uxText: string): string {
  const detailIndex = uxText.indexOf("[세부 해석]");
  const overview = (detailIndex >= 0 ? uxText.slice(0, detailIndex) : uxText).trim();
  // 섹션 헤더가 배너로 이미 있으므로 "[종합 해석]" 라벨 줄은 뺀다.
  return overview.replace(/^\[종합 해석\]\s*/u, "").trim();
}

/** 교차분석 원문에서 연령대·성별의 "[종합 분석]" 부분만 뽑아 원본 52쪽 결과요약 형식
 * ("[연령대별 차이] … [성별에 따른 차이] …")으로 재조립한다. */
function crossSummaryOnly(crossText: string): string {
  const { age, gender } = splitCrossAnalysisText(crossText);
  const jonghap = (part: string): string => {
    const idx = part.indexOf("[종합 분석]");
    return idx >= 0 ? part.slice(idx + "[종합 분석]".length).trim() : "";
  };
  const ageJong = jonghap(age);
  const genderJong = jonghap(gender);
  const blocks: string[] = [];
  if (ageJong) blocks.push(`[연령대별 차이]\n${ageJong}`);
  if (genderJong) blocks.push(`[성별에 따른 차이]\n${genderJong}`);
  return blocks.join("\n\n");
}

/** sectionAnalyses가 아예 없을 때(구버전 캐시)만 쓰는 fallback 입력 — 예전 raw 조립 방식. */
function buildFallbackInput(
  quantStats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  productType: ProductType,
): Record<string, unknown> {
  const negativeInsights = (questionKey: string, limit = 3) =>
    qualitative.find((q) => q.question_key === questionKey)?.categories
      .filter((c) => c.polarity === "negative").slice(0, limit)
      .map((c) => c.insight_final ?? c.insight_draft) ?? [];
  const positiveInsights = (questionKey: string, limit = 2) =>
    qualitative.find((q) => q.question_key === questionKey)?.categories
      .filter((c) => c.polarity === "positive").slice(0, limit)
      .map((c) => c.insight_final ?? c.insight_draft) ?? [];

  const input: Record<string, unknown> = {
    "기능별 고객 경험 평가": quantStats.featureSatisfaction.map((f) => ({
      기능명: f.name,
      평균만족도: f.mean,
      상대중요도: quantStats.relativeImportance.find((r) => r.name === f.name)?.score ?? null,
      대표_부정_인사이트: negativeInsights(`feature:${f.name}`),
    })),
    "핵심구매요소": [...quantStats.keyFactorDistribution]
      .sort((a, b) => b.percentage - a.percentage)
      .map((k, i) => ({ 요인명: shortenFactorLabel(k.label), 순위: i + 1, 비율: k.percentage })),
    "4대 가치 만족도": [
      { key: "values:functional", label: "기능적 가치", stat: quantStats.fourValues.functional },
      { key: "values:aesthetic", label: "심미적 가치", stat: quantStats.fourValues.aesthetic },
      { key: "values:economic", label: "경제적 가치", stat: quantStats.fourValues.economic },
      { key: "values:social", label: "사회·공공적 가치", stat: quantStats.fourValues.social },
    ].map((v) => ({
      가치명: v.label, 평균: v.stat.mean,
      대표_긍정_인사이트: positiveInsights(v.key), 대표_부정_인사이트: negativeInsights(v.key),
    })),
  };
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
  sectionAnalyses?: SectionAnalyses | null;
  /** 마법사 1단계에서 사용자가 명시적으로 고른 값(reports.product_type). null/미지정이면
   * quantStats로 자동추정한다(레거시 report 호환). */
  productType?: ProductType | null;
  /** 재생성 실험·비용 추적용. 원본 대비 재생성 시 토큰/비용 기록에 쓴다(2026-07-30). */
  onUsage?: (usage: ClaudeUsageLike) => void;
}): Promise<string> {
  const productType = params.productType ?? detectProductType(params.quantStats);
  const hasSectionAnalyses = Boolean(
    params.sectionAnalyses && Object.values(params.sectionAnalyses).some((value) => typeof value === "string" && value.trim()),
  );
  const input = hasSectionAnalyses
    ? buildResultSummaryInput(params.quantStats, params.qualitative ?? [], productType, params.sectionAnalyses)
    : buildFallbackInput(params.quantStats, params.qualitative ?? [], productType);

  const result = await generateText({
    model: anthropic(SUMMARY_MODEL),
    system: hasSectionAnalyses ? SUMMARY_SYSTEM_PROMPT : FALLBACK_SYSTEM_PROMPT,
    prompt: JSON.stringify(input, null, 2),
    maxOutputTokens: 2000,
    reasoning: "none",
  });
  logClaudeUsage("result-summary", result.usage);
  if (result.usage) params.onUsage?.(result.usage);

  // 사용자 경험 품질·교차 분석 행은 LLM 압축 없이 앞장 종합해석을 그대로 붙인다(원본 52쪽 형식).
  // sectionAnalyses가 있을 때만 append하며, 없으면 fallback 프롬프트가 이미 전 항목을 생성한다.
  if (!hasSectionAnalyses || productType !== "sw") return result.text;
  const parts = [result.text.trim()];
  if (params.sectionAnalyses?.uxQuality) {
    parts.push(`## 사용자 경험 품질 평가\n${uxOverviewOnly(params.sectionAnalyses.uxQuality)}`);
  }
  if (params.sectionAnalyses?.crossAnalysis) {
    const cross = crossSummaryOnly(params.sectionAnalyses.crossAnalysis);
    if (cross) parts.push(`## 교차 분석\n${cross}`);
  }
  return parts.join("\n\n");
}
