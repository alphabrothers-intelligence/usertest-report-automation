/**
 * 역할 기반 통계(`RoleQuantStats`, 4단계) → 렌더러가 읽는 `QuantStats`.
 *
 * **왜 어댑터인가**: 렌더러 15개 파일이 `QuantStats`의 고정 칸을 77곳에서 읽는다. 타입을 한
 * 번에 갈아엎으면 그 77곳이 동시에 깨진다 — 대신 여기서 모양을 맞춰주면 **어떤 raw data든
 * 기존 렌더러가 그대로 그린다.**
 *
 * **고정 칸에 담기지 않는 것은 억지로 담지 않는다.** `QuantStats.demographics`는 걷기 앱
 * 전용 칸(`os`·`avgWalkTime`·`walkFrequencyPerWeek`)이고 `fourValues`는 축 4개, `uxQuality`는
 * 계열 2개로 이름까지 박혀 있다. 가치 축이 3개인 데이터는 담을 칸이 없다. 그래서 그 세 칸은
 * 옛 경로 호환을 위해 **가능한 만큼만** 채우고, 진짜 값은 `generic`에 배열 그대로 실어 보낸다
 * — Ⅱ·Ⅴ·Ⅵ장 렌더러가 `generic`을 읽도록 바꾸는 것이 다음 작업이다.
 *
 * ponytail: `generic`은 전환용 동거 필드다. Ⅱ·Ⅴ·Ⅵ 렌더러가 전부 넘어가면 고정 칸
 * (`demographics.os`·`fourValues`·`uxQuality`)을 지우고 `generic`을 본체로 올린다.
 */
import type { QuantStats, FeatureStat } from "@/lib/quant/compute";
import type { CategoryCount, CrossTabRow, MeanSd } from "@/lib/quant/basic";
import type { SurveyQuestionRow } from "@/lib/pipeline/surveyQuestions";
import type { CrossAnalysis } from "@/lib/quant/crossAnalysis";
import type { RoleQuantStats, ScaleStat, ChoiceStat } from "./quant";
import type { ColumnProfile } from "./profile";
import type { QuestionRole } from "./sectionPlan";

const EMPTY_MEAN_SD: MeanSd = { mean: 0, sd: 0, n: 0 };
/** 성별 문항을 고르는 신호. 교차표·범례에서 "성별"이라는 축이 따로 필요하다. */
const GENDER_HEADER = /성별|gender/i;

/**
 * 척도 문항 하나. `ScaleStat`보다 느슨하다 — 옛 경로(`QuantStats`)에는 `columnIndex`·`scaleMax`가
 * 없어서, 그쪽에서도 같은 타입으로 채울 수 있어야 렌더러가 **한 갈래로만** 짜인다.
 */
export type AxisStat = {
  name: string;
  mean: number;
  sd: number;
  n: number;
  scaleMax?: number;
  distribution?: number[];
};

/** 데이터에서 나온 그대로의 값. 개수·이름이 고정되지 않는다. */
export type GenericStats = {
  /** 선택형 문항 전부(인적·습관·선택형 시점 …). 역할로 걸러 쓴다. */
  choices: Pick<ChoiceStat, "role" | "question" | "distribution">[];
  /** 3장의 성격 — 기능별인가 단계별인가. */
  featureRole: "feature" | "task_flow" | null;
  /** 가치 축. **개수·이름 모두 데이터에서 나온다.** */
  valueAxes: AxisStat[];
  /** 의미분별 척도 계열별 묶음. 계열 수도 데이터에서 나온다. */
  uxGroups: { groupKey: string; items: AxisStat[] }[];
  /** 시점 흐름 문항(고객 여정). 없으면 빈 배열이고 그 장은 드롭된다. */
  journey: AxisStat[];
  /** 구매요소별 만족도(있는 raw data만). */
  purchaseFactorSatisfaction: AxisStat[];
};

/**
 * 역할 → Ⅰ장 3절 "설문 항목" 표의 단계 이름.
 *
 * 옛 경로(`buildSurveyQuestionRows`)는 **컬럼 위치로** 단계를 정해서 리바랩스에서만 맞았다.
 * 여기서는 역할로 정하므로 어떤 raw data든 그 데이터의 실제 문항이 실제 단계에 들어간다.
 * 이름은 목차의 장 제목과 같아야 한다 — 표에는 "기능별"인데 목차는 "단계별"이면 어긋나 보인다.
 */
export const STAGE_OF_ROLE: Partial<Record<QuestionRole, string>> = {
  demographic: "인적 사항 및 특성 조사",
  context: "인적 사항 및 특성 조사",
  prior_service: "인적 사항 및 특성 조사",
  feature: "기능별 고객 경험 평가",
  task_flow: "단계별 고객 경험 평가",
  journey: "고객 여정 기반 경험 평가",
  purchase_factor: "핵심구매요소",
  value: "4대 가치 만족도",
  ux_quality: "사용자 경험 품질 평가",
  overall: "종합 만족도 및 NPS 지수",
  intent: "종합 만족도 및 NPS 지수",
  improvement: "개선 아이디어",
};

