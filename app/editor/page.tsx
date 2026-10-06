import { ContinuousEditor } from "@/components/continuous-editor/ContinuousEditor";
import { getReportById } from "@/lib/db/reports";

export const metadata = { title: "이어진 편집기 시제품 | 사용성테스트 결과보고서 자동생성" };

/** A안 시제품: `/editor?report=<id>&section=III`. 기존 `/viewer`와 분리해 둔다. */
export default async function EditorPage({ searchParams }: { searchParams: Promise<{ report?: string; section?: string }> }) {
  const params = await searchParams;
  const sourceFileUrl = params.report ? (await getReportById(params.report))?.file_url : undefined;
  if (!sourceFileUrl) return <p className="p-10 text-sm text-[#c44848]">?report=&lt;보고서 id&gt;가 필요합니다.</p>;
  return <ContinuousEditor sourceFileUrl={sourceFileUrl} numeral={params.section ?? "III"} />;
}
