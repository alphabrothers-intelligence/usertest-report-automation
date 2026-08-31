/**
 * 목차·섹션 조립기 — 범용화 파이프라인 3단계(PRD 2.2.2절).
 *
 * **AI를 쓰지 않는다.** 입력은 2단계(역할 분류)가 만든 문항별 역할 목록이고, 출력은
 * 장·절 목록 + 드롭 사유다. 판정 조건은 전부 역할 개수와 데이터 성질이라 LLM이 필요 없다.
 *
 * **표 하나를 순회하는 코드다** — 아래 `CHAPTERS`는 `docs/STAGE_MAPPING.xlsx`의 `표준목차`
 * 시트를 그대로 옮긴 것이다. 시트가 단일 출처이므로, 조건·제목·레이아웃 코드를 여기서
 * 임의로 바꾸지 말고 시트를 먼저 고친다.
 *
 * **장 번호는 생성된 장에만 순서대로 부여한다** — 번호를 고정하지 않는다(고객 여정이 없는
 * raw data 는 핵심구매요소가 IV 가 된다).
 */

/** 2단계(`lib/agent/classify.ts`)가 판정하는 역할. `docs/QUESTION_SECTION_LAYOUT_MAP.md` §2. */
export type QuestionRole =
  | "demographic"
  | "context"
  | "prior_service"
  | "feature"
  | "task_flow"
  | "journey"
  | "purchase_factor"
  | "value"
  | "ux_quality"
  | "overall"
  | "intent"
  | "improvement"
  | "meta";

export type PlannedQuestion = {
  columnIndex: number;
  role: QuestionRole;
  /** 항목명(기능명·가치축 이름 등). 사분면 교집합 판정에 쓴다. */
  itemName?: string;
  /** 같은 척도 묶음. `ux_quality`의 계열(실용성·즐거움). */
  groupKey?: string;
  /** 척도 문항이면 상한. 없으면 척도가 아니다. */
  scaleMax?: number;
};

export type SectionPlanInput = {
  questions: PlannedQuestion[];
  /** 순위 문항의 항목명 목록(프로파일러 `options`). 사분면 성립 판정에 쓴다. */
  rankItems?: string[];
  /** 인적 범주형 문항별 그룹 응답자 수. 교차 분석 성립 판정(그룹 2개 이상 · 각 n >= 5). */
  demographicGroupSizes?: number[][];
};

export type PlannedSection = { number: number; title: string; layouts: string[] };
export type PlannedChapter = {
  /** 표준목차 시트의 고정 식별자(I~X). 출력 번호(`numeral`)와 다를 수 있다. */
  id: string;
  numeral: string;
  title: string;
  stageCode: string;
  sections: PlannedSection[];
};
export type DropNote = { id: string; title: string; reason: string };
export type SectionPlan = {
  chapters: PlannedChapter[];
  dropped: DropNote[];
  /** 보고서에 밝혀야 하는 비표준 입력 안내(예: 중요 순위 미수집). */
  notes: string[];
};

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** 판정에 쓰는 파생값. 한 번만 계산해 표 순회에서 돌려 쓴다. */
type Ctx = {
  count: (role: QuestionRole) => number;
  items: (role: QuestionRole) => string[];
  /** 기능 계열(`feature` 우선, 없으면 `task_flow`). */
  featureRole: "feature" | "task_flow" | null;
  /**
   * 가치 **축**의 개수 = `value` 중 **척도 문항만** 센 값. 장 제목("N대 가치 만족도")과
   * 생성 여부가 이 값에서 나온다.
   *
   * 컬럼 수를 그대로 세면 안 된다 — 가치 블록 안에 척도가 아닌 문항이 끼어 있을 수 있고
   * (이젠오토 `가장 인상 깊었던 기능`은 단일선택인데 4대 가치 장에 들어간다), 그걸 세는 순간
   * 원본에 없는 "5대 가치 만족도"가 된다. 축은 점수를 매긴 것만이다.
   */
  valueAxes: number;
  /** 같은 계열 척도가 3개 이상인 `ux_quality` 그룹이 있는가(3개 미만이면 레이더가 성립 안 함). */
  hasUxRadar: boolean;
  /** 순위 항목명 ∩ 기능명 >= 3 (사분면 성립 조건). */
  hasQuadrant: boolean;
  hasRank: boolean;
  /** 구매요소별 만족도 척도 문항이 있는가(L27). */
  hasPurchaseSatisfaction: boolean;
  /** 기업 측 추가 질문(개선 문항인데 척도가 붙어 있음. 투블럭 Q23~Q25). */
  hasEnterpriseQuestions: boolean;
  /** 비교 가능한 인적 범주(그룹 2개 이상 · 각 n >= 5)의 개수. */
  crossGroups: number;
};

