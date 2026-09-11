import { NextResponse } from "next/server";
import { z } from "zod";
import { readRolePlan, saveRoleOverride } from "@/lib/agent/rolePlan";
import { REVIEW_CONFIDENCE } from "@/lib/agent/classify";
import { saveRoleQuantStats } from "@/lib/agent/saveRoleQuantStats";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { getReportByFileUrl } from "@/lib/db/reports";
import type { QuestionRole } from "@/lib/agent/sectionPlan";

export const runtime = "nodejs";

const ROLES: QuestionRole[] = [
  "demographic", "context", "prior_service", "feature", "task_flow", "journey",
  "purchase_factor", "value", "ux_quality", "overall", "intent", "improvement", "meta",
];

/**
 * 역할 판정 확인 카드의 데이터. **AI가 스스로 확신이 낮다고 표시한 문항만** 돌려준다
 * (`confidence < REVIEW_CONFIDENCE`) — 전수를 보여주면 검수 피로만 늘고 정작 볼 것이 묻힌다
 * (6.4절 "전수 노출 시 검수 피로" 원칙과 같다).
 *
 * 리바랩스처럼 WALLA 59열 검증을 통과한 파일은 역할 분류를 애초에 하지 않으므로 빈 목록이다.
 */
export async function GET(request: Request) {
  const source = new URL(request.url).searchParams.get("source");
  if (!source) return NextResponse.json({ ok: false, error: "원본 파일 정보가 없습니다." }, { status: 400 });

  const plan = await readRolePlan(source);
  if (!plan) return NextResponse.json({ ok: true, items: [], roles: ROLES });

  const headerByIndex = new Map(plan.profiles.map((profile) => [profile.index, profile.header]));
  const overrides = plan.overrides ?? {};
  const items = plan.classification.questions
    .filter((question) => question.confidence < REVIEW_CONFIDENCE && overrides[question.columnIndex] === undefined)
    .map((question) => ({
      columnIndex: question.columnIndex,
      header: String(headerByIndex.get(question.columnIndex) ?? "").trim(),
      role: question.role,
      confidence: question.confidence,
      note: question.note ?? null,
    }));
  return NextResponse.json({ ok: true, items, roles: ROLES });
}

const PatchSchema = z.object({
  source: z.string().url(),
  columnIndex: z.number().int(),
  role: z.enum(ROLES as [QuestionRole, ...QuestionRole[]]),
});

/**
 * 담당자가 고른 역할을 저장하고 **그 자리에서 정량 통계·장 구성을 다시 계산한다**. 저장만 하고
 * 재계산을 다음 요청에 미루면 "고쳤는데 화면은 그대로"가 되어 고친 것인지 알 수 없다.
 *
 * ponytail: 이미 돌고 있는 의견 분석 job은 되돌리지 않는다 — 이 판정 변경으로 문항 키가 바뀌면
 * 그 문항은 실패로 남고 생성 화면의 "빠진 문항만 재시도"로 다시 돈다. job을 통째로 다시 만들면
 * 이미 쓴 API 비용이 날아가서, 드물게 나는 실패를 재시도로 흡수하는 쪽을 택했다.
 */
export async function PATCH(request: Request) {
  const body = PatchSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ ok: false, error: body.error.message }, { status: 400 });
  const { source, columnIndex, role } = body.data;

  await saveRoleOverride({ fileUrl: source, columnIndex, role });

  const loaded = await loadWallaFromUrl(source);
  if (!loaded.ok || !loaded.parsed) {
    return NextResponse.json({ ok: false, error: loaded.fetchError ?? "원본 raw data를 읽지 못했습니다." }, { status: 502 });
  }
  const report = await getReportByFileUrl(source);
  await saveRoleQuantStats({
    fileUrl: source,
    fileName: report?.file_name ?? null,
    headerRow: loaded.parsed.headerRow,
    dataRows: loaded.parsed.dataRows,
  });
  return NextResponse.json({ ok: true });
}
