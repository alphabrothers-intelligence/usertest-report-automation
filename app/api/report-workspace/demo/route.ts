import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseWallaWorkbook } from "@/lib/walla/parse";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { computeQuantStats } from "@/lib/quant/compute";
import { buildReportWorkspaceSeed } from "@/lib/report/workspace";
import { getOrCreateRolePlan, applyOverrides, planSections } from "@/lib/agent/rolePlan";
import { computeRoleQuantStats } from "@/lib/agent/quant";
import { toQuantStats, surveyQuestionRowsFromRoles } from "@/lib/agent/toQuantStats";
import type { ProductInfo } from "@/lib/productInfo/types";

export const runtime = "nodejs";

/**
 * 보고서 스튜디오를 바로 검토할 수 있는 로컬 예시.
 * 업로드 없이 저장소의 원본 raw data를 매 요청마다 로컬 계산한다.
 *
 * 두 경로를 **같은 화면으로** 볼 수 있다 — 옛 경로와 새 경로가 정말 같은 보고서를 내는지
 * 눈으로 대조하는 것이 이 라우트의 쓸모다.
 *  - `?dataset=rivalabs`(기본): 옛 고정 경로(리바랩스 전용 컬럼 위치). LLM·DB 불필요.
 *  - `?dataset=<키>&generic=1`: 역할 분류 에이전트 경로. **DB와 ANTHROPIC_API_KEY가 필요**하며
 *    분류는 파일당 **한 번만** 일어난다(`role_plan`에 저장 → 두 번째 요청부터 캐시).
 */

type Demo = { key: string; name: string; file: string; productInfo: ProductInfo };

const RIVALABS_PRODUCT: ProductInfo = {
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
};

// 제품 정보는 Ⅰ장을 채우는 **담당자 입력값**이지 raw data에서 나오는 값이 아니다. 예시 화면에서는
// 회사·서비스명만 넣고 나머지는 비워 둔다 — 없는 정보를 지어내면 "입력 필요" 표시가 어떻게
// 보이는지 확인할 수 없다.
const DEMOS: Demo[] = [
  { key: "rivalabs", name: "리바랩스", file: "[리바랩스]사용성테스트 raw data.xlsx", productInfo: RIVALABS_PRODUCT },
  { key: "carecl", name: "케어클", file: "[케어클] 사용성테스트 raw data.csv", productInfo: { companyName: "케어클", serviceName: "케어클" } },
  { key: "ezenauto", name: "이젠오토", file: "[WALLA]_[이젠오토]_사용성_고객반응_설문조사_oS1LD_2608031228.csv", productInfo: { companyName: "이젠오토", serviceName: "이젠오토" } },
  { key: "cleanhabit", name: "정리습관", file: "[WALLA]_[정리습관]_사용성_고객반응_설문조사_2a2KD_2608031225.csv", productInfo: { companyName: "정리습관", serviceName: "정리습관" } },
  { key: "twoblock", name: "투블럭에이아이", file: "알파브라더스_투블럭에이아이_사용성테스트_2회차_RAW_data.csv", productInfo: { companyName: "투블럭에이아이", serviceName: "키위티" } },
];

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const demo = DEMOS.find((d) => d.key === (params.get("dataset") ?? "rivalabs"));
  if (!demo) {
    return NextResponse.json({ ok: false, error: `dataset은 ${DEMOS.map((d) => d.key).join(" · ")} 중 하나여야 합니다.` }, { status: 400 });
  }
  const generic = params.get("generic") === "1" || demo.key !== "rivalabs";

  try {
    const raw = await readFile(path.join(process.cwd(), "data", demo.file));
    const parsed = parseWallaWorkbook(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer);

    if (!generic) {
      const quantStats = computeQuantStats(normalizeWallaRows(parsed.headerRow, parsed.dataRows), parsed.headerRow);
      return NextResponse.json({
        ok: true,
        demo: true,
        dataset: demo.key,
        workspace: buildReportWorkspaceSeed({
          quantStats,
          fileName: `${demo.name} 사용성테스트 결과보고서`,
          resultSummary: `${demo.name} raw data를 기반으로 계산한 정량 분석 예시입니다. 정성 분석 결과는 승인 후 이 보고서에 추가됩니다.`,
          productInfo: demo.productInfo,
        }),
      });
    }

    // 분류는 파일당 한 번만 — 두 번째 요청부터는 DB에 저장된 판정을 그대로 쓴다.
    const plan = await getOrCreateRolePlan({
      fileUrl: `demo:${demo.key}`,
      fileName: demo.file,
      headerRow: parsed.headerRow,
      dataRows: parsed.dataRows,
    });
    const classification = applyOverrides(plan);
    const roleStats = computeRoleQuantStats(classification, plan.profiles, parsed.dataRows);

    return NextResponse.json({
      ok: true,
      demo: true,
      dataset: demo.key,
      workspace: buildReportWorkspaceSeed({
        quantStats: toQuantStats(roleStats, {
          surveyQuestions: surveyQuestionRowsFromRoles(classification, plan.profiles),
        }),
        sectionPlan: planSections(plan, parsed.dataRows),
        fileName: `${demo.name} 사용성테스트 결과보고서`,
        resultSummary: `${demo.name} raw data를 역할 분류 경로로 계산한 정량 분석 예시입니다. 정성 분석 결과는 승인 후 이 보고서에 추가됩니다.`,
        productInfo: demo.productInfo,
      }),
    });
  } catch (error) {
    console.error("[report-workspace demo]", error);
    return NextResponse.json({ ok: false, error: `${demo.name} 예시 보고서를 만들지 못했습니다.` }, { status: 500 });
  }
}