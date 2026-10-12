import { NextResponse } from "next/server";
import { createSurvey, getSurvey } from "@/lib/db/surveys";
import { splitByProduct } from "@/lib/survey/types";

export const runtime = "nodejs";

/** 분기형 설문을 제품별 설문으로 나눠 새로 저장한다. 원래 설문은 그대로 둔다. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const survey = await getSurvey((await params).id);
  if (!survey) return NextResponse.json({ ok: false, error: "설문 문항을 찾지 못했습니다." }, { status: 404 });
  const parts = splitByProduct(survey.draft);
  if (!parts) return NextResponse.json({ ok: false, error: "제품별로 나눌 분기 문항이 없습니다." }, { status: 400 });
  const ids = [];
  for (const part of parts) ids.push(await createSurvey(part, survey.sourceFileName));
  return NextResponse.json({ ok: true, ids });
}
