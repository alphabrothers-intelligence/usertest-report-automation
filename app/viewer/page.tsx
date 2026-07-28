import { ReportStudio } from "@/components/ReportStudio";

export const metadata = {
  title: "보고서 스튜디오 | 사용성테스트 결과보고서 자동생성",
};

const VALID_NUMERALS = new Set(["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"]);

export default async function ViewerPage({
  searchParams,
}: {
  searchParams: Promise<{ pdf?: string | string[]; source?: string | string[]; section?: string | string[] }>;
}) {
  const params = await searchParams;
  const pdfUrl = typeof params.pdf === "string" && params.pdf.startsWith("/api/download?")
    ? params.pdf
    : undefined;
  const sourceFileUrl = typeof params.source === "string" && /^https?:\/\//.test(params.source)
    ? params.source
    : undefined;
  // 목차 클릭으로 전환한 섹션을 URL(?section=)에 동기화해두면 새로고침·공유 링크로도 같은
  // 섹션이 유지된다(components/ReportStudio.tsx의 changeActiveSection 참고).
  const initialSection = typeof params.section === "string" && VALID_NUMERALS.has(params.section)
    ? params.section
    : undefined;
  // source 없이 스튜디오를 열었을 때도 빈 화면이 아니라, 사용자가 즉시 양식·차트·복사를
  // 검토할 수 있도록 리바랩스 정량 예시를 기본으로 연다.
  return <ReportStudio pdfUrl={pdfUrl} sourceFileUrl={sourceFileUrl} initialSection={initialSection} demo={!sourceFileUrl} />;
}
