import { NextResponse } from "next/server";
import { z } from "zod";
import { reviewClausePolarity } from "@/lib/db/reports";

// 체크포인트 A(7.1절) 카드의 버튼 클릭이 직접 호출하는 경로. LLM을 거치지 않아 빠르고 비용이 없다.
const BodySchema = z.object({
  clauseId: z.string(),
  decision: z.enum(["approve", "positive", "negative", "neutral"]),
});

export async function PATCH(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }

  const { clauseId, decision } = body.data;
  await reviewClausePolarity(clauseId, decision === "approve" ? null : decision);
  return NextResponse.json({ ok: true });
}
