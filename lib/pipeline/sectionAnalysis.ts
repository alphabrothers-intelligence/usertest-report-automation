// 섹션 단위 정성 분석 생성 (2026-07-29 신규) — 원본 보고서(리바랩스=SW형, 케어클=실제품형)의
// "종합 해석/결과 분석" 서술을 재현한다. 문항 단위 카테고리(Stage2 결과)가 아니라, 그 결과를
// 재료로 섹션 전체를 해석하는 상위 레이어다. PRD 6장 소속 프롬프트가 아니므로(신규 기능)
// "6장 프롬프트 불변" 원칙과 무관하다(extract.ts·polaritySummary.ts와 같은 예외 사유).
//
// 대상 섹션(원본 대조로 확정):
//  - featureExperience : Ⅲ.2 기능별 고객 경험 분석(SW형 전용 — 사분면 티어 서술)
//  - corePurchaseFactor: Ⅳ/Ⅴ 핵심구매요소 분석(제품형 공통)
//  - fourValues        : Ⅴ.2/Ⅵ 4대 가치 종합 해석(SW형 존댓말 3단락)
//  - uxQuality         : Ⅵ.2 사용자 경험 품질 분석(SW형 전용 — 케어클엔 이 섹션 자체가 없음)
//
// 공통 제약(사용자 확정): 주관적 판단·명령형("~해라", "~해야 함") 금지, 주관적 전망("~기대됨")
// 금지. 결론은 객관적 제언 뉘앙스("~것을 제언함/추천함", "~할 필요가 있음", "~이 요구됨",
// "~시급하다고 사료됨")로만. 정량 수치·정성 인사이트에 있는 내용만 사용(할루시네이션 금지).
import { anthropic } from "@ai-sdk/anthropic";
import pLimit from "p-limit";
import type { QuantStats } from "@/lib/quant/compute";
import {
  getReportById,
  getQuestionsWithAllCategories,
  saveReportSectionAnalyses,
  type CategoryRow,
  type QuestionWithApprovedCategories,
} from "@/lib/db/reports";
import { detectProductType, type ProductType } from "@/lib/report/productType";
import { decodeImprovementLabel } from "./stage2";
import { streamPlainText, withClaudeGuard } from "./claudeGuard";
import type { ClaudeUsageRecord } from "@/lib/claudeUsage";
import {
  FEATURE_SYSTEM,
  buildCorePurchaseSystemPrompt,
  FOUR_VALUES_SYSTEM,
  FOUR_VALUE_ITEM_SYSTEM,
  UX_QUALITY_SYSTEM,
  CROSS_ANALYSIS_SYSTEM,
} from "./prompts";

const MODEL = process.env.ANTHROPIC_SECTION_ANALYSIS_MODEL ?? "claude-sonnet-5";

export interface SectionAnalyses {
  featureExperience?: string;
  corePurchaseFactor?: string;
  fourValues?: string;
  /** "[기능적 가치]\n{문단}\n[심미적 가치]\n..." 형식 원문 — parseFourValueItemTexts로 나눠 쓴다. */
  fourValueItems?: string;
  uxQuality?: string;
  /** Ⅶ 교차분석(연령대별/성별) 텍스트 해석. "===GENDER===" 구분자로 두 부분을 이어붙인
   * 원문을 그대로 저장한다 — 렌더링 시 splitCrossAnalysisText()로 나눠 각자의 배너 아래 배치한다. */
  crossAnalysis?: string;
}

export type SectionAnalysisKey = keyof SectionAnalyses;

export interface SectionAnalysisRunHooks {
  onSectionStart?: (key: SectionAnalysisKey) => void | Promise<void>;
  onSectionComplete?: (key: SectionAnalysisKey) => void | Promise<void>;
  onSectionError?: (key: SectionAnalysisKey, error: unknown) => void | Promise<void>;
}

// ── 보고서 본문용 중요도 그룹 ────────────────────────────────────────────────
// 원본 리바랩스 Ⅲ.2는 사분면 색상 규칙이 아니라, 상대 중요도 순위 1·2위 / 3·4위 /
// 5·6위를 각각 우선·차우선·비우선으로 묶는다. 기능 수가 달라져도 높은 순서대로
// 세 그룹을 가능한 고르게 나눠, 웹 사분면의 색상 분류와 본문 서술을 혼동하지 않는다.
function classifyPriorityByRank(rank: number, total: number): "우선 개선" | "차우선 개발" | "비우선 개발" {
  const firstGroupSize = Math.ceil(total / 3);
  const secondGroupSize = Math.ceil((total - firstGroupSize) / 2);
  if (rank <= firstGroupSize) return "우선 개선";
  if (rank <= firstGroupSize + secondGroupSize) return "차우선 개발";
  return "비우선 개발";
}

