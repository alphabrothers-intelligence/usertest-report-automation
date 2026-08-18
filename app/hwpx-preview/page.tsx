import { HwpxPreviewStudio } from "@/components/HwpxPreviewStudio";
import { getRecentReports } from "@/lib/db/reports";
import { connection } from "next/server";

export const metadata = {
  title: "HWPX 양식 미리보기 | 사용성테스트 결과보고서 자동생성",
};

/**
 * 기존 /viewer와 분리된 HWPX 양식 렌더링 POC.
 * 분석·저장·다운로드 로직을 호출하거나 수정하지 않고, 저장된 작업공간 데이터를 읽어
 * 리바랩스 기준의 페이지형 웹 문서로만 표현한다.
 */
export default async function HwpxPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string | string[] }>;
}) {
  // 최신 저장 보고서 목록을 기준으로 렌더링해야 하므로 정적 빌드 결과를 재사용하지 않는다.
  await connection();
  const params = await searchParams;
  const requestedSource = typeof params.source === "string" ? params.source : undefined;
  // 직접 /hwpx-preview로 들어왔을 때 빈 데모(정량 예시만 있음)를 열지 않는다. 이미 저장된
  // 최신 보고서를 기본으로 선택해야 정량·정성·인용문·제언이 한 문서에서 바로 보인다.
  // DB 연결 자체가 불가능한 개발 환경에서만 기존 데모로 안전하게 폴백한다.
  let reports: Awaited<ReturnType<typeof getRecentReports>> = [];
  try {
    reports = await getRecentReports(30);
  } catch (error) {
    console.warn("[hwpx-preview] saved report list unavailable", error);
  }
  const source = requestedSource ?? reports[0]?.file_url;
  return <HwpxPreviewStudio
    sourceFileUrl={source}
    availableReports={reports.map((report) => ({
      fileUrl: report.file_url,
      label: report.report_name ?? report.company_name ?? report.file_name ?? "이름 없는 보고서",
    }))}
  />;
}
