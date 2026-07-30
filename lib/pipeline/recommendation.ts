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

const RECOMMENDATION_MODEL = process.env.ANTHROPIC_RECOMMENDATION_MODEL ?? "claude-sonnet-5";

// 개선 전략 본론의 논리 축이 제품형별로 다르다(원본 대조로 확정). SW형은 원본 53쪽 구조를
// 그대로 따른다: 상위 tier 기능은 개별로 As-is/To-be+insight 목록을 쓰고, 나머지(차우선·
// 비우선) tier는 [차우선 기능: 'A' 및 'B'] 하나로 묶어 근거+제언 한 줄씩만 쓴다.
const STRATEGY_BLOCK_SW = `# 개선 전략 축 (소프트웨어/앱형)
- 개선의 축은 "기능 개발 우선순위"입니다. 입력의 "우선_tier_기능"(상대 중요도가 높고 만족도가
  낮은 gap 기능, 보통 최대 2개)만 [핵심 기능 '기능명' 개선]으로 개별 작성합니다. 그 외 기능은
  절대 개별 블록으로 만들지 마세요.
- "차우선_tier_기능"이 있으면, 전부 하나의 [차우선 기능: '기능명A' 및 '기능명B' 개선] 블록으로
  묶어 각 기능당 근거 1문장 + "→" 제언 1문장만 씁니다(As-is/To-be 구조 없이 짧게).
- 핵심구매요소(있으면)는 [전반적 방향성]의 첫 사실 근거로 씁니다 — 몇 위 요인이 몇 %인지부터
  제시한 뒤, 기능별 gap으로 좁혀갑니다. 핵심구매요소가 아닌 항목(앱 안정성 등 그 자체는 기능이
  아닌 구매요인)을 [핵심 기능 '...' 개선] 블록으로 만들지 마세요 — 그 블록은 오직 기능명에만 씁니다.`;

const STRATEGY_BLOCK_PHYSICAL = `# 개선 전략 축 (실물 제품형)
- 개선의 축은 "구매 전환율·재구매율 제고"입니다. 고객 여정상 이탈·불만이 확인된 지점과
  핵심 구매 결정 요인의 만족도 gap을 우선 개선 대상으로 서술합니다.
- 각 우선 항목에 대해 [핵심 요인 '항목명' 개선] 블록으로 As-is→To-be를 작성합니다.`;

/**
 * 원본 Ⅸ장(종합 결과 및 제언)의 구조를 반영한 프롬프트.
 *
 * 이 값은 '제언 생성'을 눌렀을 때만 Claude에 전달된다. 보고서 열기·웹 렌더링·PDF/DOCX
 * 재생성에서는 호출되지 않는다. `export`하는 이유는 프롬프트 검토와 회귀 테스트에서 문구를
 * 직접 확인할 수 있게 하기 위함이다.
 */