function buildCtx(input: SectionPlanInput): Ctx {
  const { questions, rankItems = [], demographicGroupSizes = [] } = input;
  const of = (role: QuestionRole) => questions.filter((q) => q.role === role);
  const count = (role: QuestionRole) => of(role).length;
  const items = (role: QuestionRole) =>
    of(role)
      .map((q) => q.itemName)
      .filter((name): name is string => !!name);

  // 계열(groupKey)이 **없는** ux_quality는 세지 않는다. 계열은 헤더 접두(`실용성1)`)에서만
  // 나오는 코드 판정값이라(classify.ts), 없다는 건 의미분별 척도 묶음이 아니라는 뜻이다.
  // 예전엔 없으면 "전체"로 뭉쳐 셌는데, 그 바람에 화면 평가 문항 몇 개가 ux_quality로
  // 판정되기만 하면 레이더 장이 통째로 생겼다 사라졌다 했다(정리습관 실측 2026-08-27).
  const uxGroups = new Map<string, number>();
  for (const q of of("ux_quality")) {
    if (!q.groupKey) continue;
    uxGroups.set(q.groupKey, (uxGroups.get(q.groupKey) ?? 0) + 1);
  }

  const featureNames = new Set([...items("feature"), ...items("task_flow")]);
  const overlap = new Set(rankItems.filter((name) => featureNames.has(name)));

  return {
    count,
    items,
    // 둘이 섞여 나오면(정리습관 실측: 단계 7 · 기능 3) **많은 쪽이 그 장의 성격**이다.
    featureRole: Math.max(count("feature"), count("task_flow")) === 0
      ? null
      : count("task_flow") > count("feature")
        ? "task_flow"
        : "feature",
    valueAxes: of("value").filter((q) => q.scaleMax !== undefined).length,
    hasUxRadar: [...uxGroups.values()].some((n) => n >= 3),
    hasQuadrant: overlap.size >= 3,
    hasRank: rankItems.length > 0,
    hasPurchaseSatisfaction: of("purchase_factor").some((q) => q.scaleMax !== undefined),
    hasEnterpriseQuestions: of("improvement").some((q) => q.scaleMax !== undefined),
    crossGroups: demographicGroupSizes.filter((sizes) => sizes.length >= 2 && sizes.every((n) => n >= 5)).length,
  };
}

/** 살아남으면 `null`, 드롭이면 사유 문자열. */
type Gate = (c: Ctx) => string | null;

type SectionSpec = {
  title: (c: Ctx) => string;
  layouts: (c: Ctx) => string[];
  drop?: Gate;
};

type ChapterSpec = {
  id: string;
  title: (c: Ctx) => string;
  stageCode: string;
  drop?: Gate;
  sections: SectionSpec[];
};

const codes = (joined: string) => joined.split("|");

