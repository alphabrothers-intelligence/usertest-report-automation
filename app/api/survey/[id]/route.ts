import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteSurvey, getSurvey, updateSurvey } from "@/lib/db/surveys";
import { SURVEY_TYPES } from "@/lib/survey/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const DraftSchema = z.object({
  companyName: z.string(),
  productName: z.string(),
  questions: z.array(z.object({
    id: z.string(), stage: z.string(), text: z.string(), type: z.enum(SURVEY_TYPES), options: z.array(z.string()),
    required: z.boolean(), followUp: z.boolean(), branchOn: z.string(), branchValue: z.string(), note: z.string(), caution: z.string().optional(),
  })),
  excludedFeatures: z.array(z.object({ name: z.string(), reason: z.string() })),
  reviewNotes: z.array(z.string()),
});

export async function GET(_: Request, { params }: Params) {
  const survey = await getSurvey((await params).id);
  return survey
    ? NextResponse.json({ ok: true, ...survey })
    : NextResponse.json({ ok: false, error: "설문 문항을 찾지 못했습니다." }, { status: 404 });
}

export async function PUT(request: Request, { params }: Params) {
  const draft = DraftSchema.safeParse(await request.json());
  if (!draft.success) return NextResponse.json({ ok: false, error: draft.error.message }, { status: 400 });
  const ok = await updateSurvey((await params).id, draft.data);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}

export async function DELETE(_: Request, { params }: Params) {
  const ok = await deleteSurvey((await params).id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404 });
}
