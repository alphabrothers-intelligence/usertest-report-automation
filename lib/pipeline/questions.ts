// 정성 처리 대상 14개 문항을 raw data 레코드에서 추출한다 (PRD 6.1절).
// 기능 6개 + 4대가치 4개 + 유사서비스만족도 1 + 전반적만족도 1 + NPS 1 + 개선아이디어 1 = 14.
import type { WallaRecord } from "@/lib/walla/normalize";
import type { ColumnProfile } from "@/lib/agent/profile";
import type { RoleClassification } from "@/lib/agent/classify";
import { itemNameOf } from "@/lib/agent/quant";
import { resolveFeatureDisplayNames } from "@/lib/walla/normalize";
import type { Stage1Input } from "./stage1";

export interface StandardQuestionSpec {
  id: string;
  label: string;
  kind: "standard";
  inputs: Stage1Input[];
}

export interface ImprovementQuestionSpec {
  id: string;
  label: string;
  kind: "improvement";
  inputs: { respondent_id: number; reason: string }[];
}

export type QuestionSpec = StandardQuestionSpec | ImprovementQuestionSpec;

function standardQuestion(
  id: string,
  label: string,
  entries: { respondentId: number; score: number | null; reason: string | null }[],
): StandardQuestionSpec {
  return {
    id,
    label,
    kind: "standard",
    inputs: entries
      .filter((e): e is { respondentId: number; score: number; reason: string | null } => e.score !== null)
      .map((e) => ({
        respondent_id: e.respondentId,
        score: e.score,
        reason: e.reason ?? "",
      })),
  };
}

export function buildQuestionSpecs(records: WallaRecord[]): QuestionSpec[] {
  const featureCount = records[0]?.featureSatisfaction.length ?? 0;

  const featureQuestions: StandardQuestionSpec[] = Array.from({ length: featureCount }, (_, i) => {
    const name = records[0]?.featureSatisfaction[i]?.name ?? `기능${i + 1}`;
    return standardQuestion(
      `feature:${name}`,
      `'${name}' 기능 만족도`,
      records.map((r) => ({
        respondentId: r.respondentId,
        score: r.featureSatisfaction[i]?.score ?? null,
        reason: r.featureSatisfaction[i]?.reason ?? null,
      })),
    );
  });

  const valueSpecs: [string, string, (r: WallaRecord) => { score: number | null; reason: string | null }][] = [
    ["values:functional", "기능적 가치 만족도", (r) => r.values.functional],
    ["values:aesthetic", "심미적 가치 만족도", (r) => r.values.aesthetic],
    ["values:economic", "경제적 가치 만족도", (r) => r.values.economic],
    ["values:social", "사회·공공적 이슈 가치 만족도", (r) => r.values.social],
  ];
  const valueQuestions: StandardQuestionSpec[] = valueSpecs.map(([id, label, pick]) =>
    standardQuestion(
      id,
      label,
      records.map((r) => {
        const sr = pick(r);
        return { respondentId: r.respondentId, score: sr.score, reason: sr.reason };
      }),
    ),
  );

  const priorServiceQuestion = standardQuestion(
    "priorService",
    "유사(경쟁) 걷기 서비스 만족도",
    records
      .filter((r) => r.priorService.hasExperience)
      .map((r) => ({
        respondentId: r.respondentId,
        score: r.priorService.satisfaction,
        reason: r.priorService.reason,
      })),
  );

  const overallQuestion = standardQuestion(
    "overallSatisfaction",
    "전반적인 만족도",
    records.map((r) => ({
      respondentId: r.respondentId,
      score: r.overallSatisfaction.score,
      reason: r.overallSatisfaction.reason,
    })),
  );

  const npsQuestion = standardQuestion(
    "nps",
    "NPS",
    records.map((r) => ({
      respondentId: r.respondentId,
      score: r.nps.score,
      reason: r.nps.reason,
    })),
  );

  const improvementQuestion: ImprovementQuestionSpec = {
    id: "improvementIdea",
    label: "개선 아이디어 제안",
    kind: "improvement",
    inputs: records
      .filter((r) => r.improvementIdea !== null)
      .map((r) => ({ respondent_id: r.respondentId, reason: r.improvementIdea as string })),
  };

  return [
    ...featureQuestions,
    ...valueQuestions,
    priorServiceQuestion,
    overallQuestion,
    npsQuestion,
    improvementQuestion,
  ];
}

// ============================================================================
// 범용 경로 — 역할 분류 결과에서 문항을 뽑는다 (2026-09-09)
//
// 위 `buildQuestionSpecs`는 **리바랩스 59열 배치를 위치로 읽는다.** 그래서 다른 raw data를
// 넣으면 컬럼이 통째로 어긋난다(실측: 케어클의 `피부 타입`이 기능 만족도로, 조작 불편 서술이
// 심미적 가치로 잡혔다). 정량·목차는 이미 역할 분류(`lib/agent/`)로 범용화돼 있었는데 정성만
// 옛 경로에 묶여 있어서, 5종 중 리바랩스 하나만 정성 분석이 가능했다.
//
// 여기서는 **같은 역할 분류 결과**로 문항을 뽑는다 — "어느 열이 기능 만족도인가"를 위치가
// 아니라 판정 결과에서 받는다. 출력 모양(QuestionSpec)은 같으므로 그 뒤 단계(Stage1/2·저장·
// 보고서)는 이 변화를 모른다.
// ============================================================================

/** 정성 분석 대상 역할. 척도 + 이유 컬럼 쌍이 있어야 분석할 내용이 있다. */
const QUALITATIVE_SCALE_ROLES = new Set(["feature", "task_flow", "value", "prior_service", "overall", "intent"]);
/** 여러 개면 NPS로 쓸 의향 문항을 고르는 신호(lib/agent/quant.ts와 같은 기준). */
const NPS_HEADER = /추천|NPS/i;

