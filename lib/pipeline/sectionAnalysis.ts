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
  type QuestionWithApprovedCategories,
} from "@/lib/db/reports";
import { detectProductType, type ProductType } from "@/lib/report/productType";
import { streamPlainText, withClaudeGuard } from "./claudeGuard";
import type { ClaudeUsageRecord } from "@/lib/claudeUsage";

const MODEL = process.env.ANTHROPIC_SECTION_ANALYSIS_MODEL ?? "claude-sonnet-5";

export interface SectionAnalyses {
  featureExperience?: string;
  corePurchaseFactor?: string;
  fourValues?: string;
  uxQuality?: string;
}

export type SectionAnalysisKey = keyof SectionAnalyses;

export interface SectionAnalysisRunHooks {
  onSectionStart?: (key: SectionAnalysisKey) => void | Promise<void>;
  onSectionComplete?: (key: SectionAnalysisKey) => void | Promise<void>;
  onSectionError?: (key: SectionAnalysisKey, error: unknown) => void | Promise<void>;
}

// ── 공통 제언 뉘앙스 규칙(모든 프롬프트에 삽입) ───────────────────────────────
const NUANCE_RULES = `# 제언 뉘앙스 (절대 규칙)
- 제공된 정량 수치·정성 인사이트에 있는 내용만 쓴다. 새 사실·수치·원인을 지어내지 않는다.
- 결론·권고는 객관적 제언 뉘앙스로만 끝낸다: "~것을 제언함", "~것을 추천함", "~할 필요가 있음",
  "~이 요구됨", "~시급하다고 사료됨".
- 명령형("~하라", "~해야 한다")과 주관적 단정·전망("반드시 필요하다", "~기대됨", "~것으로 보임")을
  절대 쓰지 않는다.
- 수치는 제공된 값을 토씨 그대로 인용한다.
- 보고서의 장 제목(예: "Ⅲ장 기능별 고객 경험 분석", "Ⅵ. 사용자 경험 품질 평가 결과 분석")은 이미
  화면에 있으므로 다시 출력하지 않는다. 구조에 지정된 내부 소제목([종합 해석], ▶…, 세부 해석 등)과
  본문만 작성한다.`;

// ── 티어 분류(사분면 우선순위) — 규칙 기반. workspace.ts의 classifyPriority와 동일 공식.
function classifyPriority(importance: number, satisfaction: number): "우선 개선" | "차우선 개발" | "비우선 개발" {
  const col = importance < -2 ? 0 : importance < 2 ? 1 : 2;
  const row = satisfaction >= 8 ? 0 : satisfaction >= 6 ? 1 : 2;
  const score = col + row - 2;
  return score >= 1 ? "우선 개선" : score === 0 ? "차우선 개발" : "비우선 개발";
}

function negativeInsights(qual: QuestionWithApprovedCategories[], keyIncludes: string, limit = 3): string[] {
  return qual
    .find((q) => q.question_key.startsWith("feature:") && q.label.includes(keyIncludes))
    ?.categories.filter((c) => c.polarity === "negative")
    .slice(0, limit)
    .map((c) => `${c.label}: ${c.insight_final ?? c.insight_draft}`) ?? [];
}

function insightsFor(qual: QuestionWithApprovedCategories[], questionKey: string, polarity: "positive" | "negative", limit = 3): string[] {
  return qual
    .find((q) => q.question_key === questionKey)
    ?.categories.filter((c) => c.polarity === polarity)
    .slice(0, limit)
    .map((c) => `${c.label}: ${c.insight_final ?? c.insight_draft}`) ?? [];
}

