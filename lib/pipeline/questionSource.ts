/**
 * 업로드된 raw data 하나에서 **정성 분석 문항을 뽑는 유일한 자리**.
 *
 * 작업 등록(`POST /api/qualitative-jobs`)과 실행(`run-next`)이 각자 문항을 뽑으면 두 곳이
 * 어긋날 수 있다 — 등록은 16문항으로 해놓고 실행이 그 문항을 못 찾으면 작업이 통째로 막힌다.
 * 그래서 경로 선택(고정 스키마 / 역할 분류)을 여기 한 곳에서만 한다.
 *
 * - **리바랩스 형식(WALLA 59열)**: 기존 고정 경로. golden 검증이 이 경로 기준이라 그대로 둔다.
 * - **그 외**: 역할 분류 결과로 뽑는다. 예전에는 검증 실패로 작업 등록이 400이라 정성 분석을
 *   **시작조차 못 했다**(2026-09-09 QA에서 5종 중 4종이 여기서 막혀 있는 것을 확인).
 */
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { profileColumns } from "@/lib/agent/profile";
import { applyOverrides, getOrCreateRolePlan } from "@/lib/agent/rolePlan";
import { buildQuestionSpecs, buildQuestionSpecsFromRoles, type QuestionSpec } from "./questions";

export type QuestionSourceResult =
  | { ok: true; specs: QuestionSpec[]; mode: "walla" | "roles" }
  | { ok: false; error: string };

export async function loadQuestionSpecs(fileUrl: string, fileName: string | null): Promise<QuestionSourceResult> {
  const loaded = await loadWallaFromUrl(fileUrl);
  if (!loaded.ok || !loaded.parsed) {
    return { ok: false, error: loaded.fetchError ?? "원본 파일을 읽지 못했습니다. 파일을 다시 첨부한 뒤 재시도해주세요." };
  }
  const { headerRow, dataRows } = loaded.parsed;

  if (loaded.validation?.valid) {
    return { ok: true, mode: "walla", specs: buildQuestionSpecs(normalizeWallaRows(headerRow, dataRows)) };
  }

  // 분류는 파일당 한 번만 하고 reports.role_plan에 저장된다 — 정량 단계에서 이미 만들어졌으면
  // 여기서는 API를 부르지 않는다.
  const plan = await getOrCreateRolePlan({ fileUrl, fileName, headerRow, dataRows });
  const specs = buildQuestionSpecsFromRoles(applyOverrides(plan), profileColumns(headerRow, dataRows), dataRows);
  if (specs.length === 0) {
    return { ok: false, error: "이 파일에서 정성 분석할 서술형 응답을 찾지 못했습니다. 점수 문항 뒤에 이유를 적는 열이 있어야 합니다." };
  }
  return { ok: true, mode: "roles", specs };
}