interface RankedInsightEvidence {
  category: string;
  insight: string;
  clauseCount: number;
}

interface RepeatedComplaintEvidence extends RankedInsightEvidence {
  questionCount: number;
  questionLabels: string[];
}

function insightText(category: CategoryRow): string {
  return (category.insight_final ?? category.insight_draft).trim();
}

/** Stage2 카테고리는 생성 순서가 빈도순이라는 보장이 없으므로 절 수를 명시적으로 우선한다. */
function rankCategoryEvidence(categories: CategoryRow[], limit: number): RankedInsightEvidence[] {
  return categories
    .filter((category) => insightText(category).length > 0)
    .sort((a, b) =>
      (b.clause_count ?? 0) - (a.clause_count ?? 0)
      || a.label.localeCompare(b.label, "ko"))
    .slice(0, limit)
    .map((category) => ({
      category: category.label,
      insight: insightText(category),
      clauseCount: category.clause_count ?? 0,
    }));
}

function negativeInsights(
  qual: QuestionWithApprovedCategories[],
  keyIncludes: string,
  limit = 3,
): RankedInsightEvidence[] {
  const question = qual.find(
    (item) => item.question_key.startsWith("feature:") && item.label.includes(keyIncludes),
  );
  return rankCategoryEvidence(
    question?.categories.filter((category) => category.polarity === "negative") ?? [],
    limit,
  );
}

function insightsFor(
  qual: QuestionWithApprovedCategories[],
  questionKey: string,
  polarity: "positive" | "negative",
  limit = 3,
): RankedInsightEvidence[] {
  const question = qual.find((item) => item.question_key === questionKey);
  return rankCategoryEvidence(
    question?.categories.filter((category) => category.polarity === polarity) ?? [],
    limit,
  );
}