/** 개선아이디어(58번 컬럼) + 전 기능 부정 인사이트를 "반복 언급된 불만" 근거로 모은다. */
function repeatedComplaints(qual: QuestionWithApprovedCategories[], limit = 6): string[] {
  const improvement = qual
    .filter((q) => q.question_key.startsWith("improvement"))
    .flatMap((q) => q.categories.map((c) => `${c.label}: ${c.insight_final ?? c.insight_draft}`));
  const featureNeg = qual
    .filter((q) => q.question_key.startsWith("feature:"))
    .flatMap((q) => q.categories.filter((c) => c.polarity === "negative").map((c) => `${c.label}: ${c.insight_final ?? c.insight_draft}`));
  return [...improvement, ...featureNeg].slice(0, limit);
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
 * 섹션 제목은 웹/PDF 템플릿이 이미 그린다. 모델이 제목을 한 번 더 되풀이하면 원본의
 * 표·헤더 리듬이 깨지므로, 생성 결과의 맨 앞 장 제목만 제거한다. 내부 소제목([종합 해석] 등)은 유지한다.
 */
function normalizeSectionText(text: string): string {
  return text
    .trim()
    .replace(/^(?:#{1,3}\s*)?(?:Ⅲ장?\.?\s*기능별 고객 경험 분석|Ⅳ\.?\s*핵심구매요소(?:\s*분석)?|Ⅴ\.?\s*4대 가치(?:\s*만족도)?(?:\s*조사 결과 분석)?|Ⅵ\.?\s*사용자 경험 품질 평가(?:\s*결과 분석)?|핵심구매요소 중요 순위 및 만족도 종합 해석)\s*\n+/u, "")
    .trim();
}

// ── Ⅲ.2 기능별 고객 경험 분석 (SW형) ─────────────────────────────────────────
const FEATURE_SYSTEM = `당신은 사용성테스트 결과보고서 Ⅲ장 "기능별 고객 경험 분석"의 "기능별 중요 순위 및 만족도 종합 해석"을 작성합니다.
입력은 기능별 상대중요도·만족도(정량)와 각 기능의 부정 카테고리 인사이트(정성), 반복 언급된 불만입니다.

# 구조 (원본과 동일)
1) [종합 해석]: 개조식 불릿 3~5개. 만족도·중요도가 대비되는 기능(가장 높은/낮은), 중요도-만족도
   gap이 큰 기능, 반복 언급된 버그·오류 등 공통 불만을 짚는다. 도출되는 함의·제언은 앞에 "→"를
   붙여 하위 줄로 쓴다.
2) 우선순위 티어별 서술: 입력의 tier 값("우선 개선"/"차우선 개발"/"비우선 개발")대로 묶어
   "▶ {tier} 기능" 소제목 아래, 각 기능을 "'기능명' 기능의 경우 상대 중요도(부호포함 수치)와
   만족도(수치)를 가짐." 형태로 쓰고, 그 아래 "→ 해석"과 "→ (부정 인사이트 기반) 니즈 확인"을
   붙인다. 부정 인사이트가 없으면 니즈 줄은 생략한다.

# 문체
- 개조식 명사형 종결(~함/~짐/~가짐/~확인/~필요/~시급). 핵심 표현·수치에만 **굵게**.
- 제공 수치만으로 직접 비교되는 경우에만 "가장 높음/낮음"을 쓴다. 중요도와 만족도의 관계를
  원인·결과 또는 "가장 큰 gap"으로 단정하지 않는다.
- "다수", "반복" 등 빈도 표현은 입력에 반복_불만 근거가 있을 때만 쓴다.
${NUANCE_RULES}`;

// ── Ⅳ 핵심구매요소 분석 (제품형 공통) ────────────────────────────────────────
function corePurchaseSystem(productType: ProductType): string {
  const axis = productType === "physical"
    ? "- 실물 제품형: 상위 요인은 '핵심 구매 결정 요인', 나머지는 '보조 요인'/'기본 신뢰 요건'으로 역할을 구분해 서술한다. 순위 구성비(상위 3~4위 비중)를 근거로 쓴다."
    : "- 소프트웨어형: 상위 3개 요인의 합산 비중과 각 요인의 역할(동기·첫인상·기본 신뢰 등)을 서술하고, 마지막에 주관식 반복 불만을 근거로 우선 개선 방향을 제언 뉘앙스로 종합한다.";
  return `당신은 사용성테스트 결과보고서의 "핵심구매요소 중요 순위 및 만족도 종합 해석"을 작성합니다.
입력은 핵심구매요소의 순위·비율(정량)과 반복 언급된 주관식 불만(정성)입니다.

# 구조 (원본과 동일)
- 개조식 불릿. 1위 요인(비율)을 '가장 중요한 구매 결정 요인'으로 서술하고 그 근거·함의를 "→"로 붙인다.
- 중위권/하위권 요인은 역할(보조·기본 요건 등)로 해석한다.
${axis}

# 문체
- 개조식 명사형 종결(~선정됨/~시사함/~해석 가능함/~나타남/~판단됨). 핵심 표현·수치에만 **굵게**.
${NUANCE_RULES}`;
}

// ── Ⅴ.2 4대 가치 종합 해석 (SW형 존댓말 3단락) ───────────────────────────────
const FOUR_VALUES_SYSTEM = `당신은 사용성테스트 결과보고서의 "4대 가치 만족도 종합 해석"을 작성합니다.
입력은 4대 가치(기능적·심미적·경제적·사회공공적)의 평균 점수와 각 가치의 긍정·개선 요지(정성)입니다.

# 구조 (원본과 동일, 존댓말 세 단락)
- 1단락: 네 가치를 아우른 전반적 긍정 평가 요지를 종합한다.
- 2단락: 가치별 핵심 개선 과제를 "가치명(괄호 안 요지)" 형태로 나열한다.
- 3단락: "따라서 본 서비스는 … 을 통해 … 할 필요가 있습니다."로 마무리한다.

# 문체
- 존댓말 "~습니다" 종결. 각 단락은 빈 줄로 구분. 핵심 표현에만 **굵게**.
- 각 단락은 최대 4문장, 전체는 600자 이내로 작성합니다. 같은 사실을 문장만 바꾸어 반복하지 않습니다.
- 입력의 긍정·개선 요지를 넘어 원인을 추정하거나 효과를 전망하지 않습니다.
${NUANCE_RULES}`;

// ── Ⅵ.2 사용자 경험 품질 분석 (SW형 전용) ────────────────────────────────────
const UX_QUALITY_SYSTEM = `당신은 사용성테스트 결과보고서 Ⅵ장 "사용자 경험 품질 평가 결과 분석"을 작성합니다.
입력은 실용성·즐거움 항목별 점수와 평균(정량), 조작·UI 관련 반복 불만(정성)입니다.

# 구조 (원본과 동일, 두 블록)
1) [종합 해석]: 강점·약점을 한 문장으로 요약한 뒤, "실용성(평균 X)"·"즐거움(평균 Y)" 각각의 최고/최저
   항목을 짚는다. 마지막에 "→ 종합적으로, "…"" 형태로 한 줄 평가로 정리한다.
2) [세부 해석]: 실용성/즐거움 각 항목을 "항목명 (점수): 한 문장 해석"으로 쓰고, 각 블록 끝에
   "→ (조작·독창성 등) 개선 방향"을 붙인다. 개선 방향은 정성 불만에 근거가 있을 때만 구체화한다.

# 문체
- 개조식과 "~습니다"를 원본처럼 혼용하되, 제언은 제언 뉘앙스로 끝낸다. 핵심 표현·수치에만 **굵게**.
- 점수와 정성 불만은 함께 확인된 사실로만 서술합니다. "원인", "기인", "가능성이 높음"처럼
  인과관계·추정을 표현하지 않습니다.
- [종합 해석]은 4문장 이내, [세부 해석]의 항목별 설명은 각각 한 문장으로 제한합니다.
${NUANCE_RULES}`;

// ── 개별 생성 함수 ───────────────────────────────────────────────────────────
export async function runFeatureExperienceAnalysis(stats: QuantStats, qual: QuestionWithApprovedCategories[], onUsage?: (usage: ClaudeUsageRecord) => void): Promise<string> {
  const byImportance = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const 기능 = byImportance.map((imp) => {
    const mean = stats.featureSatisfaction.find((f) => f.name === imp.name)?.mean ?? 0;
    return {
      기능명: imp.name,
      상대중요도: imp.score,
      만족도: mean,
      tier: classifyPriority(imp.score, mean),
      부정인사이트: negativeInsights(qual, imp.name),
    };
  });
  return generate("feature-experience", FEATURE_SYSTEM, { 기능, 반복_불만: repeatedComplaints(qual) }, 2600, onUsage);
}

export async function runCorePurchaseFactorAnalysis(stats: QuantStats, qual: QuestionWithApprovedCategories[], productType: ProductType, onUsage?: (usage: ClaudeUsageRecord) => void): Promise<string> {
  const sorted = [...stats.keyFactorDistribution].sort((a, b) => b.percentage - a.percentage);
  const 요인 = sorted.map((k, i) => ({ 요인명: k.label, 순위: i + 1, 비율: k.percentage }));
  const 상위3합계 = sorted.slice(0, 3).reduce((s, k) => s + k.percentage, 0);
  return generate("core-purchase-factor", corePurchaseSystem(productType), {
    요인,
    상위3합계비율: Math.round(상위3합계 * 10) / 10,
    순위구성비: productType === "physical" ? stats.rankPositionComposition : undefined,
    반복_주관_불만: repeatedComplaints(qual),
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
    평균: v.stat.mean,
    긍정요지: insightsFor(qual, v.key, "positive"),
    개선요지: insightsFor(qual, v.key, "negative"),
  }));
  return generate("four-values", FOUR_VALUES_SYSTEM, { 가치 }, 1800, onUsage);
}

export async function runUxQualityAnalysis(stats: QuantStats, qual: QuestionWithApprovedCategories[], onUsage?: (usage: ClaudeUsageRecord) => void): Promise<string> {
  const usability = stats.uxQuality.usability.map((u) => ({ 항목: u.name, 점수: u.mean }));
  const fun = stats.uxQuality.fun.map((u) => ({ 항목: u.name, 점수: u.mean }));
  const avg = (arr: { 점수: number }[]) => Math.round((arr.reduce((s, x) => s + x.점수, 0) / (arr.length || 1)) * 100) / 100;
  return generate("ux-quality", UX_QUALITY_SYSTEM, {
    실용성: usability, 실용성평균: avg(usability),
    즐거움: fun, 즐거움평균: avg(fun),
    조작_UI_불만: repeatedComplaints(qual),
  }, 2200, onUsage);
}

// ── 리포트 단위 오케스트레이터 ──────────────────────────────────────────────
/** 이미 저장된 정량 통계 + 정성 카테고리를 재료로 섹션 분석 전체를 생성·저장한다.
 * 제품형에 따라 대상 섹션이 달라진다(실제품형엔 UX 품질·4대가치 종합·기능 티어 분석이 없음).
 * 각 섹션 생성은 독립적으로 try/catch — 하나가 실패해도 나머지는 저장된다. */
export async function runSectionAnalysesForReport(
  reportId: string,
  options: { concurrency?: number; onUsage?: (usage: ClaudeUsageRecord) => void } & SectionAnalysisRunHooks = {},
): Promise<SectionAnalyses> {
  const report = await getReportById(reportId);
  if (!report?.quant_stats) throw new Error("정량 통계가 없어 섹션 분석을 생성할 수 없습니다.");
  const stats = report.quant_stats;
  const qual = await getQuestionsWithAllCategories(reportId);
  const productType = detectProductType(stats);

  const analyses: SectionAnalyses = {};
  const tasks: { key: keyof SectionAnalyses; run: () => Promise<string> }[] = [
    { key: "corePurchaseFactor", run: () => runCorePurchaseFactorAnalysis(stats, qual, productType, options.onUsage) },
  ];
  // SW형 전용 섹션(케어클 원본엔 없음).
  if (productType === "sw") {
    tasks.push(
      { key: "featureExperience", run: () => runFeatureExperienceAnalysis(stats, qual, options.onUsage) },
      { key: "fourValues", run: () => runFourValuesAnalysis(stats, qual, options.onUsage) },
      { key: "uxQuality", run: () => runUxQualityAnalysis(stats, qual, options.onUsage) },
    );
  }

  // 4개 분석은 최종 정성 분석 흐름의 일부지만, 한꺼번에 4개를 보내 API 연결/레이트리밋
  // 위험을 키우지 않는다. 두 개씩만 실행해 기존 Stage1·Stage2와 독립적으로 안정성을 검증한다.
  const concurrency = Math.min(2, Math.max(1, options.concurrency ?? 2));
  const limit = pLimit(concurrency);
  await Promise.all(
    tasks.map(({ key, run }) => limit(async () => {
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
