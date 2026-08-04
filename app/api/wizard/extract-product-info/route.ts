import { NextResponse } from "next/server";
import { z } from "zod";
import { extractTextFromDocument } from "@/lib/productInfo/extractText";
import { runProductInfoExtraction } from "@/lib/productInfo/extract";

// app/api/chat/route.ts의 extractProductInfoFromFile 도구 본문을 그대로 옮긴 것 — 유일하게
// LLM을 호출하는 마법사 2단계 지점(기업소개 파일 → 구조화 추출). 추출 결과는 AI 해석이
// 개입되므로 여기서 바로 저장하지 않고, 화면에서 사용자 확인을 받은 뒤 /api/wizard/product-info
// 로 저장한다(기존 chat 흐름과 동일 원칙).
const BodySchema = z.object({
  fileUrl: z.string().url().describe("기업소개 파일의 URL (raw data 파일 URL이 아님)"),
});

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  try {
    const text = await extractTextFromDocument(body.data.fileUrl);
    const extracted = await runProductInfoExtraction(text);
    return NextResponse.json({ ok: true, extracted });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "추출에 실패했습니다." },
      { status: 500 },
    );
  }
}
