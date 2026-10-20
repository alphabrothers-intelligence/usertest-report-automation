import { readFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createPlan, updateSurvey } from "@/lib/db/surveys";
import { buildSurveyPlanHwpx } from "@/lib/survey/plan";
import { planFileName, SurveyDraftSchema } from "@/lib/survey/types";

export const runtime = "nodejs";

const BodySchema = z.object({ surveyId: z.string().uuid(), draft: SurveyDraftSchema });

/**
 * 화면의 설문(저장 전 수정 포함)으로 기획안 HWPX를 만든다. 템플릿에 케어클 문항이 들어 있어
 * 브라우저로 보내지 않고 서버에서만 읽는다(`next.config.ts`의 outputFileTracingIncludes).
 * 만든 파일은 `기획안` 탭(/plan)에 남도록 private Blob에 올리고 기록한다. 설문도 같이 저장해
 * 기획안이 저장된 설문과 어긋나지 않게 한다(자동 저장 지연 중에 눌러도).
 */
export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ ok: false, error: body.error.message }, { status: 400 });
  const { surveyId, draft } = body.data;
  if (!(await updateSurvey(surveyId, draft))) return NextResponse.json({ ok: false, error: "설문 문항을 찾지 못했습니다." }, { status: 404 });
  const template = await readFile(path.join(process.cwd(), "templates", "survey-plan-template.hwpx"));
  const plan = draft.plan ?? { businessArea: "", testers: "", schedule: "", managers: "" };
  const bytes = await buildSurveyPlanHwpx(template, draft, plan);
  const fileName = planFileName(draft.companyName);
  const blob = await put(`plans/${fileName}`, Buffer.from(bytes), { access: "private", contentType: "application/hwp+zip", addRandomSuffix: true });
  await createPlan({ surveyId, draft, fileName, blobUrl: blob.url });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/hwp+zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
