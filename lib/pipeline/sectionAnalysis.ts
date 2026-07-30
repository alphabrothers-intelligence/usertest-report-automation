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

const MODEL = process.env.ANTHROPIC_SECTION_ANALYSIS_MODEL ?? "claude-sonnet-5";

export interface SectionAnalyses {
  featureExperience?: string;
  corePurchaseFactor?: string;
  fourValues?: string;
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

// ── 원본 표현어 계산(2026-07-30 원본 29·51쪽 대조로 확정) ──────────────────────
// 원본 Ⅲ.2는 상대중요도를 순위 기반 5단계 표현어로, 만족도를 값 기반 5단계 표현어로 쓴다.
// 아래 임계값은 리바랩스 원본 문구(산책 6.35="중하위", 성장 6.81="보통의", 꾸미기 7.20="높은",
// 레이싱 6.04="낮은", 교배 5.85="가장 낮은")를 그대로 재현하도록 맞춘 것이다. 표현어를 모델이
// 즉흥으로 고르지 않도록 코드에서 확정해 프롬프트 입력으로 넘긴다.
function importanceLabel5(rank: number, total: number): string {
  if (rank === 1) return "가장 높은";
  if (rank === 2) return "다소 높은";
  if (rank === total) return "가장 낮은";
  if (rank === total - 1) return "낮은";
  return "보통의";
}
function satisfactionLabel5(mean: number): string {
  if (mean >= 7.0) return "높은";
  if (mean >= 6.6) return "보통의";
  if (mean >= 6.2) return "중하위";
  if (mean >= 5.9) return "낮은";
  return "가장 낮은";
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

// ── Ⅲ.2 기능별 고객 경험 분석 (SW형) ─────────────────────────────────────────
const FEATURE_SYSTEM = `당신은 사용성테스트 결과보고서 Ⅲ장 "기능별 고객 경험 분석"의 "기능별 중요 순위 및 만족도 종합 해석"을 작성합니다.
입력은 기능별 상대중요도·만족도(정량)와 각 기능의 부정 요지(정성), 반복 언급된 불만입니다.

# 출력 구조 (원본 29쪽과 동일 — 이 순서·기호를 그대로 지킬 것)
[종합 해석]
(빈 줄)
• {짧은 관찰 한 구절.}
• {짧은 관찰 한 구절.}
• {여러 기능에서 공통 확인된 사실 한 구절}
→ {그 사실에서 도출되는 함의·제언 한 구절}
… (불릿 총 3~5개. 단순 관찰 불릿은 "→" 없이, 함의가 필요한 불릿만 바로 다음 줄에 "→" 1줄)
(빈 줄)
▶ 우선 개선 기능
1. '{기능명}' 기능의 경우 {중요도표현} 상대 중요도({상대중요도표시})와 {만족도표현} 만족도({만족도})를 가짐.
→ '{그 기능의 성격을 규정한 짧은 해석}'으로 해석 가능
→ {부정 요지에서 도출한 니즈 한 줄}
2. …
(빈 줄)
▶ 차우선 개발 기능
… (같은 형식, 입력에 해당 tier 기능이 있을 때만)
(빈 줄)
▶ 비우선 개발 기능
… (같은 형식, 입력에 해당 tier 기능이 있을 때만)

# 형식 규칙 (반드시 지킬 것)
- 각 기능의 "1." 줄은 입력의 {중요도표현}·{상대중요도표시}·{만족도표현}·{만족도}를 **그대로** 채운다.
  이 표현어·부호·수치를 임의로 바꾸지 않는다(예: "가장 높은 상대 중요도(+2.96)와 중하위 만족도(6.35)를 가짐").
- "→"로 시작하는 줄만 해석·니즈다. 첫 "→"는 그 기능을 규정하는 짧은 해석(작은따옴표로 감싼 성격 규정),
  둘째 "→"는 부정 요지에서 도출한 니즈다. 부정 요지가 비어 있으면 둘째 "→"는 생략한다.
- [종합 해석] 불릿은 "만족도는 가장 높지만 중요도는 상대적으로 낮음", "만족도·중요도 모두 낮은 특징을
  보임"처럼 **한 구절로 짧게** 쓴다(문장을 길게 늘이거나 수치를 나열하지 않는다). 버그·오류·GPS·튜토리얼
  등 여러 기능에서 공통 확인된 불만은 "설문을 통해 전반적으로 버그, 오류에 대한 불만이 다수 확인됨"처럼
  한 불릿으로 묶고 바로 다음 줄에 "→ 함의"를 단다.

# 절대 규칙 (매우 중요)
- 내부 집계 수치·필드명을 본문에 절대 출력하지 않는다: "clauseCount", "questionCount", "빈도",
  "절 수 22" 등 어떤 형태로도 쓰지 마라. 빈도는 오직 "반복적으로", "다수", "공통으로"처럼 서술어로만 표현한다.
- "반복/다수/공통"은 입력 빈도가 "반복 확인" 이상인 근거에만 쓴다.
- 개조식 명사형 종결(~함/~짐/~가짐/~확인/~필요/~시급). 핵심 표현·수치에만 **굵게** 또는 **__굵게+밑줄__**,
  한 줄에 강조는 최대 1개.
- 기능의 개선 필요성은 해당 기능의 부정 요지를 우선 근거로 쓰고, 반복_불만을 임의로 다른 기능의
  원인처럼 연결하지 않는다. 시장성·구매전환 해석은 이 섹션에서 쓰지 않는다.
${NUANCE_RULES}`;

// ── Ⅳ 핵심구매요소 분석 (제품형 공통) ────────────────────────────────────────
function corePurchaseSystem(productType: ProductType): string {
  const axis = productType === "physical"
    ? "- 실물 제품형: 상위 요인은 선택 비율이 높은 구매 결정 요인으로 서술한다. 그 밖의 요인은 선택 비율이 낮거나 제한적인 요인으로만 서술하며, 순위 구성비가 있을 때 이를 근거로 쓴다."
    : "- 소프트웨어형: 상위 3개 요인의 합산 비중과 각 요인의 구매 결정상 역할을 입력 근거 안에서 서술하고, 마지막에 주관식 반복 불만을 근거로 우선 개선 방향을 제언 뉘앙스로 종합한다.";
  return `당신은 사용성테스트 결과보고서의 "핵심구매요소 중요 순위 및 만족도 종합 해석"을 작성합니다.
입력은 핵심구매요소의 순위·비율·응답자수(정량)와 반복 언급된 주관식 불만(정성)입니다.

# 출력 구조 (원본 31쪽과 동일 — "•" 불릿, 필요 시 "-" 서브 설명)
• 전체 응답자 {N}명 중 {N1}명({p1}%)이 서비스 이용을 결정함에 있어 가장 중요한 요인으로 '{1위 요인}'를 선택하며 핵심구매요소 중요 순위 1위로 선정됨.
- 이는 … '{1위 요인}'이 {구매 결정에 갖는 의미}에 가장 큰 영향을 주고 있음을 나타냄.
• '{2위 요인}'을 선택한 응답자는 {N}명 중 {N2}명({p2}%), '{3위 요인}'은 {N3}명({p3}%)이 선택하며 각각 핵심구매요소 중요 순위 2, 3위를 차지함.
- 상위 3개 요인인 '{1위}', '{2위}', '{3위}'이 전체 응답의 {상위3합계}%를 차지하며, {상위 3개를 각각 한 단어로 규정한 3축(예: 보상=동기, 디자인=첫인상, 안정성=기본 신뢰)}이 서비스 설치 및 지속 사용 결정에 가장 중요하게 작용함을 시사함.
• 중위권 요인('{4위}' {p4}%, '{5위}' {p5}%)은 장기적 사용 경험과 충성도를 좌우하는 보조적 요인으로 해석 가능함.
• 반면 '{최하위 요인}'은 {p}%로 선택한 응답자가 거의 없었으며, 구매 결정에 큰 영향을 미치지 않는 것으로 나타남.
• 주관식 응답에서 반복적으로 언급되는 '{불만1}', '{불만2}', '{불만3}' 등 기본 기능 불안정 요소 개선이 우선적으로 시급한 상황임.
  따라서 {상위 요인에 근거한 우선순위 — 예: 앱 안정성을 최우선 확보한 뒤, 보상 체계를 고도화해 지속 동기를 강화하고, 시각적 완성도 제고를 우선 과제로 삼는 것}이 적절할 것으로 판단됨.

# 형식 규칙
- 개별 요인의 응답자수는 "N명(N%)" 형태로 쓴다(입력의 응답자수·비율 사용). 순위·비율·요인명은 입력값을 그대로 쓴다.
- **전체 응답자수({N})에는 절대 "(100%)"나 어떤 백분율도 붙이지 않는다** — "전체 응답자 {N}명 중"으로만 쓴다.
  퍼센트는 오직 개별 요인·상위 N개 합계에만 붙인다.
- 상위 3개 요인의 3축 규정은 요인명에서 자연스럽게 도출한다(리바랩스가 아닌 raw data에도 맞게).
- 선택률이 낮은 요인을 "기본 요건", "필수 요건"이라고 부르지 않는다.
- 마지막 불릿은 주관식에서 반복 확인된 불편을 '작은따옴표' 명사구로 2~3개 나열하고, 이어서 "따라서 …" 종합 제언 1문장으로 닫는다.
${axis}

# 절대 규칙
- 내부 집계 수치·필드명("clauseCount"/"questionCount"/"빈도"/"절 수" 등)을 본문에 절대 출력하지 않는다.
  반복성은 "반복적으로 언급되는"처럼 서술어로만 표현하고, "반복/다수"는 입력 빈도가 "반복 확인" 이상일 때만 쓴다.
- 개조식 명사형 종결(~선정됨/~시사함/~해석 가능함/~나타남/~판단됨). 핵심 표현·수치는 **굵게** 또는
  **__굵게+밑줄__**로 강조하되(원본은 "N명(N%)", 상위 요인명, "N%", 3축, "따라서" 문장의 핵심 동작을 강조함),
  한 불릿에 강조는 최대 1개.
${NUANCE_RULES}`;
}

// ── Ⅴ.2 4대 가치 종합 해석 (SW형 존댓말 3단락) ───────────────────────────────
const FOUR_VALUES_SYSTEM = `당신은 사용성테스트 결과보고서의 "4대 가치 만족도 종합 해석"을 작성합니다.
입력은 4대 가치(기능적·심미적·경제적·사회공공적)의 평균 점수와 각 가치의 긍정·개선 요지(정성)입니다.

# 출력 구조 (원본 36쪽과 동일 — 존댓말 세 단락, 불릿 없음)
[종합 해석]
(빈 줄)
1단락: 네 가치를 아우른 전반적 긍정 평가를 2~3문장으로 종합한다("서비스는 전반적으로 …에서 긍정적인 평가를 받았습니다. …또한 사용자 만족을 높이는 강점으로 확인되었습니다.").
(빈 줄)
2단락: "그러나 동시에 "로 시작해, 각 가치의 개선 요지를 **주제(괄호 안 세부)** 형태로 나열한 **한 문장**으로 묶는다.
  예: "그러나 동시에 핵심 기능 안정성 부족(걸음 수 연동 불안정, 오류·성능 문제), 시각적 완성도 한계(그래픽·모션 단조로움, UI 통일성 부족), 경제적 불균형(재화 수급 부족, 무료·유료 콘텐츠 차별성 미흡), 사회적 안전 우려(보행 위험 요소, 기존 앱 대비 차별성 부족) 등이 주요 개선 과제로 지적되었습니다."
(빈 줄)
3단락: "따라서 본 서비스는 "로 시작해, 개선 과제를 '작은따옴표 명사구'로 나열한 뒤 "…할 필요가 있습니다."로 끝낸다.
  예: "따라서 본 서비스는 '핵심 기능의 안정화', '시각적 완성도 제고', '경제 구조의 균형 확보', '차별화된 경험과 안전 장치 마련'을 통해 기존의 긍정적 강점을 유지하면서 더욱 풍부하고 차별화된 사용자 경험을 제공할 필요가 있습니다."

# 형식 규칙
- **이 섹션은 아래 공통 규칙(NUANCE_RULES)의 "~할 필요가 있음/~사료됨" 같은 개조식 종결을 쓰지 않는다 —
  세 단락 전부 예외 없이 존댓말 "~습니다"로만 끝낸다.** 3단락의 마지막 문장도 반드시
  "…필요합니다."로 끝나야 하며 "…필요함."처럼 개조식으로 바꾸지 않는다. 공통 규칙은 제언 뉘앙스
  어휘 선택("~것을 제언함" 계열 대신 이 섹션 전용 "~할 필요가 있습니다" 계열을 쓴다는 뜻)에만 적용되고,
  종결 어미(음/함 vs 습니다)는 이 섹션의 지시가 공통 규칙보다 우선한다.
- 세 단락은 빈 줄로 구분. 각 단락 최대 4문장, 전체 700자 이내.
- 2단락의 주제(괄호 세부)는 입력 개선요지에서 도출한다: 기능적→"핵심 기능 안정성 부족", 심미적→"시각적 완성도 한계",
  경제적→"경제적 불균형", 사회공공적→"사회적 안전 우려" 식으로 가치별 대표 주제 1개와 괄호 안 세부 2~3개.
- 점수는 관찰 사실로만 언급하고, 정성 응답이 점수의 원인이라고 단정하지 않습니다. "중심축", "직결", "핵심 원인" 등
  제공 자료보다 강한 인과·전략 표현을 쓰지 않습니다. 입력 요지를 넘어 원인을 추정하거나 효과를 전망하지 않습니다.
- 핵심 표현에만 **굵게** 또는 **__굵게+밑줄__**(원본은 2단락의 주제어와 3단락의 개선 과제를 강조), 한 문장에 강조 최대 1개.
- 내부 집계 수치·필드명("clauseCount" 등)을 절대 출력하지 않는다.
${NUANCE_RULES}`;

// ── Ⅵ.2 사용자 경험 품질 분석 (SW형 전용) ────────────────────────────────────
const UX_QUALITY_SYSTEM = `당신은 사용성테스트 결과보고서 Ⅵ장 "사용자 경험 품질 평가 결과 분석"을 작성합니다.
입력은 실용성·즐거움 항목별 점수와 평균(정량), 조작·UI 관련 반복 불만(정성)입니다.

# 출력 구조 (원본 40쪽과 동일 — 두 블록, 반드시 이 형태를 그대로)

[종합 해석]
{강점·약점을 한 문장으로 요약(존댓말 "…강점, 반면 …약점으로 나타났습니다").}
• 실용성(평균 {실용성평균})
{높게 평가된 항목(점수)은 …되었으나, / 가장 낮은 항목(점수)은 … 개선이 필요합니다.} (하위 불릿 금지, 흐르는 2문장 이내)
• 즐거움(평균 {즐거움평균})
{기본 재미(점수)는 확보되었으나, / 가장 낮은 항목(점수)이 부족해 …가 지적되었습니다. / 다른 낮은 항목(점수)도 … 약합니다.}
→ 종합적으로, "{짧은 총평 인용구}"는 평가로 정리됩니다.

[세부 해석]
실용성 (평균 {실용성평균})
• {항목명} ({점수})
{그 점수에 대한 짧은 해석 한 줄.}
• {항목명} ({점수})
{짧은 해석 한 줄.}
… (실용성 전 항목)
→ {UI·화면 설계 강점과 조작감 개선 여지를 정성 불만의 구체 사례로 종합한 한 문장.}
(빈 줄)
즐거움 (평균 {즐거움평균})
• {항목명} ({점수})
{짧은 해석.}
… (즐거움 전 항목)
→ {정성 불만 근거가 있을 때만 개선 방향 한 문장.}

# 형식 규칙
- [세부 해석]의 각 항목은 "• 항목명 (점수)"를 한 줄로 쓰고, 그 **다음 줄**에 해석을 쓴다(콜론으로 한 줄에 붙이지 말 것).
  항목 순서는 입력 순서를 유지한다.
- 각 블록 끝의 "→"는 정성 불만에서 확인된 **구체적 사례**(예: 지도 확대/축소, 버튼 크기, 조작 단계)를 근거로 쓴다.
- 개조식과 "~습니다"를 원본처럼 혼용하되 제언은 제언 뉘앙스로 끝낸다. 핵심 표현·수치는 **굵게** 또는 **__굵게+밑줄__**,
  한 줄에 강조 최대 1개.

# 절대 규칙
- 내부 집계 수치·필드명("clauseCount"/"questionCount"/"빈도" 등)과 그 숫자를 본문에 절대 출력하지 않는다.
  "개선 방향:" 같은 라벨도 붙이지 말고 곧바로 "→ …"로 쓴다. "반복/다수"는 입력 빈도가 "반복 확인" 이상일 때만 쓴다.
- 점수와 정성 불만은 함께 확인된 사실로만 서술하고, "원인", "기인", "가능성이 높음" 같은 인과·추정 표현을 쓰지 않는다.
- 실용성/즐거움 평균은 입력값(실용성평균/즐거움평균)을 그대로 쓴다(원본 종합해석의 평균과 다를 수 있으나 우리 정량값이 기준).
${NUANCE_RULES}`;

// ── Ⅶ 교차분석 텍스트 해석 (SW형 전용, 원본에 있던 항목인데 기존엔 미구현이었다) ───────────
// 정성 카테고리 없이 정량 그룹 평균 비교만으로 만든다(4.1절: 정량은 규칙 기반이 원칙이나, 원본이
// "10대: 모든 영역에서 가장 높은 만족도"처럼 그룹 랭킹을 문장으로 서술하는 부분은 규칙만으로
// 표현하기 번거로워 LLM에 위임한다 — 새 사실을 추가하지 않고 제공된 평균 비교만 서술하도록
// 강하게 제약한다). "핵심 세그먼트"/"유지·관리형 고객군"처럼 그룹에 비즈니스적 의미를 부여하는
// 표현은 예전엔(2026-07-21) 안전하게 일반화할 수 없다고 판단해 뺐었지만, 2026-07-30 사용자가
// "원본과 최대한 같게"를 재확인해 원본 문구의 판단 톤을 되살렸다 — 다만 반드시 "전 항목에서
// 최고/최저"처럼 제공된 수치로 직접 검증되는 경우에만 쓰도록 제약해 근거 없는 라벨링을 막는다.
const CROSS_ANALYSIS_SYSTEM = `당신은 사용성테스트 결과보고서 Ⅶ장 "교차 분석 결과 및 분석"을 작성합니다.
입력은 연령대별·성별 그룹의 기능 만족도·4대 가치·UX 품질 평균(전부 정량)입니다.

# 출력 구조 (원본 41~42쪽과 동일 — 두 부분을 "===GENDER===" 한 줄로 구분해 순서대로)
# 아래 "(연령대 부분 지시)"·"(성별 부분 지시)"는 프롬프트 설명용 라벨이며, 실제 출력에는
# 이 라벨을 절대 쓰지 않는다 — 출력은 오직 [대괄호] 소제목과 그 아래 "•"/"→" 본문으로만 시작한다.

(연령대 부분 지시)
[전반적 만족도 경향]
• {그룹}: {짧은 정성 서술}
  (예: "10대: 모든 영역에서 가장 높은 만족도", "20대: 비교적 긍정적이나 10대보다는 낮음.",
   "30대: 전반적으로 가장 낮은 만족도", "40대 이상: 30대보다는 다소 높지만 여전히 중간 수준")

[종합 분석]
• {그룹}: {그 그룹의 성격을 규정하는 한 문장}
  (예: "10대: 전반적으로 모든 가치와 기능에서 높은 만족도를 보이며, 서비스 충성 고객층이자 긍정적
   입소문 확산 가능성이 높은 핵심 세그먼트.", "20대: 긍정적 평가가 많지만 10대보다 다소 낮아,
   유지·관리형 고객군으로 관리 필요.")

(성별 부분 지시 — ===GENDER=== 다음에 출력, 마찬가지로 이 라벨 자체는 출력하지 않는다)
[전반적 만족도 경향]
• {두 성별 비교를 짧은 정성 서술로 1~2불릿}

[사용자 경험 품질]
• {성별}: {실용성·즐거움 항목 중 높거나 낮은 편향을 짧게}
• {성별}: {…}
→ {성별 간 차이를 한 문장으로 요약}

[종합 분석]
• {성별}: {그 성별의 성격을 규정하는 한 문장}

# 절대 규칙 (원본과 어긋나던 핵심 — 반드시 지킬 것)
- **[전반적 만족도 경향]과 [종합 분석] 본문에는 원점수·평균 수치를 절대 쓰지 않는다**(예: "7.00~8.29",
  "사회적 7.24" 금지). 수치는 이미 위 차트에 있으므로, 여기서는 그룹 간 **상대 비교를 정성 서술**로만
  표현한다("가장 높은", "가장 낮은", "중간 수준", "일관되게 높음").
- "핵심 세그먼트", "충성 고객층", "유지·관리형 고객군", "유지·확장 전략 필요"처럼 그룹 성격을 규정하는
  표현은, 그 그룹이 제공된 지표에서 상대적으로 일관되게 높/낮을 때 쓴다(원본 톤을 재현하되 수치로 뒷받침되게).
- [종합 분석]의 핵심 표현은 **__굵게+밑줄__**로 강조한다(그룹당 최대 1개).

# 공통 규칙
- 제공된 평균 비교로만 서술하고, 제공되지 않은 원인(가치관·소비 성향 등)은 지어내지 않는다.
- 불릿은 "•", 개조식 명사형 종결(~높은 만족도/~중간 수준/~부족/~관리 필요). "낮은 평가가 부족한 편"처럼
  뜻이 어긋나는 표현을 쓰지 말고 "뚜렷한 만족 포인트 부족"처럼 명확히 쓴다.
- 내부 집계 수치·필드명("clauseCount" 등)을 절대 출력하지 않는다.
${NUANCE_RULES}`;

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
  const 기능 = byImportance.map((imp, index) => {
    const mean = stats.featureSatisfaction.find((f) => f.name === imp.name)?.mean ?? 0;
    return {
      기능명: imp.name,
      중요도표현: importanceLabel5(index + 1, total),
      상대중요도표시: signedScore(imp.score),
      만족도표현: satisfactionLabel5(mean),
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
  return generate("core-purchase-factor", corePurchaseSystem(productType), {
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
