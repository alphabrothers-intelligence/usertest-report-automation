import { NextResponse } from "next/server";
import { z } from "zod";
import { getReportByFileUrl, saveReportName, saveWorkspaceDraft } from "@/lib/db/reports";
import type { ReportSectionContent } from "@/lib/report/sections";

export const runtime = "nodejs";

const BodySchema = z.object({
  fileUrl: z.string().url(),
  /** 있으면 보고서 이름을 이 값으로 저장한다(빈 문자열이면 이름을 지운다). */
  name: z.string().optional(),
  /** 있으면 편집 초안을 저장한다. null이면 초안을 지운다("초안 초기화"). 필드 자체가 없으면
   * 이름만 바꾸고 초안은 건드리지 않는다. */
  sections: z.array(z.custom<ReportSectionContent>()).nullable().optional(),
});

/**
 * 웹 작업공간(스튜디오)의 "보고서 이름"·"초안 저장"을 서버에 영속화한다(2026-08-04 신규 —
 * components/ReportStudio.tsx의 localStorage 기반 초안을 대체). name과 sections는 독립적으로
 * 갱신할 수 있다 — 요청에 없는 필드는 건드리지 않는다.
 */
export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "잘못된 요청입니다." }, { status: 400 });
  }
  const { fileUrl, name, sections } = parsed.data;

  const report = await getReportByFileUrl(fileUrl);
  if (!report) {
    return NextResponse.json({ ok: false, error: "보고서를 찾을 수 없습니다." }, { status: 404 });
  }

  if (name !== undefined) await saveReportName(report.id, name);

  let savedAt: string | null = null;
  if (sections !== undefined) {
    const result = await saveWorkspaceDraft(report.id, sections);
    savedAt = result.savedAt;
  }

  return NextResponse.json({ ok: true, savedAt });
}