function cellText(row: unknown[], index: number): string {
  const value = row[index];
  return value === null || value === undefined ? "" : String(value).trim();
}

function cellNumber(row: unknown[], index: number): number | null {
  const text = cellText(row, index);
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function buildQuestionSpecsFromRoles(
  classification: RoleClassification,
  profiles: ColumnProfile[],
  dataRows: unknown[][],
): QuestionSpec[] {
  const byIndex = new Map(profiles.map((profile) => [profile.index, profile]));
  // 이유 컬럼은 **앞 척도 문항의 속성**이다(profile.reasonFor). 척도↔이유를 짝지어야 정성
  // 분석에 넣을 (점수, 서술) 쌍이 나온다.
  const reasonOf = new Map<number, ColumnProfile>();
  for (const profile of profiles) {
    if (profile.reasonFor !== undefined) reasonOf.set(profile.reasonFor, profile);
  }

  const scaleQuestions = classification.questions.filter((question) => {
    const profile = byIndex.get(question.columnIndex);
    return profile?.type === "scale" && QUALITATIVE_SCALE_ROLES.has(question.role) && reasonOf.has(question.columnIndex);
  });

  const intents = scaleQuestions.filter((question) => question.role === "intent");
  const npsColumn = (intents.find((question) => NPS_HEADER.test(byIndex.get(question.columnIndex)?.header ?? "")) ?? intents[0])?.columnIndex;

  // **기능 이름은 정량과 똑같아야 한다.** 정량은 순위 응답 컬럼의 긴 원문("실시간 위치 기반
  // 거점형 콘텐츠")을 정식 표시명으로 쓰는데(CLAUDE.md의 표시명 결정), 정성이 헤더의 짧은
  // 이름("실시간 거점형")을 쓰면 보고서에서 같은 기능이 둘로 보인다.
  const featureQuestions = scaleQuestions.filter((question) => question.role === "feature" || question.role === "task_flow");
  const rankColumns = classification.questions
    .filter((question) => byIndex.get(question.columnIndex)?.type === "rank")
    .map((question) => question.columnIndex);
  const featureNames = resolveFeatureDisplayNames(
    featureQuestions.map((question) => itemNameOf(byIndex.get(question.columnIndex)!, question.itemName)),
    dataRows,
    rankColumns,
  );
  const featureNameOf = new Map(featureQuestions.map((question, index) => [question.columnIndex, featureNames[index]]));

  // **타사 경험은 게이팅 문항이다.** "경험 있음"이라고 답한 사람만 대상이다 — 점수만 보고
  // 거르면 경험이 없다고 하고도 점수를 남긴 응답이 섞인다(리바랩스 실측: 91명 대 94명).
  const gate = classification.questions.find((question) => {
    const type = byIndex.get(question.columnIndex)?.type;
    // 쉼표가 섞이면 "경험 유무"도 multi로 프로파일링된다(리바랩스 24번) — 선택형이면 게이트다.
    return question.role === "prior_service" && (type === "single" || type === "multi");
  });
  const experienced = new Set(
    gate
      ? dataRows.flatMap((row, index) => (/있|네|예/.test(cellText(row, gate.columnIndex)) ? [index + 1] : []))
      : dataRows.map((_, index) => index + 1),
  );

  const specs: QuestionSpec[] = [];
  for (const question of scaleQuestions) {
    const profile = byIndex.get(question.columnIndex)!;
    const reason = reasonOf.get(question.columnIndex)!;
    const name = featureNameOf.get(question.columnIndex) ?? itemNameOf(profile, question.itemName);
    const entries = dataRows.map((row, index) => ({
      respondentId: index + 1,
      score: cellNumber(row, question.columnIndex),
      reason: cellText(row, reason.index) || null,
    }));

    // **id 접두는 보고서가 문항을 찾는 열쇠다**(workspace.ts의 questionsByKeyPrefix).
    // 태스크 플로우도 Ⅲ장이 `feature:`로 찾으므로 같은 접두를 쓴다.
    if (question.role === "feature" || question.role === "task_flow") {
      specs.push(standardQuestion(`feature:${name}`, `'${name}' 기능 만족도`, entries));
    } else if (question.role === "value") {
      specs.push(standardQuestion(`values:${name}`, `${name} 만족도`, entries));
    } else if (question.role === "prior_service") {
      specs.push(standardQuestion(
        "priorService",
        "유사(경쟁) 서비스 만족도",
        entries.filter((entry) => experienced.has(entry.respondentId)),
      ));
    } else if (question.role === "overall") {
      specs.push(standardQuestion("overallSatisfaction", "전반적인 만족도", entries));
    } else if (question.columnIndex === npsColumn) {
      specs.push(standardQuestion("nps", "NPS", entries));
    }
  }

  for (const question of classification.questions) {
    const profile = byIndex.get(question.columnIndex);
    if (question.role !== "improvement" || !profile || profile.type === "scale") continue;
    const inputs = dataRows
      .map((row, index) => ({ respondent_id: index + 1, reason: cellText(row, profile.index) }))
      .filter((entry) => entry.reason.length > 0);
    if (inputs.length > 0) specs.push({ id: "improvementIdea", label: "개선 아이디어 제안", kind: "improvement", inputs });
  }

  // 같은 id가 두 번 나오면(예: 전반적 만족도 문항이 둘) 앞의 것만 남긴다 — DB의
  // (report_id, question_key) 유니크 제약과 맞춘다.
  return specs.filter((spec, index) => specs.findIndex((other) => other.id === spec.id) === index);
}
