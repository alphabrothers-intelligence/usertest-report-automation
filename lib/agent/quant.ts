/**
 * 역할 기반 정량 계산 — 범용화 파이프라인 4단계(`docs/AGENT_PIPELINE_GUIDE.md`).
 *
 * **AI를 쓰지 않는다.** 입력은 1단계 프로파일 + 2단계 역할 판정 + 응답 행이고, 출력은
 * 어느 raw data에도 담기는 통계 그릇이다.
 *
 * ## 옛 경로와 무엇이 다른가
 *
 * `lib/quant/compute.ts`는 **컬럼 위치가 고정**(WALLA 59열)이고 그릇 이름도 걷기 앱 모양이다
 * (`os`·`avgWalkTime`·`fourValues.functional`·`uxQuality.usability`). 가치 축이 3개거나 이름이
 * 다르면 담을 칸이 없다. 여기서는 **역할이 열을 고르고, 이름은 데이터에서 나온다** — 가치가
 * 몇 개든 `values` 배열이고, UX 계열이 몇 개든 `uxQuality` 배열이다.
 *
 * **계산 자체는 옛 경로와 같은 함수**(`lib/quant/basic.ts`)를 쓴다. 바뀐 것은 "어느 열에서
 * 값을 꺼내 어떤 이름으로 담느냐" 하나뿐이라, 리바랩스를 이 경로로 통과시키면 옛 경로와 값이
 * 전부 같아야 한다 — 그게 `npm run check:role-quant`이 확인하는 안전망이다.
 */
import type { ColumnProfile } from "./profile";
import { TIME_MARKER, type RoleClassification } from "./classify";
import type { QuestionRole } from "./sectionPlan";
import { alignToFeatureName, resolveFeatureDisplayNames } from "@/lib/walla/normalize";
import {
  AGE_BRACKETS,
  ageBracketDistribution,
  ageBracketLabel,
  categoryDistribution,
  computeNps,
  meanSd,
  normalizeRangeOptionLabel,
  rankPositionComposition,
  relativeImportance,
  scoreHistogram,
  type CategoryCount,
  type MeanSd,
  type NpsResult,
  type RankPositionComposition,
} from "@/lib/quant/basic";

/** 나이는 구간으로 묶어야 비교 그룹이 된다(classify.ts의 같은 상수와 같은 이유). */
const AGE_HEADER = /나이|연령|age/i;
/** 성별 문항을 고르는 신호. **교차 분석 축은 연령대와 성별뿐이다**(위 crossAnalysis 주석 참고). */
const GENDER_HEADER = /성별|gender/i;
/** 교차 분석 축으로 쓸 수 있는 그룹 최소 인원. 3단계 조건표(`sectionPlan.ts`)와 같은 기준. */
const MIN_GROUP_SIZE = 5;
/** NPS로 쓸 의향 문항. 여러 개면 이걸로 고른다(사용 의향 vs 추천 의향). */
const NPS_HEADER = /추천|NPS/i;

export type ScaleStat = MeanSd & {
  columnIndex: number;
  name: string;
  scaleMax: number;
  /** 점수별 응답자 수(인덱스 = 점수). 만족도 분포도 막대그래프용. */
  distribution: number[];
};

export type ChoiceStat = {
  columnIndex: number;
  role: QuestionRole;
  /** 문항 원문. 도표 제목으로 그대로 쓴다. */
  question: string;
  distribution: CategoryCount[];
};

export type CrossGroup = {
  group: string;
  n: number;
  features: { name: string; mean: number }[];
  values: { name: string; mean: number }[];
  uxQuality: { name: string; mean: number }[];
};

/** 인적 범주 하나를 기준으로 한 교차 분석(연령대별·성별 등). */
export type CrossAxis = { columnIndex: number; by: string; groups: CrossGroup[] };