/**
 * Ⅰ장 3절 설문 항목 표를 **역할 판정에서** 만든다. 문항 문구는 raw data 헤더 원문 그대로다
 * ("raw data가 ground truth" 원칙).
 *
 * **이유 컬럼은 문항으로 세지 않는다** — 앞 문항의 속성이라 따로 세면 문항 수가 두 배가 된다
 * (목차 조립기가 가치 4개를 8개로 세던 것과 같은 함정, `toSectionPlanInput`도 같은 규칙).
 */
export function surveyQuestionRowsFromRoles(
  classification: { questions: { columnIndex: number; role: QuestionRole }[] },
  profiles: ColumnProfile[],
): SurveyQuestionRow[] {
  const profileOf = new Map(profiles.map((profile) => [profile.index, profile]));
  return classification.questions
    .filter((question) => profileOf.get(question.columnIndex)?.reasonFor === undefined)
    .map((question) => ({ stage: STAGE_OF_ROLE[question.role], profile: profileOf.get(question.columnIndex) }))
    .filter((row): row is { stage: string; profile: ColumnProfile } => !!row.stage && !!row.profile)
    .map((row) => ({ stage: row.stage, question: row.profile.header.replace(/\s+/g, " ").trim() }))
    .filter((row) => row.question !== "");
}

function toFeatureStat(stat: ScaleStat): FeatureStat {
  return { name: stat.name, mean: stat.mean, sd: stat.sd, n: stat.n, scoreDistribution: stat.distribution };
}

function toMeanSd(stat: ScaleStat | null | undefined): MeanSd {
  return stat ? { mean: stat.mean, sd: stat.sd, n: stat.n } : EMPTY_MEAN_SD;
}

function choiceOf(choices: ChoiceStat[], test: RegExp): CategoryCount[] {
  return choices.find((c) => test.test(c.question))?.distribution ?? [];
}

export function toQuantStats(
  role: RoleQuantStats,
  extra: {
    surveyQuestions?: SurveyQuestionRow[];
    /** 성별×연령대 교차표. 두 문항이 다 있을 때만 계산되므로 호출부가 넘긴다. */
    genderByAgeBracket?: CrossTabRow[];
    /** Ⅶ 교차 분석. 고정 경로 타입과 모양이 달라 호출부가 변환해 넘긴다. */
    crossAnalysis?: CrossAnalysis;
  } = {},
): QuantStats & { generic: GenericStats } {
  const demographicChoices = role.choices.filter((c) => c.role === "demographic" || c.role === "context");

  return {
    respondentCount: role.respondentCount,
    demographics: {
      age: role.age ? { mean: role.age.mean, sd: role.age.sd, n: role.age.n } : EMPTY_MEAN_SD,
      ageDistribution: role.age?.brackets ?? [],
      gender: choiceOf(demographicChoices, GENDER_HEADER),
      // 걷기 앱 전용 칸 — 다른 데이터셋에는 대응하는 문항이 없다. 억지로 아무 문항이나
      // 넣으면 "하루 평균 걷는 시간" 자리에 엉뚱한 문항이 그려진다. 비워두고 generic을 쓴다.
      os: [],
      avgWalkTime: [],
      walkFrequencyPerWeek: [],
      priorServiceExperienceRate: role.priorService?.experienceRate ?? 0,
      priorServiceSatisfaction: role.priorService?.satisfaction ?? EMPTY_MEAN_SD,
      genderByAgeBracket: extra.genderByAgeBracket ?? [],
    },
    featureSatisfaction: role.features.map(toFeatureStat),
    relativeImportance: role.purchaseFactor.relativeImportance,
    rankPositionComposition: role.purchaseFactor.rankComposition,
    keyFactorDistribution: choiceOf(
      role.choices.filter((c) => c.role === "purchase_factor"),
      /./,
    ),
    // 축 4개 고정 칸이라 앞에서부터 넣는 것 말고 할 수 있는 게 없다. 축이 3개면 마지막이
    // 빈 값이고 5개면 다섯째가 잘린다 — 그래서 Ⅴ장 렌더러는 generic.valueAxes를 봐야 한다.
    fourValues: {
      functional: toMeanSd(role.values[0]),
      aesthetic: toMeanSd(role.values[1]),
      economic: toMeanSd(role.values[2]),
      social: toMeanSd(role.values[3]),
    },
    uxQuality: {
      usability: (role.uxQuality[0]?.items ?? []).map(toFeatureStat),
      fun: (role.uxQuality[1]?.items ?? []).map(toFeatureStat),
    },
    overallSatisfaction: toMeanSd(role.overall),
    overallSatisfactionDistribution: role.overall?.distribution,
    nps: role.nps ?? { n: 0, promoterPct: 0, passivePct: 0, detractorPct: 0, npsScore: 0, rawMean: 0 },
    crossAnalysis: extra.crossAnalysis ?? { byAgeGroup: [], byGender: [] },
    surveyQuestions: extra.surveyQuestions ?? [],
    generic: {
      choices: role.choices,
      featureRole: role.featureRole,
      valueAxes: role.values,
      uxGroups: role.uxQuality,
      journey: role.journey,
      purchaseFactorSatisfaction: role.purchaseFactor.satisfaction,
    },
  };
}