import { BriefReport } from "@/components/BriefReport";

export const metadata = {
  title: "축소판 요약본 | 사용성테스트 결과보고서 자동생성",
};

/**
 * 축소판(요약본) 전용 화면. **전체 보고서(`/viewer`)와 분리된 경로**다 — 담당자가 두 판을
 * 나란히 열어 분량을 비교할 수 있게 주소부터 따로 둔다.
 *
 * `?source=` 는 실제 업로드한 보고서, `?dataset=` 은 예시 raw data(정량만)를 연다.
 */
export default async function BriefPage({
  searchParams,
}: {
  searchParams: Promise<{ dataset?: string | string[]; source?: string | string[] }>;
}) {
  const params = await searchParams;
  const dataset = typeof params.dataset === "string" ? params.dataset : undefined;
  const source = typeof params.source === "string" && /^https?:\/\//.test(params.source) ? params.source : undefined;
  return <BriefReport dataset={dataset} source={source} />;
}
