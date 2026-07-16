import { NextResponse } from "next/server";
import { z } from "zod";
import { approveInsight } from "@/lib/db/reports";

// 체크포인트 B(7.2절) 카드의 버튼 클릭이 직접 호출하는 경로. LLM을 거치지 않아 빠르고 비용이 없다.
const BodySchema = z.object({
  categoryId: z.string(),
  finalText: z.string().min(1),
});

export async function PATCH(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }

  const { categoryId, finalText } = body.data;
  await approveInsight(categoryId, finalText);
  return NextResponse.json({ ok: true });
}
