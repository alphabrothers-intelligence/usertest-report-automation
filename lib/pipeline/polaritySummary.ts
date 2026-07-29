// 문항×극성당 한 단락 총평 — 실제 발행 보고서의 "[긍정 의견 요약]" 박스 형식(2026-07-20 추가).
// PRD 6장 소속 프롬프트가 아니라 v1.4 이후 신규 기능이므로 "6장 프롬프트 불변" 원칙과 무관하게
// 자유롭게 작성한다(lib/productInfo/extract.ts와 같은 예외 사유).
//
// Stage2가 이미 만들어둔 카테고리·인사이트(작은 텍스트)만 입력으로 쓴다 — 원본 clause 전체를
// 다시 넣지 않으므로 비용이 아주 작다. "카테고리를 구성하면서 같이 뽑을 수 없냐"는 질문에는,
// Stage2 프롬프트(6.3절, 불변) 자체를 건드리지 않고 그 출력을 재료로 삼는 방식으로 답했다 —
// 결과적으로 Stage2 이후 곧바로 이어지는 가벼운 후처리 호출이라 사용자 입장에서는 "같은 흐름의
// 일부"처럼 느껴지되, 프롬프트 불변 원칙은 지킨다.
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { Polarity } from "./stage1";
import type { ProductType } from "@/lib/report/productType";
import { CLAUDE_TIMEOUT_MS, withClaudeGuard } from "./claudeGuard";

const MODEL = process.env.ANTHROPIC_STAGE2_MODEL ?? "claude-sonnet-5";

const POLARITY_LABEL: Record<Polarity, string> = {
  positive: "긍정",
  negative: "부정",
  neutral: "중립",
};

const PolaritySummariesSchema = z.object({
  positive: z.string().optional(),
  negative: z.string().optional(),
  neutral: z.string().optional(),
});

// 기능 문항의 긍정/부정/중립 "응답 요약" 박스(원본 리바랩스 Ⅲ장). 이건 "사용 경험 요약"이며
// 구매전환·시장성 프레임을 넣지 않는다(그건 Ⅸ 종합 제언의 몫 — 2026-07-29 원본 대조로 확정).
// 원본 특징(극성별):
//   긍정 = 만족한 핵심 요인들을 묶어 "무엇을 통해 무엇을 느낌"
//   부정 = 불편·오류 요인 나열 + 그로 인해 저하된 것 + "불만이 제기"
//   중립 = 조건부·양가적 반응 또는 개선 시 개선 여지 + "반응/필요성 제기/보류"
const SYSTEM_PROMPT = `당신은 사용성테스트 결과보고서의 기능 문항 "응답 요약"을 작성하는 애널리스트입니다.
주어진 극성별 카테고리 인사이트를 읽고, 각 극성을 한 문장으로 종합합니다. 이것은 "사용 경험"의
요약이며, 구매전환·시장성 같은 상위 해석은 하지 않습니다.

# 극성별 지침 (각 극성 1문장)
- 긍정: 사용자가 만족한 핵심 요인들을 묶어 "~을 통해 ~을 느낌/강화함/제공"처럼, 만족의 원천을
  종합한다.
- 부정: 불편·오류 요인을 나열하고 그로 인해 저하된 것(신뢰성·사용성·재미·몰입 등)을 짚어
  "~로 인해 ~이 떨어진다는 불만이 제기" 형태로 종합한다.
- 중립: 조건부·양가적 반응이나 개선 시 개선 여지를 "~반응 / ~개선 필요성 제기 / ~평가 보류"로
  종합한다.

# 공통 규칙
- 개별 카테고리를 그대로 나열하지 말고 공통 흐름을 한 문장으로 종합한다.
- 개조식 명사형 종결만 쓴다("~함", "~짐", "~제기", "~반응", "~보류" 등). "~습니다"/"~이다" 금지.
- 새로운 사실·수치를 지어내지 않는다. 주어진 인사이트에 있는 내용만 쓴다.
- 주관적 판단·전망·기대, 명령형을 넣지 않는다.
- 화살표, 대괄호, 마크다운 기호를 쓰지 않는다 — 순수 문장만 출력한다.`;

