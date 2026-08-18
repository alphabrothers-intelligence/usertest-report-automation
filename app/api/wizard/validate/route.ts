import { NextResponse } from "next/server";
import { z } from "zod";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { extractFeatureNames } from "@/lib/walla/schema";
import { filterWallaResponseRows } from "@/lib/walla/normalize";

// app/api/chat/route.ts의 validateInput 도구 본문을 그대로 옮긴 것 — LLM 없이 raw data
// 구조만 검증하는 결정론적 로직이라 채팅 없이도 그대로 재사용 가능하다.
const BodySchema = z.object({
  fileUrl: z.string().url(),
  fileName: z.string().optional(),
});

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const { fileUrl, fileName } = body.data;

  const loaded = await loadWallaFromUrl(fileUrl);
  if (!loaded.ok || !loaded.parsed || !loaded.validation) {
    return NextResponse.json({ valid: false, error: loaded.fetchError });
  }

  const featureNames = loaded.validation.valid
    ? extractFeatureNames(loaded.parsed.headerRow)
    : [];

  return NextResponse.json({
    fileName: fileName ?? null,
    valid: loaded.validation.valid,
    expectedColumnCount: loaded.validation.expectedColumnCount,
    actualColumnCount: loaded.validation.columnCount,
    respondentCount: filterWallaResponseRows(loaded.parsed.dataRows).length,
    featureNames,
    errors: loaded.validation.errors,
  });
}
