import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { deletePlan } from "@/lib/db/surveys";

export const runtime = "nodejs";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const blobUrl = await deletePlan((await params).id);
  if (!blobUrl) return NextResponse.json({ ok: false, error: "기획안을 찾지 못했습니다." }, { status: 404 });
  await del(blobUrl).catch(() => {}); // 기록은 이미 지웠다 — 파일이 남아도 목록엔 안 보인다
  return NextResponse.json({ ok: true });
}