// 4대 가치 "[ … 조사 결과 ]" 박스용 — 긍정+부정을 종합한다. 형식이 제품형별로 다르다
// (2026-07-29 원본 대조): SW형(리바랩스)=존댓말 한 단락, 실제품형(케어클)=개조식 불릿.
const VALUE_SUMMARY_COMMON = `주어진 긍정·부정 카테고리 인사이트를 그 가치 영역의 "조사 결과 요약"으로 종합합니다.

# 공통 규칙
- 구조: 긍정 평가 요지 먼저 → 그 다음 개선이 필요한 요소.
- 경제적 가치는 가격·구매 관련 함의(예: 가격 허들, 구매 전환)를 자연스럽게 포함할 수 있음. 그 외
  가치는 해당 가치 영역의 함의(브랜드·포지셔닝·사용 경험)에 한한다. 전면적 시장성 논증은 하지 않는다.
- 주관적 전망·기대("~기대됩니다", "~판단됩니다", "~것으로 보입니다")와 명령형("~해야 합니다")을
  절대 쓰지 않는다. 제언이 필요하면 "~강화/개선/검토가 필요함"의 객관적 제언 뉘앙스만 쓴다.
- 핵심 표현(긍정 요소, 개선 필요 요소)은 **__이렇게__**(별 두 개 + 밑줄 두 개)로 굵게+밑줄한다
  (문장/불릿당 1~2개).
- 새로운 사실·수치를 지어내지 않는다. 화살표·대괄호는 쓰지 않는다.`;

const VALUE_SUMMARY_SYSTEM_SW = `당신은 사용성테스트 결과보고서(소프트웨어형)의 "가치 조사 결과" 요약을 작성합니다.
${VALUE_SUMMARY_COMMON}

# 형식 (소프트웨어형)
- 존댓말 "~습니다" 종결의 한 단락, 3~4문장. 문장마다 줄바꿈해 3~4줄로 출력한다.`;

const VALUE_SUMMARY_SYSTEM_PHYSICAL = `당신은 사용성테스트 결과보고서(실물 제품형)의 "가치 조사 결과" 요약을 작성합니다.
${VALUE_SUMMARY_COMMON}

# 형식 (실물 제품형)
- 개조식 명사형 종결(~나타남/~확인됨/~작용/~인식됨/~필요함)의 불릿 2~3개.
- 각 불릿은 "• "로 시작하고 줄바꿈으로 구분한다.`;

export async function runPolaritySummary(params: {
  questionLabel: string;
  polarity: Polarity;
  categories: { label: string; insight: string; clause_count: number }[];
}): Promise<string> {
  const { questionLabel, polarity, categories } = params;
  const categoryList = categories
    .map((c) => `- [${c.label}] (${c.clause_count}건): ${c.insight}`)
    .join("\n");

  const { text } = await withClaudeGuard(`polarity-summary:${questionLabel}:${polarity}`, () => generateText({
    model: anthropic(MODEL),
    instructions: { role: "system", content: SYSTEM_PROMPT },
    prompt:
      `문항: "${questionLabel}"\n` +
      `극성: ${POLARITY_LABEL[polarity]}\n\n` +
      `카테고리별 인사이트:\n${categoryList}\n\n` +
      `위 내용을 종합한 ${POLARITY_LABEL[polarity]} 의견 총평을 한 단락으로 작성하세요.`,
    maxOutputTokens: 500,
    // 이미 카테고리화·인사이트 추출이 끝난 작은 텍스트를 종합하는 단순 요약 작업이라
    // 별도 reasoning이 불필요하다 — stage1.ts/stage2.ts와 같은 이유.
    reasoning: "none",
    // 타임아웃을 안 주면 이 호출 하나가 응답 없이 걸렸을 때(2026-07-20 실사용 중 재현 —
    // 정성 분석이 15분 넘게 끝나지 않음) Promise.all이 영원히 안 끝나서 14문항 전체 파이프라인이
    // 통째로 멈춘다. 60초면 이 정도 크기의 요약 작업엔 충분히 넉넉하다.
    timeout: CLAUDE_TIMEOUT_MS,
  }));

  return text.trim();
}

