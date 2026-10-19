import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { buildSurveyPlanHwpx } from "@/lib/survey/plan";
import { planFileName, SurveyDraftSchema } from "@/lib/survey/types";

export const runtime = "nodejs";

/**
 * 화면의 설문(저장 전 수정 포함)으로 기획안 HWPX를 만든다. 템플릿에 케어클 문항이 들어 있어
 * 브라우저로 보내지 않고 서버에서만 읽는다(`next.config.ts`의 outputFileTracingIncludes).
 */
export async function POST(request: Request) {
  const draft = SurveyDraftSchema.safeParse(await request.json());
  if (!draft.success) return NextResponse.json({ ok: false, error: draft.error.message }, { status: 400 });
  const template = await readFile(path.join(process.cwd(), "templates", "survey-plan-template.hwpx"));
  const plan = draft.data.plan ?? { businessArea: "", testers: "", schedule: "", managers: "" };
  const bytes = await buildSurveyPlanHwpx(template, draft.data, plan);
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/hwp+zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(planFileName(draft.data.companyName))}`,
    },
  });
}
