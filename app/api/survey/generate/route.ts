import { NextResponse } from "next/server";
import { z } from "zod";
import { createSurvey } from "@/lib/db/surveys";
import { readDocumentForModel } from "@/lib/productInfo/extractText";
import { generateSurvey } from "@/lib/survey/generate";

// 사전요청서 → 설문 문항. 만든 즉시 저장하고 id를 돌려준다 — 이후 화면의 수정은 PUT /api/survey/[id].
export const maxDuration = 300;

const BodySchema = z.object({ fileUrl: z.string().url(), fileName: z.string().optional() });

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ ok: false, error: body.error.message }, { status: 400 });
  try {
    const source = await readDocumentForModel(body.data.fileUrl);
    // PDF는 Claude가 그림으로도 읽으므로 스캔본도 된다. 글자로 넘기는 형식만 빈 문서를 걸러 낸다.
    if ("text" in source && source.text.trim().length < 50) throw new Error("문서에서 글자를 거의 읽지 못했습니다. PDF로 저장해 올려 주세요.");
    const draft = await generateSurvey(source);
    const id = await createSurvey(draft, body.data.fileName ?? null, { sourceFileUrl: body.data.fileUrl });
    return NextResponse.json({ ok: true, id, draft });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "설문 문항을 만들지 못했습니다." },
      { status: 500 },
    );
  }
}
