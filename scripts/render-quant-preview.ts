/**
 * DB/Claude 호출 없이 리바랩스 raw data의 정량 보고서를 렌더링한다.
 * 사용법: npx tsx scripts/render-quant-preview.ts
 *
 * output/pdf/에 생성한 PDF는 원본 PDF와 페이지 이미지로 직접 비교하는 기준 산출물이다.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { parseWallaWorkbook } from "../lib/walla/parse";
import { normalizeWallaRows } from "../lib/walla/normalize";
import { computeQuantStats } from "../lib/quant/compute";
import { registerFonts } from "../lib/pdf/fonts";
import { ReportDocument } from "../lib/pdf/ReportDocument";

async function main() {
  const rawPath = path.join(process.cwd(), "data", "[리바랩스]사용성테스트 raw data.xlsx");
  const raw = readFileSync(rawPath);
  const arrayBuffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  const parsed = parseWallaWorkbook(arrayBuffer);
  const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
  const quantStats = computeQuantStats(records, parsed.headerRow);

  registerFonts();
  const buffer = await renderToBuffer(
    ReportDocument({
    fileName: "리바랩스_원본재현_정량검증.pdf",
    generatedAt: "2025-09-05",
    quantStats,
    questions: [],
    recommendations: [],
    strategicInput: null,
    resultSummary: "정성 분석 및 제언은 검증 전 상태입니다.",
    productInfo: {
      companyName: "리바랩스",
      serviceName: "캣독런",
      homepage: "https://rebalabs.qshop.ai/",
      representative: "정 동 성",
      contactPerson: "정 동 성",
      serviceSummary: "걸음 수 측정 및 위치 트래킹 기술을 기반으로 사용자의 실제 활동량과 이동 거리를 측정하고, 이를 경험치로 변환하여 캐릭터를 육성하는 게임형 헬스케어 서비스",
      businessArea: "B2C",
      industry: "정보 통신",
      operatingEnvironment: "Web (Mobile)",
      businessStage: "시장 검증 단계",
    },
    }),
  );

  const outputDir = path.join(process.cwd(), "output", "pdf");
  mkdirSync(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "리바랩스_원본재현_정량검증.pdf");
  writeFileSync(outputPath, buffer);
  console.log(outputPath);
}

// @react-pdf/renderer가 내부적으로 unref된 작업을 써서, CJS tsx 실행에서는 Promise가
// 끝나기 전에 Node 이벤트 루프가 비어 프로세스가 조기 종료될 수 있다. 검증 산출물이
// 이전 PDF로 남는 것을 막기 위해 렌더가 끝날 때까지 명시적으로 이벤트 루프를 유지한다.
const keepAlive = setInterval(() => undefined, 1_000);
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => clearInterval(keepAlive));
