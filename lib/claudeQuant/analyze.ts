import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { ClaudeQuantReportSchema, type ClaudeQuantReport } from "./schema";
import { logClaudeUsage } from "@/lib/claudeUsage";

const model = process.env.ANTHROPIC_QUANT_MODEL ?? "claude-sonnet-5";

/** Claude가 산출한 정량 JSON만 렌더러에 넘긴다.
 * 문장형 정성 분석은 이 단계에서 절대 요청하지 않는다. */
export async function analyzeQuantWithClaude(rawData: unknown): Promise<ClaudeQuantReport> {
  const result = await generateText({
    model: anthropic(model),
    instructions: `당신은 사용성 테스트의 정량 분석기입니다. 제공된 raw data만 근거로
정확한 집계값을 계산하세요. 추측하거나 정성적 문장을 만들지 마세요.
기능별 점수 분포는 0점부터 10점까지 정확히 11개 정수 응답자 수로 반환하세요.
백분율은 소수 첫째 자리까지, 평균과 표준편차는 소수 둘째 자리까지 계산하세요.`,
    prompt: JSON.stringify(rawData),
    output: Output.object({ schema: ClaudeQuantReportSchema }),
    reasoning: "none",
    temperature: 0,
    maxOutputTokens: 16000,
  });
  logClaudeUsage("legacy-claude-quant", result.usage);
  return result.output;
}
