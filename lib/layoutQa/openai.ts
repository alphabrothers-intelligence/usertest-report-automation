/**
 * OpenAI는 보고서를 "그리는" 역할이 아니라, 원본 페이지와 생성 페이지의 시각적 차이를
 * 구조화해 판정하는 QA 역할만 맡는다. 실제 수정은 PDF/차트 템플릿 코드가 수행한다.
 */
import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";

const LayoutFindingSchema = z.object({
  area: z.enum(["page", "header", "typography", "spacing", "chart", "table", "footer", "color"]),
  severity: z.enum(["blocking", "major", "minor"]),
  reference_observation: z.string(),
  generated_observation: z.string(),
  recommended_change: z.string(),
});

export const VisualLayoutReviewSchema = z.object({
  page_number: z.number(),
  fidelity_score: z.number().min(0).max(100),
  matches: z.array(z.string()),
  findings: z.array(LayoutFindingSchema),
  next_priority: z.string(),
});

export type VisualLayoutReview = z.infer<typeof VisualLayoutReviewSchema>;

export async function reviewVisualLayout({
  pageNumber,
  referenceImage,
  generatedImage,
}: {
  pageNumber: number;
  referenceImage: Uint8Array;
  generatedImage: Uint8Array;
}): Promise<VisualLayoutReview> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY가 없습니다. 시각 QA는 선택 기능이므로 PDF 생성 자체에는 영향이 없습니다.");
  }

  const { output } = await generateText({
    model: openai(process.env.OPENAI_LAYOUT_QA_MODEL ?? "gpt-5.6-terra"),
    instructions: `당신은 사용성테스트 결과보고서의 시각적 fidelity를 검수하는 전문 편집 디자이너입니다.
첫 번째 이미지는 원본 보고서, 두 번째 이미지는 같은 내용을 재현하려는 생성본입니다.
텍스트 내용의 문장 품질은 평가하지 말고, 페이지 레이아웃만 비교하세요.
특히 A4 여백, 장 배너, 글자 크기와 줄바꿈, 표 높이, 차트 캔버스 크기, 축/범례, 색상, 푸터를 확인합니다.
수정 제안은 "차트 높이를 150pt로"처럼 코드에서 적용 가능한 구체적 규칙으로 작성하세요.
이미지에 없는 내용을 추정하지 말고, 확인 가능한 차이만 보고하세요.`,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `페이지 ${pageNumber}의 원본 이미지입니다.` },
          { type: "file", mediaType: "image/jpeg", data: referenceImage },
          { type: "text", text: `페이지 ${pageNumber}의 생성 이미지입니다.` },
          { type: "file", mediaType: "image/jpeg", data: generatedImage },
        ],
      },
    ],
    output: Output.object({ schema: VisualLayoutReviewSchema }),
    reasoning: "low",
    maxOutputTokens: 3000,
  });

  return output;
}
