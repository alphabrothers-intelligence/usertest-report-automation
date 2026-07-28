import { getReportByFileUrl, getQuestionsWithAllCategories } from "../lib/db/reports";
import { buildReportWorkspaceSeed } from "../lib/report/workspace";

const URL = "https://qe82qvnkulxqqgax.private.blob.vercel-storage.com/%5B%E1%84%85%E1%85%B5%E1%84%87%E1%85%A1%E1%84%85%E1%85%A2%E1%86%B8%E1%84%89%E1%85%B3%5D%E1%84%89%E1%85%A1%E1%84%8B%E1%85%AD%E1%86%BC%E1%84%89%E1%85%A5%E1%86%BC%E1%84%90%E1%85%A6%E1%84%89%E1%85%B3%E1%84%90%E1%85%B3%20raw%20data-Kmh0S2mt2556tqw8RQrIlKpcDp3Sec.xlsx";

async function main() {
  const report = await getReportByFileUrl(URL);
  if (!report?.quant_stats) { console.log("report/quant_stats 없음"); return; }
  const qualitative = await getQuestionsWithAllCategories(report.id);
  try {
    const ws = buildReportWorkspaceSeed({
      quantStats: report.quant_stats,
      productInfo: report.product_info,
      fileName: report.file_name,
      resultSummary: report.result_summary,
      qualitative,
    });
    console.log("성공 — 섹션 수:", ws.sections.length);
  } catch (e) {
    console.log("=== buildReportWorkspaceSeed 에러 ===");
    console.log(e instanceof Error ? e.stack : String(e));
  }
}
main().catch((e) => console.log("최상위 에러:", e instanceof Error ? e.stack : String(e)));
