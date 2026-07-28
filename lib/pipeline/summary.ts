// 결과요약 생성 (PRD 6.9절). Tier 1: 완전 자동생성 — 해석 없이 수치·순위만 개조식으로 서술.
// computeQuantStats의 결과만 근거로 하므로 이미 검증된 결정론적 데이터에 기반한다(4.1절).
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { logClaudeUsage } from "@/lib/claudeUsage";

const SUMMARY_MODEL = process.env.ANTHROPIC_SUMMARY_MODEL ?? "claude-sonnet-5";

// PRD 6.9절 [SYSTEM] 프롬프트 원문. 절대 의역·축약하지 않는다(4.4절 원칙).
const SUMMARY_SYSTEM_PROMPT = `당신은 사용성테스트 결과보고서의 "사용성테스트 결과 요약" 섹션을
작성합니다. 아래 입력된 각 섹션의 통계 결과만을 근거로, 객관적
사실을 개조식으로 요약하세요.

# 규칙
- 해석이나 추천을 추가하지 마세요. 데이터에 있는 수치와 순위만
  사실 그대로 서술하세요. (해석은 이 섹션의 역할이 아닙니다.
  해석은 6.5절의 별도 제언 모듈에서 처리됩니다.)
- 4대가치, 핵심구매요소, 종합만족도·NPS 순서로 정리하세요.
- 개조식(명사형 종결, "~함", "~됨")으로 작성하세요.`;

export async function runResultSummary(statsSummary: unknown): Promise<string> {
  const result = await generateText({
    model: anthropic(SUMMARY_MODEL),
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: JSON.stringify(statsSummary, null, 2),
    maxOutputTokens: 2000,
  });
  logClaudeUsage("result-summary", result.usage);
  return result.text;
}
