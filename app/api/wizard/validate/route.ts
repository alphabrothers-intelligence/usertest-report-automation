import { NextResponse } from "next/server";
import { z } from "zod";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { extractFeatureNames } from "@/lib/walla/schema";
import { filterWallaResponseRows } from "@/lib/walla/normalize";
import { hasEnterprisePrefix, uxHeadersMissingPrefix } from "@/lib/agent/profile";

// app/api/chat/route.ts의 validateInput 도구 본문을 그대로 옮긴 것 — LLM 없이 raw data
// 구조만 검증하는 결정론적 로직이라 채팅 없이도 그대로 재사용 가능하다.
const BodySchema = z.object({
  fileUrl: z.string().url(),
  fileName: z.string().optional(),
});

export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: body.error.message }, { status: 400 });
  }
  const { fileUrl, fileName } = body.data;

  const loaded = await loadWallaFromUrl(fileUrl);
  if (!loaded.ok || !loaded.parsed || !loaded.validation) {
    return NextResponse.json({ valid: false, error: loaded.fetchError });
  }

  const fixedFormat = loaded.validation.valid;
  const featureNames = fixedFormat ? extractFeatureNames(loaded.parsed.headerRow) : [];
  const respondentCount = filterWallaResponseRows(loaded.parsed.dataRows).length;
  // 리바랩스 형식(WALLA 59열)이 아니어도 받는다 — 정량·정성 단계는 역할 분류(범용 경로)로 계산한다
  // (wizard/quant-stats, questionSource). 예전엔 여기서 59열 검증 실패를 그대로 돌려줘 '다음'이 잠겼고,
  // WALLA에서 받은 다른 설문의 raw data는 업로드 화면에서 막혔다(2026-10-23 피매치 테스트 CSV 실측).
  // 막는 것은 읽을 응답이 아예 없을 때뿐이다.
  const valid = respondentCount > 0 && loaded.parsed.headerRow.length > 1;

  return NextResponse.json({
    fileName: fileName ?? null,
    valid,
    error: valid ? undefined : "응답이 들어 있는 행을 찾지 못했습니다. WALLA에서 받은 원본 파일(csv/xlsx)인지 확인해 주세요.",
    fixedFormat,
    questionColumnCount: loaded.parsed.headerRow.length,
    expectedColumnCount: loaded.validation.expectedColumnCount,
    actualColumnCount: loaded.validation.columnCount,
    respondentCount,
    featureNames,
    errors: loaded.validation.errors,
    uxMissingPrefix: uxHeadersMissingPrefix(loaded.parsed.headerRow),
    hasEnterprisePrefix: hasEnterprisePrefix(loaded.parsed.headerRow),
  });
}
