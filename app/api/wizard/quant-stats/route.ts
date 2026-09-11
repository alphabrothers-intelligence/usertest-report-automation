import { NextResponse } from "next/server";
import { z } from "zod";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { computeQuantStats } from "@/lib/quant/compute";
import { upsertReportQuantStats } from "@/lib/db/reports";
import { saveRoleQuantStats } from "@/lib/agent/saveRoleQuantStats";

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
  const { headerRow, dataRows } = loaded.parsed;

  // **리바랩스 형식(WALLA 59열)이 아니어도 받는다**(2026-09-09). 예전에는 검증에 실패하면
  // 여기서 막아서 다른 raw data는 정량조차 못 냈다 — 범용 경로(역할 분류)는 데모 라우트에만
  // 배선돼 있었고 담당자가 파일을 올리는 진짜 흐름은 리바랩스 전용이었다.
  if (!loaded.validation.valid) {
    // 컬럼 역할은 파일당 한 번만 판정하고 reports.role_plan에 저장된다(재요청 시 0회 호출).
    // 확인 카드에서 역할을 고쳤을 때도 같은 함수를 다시 돌린다(lib/agent/saveRoleQuantStats.ts).
    const stats = await saveRoleQuantStats({ fileUrl, fileName: fileName ?? null, headerRow, dataRows });
    return NextResponse.json({ ok: true, stats });
  }

  const records = normalizeWallaRows(headerRow, dataRows);
  const stats = computeQuantStats(records, headerRow);
  await upsertReportQuantStats({
    fileUrl,
    fileName: fileName ?? null,
    respondentCount: records.length,
    quantStats: stats,
  });
  return NextResponse.json({ ok: true, stats });
}