/** `docs/STAGE_MAPPING.xlsx` > `표준목차` 시트 한 줄 = 아래 한 항목. */
const CHAPTERS: ChapterSpec[] = [
  {
    id: "I",
    title: () => "개요",
    stageCode: "S1",
    sections: [
      { title: () => "제품 소개", layouts: () => codes("L10|L10a") },
      { title: () => "사용성 테스트 진행 일정", layouts: () => codes("L10a") },
      { title: () => "사용성 테스트 설문 항목", layouts: () => codes("L10a|L9b") },
    ],
  },
  {
    id: "II",
    // 경험 문항(타사 경험)이 있으면 '특성·경험', 없으면 '특성'.
    title: (c) => (c.count("prior_service") > 0 ? "인적 사항 및 특성·경험 조사" : "인적 사항 및 특성 조사"),
    stageCode: "S1 · S3",
    drop: (c) => (c.count("demographic") > 0 ? null : "인적 문항 0개"),
    sections: [
      {
        title: () => "인적 사항 조사 결과",
        // 타사 경험 문항이 없으면 경쟁재 비교표(L14)가 빠진다 — 그 블록만 빠지고 절은 남는다.
        // ponytail: L20(경험 수준 정의표)은 그대로 둔다. 설명문 입력 경로가 아직 없어
        // (docs/LAYOUT_RENDERER_GAP.md §4) 판정 신호를 만들 근거가 없다.
        layouts: (c) =>
          codes("L10|L10b|L1|L2|L9|L20|L14").filter((code) => code !== "L14" || c.count("prior_service") > 0),
      },
    ],
  },
  {
    id: "III",
    title: (c) => (c.featureRole === "task_flow" ? "단계별 고객 경험 평가" : "기능별 고객 경험 평가"),
    stageCode: "S2",
    drop: (c) => (c.featureRole ? null : "기능 만족도 척도 문항 0개"),
    sections: [
      {
        title: (c) => (c.featureRole === "task_flow" ? "단계별 고객 경험 조사 결과" : "기능별 고객 경험 조사 결과"),
        // 중요 순위를 받지 않은 raw data 는 순위 계열 4종(L5·L9a·L6·L6a)을 생략한다.
        // 사분면(L6·L6a)은 순위 항목명 ∩ 기능명 >= 3 일 때만 성립한다.
        layouts: (c) =>
          codes("L10|L10a|L10b|L9|L1b|L12|L8|L8t|L11a|L11|L1a|L9a|L5|L6|L6a").filter((code) => {
            if (code === "L5" || code === "L9a") return c.hasRank;
            if (code === "L6" || code === "L6a") return c.hasQuadrant;
            return true;
          }),
      },
      {
        title: (c) => (c.featureRole === "task_flow" ? "단계별 고객 경험 분석" : "기능별 고객 경험 분석"),
        layouts: () => codes("L10a|L24"),
      },
    ],
  },
  {
    id: "IV",
    title: () => "고객 여정 기반 경험 평가",
    stageCode: "S4",
    drop: (c) => (c.count("journey") >= 3 ? null : `시점 문항 ${c.count("journey")}개 (3개 미만)`),
    sections: [
      { title: () => "고객 여정 기반 경험 평가 조사 결과", layouts: () => codes("L10|L10a|L10b|L1") },
      { title: () => "고객 여정 기반 경험 평가 결과 분석", layouts: () => codes("L10a|L9|L13|L13a|L11") },
    ],
  },
  {
    id: "V",
    title: () => "핵심구매요소",
    stageCode: "S5",
    drop: (c) => (c.count("purchase_factor") > 0 ? null : "핵심 요인 문항 0개"),
    sections: [
      {
        title: () => "핵심구매요소 조사 결과",
        // 구매요소별 만족도 척도가 있을 때만 평균 만족도 표(L27)를 붙인다.
        layouts: (c) => codes("L10|L10a|L10b|L1|L9|L27").filter((code) => code !== "L27" || c.hasPurchaseSatisfaction),
      },
      { title: () => "핵심구매요소 분석", layouts: () => codes("L10a|L24") },
    ],
  },
  {
    id: "VI",
    // **"4대 가치"는 조사 방법론의 이름이지 데이터에서 세는 값이 아니다**(담당자 확인
    // 2026-08-28). 기능적·심미적·경제적·사회공공적 네 축은 이 조사가 항상 쓰는 틀이고,
    // 실측으로도 축이 있는 데이터셋 4종은 전부 정확히 4개다(0개인 정리습관은 장 자체가 드롭).
    // 그래서 제목은 `표준목차` 시트에 적힌 리터럴 그대로 쓴다 — 세어서 만들면 오분류 하나가
    // 장 제목을 "3대 가치 만족도"로 바꿔버린다(가이드 8.4 ⑦이 예견한 증상).
    // **축 이름은 여전히 헤더에서 그대로 뽑는다** — 고정된 것은 개수이지 문구가 아니다.
    title: () => "4대 가치 만족도",
    stageCode: "S6",
    drop: (c) => (c.valueAxes > 0 ? null : "가치 척도 문항 0개"),
    sections: [
      { title: () => "4대 가치 만족도 조사 결과", layouts: () => codes("L10|L10a|L10b|L9|L25|L26") },
      {
        title: () => "4대 가치 만족도 조사 결과 분석",
        layouts: () => codes("L10a|L1a|L9|L26"),
      },
    ],
  },
  {
    id: "VII",
    title: () => "사용자 경험 품질 평가",
    stageCode: "S7",
    drop: (c) => (c.hasUxRadar ? null : "같은 계열 척도 문항 3개 미만 (레이더 성립 안 함)"),
    sections: [
      { title: () => "사용자 경험 품질 평가 결과", layouts: () => codes("L10|L10a|L10b|L9") },
      { title: () => "사용자 경험 품질 평가 결과 분석", layouts: () => codes("L10a|L4|L9|L11") },
    ],
  },
  {
    id: "VIII",
    title: () => "교차 분석",
    stageCode: "S1 x S2·S6",
    // **조건은 "데이터가 되느냐" 하나뿐이다**(2026-08-31 담당자 확인). 원본 5종 중 이 장이
    // 실린 것은 리바랩스뿐이지만, 나머지에 없는 것은 조건 미달이 아니라 원본 편차다
    // (사람이 쓰던 문서라 작성자가 뺐다). 조건이 되면 만든다.
    drop: (c) =>
      c.crossGroups >= 2 ? null : `비교 가능한 인적 범주 ${c.crossGroups}종 (2종 미만 또는 그룹 n < 5)`,
    sections: [
      {
        // UX 품질 레이더 오버레이(L4a)는 7장이 생성됐을 때만.
        title: () => "교차 분석 결과 및 분석",
        layouts: (c) => codes("L10|L10a|L3|L4a|L9").filter((code) => code !== "L4a" || c.hasUxRadar),
      },
    ],
  },
  {
    id: "IX",
    title: () => "종합 만족도 및 NPS 지수",
    stageCode: "S8",
    drop: (c) => (c.count("overall") + c.count("intent") > 0 ? null : "종합·추천 문항 0개"),
    sections: [
      { title: () => "종합 만족도 및 NPS 지수", layouts: () => codes("L10|L10a|L1|L7|L22|L9|L19|L11") },
      {
        title: (c) => (c.hasEnterpriseQuestions ? "기업 측 질문 및 개선 아이디어" : "개선 아이디어"),
        layouts: (c) => codes("L10a|L10b|L11b|L9").filter((code) => code !== "L9" || c.hasEnterpriseQuestions),
        drop: (c) => (c.count("improvement") > 0 ? null : "개선 서술 문항 0개"),
      },
    ],
  },
  {
    id: "X",
    title: () => "종합 결과 및 제언",
    stageCode: "전 단계",
    sections: [
      {
        title: () => "사용성테스트 결과 요약",
        // 사분면은 3장에서 그려졌을 때만 다시 넣는다. 없으면 L6·L6a 만 빠지고 절은 유지한다.
        layouts: (c) =>
          codes("L10|L10a|L23|L9|L6|L6a").filter((code) => (code !== "L6" && code !== "L6a") || c.hasQuadrant),
      },
      { title: () => "개선 전략 제언", layouts: () => codes("L10a|L23|L18") },
      {
        title: () => "기능별 고객 제언 종합",
        layouts: () => codes("L21"),
        drop: (c) => (c.featureRole ? null : "3장(기능별 고객 경험 평가)이 드롭됨"),
      },
    ],
  },
];

