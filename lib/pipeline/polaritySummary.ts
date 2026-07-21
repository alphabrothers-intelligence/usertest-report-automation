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
import { generateText } from "ai";
import type { Polarity } from "./stage1";

const MODEL = process.env.ANTHROPIC_STAGE2_MODEL ?? "claude-sonnet-5";

const POLARITY_LABEL: Record<Polarity, string> = {
  positive: "긍정",
  negative: "부정",
  neutral: "중립",
};

const SYSTEM_PROMPT = `당신은 사용성테스트 결과보고서를 작성하는 애널리스트입니다.
주어진 카테고리별 인사이트 목록을 읽고, 해당 극성 전체를 아우르는 한 단락(2~4문장)
총평을 씁니다.

# 규칙
- 개별 카테고리를 나열하지 말고, 공통된 흐름이나 핵심 원인을 자연스러운 문장으로 종합하세요.
- 새로운 사실을 지어내지 말고, 주어진 인사이트에 있는 내용만 근거로 쓰세요.
- 화살표, 대괄호, 마크다운 기호를 쓰지 마세요 — 순수 문장만 출력합니다.`;

export async function runPolaritySummary(params: {
  questionLabel: string;
  polarity: Polarity;
  categories: { label: string; insight: string; clause_count: number }[];
}): Promise<string> {
  const { questionLabel, polarity, categories } = params;
  const categoryList = categories
    .map((c) => `- [${c.label}] (${c.clause_count}건): ${c.insight}`)
    .join("\n");

  const { text } = await generateText({
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
    timeout: 60000,
  });

  return text.trim();
}