function complaintKey(label: string): string {
  return label
    .normalize("NFKC")
    .toLocaleLowerCase("ko")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * 개선 아이디어 + 기능 부정 카테고리를 실제 절 수 기준으로 집계한다.
 * 서로 다른 라벨을 임의로 같은 주제로 합치지 않으며, 동일 라벨만 보수적으로 병합한다.
 * 모델에는 절 수와 등장 문항 수를 함께 주어 "반복/다수" 표현의 근거를 제한한다.
 */
function repeatedComplaints(
  qual: QuestionWithApprovedCategories[],
  limit = 6,
): RepeatedComplaintEvidence[] {
  const sources = qual.flatMap((question) => {
    const categories = question.question_key.startsWith("improvement")
      ? question.categories
      : question.question_key.startsWith("feature:")
        ? question.categories.filter((category) => category.polarity === "negative")
        : [];
    return categories.map((category) => ({ question, category }));
  });

  const grouped = new Map<string, {
    label: string;
    insight: string;
    clauseCount: number;
    questionLabels: Set<string>;
  }>();
  for (const { question, category } of sources) {
    // 개선 아이디어 카테고리는 label이 "대분류소분류"로 인코딩되고 insight가 없다(2단 구조,
    // 2026-07-30). 소분류명을 불만 라벨로, 대표 인용을 근거 텍스트로 쓴다.
    const isImprovement = question.question_key.startsWith("improvement");
    const complaintLabel = isImprovement ? decodeImprovementLabel(category.label).sub : category.label;
    const insight = isImprovement
      ? (category.quotes[0] ?? complaintLabel)
      : insightText(category);
    if (!insight) continue;
    const key = complaintKey(complaintLabel);
    if (!key) continue;
    const previous = grouped.get(key);
    if (previous) {
      previous.clauseCount += category.clause_count ?? 0;
      previous.questionLabels.add(question.label);
      if (insight.length > previous.insight.length) previous.insight = insight;
    } else {
      grouped.set(key, {
        label: complaintLabel,
        insight,
        clauseCount: category.clause_count ?? 0,
        questionLabels: new Set([question.label]),
      });
    }
  }

  return [...grouped.values()]
    .sort((a, b) =>
      b.clauseCount - a.clauseCount
      || b.questionLabels.size - a.questionLabels.size
      || a.label.localeCompare(b.label, "ko"))
    .slice(0, limit)
    .map((item) => ({
      category: item.label,
      insight: item.insight,
      clauseCount: item.clauseCount,
      questionCount: item.questionLabels.size,
      questionLabels: [...item.questionLabels],
    }));
}

// ── 원본 표현어 계산(2026-07-30 원본 29·51쪽 대조로 확정, 2026-08-03 만족도 표현어를
// 절대 점수 구간에서 순위 기반으로 교체) ──────────────────────────────────────
// 원본 Ⅲ.2는 상대중요도·만족도 둘 다 그 raw data 안에서의 상대적 위치로 표현어를 고른다.
// **처음엔 만족도 표현어를 리바랩스의 실제 점수 구간(6.6/6.2/5.9/7.0)에 맞춘 절대 임계값으로
// 구현했는데, 이러면 리바랩스와 점수 분포가 다른 raw data(예: 전체 평균이 8점대이거나 4점대인
// 서비스)에 그대로 적용했을 때 전부 "가장 낮은"이나 "높은"으로 쏠려 잘못된 표현어가 나온다 —
// 다른 raw data 실험 전 발견해 순위 기반으로 일반화했다.** 리바랩스 6개 기능의 만족도 순위
// (꾸미기7.20>성장6.81>산책6.35=거점형6.35>레이싱6.04>교배5.85)에 이 함수를 적용하면 여전히
// 원본 문구(꾸미기="높은", 성장="보통의", 산책/거점형="중하위", 레이싱="낮은", 교배="가장 낮은")와
// 정확히 일치한다 — 우연이 아니라 원본 표현어 자체가 순위 기반이었다는 뜻이다.
function importanceLabel5(rank: number, total: number): string {
  if (rank === 1) return "가장 높은";
  if (rank === 2) return "다소 높은";
  if (rank === total) return "가장 낮은";
  if (rank === total - 1) return "낮은";
  return "보통의";
}
function satisfactionLabel5(rank: number, total: number): string {
  if (rank === 1) return "높은";
  if (rank === 2) return "보통의";
  if (rank === total) return "가장 낮은";
  if (rank === total - 1) return "낮은";
  return "중하위";
}
/** 상대중요도는 항상 부호를 붙여 표기한다(원본: +2.96, -2.55). U+2212 대신 ASCII '-'를 쓴다. */
function signedScore(score: number): string {
  return `${score >= 0 ? "+" : "-"}${Math.abs(score).toFixed(2)}`;
}

/** keyFactorDistribution 라벨의 raw 괄호 설명을 뗀다(원본은 짧은 라벨만 씀 — 예: "성취 및
 * 보상 요소 (걸음 수 보상, 미션 보상 등)" → "성취 및 보상 요소"). lib/pdf/sectionsQuant.tsx의
 * shortenLabel과 같은 규칙이지만, pipeline이 pdf 렌더 모듈을 의존하지 않도록 여기 따로 둔다. */
export function shortenFactorLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// ── 내부 집계 수치 노출 차단(2026-07-30) ─────────────────────────────────────
// repeatedComplaints/rankCategoryEvidence는 clause_count·question_count를 갖는데, 이 필드명·수치가
// 본문에 그대로 새어 나오는 버그가 있었다("…재화·가격 부담(clauseCount 30)…"). 프롬프트에 넘기기
// 전에 raw 수치를 버리고, 빈도만 서술 라벨로 남겨 "반복/다수" 표현의 근거로만 쓰이게 한다.
function complaintMaterial(items: RepeatedComplaintEvidence[]): { 항목: string; 대표언급: string; 빈도: string }[] {
  return items.map((it) => ({
    항목: it.category,
    대표언급: it.insight,
    빈도: it.clauseCount >= 2 && it.questionCount >= 2 ? "여러 문항에서 반복 확인"
      : it.clauseCount >= 2 ? "반복 확인" : "확인",
  }));
}
function insightMaterial(items: RankedInsightEvidence[]): { 항목: string; 요지: string }[] {
  return items.map((it) => ({ 항목: it.category, 요지: it.insight }));
}

async function generate(
  label: string,
  system: string,
  input: unknown,
  maxOutputTokens: number,
  onUsage?: (usage: ClaudeUsageRecord) => void,
): Promise<string> {
  // 기존 Stage1·Stage2와 같은 스트리밍 가드를 사용한다. 이 신규 레이어가 비스트리밍
  // 호출로 다시 HTTP hang을 만들지 않도록 하며, 문단형 결과는 구조화 스키마 대신 text로 받는다.
  const { text } = await withClaudeGuard(`section-analysis:${label}`, () => streamPlainText({
    model: anthropic(MODEL),
    instructions: {
      role: "system",
      content: system,
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
    },
    prompt: JSON.stringify(input, null, 2),
    maxOutputTokens,
    reasoning: "none",
    // 장문이 아닌 4개 종합 해석은 2분 안에 결과 또는 실패가 확정돼야 다음 단계를 막지 않는다.
    hardTimeoutMs: 120_000,
  }, `section-analysis:${label}`), { onUsage });
  return normalizeSectionText(text);
}

/**
 * 섹션 제목은 웹/PDF 템플릿이 이미 그린다(배너 박스). 모델이 제목을 한 번 더 되풀이하면 원본의
 * 표·헤더 리듬이 깨지므로, 생성 결과의 맨 앞에 붙는 장 제목 줄을 제거한다. 내부 구조 마커
 * ([종합 해석], ▶, -, •, →로 시작하는 줄)가 아닌 첫 줄은 전부 "제목 되풀이"로 간주해 잘라낸다 —
 * 모델이 어떤 문구로 제목을 다시 쓰든(예: "기능별 중요 순위 및 만족도 종합 해석") 안전하게 걸러진다.
 */
function normalizeSectionText(text: string): string {
  let result = text.trim().replace(/^#{1,3}\s+/gmu, "").trim();
  const structureMarker = /^(\[[^\]]+\]|▶|[-•]\s|→)/u;
  while (result && !structureMarker.test(result)) {
    const newlineIndex = result.indexOf("\n");
    if (newlineIndex < 0) break; // 구조 마커 없이 한 줄만 있으면(짧은 응답) 그대로 둔다.
    result = result.slice(newlineIndex + 1).trim();
  }
  return result;
}

interface CrossAnalysisGroupInput {
  그룹: string;
  n: number;
  기능만족도: { name: string; mean: number }[];
  사대가치: { functional: number; aesthetic: number; economic: number; social: number };
  UX품질: { usability: { name: string; mean: number }[]; fun: { name: string; mean: number }[] };
}

export async function runCrossAnalysisText(stats: QuantStats, onUsage?: (usage: ClaudeUsageRecord) => void): Promise<string> {
  const toGroupInput = (g: QuantStats["crossAnalysis"]["byAgeGroup"][number]): CrossAnalysisGroupInput => ({
    그룹: g.group,
    n: g.n,
    기능만족도: g.featureSatisfaction,
    사대가치: g.fourValues,
    UX품질: g.uxQuality,
  });
  return generate("cross-analysis", CROSS_ANALYSIS_SYSTEM, {
    연령대그룹: stats.crossAnalysis.byAgeGroup.map(toGroupInput),
    성별그룹: stats.crossAnalysis.byGender.map(toGroupInput),
  }, 2200, onUsage);
}

/** 저장된 crossAnalysis 원문("===GENDER===" 구분자 포함)을 연령대/성별 두 부분으로 나눈다.
 * 각 부분은 기존 "연령대별 차이"/"연령에 따른 차이(성별)" 차트 배너 바로 아래 배치한다. */
export function splitCrossAnalysisText(text: string | undefined): { age: string; gender: string } {
  if (!text) return { age: "", gender: "" };
  const [age, gender] = text.split(/\n?===GENDER===\n?/);
  return { age: (age ?? "").trim(), gender: (gender ?? "").trim() };
}

// ── 개별 생성 함수 ───────────────────────────────────────────────────────────
export async function runFeatureExperienceAnalysis(stats: QuantStats, qual: QuestionWithApprovedCategories[], onUsage?: (usage: ClaudeUsageRecord) => void): Promise<string> {
  const byImportance = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const total = byImportance.length;
  // 만족도 표현어도 순위 기반이라, raw data 전체의 만족도 순위를 먼저 계산해둔다(상대중요도
  // 순서와는 별개 — 같은 기능이라도 중요도 순위와 만족도 순위는 다를 수 있다).
  const bySatisfaction = [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean);
  const satisfactionRank = new Map(bySatisfaction.map((f, i) => [f.name, i + 1]));
  const 기능 = byImportance.map((imp, index) => {
    const mean = stats.featureSatisfaction.find((f) => f.name === imp.name)?.mean ?? 0;
    return {
      기능명: imp.name,
      중요도표현: importanceLabel5(index + 1, total),
      상대중요도표시: signedScore(imp.score),
      만족도표현: satisfactionLabel5(satisfactionRank.get(imp.name) ?? index + 1, total),
      만족도: mean.toFixed(2),
      tier: classifyPriorityByRank(index + 1, total),
      부정요지: insightMaterial(negativeInsights(qual, imp.name)),
    };
  });
  return generate("feature-experience", FEATURE_SYSTEM, { 기능, 반복_불만: complaintMaterial(repeatedComplaints(qual)) }, 2600, onUsage);
}

export async function runCorePurchaseFactorAnalysis(stats: QuantStats, qual: QuestionWithApprovedCategories[], productType: ProductType, onUsage?: (usage: ClaudeUsageRecord) => void): Promise<string> {
  const n = stats.respondentCount;
  const sorted = [...stats.keyFactorDistribution].sort((a, b) => b.percentage - a.percentage);
  const 요인 = sorted.map((k, i) => ({ 요인명: shortenFactorLabel(k.label), 순위: i + 1, 응답자수: Math.round((k.percentage / 100) * n), 비율: k.percentage }));
  const 상위3합계 = sorted.slice(0, 3).reduce((s, k) => s + k.percentage, 0);
  return generate("core-purchase-factor", buildCorePurchaseSystemPrompt(productType), {
    응답자수: n,
    요인,
    상위3합계비율: Math.round(상위3합계 * 10) / 10,
    순위구성비: productType === "physical" ? stats.rankPositionComposition : undefined,
    반복_주관_불만: complaintMaterial(repeatedComplaints(qual)),
  }, 2200, onUsage);
}

export async function runFourValuesAnalysis(stats: QuantStats, qual: QuestionWithApprovedCategories[], onUsage?: (usage: ClaudeUsageRecord) => void): Promise<string> {
  const 가치 = [
    { key: "values:functional", label: "기능적 가치", stat: stats.fourValues.functional },
    { key: "values:aesthetic", label: "심미적 가치", stat: stats.fourValues.aesthetic },
    { key: "values:economic", label: "경제적 가치", stat: stats.fourValues.economic },
    { key: "values:social", label: "사회·공공적 가치", stat: stats.fourValues.social },
  ].map((v) => ({
    가치명: v.label,
    평균: v.stat.mean.toFixed(2),
    긍정요지: insightMaterial(insightsFor(qual, v.key, "positive")),
    개선요지: insightMaterial(insightsFor(qual, v.key, "negative")),
  }));
  return generate("four-values", FOUR_VALUES_SYSTEM, { 가치 }, 1800, onUsage);
}

/** 가치명 → 한 문단 텍스트. 파싱 실패(모델이 형식을 안 지킴)를 대비해 못 찾은 가치는 빈 문자열. */
export function parseFourValueItemTexts(text: string): Record<string, string> {
  const labels = ["기능적 가치", "심미적 가치", "경제적 가치", "사회·공공적 가치"] as const;
  const result = { "기능적 가치": "", "심미적 가치": "", "경제적 가치": "", "사회·공공적 가치": "" };
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const match = text.match(new RegExp(`\\[${label.replace("·", "\\·")}\\]([\\s\\S]*?)(?=\\n\\s*\\[|$)`));
    if (match) result[label] = match[1].trim();
  }
  return result;
}

