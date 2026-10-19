import { NextResponse } from "next/server";
import { deleteSurvey, getSurvey, updateSurvey } from "@/lib/db/surveys";
import { SurveyDraftSchema as DraftSchema } from "@/lib/survey/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };


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