export type RoleQuantStats = {
  respondentCount: number;
  /** 나이 문항이 있으면 평균·SD와 연령대 분포. */
  age: (MeanSd & { columnIndex: number; brackets: CategoryCount[] }) | null;
  /**
   * 척도가 아닌 **선택형 문항 전부**(인적·습관·핵심요인·선택형 시점 문항 …). 역할별로 따로
   * 담지 않고 한 배열에 `role`을 붙여 담는다 — 역할마다 칸을 만들면 그 칸이 없는 역할의
   * 선택형 문항이 조용히 사라진다(케어클 사용 주기·사용 시간이 `journey`인데 선택형이라
   * 실제로 그렇게 빠졌다, 2026-08-27). 쓰는 쪽에서 `role`로 거른다.
   */
  choices: ChoiceStat[];
  /** 3장의 본체. `feature`와 `task_flow`가 섞이면 많은 쪽이 그 장의 성격이다(3단계와 같은 규칙). */
  featureRole: "feature" | "task_flow" | null;
  features: ScaleStat[];
  journey: ScaleStat[];
  /** 가치 축. **개수·이름 모두 데이터에서 나온다**(4개 고정 아님). */
  values: ScaleStat[];
  /** 의미분별 척도 계열별 묶음(실용성·즐거움 …). 계열 수도 데이터에서 나온다. */
  uxQuality: { groupKey: string; items: ScaleStat[] }[];
  purchaseFactor: {
    /** 순위 문항이 있을 때만. 없으면 빈 배열. */
    relativeImportance: { name: string; score: number }[];
    rankComposition: RankPositionComposition[];
    /** 구매요소별 만족도 척도(있는 raw data만). */
    satisfaction: ScaleStat[];
  };
  priorService: { experienceRate: number; satisfaction: MeanSd | null } | null;
  overall: ScaleStat | null;
  nps: NpsResult | null;
  crossAnalysis: CrossAxis[];
};

function cell(row: unknown[], index: number): string {
  const value = row[index];
  return value === null || value === undefined ? "" : String(value).trim();
}

function asNumber(row: unknown[], index: number): number | null {
  const text = cell(row, index).replace(/점|score/gi, "").trim();
  if (!text || !/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}

/**
 * 항목명. **코드가 아는 값을 먼저 쓴다**(classify.ts "하는 일 ③"과 같은 원칙) — 헤더 따옴표
 * 안 이름이 있으면 그것, 계열 접두가 있으면 접두 뒤 문항명, 둘 다 없으면 모델이 뽑은 이름.
 */
function itemNameOf(profile: ColumnProfile, fromModel?: string): string {
  if (profile.quotedName) return profile.quotedName;
  const header = profile.header.replace(/\s+/g, " ").trim();
  if (profile.groupPrefix) {
    const stripped = header.replace(/^[가-힣A-Za-z]+\s*\d+\s*\)\s*/, "").trim();
    if (stripped) return stripped;
  }
  return fromModel ?? header;
}

/**
 * 시점 문항의 이름은 **헤더에 적힌 시간 표현 그대로**다("첫인상", "일주일", "2주").
 *
 * 따옴표 안 이름을 우선하는 규칙(`itemNameOf`)이 시점 문항에서는 정반대로 작동한다 —
 * 케어클 여정 문항은 헤더가 전부 `'테크핏'의 첫인상은…` 형태라 다섯 시점 이름이 **전부
 * "테크핏"**이 된다. 실제로 꺾은선 x축이 "테크핏 테크핏 테크핏 …"으로 그려져 읽을 수 없었다
 * (2026-08-28 렌더 확인 — 코드로는 안 보이던 버그다). 반대로 헤더 전체를 쓰면 x축 라벨이
 * 한 줄을 넘긴다.
 *
 * 시간 표현은 **분류 단계가 이미 journey 판정의 근거로 쓰는 값**이라(`TIME_MARKER`), 그것을
 * 그대로 이름으로 쓴다 — 새 규칙을 만들지 않고 판정 근거와 표시 이름을 하나로 맞춘다.
 */
function journeyName(profile: ColumnProfile, fallback: string): string {
  const matched = TIME_MARKER.exec(profile.header.replace(/\s+/g, " "));
  return matched ? matched[0].trim() : fallback;
}

/**
 * 한 목록 안에서 이름이 겹치면 헤더에서 **서로 다른 부분**을 찾아 이름으로 쓴다.
 *
 * 따옴표 안 이름을 우선하는 규칙(`itemNameOf`)이 시점 문항에서는 정반대로 작동한다 —
 * 케어클 여정 문항은 헤더가 전부 `'태크핏'의 첫인상은…`, `'태크핏'을 2주간 사용하며…` 형태라
 * 다섯 시점의 이름이 **전부 "태크핏"**이 된다. 실제로 꺾은선 x축이 "태크핏 태크핏 태크핏 …"으로
 * 그려져 읽을 수가 없었다(2026-08-28 렌더 확인 — 코드로는 안 보이던 버그다).
 *
 * 겹칠 때만 개입한다. 안 겹치면 기존 이름이 그대로 유지되므로 리바랩스 결과는 바뀌지 않는다.
 * 공통 접두·접미를 떼고 남는 부분이 그 항목을 구별하는 말이다.
 */
