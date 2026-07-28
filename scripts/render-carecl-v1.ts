/**
 * 케어클 실물제품형 정량 검증 PDF.
 * Claude API를 호출하지 않으며, CSV 파싱·중복 응답 제거·통계·PDF 렌더링만 수행한다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { registerFonts } from "../lib/pdf-rivalabs-v3/fonts";
import { CareclReportDocument } from "../lib/pdf-carecl-v1/ReportDocument";
import { computeCareclQuantStats } from "../lib/pdf-carecl-v1/quant";

async function main() {
  const stats = computeCareclQuantStats();
  registerFonts();
  const buffer = await renderToBuffer(CareclReportDocument({ stats }));
  const outputDir = path.join(process.cwd(), "output", "pdf");
  mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, "케어클_실물제품형_정량검증_v1.pdf");
  writeFileSync(output, buffer);
  console.log(JSON.stringify({ output, respondentCount: stats.respondentCount, rawRowCount: stats.rawRowCount, duplicateRowsRemoved: stats.duplicateRowsRemoved }, null, 2));
}

const keepAlive = setInterval(() => undefined, 1_000);
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
