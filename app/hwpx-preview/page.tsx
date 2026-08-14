import { HwpxPreviewStudio } from "@/components/HwpxPreviewStudio";

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
  const params = await searchParams;
  const source = typeof params.source === "string" ? params.source : undefined;
  return <HwpxPreviewStudio sourceFileUrl={source} />;
}
