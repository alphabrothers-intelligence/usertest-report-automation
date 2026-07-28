// 제언 생성 — 헤지 워딩 강제 (PRD 6.5절). Tier 2: AI 초안 + 사용자 필수편집(체크포인트 B 대상②).
// Ⅳ. 핵심구매요소 해석 서술, Ⅸ. 개발우선순위제언·기능개선제안(As-is→To-be)에 재사용된다.
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { logClaudeUsage } from "@/lib/claudeUsage";

const RECOMMENDATION_MODEL = process.env.ANTHROPIC_RECOMMENDATION_MODEL ?? "claude-sonnet-5";

// PRD 6.5절 [SYSTEM] 프롬프트 원문. 절대 의역·축약하지 않는다(4.4절 원칙).
const RECOMMENDATION_SYSTEM_PROMPT = `당신은 사용성테스트 결과보고서의 "제언" 섹션을 작성하는 애널리스트입니다.

# 작성 규칙 (반드시 준수)
1. 먼저 데이터에 근거한 사실을 객관적으로 정리합니다.
   (예: "펫 레이싱 기능은 상대중요도 -2.27, 만족도 6.04점으로
   6개 기능 중 하위권입니다")
2. 그 다음 해석을 덧붙이되, 반드시 헤지(hedge) 워딩을 사용합니다.

   금지 표현 (사용하지 마세요):
   - "~이다" / "~다" 로 끝나는 단정적 서술
   - "~로 판단된다" / "~로 판단됨"
   - "~인 요소이다" / "~때문이다"

   필수 표현 (반드시 이 중 하나로 해석 문장을 마무리하세요):
   - "~로 해석할 수 있음"
   - "~로 볼 수 있음"
   - "~일 가능성이 있음"
   - "~로 보임"

3. 이 텍스트는 초안이며, 담당자가 검수 후 직접 수정합니다.
   확정적으로 들리는 표현을 피하세요.

# 예시
나쁜 예: "펫 레이싱 기능은 핵심 기능이 아니므로 개발 우선순위에서
         제외해야 한다."
좋은 예: "펫 레이싱 기능은 상대중요도(-2.27)와 만족도(6.04점) 모두
         낮은 편으로, 핵심 성과 거리가 있어 단기 개선 우선순위가
         낮은 기능으로 해석할 수 있습니다."`;

export async function runRecommendation({
  sectionLabel,
  dataSummary,
}: {
  sectionLabel: string;
  dataSummary: unknown;
}): Promise<string> {
  const result = await generateText({
    model: anthropic(RECOMMENDATION_MODEL),
    system: RECOMMENDATION_SYSTEM_PROMPT,
    prompt: `아래는 '${sectionLabel}' 관련 정량 분석 결과입니다.\n이 결과를 바탕으로 제언 문단을 작성하세요. (3~5문장)\n\n${JSON.stringify(dataSummary, null, 2)}`,
    maxOutputTokens: 2000,
  });
  logClaudeUsage(`recommendation:${sectionLabel}`, result.usage);
  return result.text;
}