/** 원문(raw, "[가치명]\n문단" 구분자 포함)을 반환한다 — DB에는 이 형태로 저장하고,
 * 렌더링 시 parseFourValueItemTexts로 나눠 쓴다(다른 SectionAnalyses 필드와 같은 패턴). */
export async function runFourValueItemAnalysis(stats: QuantStats, qual: QuestionWithApprovedCategories[], onUsage?: (usage: ClaudeUsageRecord) => void): Promise<string> {
  const 가치 = [
    { key: "values:functional", label: "기능적 가치" },
    { key: "values:aesthetic", label: "심미적 가치" },
    { key: "values:economic", label: "경제적 가치" },
    { key: "values:social", label: "사회·공공적 가치" },
  ].map((v) => ({
    가치명: v.label,
    긍정요지: insightMaterial(insightsFor(qual, v.key, "positive")),
    개선요지: insightMaterial(insightsFor(qual, v.key, "negative")),
  }));
  return generate("four-values-item", FOUR_VALUE_ITEM_SYSTEM, { 가치 }, 1800, onUsage);
}

export async function runUxQualityAnalysis(stats: QuantStats, qual: QuestionWithApprovedCategories[], onUsage?: (usage: ClaudeUsageRecord) => void): Promise<string> {
  const usabilityRaw = stats.uxQuality.usability.map((u) => u.mean);
  const funRaw = stats.uxQuality.fun.map((u) => u.mean);
  const avg = (arr: number[]) => (arr.reduce((s, x) => s + x, 0) / (arr.length || 1)).toFixed(2);
  const usability = stats.uxQuality.usability.map((u) => ({ 항목: u.name, 점수: u.mean.toFixed(2) }));
  const fun = stats.uxQuality.fun.map((u) => ({ 항목: u.name, 점수: u.mean.toFixed(2) }));
  return generate("ux-quality", UX_QUALITY_SYSTEM, {
    실용성: usability, 실용성평균: avg(usabilityRaw),
    즐거움: fun, 즐거움평균: avg(funRaw),
    조작_UI_불만: complaintMaterial(repeatedComplaints(qual)),
  }, 2200, onUsage);
}

