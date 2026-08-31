/**
 * 정성 분석 대상 문항을 **역할 판정에서** 뽑는다 (PRD 2.2.2절 6단계).
 *
 * 옛 경로(`lib/pipeline/questions.ts`)는 리바랩스 14문항을 손으로 세어 컬럼 위치로 꺼냈다.
 * 여기서는 **"근거 서술(이유) 컬럼이 붙어 있는 문항"** 이라는 하나의 규칙으로 뽑는다 —
 * 정성 분석은 점수의 *이유*를 읽는 작업이라, 이유 컬럼이 없으면 애초에 분석할 재료가 없다.
 *
 * **Stage1/Stage2 프롬프트는 건드리지 않는다**(PRD 4.4절). 바뀌는 것은 "무엇을 넣는가"뿐이다.
 *
 * **항목명을 여기서 다시 만들지 않고 `RoleQuantStats`에서 그대로 가져온다.** 처음에는 같은
 * 규칙을 여기 옮겨 적었는데 곧바로 어긋났다 — 정량 쪽은 순위 컬럼 원문에서 정식 표시명
 * ("실시간 위치 기반 거점형 콘텐츠")을 뽑는데 여기서는 짧은 헤더 이름("실시간 거점형")이
 * 나왔다(2026-08-30 실측). 문항 키가 `feature:{이름}`이라 이름이 어긋나면 **정성 결과가
 * 저장은 되는데 화면의 그 기능에 안 붙는다.** 이름의 출처는 하나여야 한다.
 */
import type { ColumnProfile } from "./profile";
import type { RoleClassification } from "./classify";
import type { RoleQuantStats, ScaleStat } from "./quant";
import type { QuestionSpec, StandardQuestionSpec, ImprovementQuestionSpec } from "@/lib/pipeline/questions";

function cell(row: unknown[], index: number): string {
  const value = row[index];
  return value === null || value === undefined ? "" : String(value).trim();
}

function asScore(text: string): number | null {
  const cleaned = text.replace(/점|score/gi, "").trim();
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export function buildQuestionSpecsFromRoles(
  stats: RoleQuantStats,
  classification: RoleClassification,
  profiles: ColumnProfile[],
  dataRows: unknown[][],
): QuestionSpec[] {
  const profileOf = new Map(profiles.map((profile) => [profile.index, profile]));
  const reasonOf = new Map<number, number>();
  for (const question of classification.questions) {
    if (question.reasonColumn !== undefined) reasonOf.set(question.columnIndex, question.reasonColumn);
  }
  // 분류가 이유 컬럼을 안 실어 보내는 경로(시트 기반 검사 등)를 위해 프로파일러 판정도 함께 본다.
  for (const profile of profiles) {
    if (profile.reasonFor !== undefined && !reasonOf.has(profile.reasonFor)) reasonOf.set(profile.reasonFor, profile.index);
  }

  const specs: QuestionSpec[] = [];
  const usedKeys = new Set<string>();

  const add = (stat: ScaleStat, key: string, label: string) => {
    const reasonColumn = reasonOf.get(stat.columnIndex);
    // 이유 컬럼이 없으면 분석할 재료가 없다 — 점수만 있는 문항은 정량으로만 나간다.
    if (reasonColumn === undefined) return;

    // 이젠오토처럼 같은 이름의 문항이 여러 개인 raw data가 있다(설문 작성자가 문항을 복사하고
    // 이름을 안 고친 경우 — 헤더에 `(copy)`가 그대로 남아 있다). 키가 겹치면 DB의
    // `unique (report_id, question_key)`에 걸려 뒤 문항이 앞 문항을 덮어쓰므로 순번을 붙인다.
    // **이름을 우리가 고치지는 않는다** — 중복은 raw data의 사실이다.
    let unique = key;
    for (let n = 2; usedKeys.has(unique); n += 1) unique = `${key}#${n}`;
    usedKeys.add(unique);

    const inputs = dataRows
      .map((row, index) => ({
        respondent_id: index + 1,
        score: asScore(cell(row, stat.columnIndex)),
        reason: cell(row, reasonColumn),
      }))
      // 점수가 없는 응답자는 그 문항을 안 받은 것이다(게이팅 뒤 문항 등).
      .filter((entry): entry is { respondent_id: number; score: number; reason: string } => entry.score !== null);

    if (inputs.length > 0) specs.push({ id: unique, label, kind: "standard", inputs } satisfies StandardQuestionSpec);
  };

  // 문항 키 접두는 옛 경로와 같다 — 렌더러가 `feature:`·`values:` 접두로 문항을 찾고
  // (`questionsByKeyPrefix`), DB의 `questions.question_key`도 이 값이다.
  // Ⅲ장의 본체는 기능(feature)이든 단계(task_flow)든 같은 접두를 쓴다(같은 장이다).
  for (const feature of stats.features) add(feature, `feature:${feature.name}`, `'${feature.name}' 만족도`);
  for (const point of stats.journey) add(point, `journey:${point.name}`, `${point.name} 시점 만족도`);
  for (const value of stats.values) add(value, `values:${value.name}`, value.name);
  if (stats.overall) add(stats.overall, "overallSatisfaction", "전반적인 만족도");

  // **`ux_quality`는 일부러 뺐다** — 의미분별 척도(실용성/즐거움)는 양끝 형용사 사이의 위치를
  // 고르는 문항이라 자유서술 극성 판정과 성격이 다르다(PRD 6.7절, 옛 경로도 같은 이유로 제외).

  // NPS(추천 의향)는 `RoleQuantStats`에 점수 분포로만 담기므로 컬럼을 분류에서 직접 찾는다.
  const npsQuestion = classification.questions.find((q) => q.role === "intent" && q.reasonColumn !== undefined);
  if (npsQuestion) {
    const profile = profileOf.get(npsQuestion.columnIndex);
    if (profile) add({ ...(stats.overall ?? { mean: 0, sd: 0, n: 0, scaleMax: 10, distribution: [] }), columnIndex: npsQuestion.columnIndex, name: "NPS" }, "nps", "NPS");
  }

  // 개선 아이디어는 점수가 없는 자유서술 단독 문항이라 형태가 다르다(PRD 6.6절 변형 파이프라인).
  const improvement = classification.questions.find(
    (question) => question.role === "improvement" && profileOf.get(question.columnIndex)?.type === "text",
  );
  if (improvement) {
    const inputs = dataRows
      .map((row, index) => ({ respondent_id: index + 1, reason: cell(row, improvement.columnIndex) }))
      .filter((entry) => entry.reason !== "");
    if (inputs.length > 0) {
      specs.push({ id: "improvementIdea", label: "개선 아이디어 제안", kind: "improvement", inputs } satisfies ImprovementQuestionSpec);
    }
  }

  return specs;
}