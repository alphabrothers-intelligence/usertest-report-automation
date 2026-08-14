import { getAllRecommendations, getQuestionsWithAllCategories, getReportByFileUrl } from "@/lib/db/reports";
import { buildRivalabsSwWebEditPatches } from "@/lib/hwpx/rivalabsSwTemplateMap";
import { buildStoredTemplateReportPayload } from "@/lib/hwpx/templatePayload";

type RequestBody = { source?: string; edits?: Record<string, string> };

/**
 * 새 /hwpx-preview 전용: 브라우저 수정값을 원본 HWPX의 안전 문단 패치 목록으로만 변환한다.
 * DB 저장·분석 재실행·원본 HWPX 파일 수정은 절대 하지 않는다.
 */
export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return Response.json({ ok: false, error: "수정값 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!body.source || !body.edits || typeof body.edits !== "object") {
    return Response.json({ ok: false, error: "보고서 원본 정보와 수정값이 필요합니다." }, { status: 400 });
  }

  const report = await getReportByFileUrl(body.source);
  if (!report?.quant_stats) return Response.json({ ok: false, error: "저장된 정량 결과를 찾을 수 없습니다." }, { status: 404 });

  try {
    const [qualitative, recommendations] = await Promise.all([
      getQuestionsWithAllCategories(report.id),
      getAllRecommendations(report.id),
    ]);
    const payload = buildStoredTemplateReportPayload({ report, qualitative, recommendations });
    const result = buildRivalabsSwWebEditPatches(payload, body.edits);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "HWPX 반영 목록을 만들지 못했습니다.",
    }, { status: 422 });
  }
}
