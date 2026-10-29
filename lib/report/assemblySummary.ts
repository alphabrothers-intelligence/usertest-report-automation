import { saveReportResultSummary } from "@/lib/db/reports";
import { runResultSummary } from "@/lib/pipeline/summary";
import type { loadAssemblyData } from "@/lib/report/assemblyData";

/** 문서 형식과 관계없이 저장된 결과요약을 우선 사용하고, 없을 때만 생성해 캐시한다. */
export async function resolveAssemblyResultSummary(
  data: NonNullable<Awaited<ReturnType<typeof loadAssemblyData>>>,
  suppliedResultSummary?: string,
): Promise<string> {
  const { report, questions } = data;
  const resultSummary = suppliedResultSummary ?? report.result_summary ?? await runResultSummary({
    quantStats: report.quant_stats,
    qualitative: questions,
    sectionAnalyses: report.section_analyses,
    productType: report.product_type,
  });
  if (!suppliedResultSummary && !report.result_summary) {
    await saveReportResultSummary(report.id, resultSummary);
  }
  return resultSummary;
}