function disambiguate<T extends { name: string; columnIndex: number }>(items: T[], profileOf: Map<number, ColumnProfile>): T[] {
  const duplicated = new Set(items.map((i) => i.name).filter((name, index, all) => all.indexOf(name) !== index));
  if (duplicated.size === 0) return items;

  const headers = items.map((item) => (profileOf.get(item.columnIndex)?.header ?? item.name).replace(/\s+/g, " ").trim());
  const common = (pick: (h: string, i: number) => string) => {
    let length = 0;
    while (length < Math.min(...headers.map((h) => h.length))) {
      const next = pick(headers[0], length);
      if (!headers.every((h) => pick(h, length) === next)) break;
      length += 1;
    }
    return length;
  };
  const prefix = common((h, i) => h[i]);
  const suffix = common((h, i) => h[h.length - 1 - i]);

  return items.map((item, index) => {
    if (!duplicated.has(item.name)) return item;
    const trimmed = headers[index].slice(prefix, headers[index].length - suffix).replace(/^['’"”)\s의을를은는]+|[\s의을를은는(]+$/g, "").trim();
    return trimmed ? { ...item, name: trimmed } : item;
  });
}

export function computeRoleQuantStats(
  classification: RoleClassification,
  profiles: ColumnProfile[],
  dataRows: unknown[][],
): RoleQuantStats {
  const profileOf = new Map(profiles.map((profile) => [profile.index, profile]));

  // 이유 컬럼은 문항이 아니라 앞 문항의 속성이다(2.5단계 다리와 같은 처리). 정성 분석이
  // 쓰는 열이지 정량 통계의 열이 아니다.
  const questions = classification.questions.filter(
    (question) => profileOf.get(question.columnIndex)?.reasonFor === undefined,
  );
  const of = (role: QuestionRole) => questions.filter((question) => question.role === role);

  // 서식만 남은 트레일링 행 제거. 옛 경로(`filterWallaResponseRows`)는 "첫 열 말고 뭐라도
  // 있으면 응답"이라는 WALLA 전용 규칙이었는데, 그 첫 열이 바로 `meta`(리크루팅 ID)다 —
  // **판정된 역할로 일반화**하면 같은 결과가 나오면서 어떤 raw data에도 통한다.
  const contentColumns = questions
    .filter((question) => question.role !== "meta")
    .map((question) => question.columnIndex);
  const rows = dataRows.filter((row) => contentColumns.some((index) => cell(row, index) !== ""));

  const scaleStat = (question: { columnIndex: number; itemName?: string }): ScaleStat => {
    const profile = profileOf.get(question.columnIndex)!;
    const scaleMax = profile.scaleMax ?? 10;
    const values = rows.map((row) => asNumber(row, question.columnIndex)).filter((v): v is number => v !== null);
    return {
      columnIndex: question.columnIndex,
      name: itemNameOf(profile, question.itemName),
      scaleMax,
      ...meanSd(values),
      distribution: scoreHistogram(values, scaleMax),
    };
  };

  const choiceStat = (question: { columnIndex: number; role: QuestionRole }): ChoiceStat => {
    const profile = profileOf.get(question.columnIndex)!;
    return {
      columnIndex: question.columnIndex,
      role: question.role,
      question: profile.header.replace(/\s+/g, " ").trim(),
      // 범위형 선택지는 표기 흔들림("1~2일 정도" / "1 ~ 2일")이 흔해 같은 항목이 둘로 쪼개진다.
      // 옛 경로는 걷기 시간·산책 빈도 두 열에만 걸었는데, 공백·끝의 "정도"만 다른 값을 묶는
      // 규칙이라 어느 선택지 문항에 걸어도 해롭지 않다 — 그래서 전부에 건다.
      distribution: categoryDistribution(
        rows.map((row) => cell(row, question.columnIndex) || null),
        normalizeRangeOptionLabel,
      ),
    };
  };

  const isScale = (question: { columnIndex: number }) => profileOf.get(question.columnIndex)?.type === "scale";

  // ── 기능(또는 단계) ──────────────────────────────────────────────────────────
  // 순위 응답의 항목명은 만족도 헤더의 짧은 이름과 문구가 다르다("실시간 거점형" ↔ "실시간
  // 위치 기반 거점형 콘텐츠"). 옛 경로가 쓰던 정렬·표시명 규칙을 그대로 쓴다.
  const featureRole: RoleQuantStats["featureRole"] =
    Math.max(of("feature").length, of("task_flow").length) === 0
      ? null
      : of("task_flow").length > of("feature").length
        ? "task_flow"
        : "feature";
  const featureQuestions = featureRole ? of(featureRole).filter(isScale) : [];
  const shortNames = featureQuestions.map((question) =>
    itemNameOf(profileOf.get(question.columnIndex)!, question.itemName),
  );
  const rankCols = questions
    .filter((question) => profileOf.get(question.columnIndex)?.type === "rank")
    .map((question) => question.columnIndex);
  const displayNames = resolveFeatureDisplayNames(shortNames, rows, rankCols);
  const features: ScaleStat[] = featureQuestions.map((question, i) => ({
    ...scaleStat(question),
    name: displayNames[i],
  }));

  const rankRows = rows.map((row) =>
    rankCols.map((col) => {
      const raw = cell(row, col);
      if (!raw) return "";
      const matched = alignToFeatureName(raw, shortNames);
      const i = shortNames.indexOf(matched);
      return i >= 0 ? displayNames[i] : matched;
    }),
  );
  // 순위 항목이 기능명과 안 맞는 raw data(케어클: 구매 요인 8개 ≠ 기능 8개)는 순위 응답에
  // 나온 항목 자체를 후보로 쓴다 — 그래야 상대중요도가 0으로 뭉개지지 않는다.
  const rankCandidates =
    rankCols.length === 0
      ? []
      : displayNames.filter((name) => rankRows.some((ranks) => ranks.includes(name))).length >= 3
        ? displayNames
        : [...new Set(rankRows.flat().filter(Boolean))];

  // ── UX 품질 계열 ────────────────────────────────────────────────────────────
  const uxGroups = new Map<string, ScaleStat[]>();
  for (const question of of("ux_quality").filter(isScale)) {
    if (!question.groupKey) continue; // 계열 없는 ux_quality는 레이더가 성립하지 않는다(3단계와 같은 판정)
    const bucket = uxGroups.get(question.groupKey) ?? [];
    bucket.push(scaleStat(question));
    uxGroups.set(question.groupKey, bucket);
  }

  // ── 인적 사항 ───────────────────────────────────────────────────────────────
  const ageQuestion = of("demographic").find(
    (question) => isScale(question) && AGE_HEADER.test(profileOf.get(question.columnIndex)!.header),
  );
  const ages = ageQuestion
    ? rows.map((row) => {
        const value = asNumber(row, ageQuestion.columnIndex);
        return value !== null && value > 0 ? value : null;
      })
    : [];
  const age = ageQuestion
    ? {
        columnIndex: ageQuestion.columnIndex,
        ...meanSd(ages.filter((v): v is number => v !== null)),
        brackets: ageBracketDistribution(ages),
      }
    : null;

  // ── 교차 분석 축 ────────────────────────────────────────────────────────────
  // 그룹이 2개 이상이고 각 n >= 5인 인적 범주만 축이 된다(3단계 조건표와 같은 기준).
  const values = of("value").filter(isScale).map(scaleStat);
  const uxFlat = [...uxGroups.values()].flat();
  const meansFor = (members: unknown[][], stats: { columnIndex: number; name: string }[]) =>
    stats.map((stat) => ({
      name: stat.name,
      mean: meanSd(
        members.map((row) => asNumber(row, stat.columnIndex)).filter((v): v is number => v !== null),
      ).mean,
    }));
  const summarize = (group: string, members: unknown[][]): CrossGroup => ({
    group,
    n: members.length,
    features: meansFor(members, features),
    values: meansFor(members, values),
    uxQuality: meansFor(members, uxFlat),
  });

  const crossAnalysis: CrossAxis[] = [];
  for (const question of of("demographic")) {
    const profile = profileOf.get(question.columnIndex)!;
    const buckets = new Map<string, unknown[][]>();
    if (question.columnIndex === ageQuestion?.columnIndex) {
      for (const bracket of AGE_BRACKETS) buckets.set(bracket, []);
      rows.forEach((row, i) => {
        const value = ages[i];
        if (value === null) return;
        buckets.get(ageBracketLabel(value))!.push(row);
      });
    } else if (GENDER_HEADER.test(profile.header) && (profile.type === "single" || profile.type === "multi")) {
      for (const row of rows) {
        const value = cell(row, question.columnIndex);
        if (!value) continue;
        buckets.set(value, [...(buckets.get(value) ?? []), row]);
      }
    } else {
      // **교차 분석 축은 연령대와 성별뿐이다**(2026-08-31 담당자 확인, `표준목차` 시트의
      // `원본 p41~42 연령대별 · 성별`). 예전에는 인적 문항이면 뭐든 축으로 삼아서, 리바랩스조차
      // 원본에 없는 `운영체제`·`하루 평균 걷는 시간` 축을 더 그렸고 이젠오토는 `운전 경력`
      // (7그룹)까지 그렸다. 축이 늘어나면 장이 길어지기만 하고 원본과 멀어진다.
      //
      // 수치 척도(나이 외)·자유서술도 애초에 비교 그룹이 안 된다.
      continue;
    }
    const groups = [...buckets.entries()].filter(([, members]) => members.length > 0);
    if (groups.length < 2 || groups.some(([, members]) => members.length < MIN_GROUP_SIZE)) continue;
    crossAnalysis.push({
      columnIndex: question.columnIndex,
      by: profile.header.replace(/\s+/g, " ").trim(),
      groups: groups.map(([group, members]) => summarize(group, members)),
    });
  }

  // ── 타사 경험 ───────────────────────────────────────────────────────────────
  const priorQuestions = of("prior_service");
  const gate = priorQuestions.find((question) => profileOf.get(question.columnIndex)?.type === "single");
  const priorSatisfaction = priorQuestions.find(isScale);
  const experienced = gate
    ? rows.filter((row) => /있|네|예/.test(cell(row, gate.columnIndex)))
    : [];
  const priorService = gate
    ? {
        experienceRate: rows.length === 0 ? 0 : Math.round((experienced.length / rows.length) * 1000) / 10,
        satisfaction: priorSatisfaction
          ? meanSd(
              experienced
                .map((row) => asNumber(row, priorSatisfaction.columnIndex))
                .filter((v): v is number => v !== null),
            )
          : null,
      }
    : null;

  // ── 종합 · NPS ──────────────────────────────────────────────────────────────
  const intents = of("intent").filter(isScale);
  const npsQuestion =
    intents.find((question) => NPS_HEADER.test(profileOf.get(question.columnIndex)!.header)) ??
    intents[intents.length - 1];
  const overallQuestion = of("overall").filter(isScale)[0];

  return {
    respondentCount: rows.length,
    age,
    choices: questions
      .filter((question) => {
        if (question.role === "meta" || question.columnIndex === ageQuestion?.columnIndex) return false;
        const type = profileOf.get(question.columnIndex)?.type;
        return type === "single" || type === "multi";
      })
      .map(choiceStat),
    featureRole,
    features,
    // 시점 이름은 헤더의 시간 표현에서 뽑고(journeyName), 그래도 겹치면 헤더에서 서로 다른
    // 부분을 찾아 쓴다(disambiguate). 두 단계 다 **헤더에 적힌 것만** 쓴다 — 지어내지 않는다.
    journey: disambiguate(
      of("journey")
        .filter(isScale)
        .map((question) => {
          const stat = scaleStat(question);
          return { ...stat, name: journeyName(profileOf.get(question.columnIndex)!, stat.name) };
        }),
      profileOf,
    ),
    values,
    uxQuality: [...uxGroups.entries()].map(([groupKey, items]) => ({ groupKey, items })),
    purchaseFactor: {
      relativeImportance: rankCandidates.length === 0 ? [] : relativeImportance(rankRows, rankCandidates),
      rankComposition: rankCandidates.length === 0 ? [] : rankPositionComposition(rankRows, rankCandidates),
      satisfaction: of("purchase_factor").filter(isScale).map(scaleStat),
    },
    priorService,
    overall: overallQuestion ? scaleStat(overallQuestion) : null,
    nps: npsQuestion
      ? computeNps(
          rows
            .map((row) => asNumber(row, npsQuestion.columnIndex))
            .filter((v): v is number => v !== null),
        )
      : null,
    crossAnalysis,
  };
}