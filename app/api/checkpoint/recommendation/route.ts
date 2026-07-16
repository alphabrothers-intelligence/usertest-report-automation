import { NextResponse } from "next/server";
import { z } from "zod";
import { approveRecommendation } from "@/lib/db/reports";

// 체크포인트 B 대상②(7.2절) 카드의 버튼 클릭이 직접 호출하는 경로. LLM을 거치지 않는다.
const BodySchema = z.object({
  recommendationId: z.string(),
  finalText: z.string().min(1),
});

export async function PATCH(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }

  const { recommendationId, finalText } = body.data;
  await approveRecommendation(recommendationId, finalText);
  return NextResponse.json({ ok: true });
}