// ── 리포트 단위 오케스트레이터 ──────────────────────────────────────────────
/** 이미 저장된 정량 통계 + 정성 카테고리를 재료로 섹션 분석 전체를 생성·저장한다.
 * 제품형에 따라 대상 섹션이 달라진다(실제품형엔 UX 품질·4대가치 종합·기능 티어 분석이 없음).
 * 각 섹션 생성은 독립적으로 try/catch — 하나가 실패해도 나머지는 저장된다. */
export async function runSectionAnalysesForReport(
  reportId: string,
  options: {
    concurrency?: number;
    onUsage?: (usage: ClaudeUsageRecord) => void;
    /** 비용을 아끼는 재검증용. 비우면 제품형에 필요한 전체 섹션을 생성한다. */
    sections?: SectionAnalysisKey[];
  } & SectionAnalysisRunHooks = {},
): Promise<SectionAnalyses> {
  const report = await getReportById(reportId);
  if (!report?.quant_stats) throw new Error("정량 통계가 없어 섹션 분석을 생성할 수 없습니다.");
  const stats = report.quant_stats;
  const qual = await getQuestionsWithAllCategories(reportId);
  const productType = report.product_type ?? detectProductType(stats);

  const analyses: SectionAnalyses = {};
  const tasks: { key: keyof SectionAnalyses; run: () => Promise<string> }[] = [
    { key: "corePurchaseFactor", run: () => runCorePurchaseFactorAnalysis(stats, qual, productType, options.onUsage) },
  ];
  // SW형 전용 섹션(케어클 원본엔 없음).
  if (productType === "sw") {
    tasks.push(
      { key: "featureExperience", run: () => runFeatureExperienceAnalysis(stats, qual, options.onUsage) },
      { key: "fourValues", run: () => runFourValuesAnalysis(stats, qual, options.onUsage) },
      { key: "fourValueItems", run: () => runFourValueItemAnalysis(stats, qual, options.onUsage) },
      { key: "uxQuality", run: () => runUxQualityAnalysis(stats, qual, options.onUsage) },
      { key: "crossAnalysis", run: () => runCrossAnalysisText(stats, options.onUsage) },
    );
  }

  const selected = options.sections?.length
    ? new Set(options.sections)
    : null;
  const selectedTasks = selected
    ? tasks.filter(({ key }) => selected.has(key))
    : tasks;
  if (selectedTasks.length === 0) {
    throw new Error("선택한 섹션이 현재 보고서 유형에 존재하지 않습니다.");
  }

  // 4개 분석은 최종 정성 분석 흐름의 일부지만, 한꺼번에 4개를 보내 API 연결/레이트리밋
  // 위험을 키우지 않는다. 두 개씩만 실행해 기존 Stage1·Stage2와 독립적으로 안정성을 검증한다.
  const concurrency = Math.min(2, Math.max(1, options.concurrency ?? 2));
  const limit = pLimit(concurrency);
  await Promise.all(
    selectedTasks.map(({ key, run }) => limit(async () => {
      try {
        await options.onSectionStart?.(key);
        const text = await run();
        if (text) analyses[key] = text;
        await options.onSectionComplete?.(key);
      } catch (err) {
        console.error(`[sectionAnalysis] ${key} 실패:`, err);
        try {
          await options.onSectionError?.(key, err);
        } catch (hookError) {
          console.error(`[sectionAnalysis] ${key} 실패 이력 저장 실패:`, hookError);
        }
      }
    })),
  );

  await saveReportSectionAnalyses(reportId, analyses);
  return analyses;
}
