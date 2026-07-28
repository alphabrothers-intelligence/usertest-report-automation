import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseWallaWorkbook } from "@/lib/walla/parse";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { computeQuantStats } from "@/lib/quant/compute";
import { buildReportWorkspaceSeed } from "@/lib/report/workspace";

export const runtime = "nodejs";

/**
 * 보고서 스튜디오를 바로 검토할 수 있는 리바랩스 정량 예시.
 * 업로드·DB·Claude 호출 없이 저장소의 원본 raw data를 매 요청마다 로컬 계산한다.
 * 실제 생성물은 기존 `/api/report-workspace?source=...` 경로로 계속 불러온다.
 */
export async function GET() {
  try {
    const rawPath = path.join(process.cwd(), "data", "[리바랩스]사용성테스트 raw data.xlsx");
    const raw = await readFile(rawPath);
    const arrayBuffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const parsed = parseWallaWorkbook(arrayBuffer);
    const records = normalizeWallaRows(parsed.headerRow, parsed.dataRows);
    const quantStats = computeQuantStats(records, parsed.headerRow);

    return NextResponse.json({
      ok: true,
      demo: true,
      workspace: buildReportWorkspaceSeed({
        quantStats,
        fileName: "리바랩스 사용성테스트 결과보고서",
        resultSummary: "리바랩스 캣독런 raw data를 기반으로 계산한 정량 분석 예시입니다. 정성 분석 결과는 승인 후 이 보고서에 추가됩니다.",
        productInfo: {
          companyName: "리바랩스",
          serviceName: "캣독런",
          homepage: "https://rebalabs.qshop.ai/",
          representative: "정 동 성",
          contactPerson: "정 동 성",
          serviceSummary: "걸음 수 측정 및 위치 트래킹을 기반으로 실제 활동을 게임 경험으로 전환하는 헬스케어 서비스",
          businessArea: "B2C",
          industry: "정보 통신",
          operatingEnvironment: "Web (Mobile)",
          businessStage: "시장 검증 단계",
        },
      }),
    });
  } catch (error) {
    console.error("[report-workspace demo]", error);
    return NextResponse.json({ ok: false, error: "리바랩스 예시 보고서를 만들지 못했습니다." }, { status: 500 });
  }
}
