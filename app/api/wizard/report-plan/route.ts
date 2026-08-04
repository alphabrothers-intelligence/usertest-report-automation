import { NextResponse } from "next/server";
import { z } from "zod";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";

// app/api/chat/route.ts의 presentReportPlan 도구 본문을 그대로 옮긴 것 — 규칙 기반이라 LLM
// 호출이 없다. productType은 아직 buildReportPlan이 실제로 분기하진 않지만(실제품형은 준비중,
// lib/report/productType.ts 참고) 신호선을 미리 받아둔다.
const BodySchema = z.object({
  featureNames: z.array(z.string()),
  qualitativeQuestionCount: z.number().default(14),
  productType: z.enum(["sw", "physical"]).optional(),
});

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const { featureNames, qualitativeQuestionCount } = body.data;
  return NextResponse.json({
    sections: buildReportPlan(featureNames),
    qualitativeQuestionCount,
  });
}
