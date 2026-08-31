/**
 * 역할 판정의 **저장·재사용 경로** (PRD 2.2.2절 2단계, docs/AGENT_PIPELINE_GUIDE.md 7장 보완책 1).
 *
 * 분류 자체는 `classify.ts`가 한다. 여기서 하는 일은 하나뿐이다 — **파일당 한 번만 분류한다.**
 *
 * 왜 필요한가: 같은 파일을 여러 번 돌리면 경계 문항의 답이 갈린다(모델이 재현성 옵션을
 * 지원하지 않고, 애초에 사람도 갈리는 판정이다). 실제 제품에서 분류는 파일당 한 번이면
 * 충분하므로, 첫 판정을 DB에 저장해두면 두 번째부터는 흔들릴 기회 자체가 없다.
 *
 * 담당자가 확인 카드에서 고친 내용(`overrides`)도 같은 JSON에 넣는다. 재분류(`force`)해도
 * overrides는 그대로 살아남는다 — 사람이 고친 것을 기계가 덮어쓰지 않는다.
 */
import { sql } from "@/lib/db/client";
import { profileColumns, type ColumnProfile } from "./profile";
import { runRoleClassification, toSectionPlanInput, type RoleClassification } from "./classify";
import { buildSectionPlan, type QuestionRole, type SectionPlan } from "./sectionPlan";

export type RolePlan = {
  classification: RoleClassification;
  profiles: ColumnProfile[];
  /** 담당자가 확인 카드/채팅에서 고친 역할. 컬럼 번호 → 역할. `meta`는 "보고서에 넣지 않음". */
  overrides: Record<number, QuestionRole>;
  classifiedAt: string;
};

/** 저장된 판정에 담당자 수정을 얹는다. 저장본을 건드리지 않고 읽을 때마다 적용한다. */
export function applyOverrides(plan: RolePlan): RoleClassification {
  const overrides = new Map(Object.entries(plan.overrides).map(([i, role]) => [Number(i), role]));
  if (overrides.size === 0) return plan.classification;

  const questions = plan.classification.questions.map((q) =>
    overrides.has(q.columnIndex) ? { ...q, role: overrides.get(q.columnIndex)!, confidence: 1 } : q,
  );

  // 미판정이었던 컬럼을 담당자가 지정했으면 문항 목록으로 올린다.
  const unassigned = plan.classification.unassigned.filter((item) => !overrides.has(item.columnIndex));
  for (const item of plan.classification.unassigned) {
    const role = overrides.get(item.columnIndex);
    if (!role) continue;
    const profile = plan.profiles.find((p) => p.index === item.columnIndex);
    questions.push({
      columnIndex: item.columnIndex,
      role,
      header: item.header,
      type: profile?.type ?? "text",
      confidence: 1,
      itemName: profile?.quotedName ?? item.header,
      groupKey: profile?.groupPrefix,
      scaleMax: profile?.scaleMax,
      reasonColumn: profile?.reasonFor,
      note: "담당자가 직접 지정",
    });
  }

  questions.sort((a, b) => a.columnIndex - b.columnIndex);
  return { ...plan.classification, questions, unassigned };
}

export function planSections(plan: RolePlan, dataRows: unknown[][]): SectionPlan {
  return buildSectionPlan(toSectionPlanInput(applyOverrides(plan), plan.profiles, dataRows));
}

/**
 * 저장된 판정이 있으면 그대로 쓰고, 없을 때만 분류한다(API 1회 · 약 27초 · 약 74원).
 *
 * `force`는 프롬프트·규칙을 고친 뒤 다시 판정할 때만 쓴다 — 담당자 수정은 유지된다.
 */
export async function getOrCreateRolePlan(params: {
  fileUrl: string;
  fileName: string | null;
  headerRow: unknown[];
  dataRows: unknown[][];
  force?: boolean;
}): Promise<RolePlan> {
  const stored = await readRolePlan(params.fileUrl);
  if (stored && !params.force) return stored;

  const profiles = profileColumns(params.headerRow, params.dataRows);
  const classification = await runRoleClassification({
    fileName: params.fileName ?? params.fileUrl,
    profiles,
  });
  const plan: RolePlan = {
    classification,
    profiles,
    overrides: stored?.overrides ?? {},
    classifiedAt: new Date().toISOString(),
  };
  await writeRolePlan(params.fileUrl, params.fileName, plan);
  return plan;
}

export async function readRolePlan(fileUrl: string): Promise<RolePlan | null> {
  const [row] = await sql<{ role_plan: RolePlan | null }[]>`
    select role_plan from reports where file_url = ${fileUrl}
  `;
  return row?.role_plan ?? null;
}

async function writeRolePlan(fileUrl: string, fileName: string | null, plan: RolePlan): Promise<void> {
  // quant_stats와 같은 upsert 패턴 — raw data 업로드 순서와 무관하게 reports 행이 생긴다.
  await sql`
    insert into reports (file_url, file_name, role_plan, updated_at)
    values (${fileUrl}, ${fileName}, ${sql.json(JSON.parse(JSON.stringify(plan)))}, now())
    on conflict (file_url) do update set
      role_plan = excluded.role_plan,
      updated_at = now()
  `;
}

/** 확인 카드/채팅에서 역할 하나를 고친다. 버튼과 자연어가 이 함수를 공유한다(기존 체크포인트 방식). */
export async function saveRoleOverride(params: {
  fileUrl: string;
  columnIndex: number;
  role: QuestionRole;
}): Promise<RolePlan> {
  const plan = await readRolePlan(params.fileUrl);
  if (!plan) throw new Error("아직 이 파일의 역할 판정이 없습니다.");
  const next: RolePlan = {
    ...plan,
    overrides: { ...plan.overrides, [params.columnIndex]: params.role },
  };
  await writeRolePlan(params.fileUrl, null, next);
  return next;
}