/**
 * 세 극성의 총평을 한 문항당 한 번에 생성한다. 기존 구현은 문항×극성으로 최대 42회 호출했지만,
 * 입력 재료가 모두 짧은 Stage2 카테고리이므로 하나의 구조화된 응답으로 합쳐도 품질 저하가 없다.
 */
export async function runPolaritySummaries(params: {
  questionLabel: string;
  byPolarity: Partial<Record<Polarity, { label: string; insight: string; clause_count: number }[]>>;
}): Promise<Partial<Record<Polarity, string>>> {
  const sections = (Object.keys(params.byPolarity) as Polarity[])
    .flatMap((polarity) => {
      const categories = params.byPolarity[polarity];
      if (!categories?.length) return [];
      return [`## ${POLARITY_LABEL[polarity]} 의견`, ...categories.map((c) => `- [${c.label}] (${c.clause_count}건): ${c.insight}`)];
    })
    .join("\n");

  const { output } = await withClaudeGuard(`polarity-summaries:${params.questionLabel}`, () => generateText({
    model: anthropic(MODEL),
    instructions: { role: "system", content: `${SYSTEM_PROMPT}\n- 입력에 존재하는 극성에 대해서만 해당 키에 총평을 작성하세요.` },
    prompt: `문항: "${params.questionLabel}"\n\n${sections}\n\n각 극성의 총평을 positive, negative, neutral 키로 구조화해 작성하세요.`,
    output: Output.object({ schema: PolaritySummariesSchema }),
    maxOutputTokens: 1_200,
    reasoning: "none",
    timeout: CLAUDE_TIMEOUT_MS,
  }));

  return Object.fromEntries(
    Object.entries(output).filter((entry): entry is [Polarity, string] => typeof entry[1] === "string" && entry[1].trim().length > 0),
  ) as Partial<Record<Polarity, string>>;
}

/** 4대 가치 "[ … 조사 결과 ]" 박스용 요약. 긍정·부정 카테고리를 함께 넣어 종합한다 —
 * 극성별 짧은 총평(runPolaritySummaries)과 용도가 다르다. 형식은 제품형별로 다르다:
 * SW형=존댓말 한 단락, 실제품형=개조식 불릿(2026-07-29 원본 대조). */
export async function runValueSummary(params: {
  valueLabel: string;
  byPolarity: Partial<Record<Polarity, { label: string; insight: string; clause_count: number }[]>>;
  productType?: ProductType;
}): Promise<string> {
  const productType = params.productType ?? "sw";
  const sections = (["positive", "negative"] as Polarity[])
    .flatMap((polarity) => {
      const categories = params.byPolarity[polarity];
      if (!categories?.length) return [];
      return [`## ${POLARITY_LABEL[polarity]} 의견`, ...categories.map((c) => `- [${c.label}] (${c.clause_count}건): ${c.insight}`)];
    })
    .join("\n");

  const system = productType === "physical" ? VALUE_SUMMARY_SYSTEM_PHYSICAL : VALUE_SUMMARY_SYSTEM_SW;
  const closing = productType === "physical"
    ? "위 내용을 종합한 조사 결과 요약을 개조식 불릿으로 작성하세요."
    : "위 내용을 한 단락으로 종합한 조사 결과 요약을 작성하세요.";

  const { text } = await withClaudeGuard(`value-summary:${params.valueLabel}`, () => generateText({
    model: anthropic(MODEL),
    instructions: { role: "system", content: system },
    prompt: `가치: "${params.valueLabel}"\n\n${sections}\n\n${closing}`,
    maxOutputTokens: 700,
    reasoning: "none",
    timeout: CLAUDE_TIMEOUT_MS,
  }));

  return text.trim();
}
