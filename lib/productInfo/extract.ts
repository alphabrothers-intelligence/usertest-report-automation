// 기업/제품 소개 문서 원문에서 PRD 5.0절 필드를 구조화 추출한다. 이 프롬프트는 PRD 6장
// 소속이 아니라 v1.4 신규 기능이므로 "6장 프롬프트 불변" 원칙과 무관하게 자유롭게 작성한다.
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import { logClaudeUsage } from "@/lib/claudeUsage";
import type { ProductInfo } from "./types";

const MODEL = process.env.ANTHROPIC_CHAT_MODEL ?? "claude-sonnet-5";

const ProductInfoExtractionSchema = z.object({
  companyName: z.string().optional().describe("기업명"),
  homepage: z.string().optional().describe("홈페이지 URL"),
  representative: z.string().optional().describe("대표자명"),
  contactPerson: z.string().optional().describe("업무담당자명"),
  serviceName: z.string().optional().describe("서비스명"),
  serviceSummary: z.string().optional().describe("서비스 요약 설명"),
  businessArea: z.string().optional().describe("사업영역"),
  industry: z.string().optional().describe("산업분야"),
  operatingEnvironment: z.string().optional().describe("운영환경(예: iOS/Android, 웹 등)"),
  businessStage: z.string().optional().describe("사업화단계(예: 베타, 정식 출시 등)"),
  // 기업소개 문서에는 보통 없는 정보라 실제로 채워지는 일은 드물지만, ProductInfo 타입과
  // 필드 목록을 맞추기 위해 스키마에도 포함한다(문서에 있으면 추출, 없으면 그대로 비워둠).
  testPeriod: z.string().optional().describe("사용성 테스트 진행 기간"),
  testTarget: z.string().optional().describe("사용성 테스트 대상"),
  testManager: z.string().optional().describe("사용성 테스트 담당자"),
});

const SYSTEM_PROMPT = `당신은 기업 소개 문서에서 정해진 항목만 뽑아내는 추출 도구입니다.

# 절대 규칙
- 문서에 명시적으로 나온 내용만 채우세요. 문서에 없는 내용을 추측·창작하지 마세요.
- 특정 필드가 문서에 없으면 그 필드는 비워두세요(빈 문자열이나 추측값을 넣지 마세요).
- 문서 원문에 있는 표현을 최대한 그대로 사용하세요. 의역하거나 재작성하지 마세요.`;

export async function runProductInfoExtraction(documentText: string): Promise<ProductInfo> {
  const result = await generateText({
    model: anthropic(MODEL),
    instructions: { role: "system", content: SYSTEM_PROMPT },
    prompt: `다음 문서에서 기업/제품 정보를 추출하세요.\n\n${documentText}`,
    output: Output.object({ schema: ProductInfoExtractionSchema }),
    maxOutputTokens: 2000,
    // 규칙이 이미 명시된 단순 추출 작업이라 별도 reasoning이 불필요하다 —
    // stage1.ts의 상세 주석 참고(같은 이유로 다른 추출/분류 파이프라인에도 적용).
    reasoning: "none",
  });
  logClaudeUsage("product-info-extraction", result.usage);
  const { output } = result;

  const info: ProductInfo = {};
  // PRODUCT_INFO_FIELD_LABELS가 아니라 이 추출 스키마 자신의 키만 순회한다 — footerBrandName
  // 같은 필드는 ProductInfo 전체 필드 목록엔 있어도 "기업소개 문서에서 뽑아낼 수 있는 정보"가
  // 아니므로 이 스키마에 아예 없다(2026-07-21, footerBrandName 추가 때 두 목록이 어긋나며
  // 타입 에러로 발견됨 — 라벨 목록 대신 스키마 자체를 기준으로 삼으면 이런 어긋남이 재발하지
  // 않는다).
  for (const key of Object.keys(ProductInfoExtractionSchema.shape) as (keyof typeof ProductInfoExtractionSchema.shape)[]) {
    const value = output[key];
    if (value && value.trim() !== "") info[key] = value.trim();
  }
  return info;
}