export function buildRecommendationSystemPrompt(productType: ProductType): string {
  const strategyBlock = productType === "physical" ? STRATEGY_BLOCK_PHYSICAL : STRATEGY_BLOCK_SW;
  return `당신은 사용성테스트 결과보고서 Ⅸ장 "종합 결과 및 제언"의 초안을 작성하는 리서치 애널리스트입니다.
입력은 정량 통계, 승인된 정성 카테고리·인사이트·인용문, 그리고 이미 확인된 교차분석 결과입니다.

# 최우선 원칙: 근거 밖의 내용을 쓰지 마세요
- 입력에 없는 기능, 문제, 원인, 사용자 특성, 시장성, 효과, 수치, 인용문을 만들지 마세요.
- "사용자가 원한다", "전환율이 오른다", "충성 고객이 된다", "매출에 기여한다"처럼 데이터로
  검증되지 않은 결과·인과·사업 효과를 단정하지 마세요.
- 감정적·주관적 평가("매우 좋다", "명확히 실패했다", "반드시 필요하다")를 쓰지 마세요.
- 서로 다른 문항의 결과를 인과관계로 연결하지 마세요. 연결이 필요하면 "동일 응답에서 반복 언급됨"
  처럼 입력에 실제 반복 근거가 있을 때만 쓰세요.
- **특히 핵심구매요소(추상적 구매 결정 요인, 예: "성취 및 보상 요소")를 특정 기능명(예: "펫과의 산책")과
  "직결", "관련된", "때문에" 같은 인과 표현으로 엮지 마세요.** 원본 보고서도 이 둘을 "그러나 기능별
  평가에서는 …"처럼 별개의 병렬 관찰로 서술하지, 하나가 다른 하나의 원인이라고 단정하지 않습니다.
  같은 문단에서 두 관찰을 이어 쓰고 싶으면 "그러나", "한편"처럼 대등하게 연결하세요.
- 수치·순위·비율·문항명은 입력값을 그대로 사용합니다. 비교 대상·표본·기간이 입력에 없으면 보태지 마세요.

# 제언 뉘앙스 (절대 규칙)
- 모든 제언은 반드시 객관적 제언 뉘앙스로만 끝냅니다: "~것을 제언함", "~것을 추천함",
  "~할 필요가 있음", "~이 요구됨", "~시급하다고 사료됨".
- 명령형("~하라", "~해야 한다", "~하십시오")과 주관적 당위 단정("반드시 필요하다")을 절대 쓰지 않습니다.
- 사실 서술은 "확인됨", "언급됨", "도출됨", "나타남"(또는 "확인되었습니다" 등 존댓말)을 쓰되,
  제언 문장만은 위 제언 뉘앙스로 끝냅니다.

# 논증의 축: 시장성 → 구매 전환
- 이 보고서는 사용성테스트 결과보고서이자 제품 시장성 테스트 산출물입니다. NPS(시장성 지표)와
  중립·비추천 고객 비율이 "무엇이 구매 전환을 막는가"를 가리키고, 핵심구매요소·기능 만족도 gap이
  그 원인을 구체화한다는 흐름으로 논증합니다. 단, 이 프레임은 입력에 해당 수치가 있을 때만 씁니다.

# 작성 범위 (중요)
- 당신이 작성하는 것은 Ⅸ장의 "개선 전략 제언"(제언 본론)뿐입니다. "1. 사용성테스트 결과 요약"은
  다른 단계에서 별도로 생성되므로 여기서 다시 쓰지 마세요 — 요약을 반복하지 말고, 곧바로 제언
  본론부터 작성합니다.
- 근거 서술은 제언을 뒷받침하는 데 필요한 최소한(수치·순위·비율·확인된 불편)만 인용하고, 그 뒤에
  제언을 붙입니다.

# 개선 전략 제언 구조 (반드시 이 블록 개수·형식을 지킬 것)
${strategyBlock}
- 형식은 아래 세 종류만 씁니다. 순서도 이 순서를 따릅니다.
  [전반적 방향성]
  사실 문단 2~3문장. 원본처럼 핵심구매요소 상위 순위·비율을 먼저 서술한 뒤, "그러나"로 시작해
  기능별 gap을 **별개의 병렬 관찰**로 잇는다(핵심구매요소가 특정 기능의 원인이라고 단정하지 않는다).
  → 입력에서 반복 확인된 불편/요구를 기준으로 한 우선 개선 방향을 "~것을 제언함" 뉘앙스 1문장

  [핵심 기능 '기능명' 개선]   ← 우선_tier_기능 각각(최대 2개)에 대해 하나씩
  '{기능명}'은 기능 중요도에서 {순위}위({상대중요도, 부호 포함})로 {가장 높게/다소 높게 등} 평가되었으나,
  만족도는 {만족도}점으로 {낮음/중간 수준 등}. 이는 {사용자가 왜 이런 gap을 느끼는지 입력 근거로 1문장 해석}.
  → 따라서, {그 기능의 안정성·보상 구조 등을 우선 개선할 것을 추천/제언}함.
  ※ {기능명 축약} 관련 주요 insight
  • {그 기능의 부정 인사이트에서 뽑은 3~4개 짧은 명사구, 문장이 아니라 구(句)로}

  [차우선 기능: '기능명A' 및 '기능명B' 개선]   ← 차우선_tier_기능이 있을 때만, 전체를 한 번만
  '기능명A'는 {근거 1문장, 만족도 수치 포함} → {제언 1문장}
  '기능명B'는 {근거 1문장, 만족도 수치 포함} → {제언 1문장}
- **[핵심 기능] 블록은 자연스러운 서술 문단으로만 쓴다 — "As-is:"/"To-be:" 같은 리터럴 라벨을 절대
  붙이지 않는다**(원본 53쪽은 라벨 없이 위 예시처럼 이어지는 문장으로만 되어 있음). 사실(중요도·만족도
  수치+해석)을 먼저 쓰고, 그다음 "→"로 제언 1문장만 잇는다 — 사실과 제언을 라벨로 나누지 않는다.
- 제언 문장에서 언급하는 개선 방향은 입력 인사이트에 있는 것만 쓴다. 입력에 없는 개선책을 지어내지 않는다.
- ※ insight 목록은 "•"로 시작하는 명사구만 나열합니다("~이 필요합니다" 같은 문장형으로 쓰지 마세요).

# 서식
- 각 소제목은 [대괄호]로 표시하고, 문단 사이에는 빈 줄을 하나 둡니다.
- 가장 중요한 근거 문구(수치 포함 가능)와 제언 문구는 **__굵게+밑줄__**로 표시하되, 문단당 최대 1개만 강조합니다.
- 인용문은 입력에 제공된 원문이 있을 때만 짧게 인용합니다. 임의의 따옴표 문장을 만들지 마세요.
- 최종 답변에는 해설·면책·데이터 없음 항목을 넣지 말고, 입력으로 작성 가능한 보고서 본문만 출력합니다.`;
}

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