export function buildSectionPlan(input: SectionPlanInput): SectionPlan {
  const ctx = buildCtx(input);
  const chapters: PlannedChapter[] = [];
  const dropped: DropNote[] = [];
  const notes: string[] = [];

  for (const spec of CHAPTERS) {
    const title = spec.title(ctx);
    const reason = spec.drop?.(ctx) ?? null;
    if (reason) {
      dropped.push({ id: spec.id, title, reason });
      continue;
    }

    const sections: PlannedSection[] = [];
    for (const section of spec.sections) {
      const sectionTitle = section.title(ctx);
      const sectionReason = section.drop?.(ctx) ?? null;
      if (sectionReason) {
        dropped.push({ id: `${spec.id}-${spec.sections.indexOf(section) + 1}`, title: sectionTitle, reason: sectionReason });
        continue;
      }
      sections.push({ number: sections.length + 1, title: sectionTitle, layouts: section.layouts(ctx) });
    }
    if (sections.length === 0) {
      dropped.push({ id: spec.id, title, reason: "남은 절 없음" });
      continue;
    }

    chapters.push({
      id: spec.id,
      numeral: NUMERALS[chapters.length] ?? String(chapters.length + 1),
      title,
      stageCode: spec.stageCode,
      sections,
    });
  }

  if (ctx.featureRole && !ctx.hasRank) notes.push("중요 순위 미수집 — 순위 계열 도표를 생략했습니다.");
  if (ctx.featureRole && ctx.hasRank && !ctx.hasQuadrant) {
    notes.push("순위 항목과 만족도 항목의 교집합이 3개 미만이라 사분면을 생성하지 않았습니다.");
  }

  return { chapters, dropped, notes };
}