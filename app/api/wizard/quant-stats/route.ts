import { NextResponse } from "next/server";
import { z } from "zod";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { computeQuantStats } from "@/lib/quant/compute";
import { upsertReportQuantStats } from "@/lib/db/reports";

// app/api/chat/route.ts의 computeQuantStats 도구 본문을 그대로 옮긴 것 — 정량 계산은 항상
// 규칙 기반(LLM 미사용)이라 채팅 없이도 안전하게 재사용 가능하다.
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
    return NextResponse.json({ ok: false, error: loaded.fetchError });
  }
  if (!loaded.validation.valid) {
    return NextResponse.json({
      ok: false,
      error: "보고서에 필요한 응답 구조를 찾지 못했습니다. 원본 파일의 질문과 응답 열을 다시 확인해주세요.",
    });
  }

  const records = normalizeWallaRows(loaded.parsed.headerRow, loaded.parsed.dataRows);
  const stats = computeQuantStats(records, loaded.parsed.headerRow);
  await upsertReportQuantStats({
    fileUrl,
    fileName: fileName ?? null,
    respondentCount: records.length,
    quantStats: stats,
  });
  return NextResponse.json({ ok: true, stats });
}
