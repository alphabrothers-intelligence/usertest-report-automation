import { NextResponse } from "next/server";
import { getRecentReports } from "@/lib/db/reports";

export const runtime = "nodejs";

/**
 * 채팅 좌측 "저장된 보고서" 목록용(2026-07-30 신규). Claude 호출·재분석 없이 이미 저장된
 * report 메타데이터만 최신순으로 조회한다. 이 앱은 사용자 구분이 없는 단일 팀 내부 도구라
 * 전체 목록을 그대로 반환한다.
 */
export async function GET() {
  const reports = await getRecentReports(30);
  return NextResponse.json({
    ok: true,
    reports: reports.map((r) => ({
      id: r.id,
      fileName: r.file_name,
      fileUrl: r.file_url,
      updatedAt: r.updated_at,
      companyName: r.company_name,
    })),
  });
}
