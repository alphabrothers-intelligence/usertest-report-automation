import type { StoredTemplateReportPayload } from "./templatePayload";

/** 원본 HWPX의 실제 문단 위치를 가리키는 최소 수정 단위. */
export type HwpxParagraphPatch = {
  sectionIndex: number;
  paragraphIndex: number;
  /** 원본이 바뀌었거나 다른 양식을 선택한 경우 덮어쓰지 않기 위한 안전 앵커. */
  expectedText: string;
  text: string;
  source: "product-info" | "quantitative" | "qualitative" | "recommendation";
};

export type HwpxWebEditPatchResult = {
  patches: HwpxParagraphPatch[];
  /** 원본 HWPX의 정확한 슬롯이 아직 정의되지 않아 자동 반영하지 않은 웹 수정 키. */
  unsupportedEditKeys: string[];
};

type FeatureParagraphs = {
  question: number;
  mean: number;
  sd: number;
};

/**
 * 리바랩스 원본(0904) section1.xml의 직접 편집 문단 위치.
 *
 * 컨테이너 문단이 아닌 화면에 실제로 보이는 하위 문단만 대상으로 삼는다. 따라서 기존
 * charPr/paraPr, 표 셀 병합, 그래프 프레임, 페이지/목차 구조는 변경하지 않는다.
 */
const FEATURE_PARAGRAPHS: readonly FeatureParagraphs[] = [
  { question: 227, mean: 229, sd: 230 },
  { question: 333, mean: 335, sd: 336 },
  { question: 429, mean: 431, sd: 432 },
  { question: 509, mean: 511, sd: 512 },
  { question: 616, mean: 618, sd: 619 },
  { question: 708, mean: 710, sd: 711 },
];

const REFERENCE_FEATURES = [
  { name: "펫과의 산책", mean: "6.35", sd: "2.54" },
  { name: "펫 성장 시스템", mean: "6.81", sd: "2.39" },
  { name: "펫 꾸미기", mean: "7.2", sd: "2.29" },
  { name: "실시간 위치 기반 거점형 콘텐츠", mean: "6.35", sd: "2.46" },
  { name: "펫 교배", mean: "5.85", sd: "2.77" },
  { name: "펫 레이싱", mean: "6.04", sd: "2.86" },
] as const;

const FEATURE_SUMMARY_PARAGRAPHS = [
  { positive: 243, negative: 246, neutral: 248 },
  { positive: 348, negative: 351, neutral: 354 },
  { positive: 444, negative: 447, neutral: 450 },
  { positive: 524, negative: 527, neutral: 530 },
  { positive: 630, negative: 632, neutral: 634 },
  { positive: 723, negative: 726, neutral: 729 },
] as const;

const FEATURE_COUNT_PARAGRAPHS = [
  { positive: 252, negative: 253, neutral: 254 },
  { positive: 358, negative: 359, neutral: 360 },
  { positive: 454, negative: 455, neutral: 456 },
  { positive: 534, negative: 535, neutral: 536 },
  { positive: 638, negative: 639, neutral: 640 },
  { positive: 733, negative: 734, neutral: 735 },
] as const;

/**
 * 원본 Ⅸ.3의 고정 고객 제언 표 슬롯. 제목·표 전체를 재조립하지 않고, 이미 분리된
 * 라벨/내용 문단만 바꾼다. 각 기능의 허용 행 수를 넘는 제언은 반드시 overflow로 남긴다.
 */
const FEATURE_RECOMMENDATION_SLOTS = [
  { title: 1793, titleText: "[기능 1] 펫과의 산책", rows: [[1795, 1796], [1797, 1798], [1799, 1800], [1801, 1802]] },
  { title: 1804, titleText: "[기능 2] 펫 성장 시스템", rows: [[1806, 1807], [1808, 1809], [1810, 1811], [1812, 1813]] },
  { title: 1815, titleText: "[기능 3] 실시간 거점형 콘텐츠", rows: [[1817, 1818], [1819, 1820], [1821, 1822], [1823, 1824]] },
  { title: 1825, titleText: "[기능 4] 펫 꾸미기", rows: [[1827, 1828], [1829, 1830], [1831, 1832]] },
  // P1833은 기능 5·6 제목이 함께 든 복합 문단이므로 제목을 패치하지 않는다.
  { title: null, titleText: null, rows: [[1835, 1836], [1837, 1838], [1839, 1840], [1841, 1842]] },
  { title: null, titleText: null, rows: [[1844, 1845], [1846, 1847], [1848, 1849]] },
] as const;

const REFERENCE_RECOMMENDATION_TEXT = [
  ["GPS 오차 최소화를 위한 위치 정확도 개선", "산책 시작 시 자동 실행 기능 제공", "보상 아이템의 다양화 및 난이도별 차등 보상 체계 구축", "산책 중 상호작용 범위(상자, 거점 등) 시각적 표시 강화"],
  ["성장 속도 조정 및 성취감 강화 설계", "진화·변신 등 시각적 보상 효과 확대", "알 부화 콘셉트 재검토 및 대체 기획 마련", "튜토리얼 직관화 및 성장 단계별 가이드 강화"],
  ["보상 메리트 강화(아이템·재화 차별화)", "위험 지역을 제외한 안전 위치 기반 배치 규칙 마련", "펫 배치 및 관리 편의성을 높이는 원클릭 기능 도입", "지역별 유저 밀도에 따른 거점 난이도·보상 차등 설계"],
  ["아이템 가격 체계 조정으로 경제적 부담 완화", "시즌·테마별 신규 아이템 및 꾸미기 콘텐츠 확장", "꾸미기 아이템의 일부 능력치 반영 검토"],
  ["자동 진행 구조에서 벗어난 직접 조작 참여 요소 추가", "유사 레벨 매칭 시스템 도입으로 공정성 확보", "난이도 단계화 및 보상 체계 재설계", "경기 연출·스토리 강화로 몰입감 증대"],
  ["자동 매칭·개인 진행 옵션 제공", "교배 과정 소요 시간 단축 및 접근성 개선", "‘교배’라는 용어·세계관을 대체할 수 있는 새로운 콘셉트 기획"],
] as const;

const REFERENCE_SUMMARIES = [
  [
    "보상 요소와 펫 동반 경험을 통해 산책·운동 동기가 높아지고, GPS·UI 기능이 편리하다는 점에서 만족감을 느낌.",
    "GPS/걸음 수 부정확성, 보상 체계 한계, 안정성 문제, 위험 지역 배치 등으로 인해 신뢰성과 재미가 떨어진다는 불만이 제기.",
    "[중립 의견 요약]산책 기능의 조건(속도·범위)이 느슨해 실제 산책 컨셉과의 정합성 개선 필요성 제기.",
  ],
  ["펫의 부화·성장 과정을 직접 확인하며 성취감과 동기를 얻고, 수집·편의성·귀여움 등에서 재미와 만족을 느낌.", "성장/부화 속도와 난이도, 보상·시각적 변화 체감 부족, 시스템 오류, 알 부화 컨셉 불일치, 직관성·도파민 요소 부족 등이 불만으로 제기.", "다른 걷기 게임과 유사해 특별히 좋거나 나쁘지 않으며, 최적화·연동 개선 시 만족도가 높아질 수 있다는 반응."],
  ["다양한 꾸미기 아이템과 귀여운 비주얼이 개성과 재미를 주며, 커스터마이징 자체가 만족과 동기를 강화함.", "아이템 가격 대비 재화 부족, 디자인 단조로움과 UI 안내 부족 등으로 꾸미기 접근성과 활용성이 떨어진다는 불만 제기.", "꾸미기 기능은 확장성과 잠재력이 있지만, 능력치 반영 여부·아이템 다양화·개인 관심도 등에 따라 평가가 갈림."],
  ["거점 기반 경쟁과 랭킹 상승, 차별화된 지도 시스템이 걷기 동기와 성취감을 높이고 새로운 재미를 제공함.", "보상 체계·경제성 부족, 지역 불균형, 펫 관리 불편, 접근성 문제, 설명 부족 등으로 핵심 동기와 재미가 약화됨.", "경쟁형 콘텐츠 특성상 유저 수와 개인 성향에 따라 재미와 흥미가 크게 달라진다는 반응 확인."],
  ["[긍정 의견 요약]새로운 펫을 얻는 불확실성과 유전 개념이 기대와 재미를 높이고, 친구와의 협동·수집 다양성이 소셜 동기와 몰입을 강화함.", "[부정 의견 요약]버그·상대방 의존성·긴 시간 소요·보상 부족·교배 컨셉 거부감 등으로 기능 사용성이 떨어지고 만족도 낮아짐.", "[중립 의견 요약]재화·시간·매칭 조건때문에 체험이 제한되어 평가 보류."],
  ["경쟁/디펜스형 미니게임이 재미·긴장감을 주고, 펫 성장의 활용처로 동기를 강화함. 일부 비주얼·접근성·소셜성도 긍정적으로 평가됨.", "관전만 하는 자동 진행ﾷ연출 부족으로 몰입이 낮고, 규칙/튜토리얼 부재와 매칭 불균형·보상/난이도·UI 불편이 반복 참여를 떨어뜨림.", "버그/오타 지적과 난이도 추가·면담요소(사전 안내) 제안이 있으며, 유저 성향에 따라 호불호가 갈린다는 관찰이 있음."],
] as const;

type SummaryPolarity = "positive" | "negative" | "neutral";
const SUMMARY_POLARITY_LABEL: Record<SummaryPolarity, string> = { positive: "긍정", negative: "부정", neutral: "중립" };

function categorySummary(
  categories: StoredTemplateReportPayload["qualitative"][number]["categories"],
  polarity: SummaryPolarity,
): string | null {
  const labels = categories
    .filter((category) => category.polarity === polarity)
    .sort((a, b) => b.clause_count - a.clause_count || a.label.localeCompare(b.label, "ko"))
    .slice(0, 3)
    .map((category) => category.label.trim())
    .filter(Boolean);
  if (labels.length === 0) return null;
  // 분석 문장을 다시 만들지 않고, 이미 저장된 카테고리명만 원본 요약 칸의 정해진 문체로 묶는다.
  return `${SUMMARY_POLARITY_LABEL[polarity]} 의견에서는 ${labels.join(", ")}이(가) 주요 반응으로 확인됨.`;
}

function featureQuestionText(index: number, name: string): string {
  // 원본은 기능 만족도 문항을 Q6부터 연속으로 배치한다.
  return `Q${index + 6}. ‘${name}’ 기능의 만족도는 몇 점입니까?`;
}

function fixed2(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "-";
}

function plainWebText(value: string | undefined): string {
  return (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function numericValue(value: string): number | null {
  const match = value.match(/(?:평균|표준편차)\s*[:：]?\s*(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function polarityCountText(question: StoredTemplateReportPayload["qualitative"][number], polarity: SummaryPolarity): string | null {
  const count = question.categories
    .filter((category) => category.polarity === polarity)
    .reduce((total, category) => total + category.clause_count, 0);
  const total = question.categories.reduce((sum, category) => sum + category.clause_count, 0);
  if (total <= 0) return null;
  return `${((count / total) * 100).toFixed(1)}%(${count}건)`;
}

function featureCustomerActions(payload: StoredTemplateReportPayload): Map<string, string[]> {
  const record = payload.recommendations.find((item) => item.section === "feature_customer_recommendations");
  if (!record) return new Map();
  try {
    const parsed = JSON.parse(record.final ?? record.draft) as { features?: Array<{ featureName?: string; actions?: unknown[] }> };
    return new Map((parsed.features ?? [])
      .filter((feature): feature is { featureName: string; actions?: unknown[] } => Boolean(feature.featureName))
      .map((feature) => [feature.featureName, (feature.actions ?? []).map(String).map((action) => action.trim()).filter(Boolean)]));
  } catch {
    return new Map();
  }
}

/** DB의 기능별 고객 제언을 원본 Ⅸ.3의 고정 행에만 넣는다. */
export function buildRivalabsSwRecommendationPatches(payload: StoredTemplateReportPayload): HwpxParagraphPatch[] {
  if (payload.template.id !== "rivalabs-sw") {
    throw new Error("리바랩스 SW 원본 전용 고객 제언 패치를 다른 템플릿에 적용할 수 없습니다.");
  }
  const actionsByFeature = featureCustomerActions(payload);
  const patches: HwpxParagraphPatch[] = [];
  payload.report.quantStats.featureSatisfaction.forEach((feature, index) => {
    const slot = FEATURE_RECOMMENDATION_SLOTS[index];
    const expectedActions = REFERENCE_RECOMMENDATION_TEXT[index];
    if (!slot || !expectedActions) return;
    const actions = actionsByFeature.get(feature.name) ?? [];
    if (slot.title !== null && slot.titleText) {
      patches.push({ sectionIndex: 1, paragraphIndex: slot.title, expectedText: slot.titleText, text: `[기능 ${index + 1}] ${feature.name}`, source: "recommendation" });
    }
    actions.slice(0, slot.rows.length).forEach((action, actionIndex) => {
      const [labelIndex, contentIndex] = slot.rows[actionIndex];
      patches.push(
        { sectionIndex: 1, paragraphIndex: labelIndex, expectedText: `고객 제언 ${actionIndex + 1}`, text: `고객 제언 ${actionIndex + 1}`, source: "recommendation" },
        { sectionIndex: 1, paragraphIndex: contentIndex, expectedText: expectedActions[actionIndex], text: action, source: "recommendation" },
      );
    });
  });
  return patches;
}

/**
 * /hwpx-preview에서 로컬로 수정한 값 중, 원본 문단 위치를 확정한 값만 안전 패치로 바꾼다.
 * 자유 편집 HTML을 임의의 HWPX 문단에 밀어 넣지 않는 것이 원본 서식 보존의 전제다.
 */
export function buildRivalabsSwWebEditPatches(
  payload: StoredTemplateReportPayload,
  edits: Record<string, string>,
): HwpxWebEditPatchResult {
  if (payload.template.id !== "rivalabs-sw") {
    throw new Error("리바랩스 SW 원본 전용 웹 수정 패치를 다른 템플릿에 적용할 수 없습니다.");
  }
  // 저장된 분석 결과부터 원본에 반영하고, 웹에서 실제로 바꾼 값은 같은 위치의 패치를
  // 덮어쓴다. 따라서 "웹에 보인 값"과 "다운로드할 HWPX 값"의 기준이 하나로 유지된다.
  const storedPatches = buildRivalabsSwStoredPatches(payload);
  const patches: HwpxParagraphPatch[] = [];
  const supported = new Set<string>();
  const company = plainWebText(edits["cover:company"]);
  const service = plainWebText(edits["cover:service"])
    .replace(/^Usability Test Proposal for [‘']?/, "")
    .replace(/[’']$/, "")
    .trim();

  if (company) {
    supported.add("cover:company");
    patches.push(
      { sectionIndex: 0, paragraphIndex: 26, expectedText: "리바랩스", text: company, source: "product-info" },
      { sectionIndex: 1, paragraphIndex: 47, expectedText: "리바랩스", text: company, source: "product-info" },
    );
  }
  if (service) {
    supported.add("cover:service");
    patches.push(
      { sectionIndex: 0, paragraphIndex: 27, expectedText: "Usability Test Proposal for ‘캣독런’", text: `Usability Test Proposal for ‘${service}’`, source: "product-info" },
      { sectionIndex: 1, paragraphIndex: 57, expectedText: "캣독런", text: service, source: "product-info" },
    );
  }

  payload.report.quantStats.featureSatisfaction.forEach((feature, index) => {
    const position = FEATURE_PARAGRAPHS[index];
    const reference = REFERENCE_FEATURES[index];
    if (!position || !reference) return;
    const meanKey = `feature:${feature.name}:mean`;
    const sdKey = `feature:${feature.name}:sd`;
    const mean = numericValue(plainWebText(edits[meanKey]));
    const sd = numericValue(plainWebText(edits[sdKey]));
    if (mean !== null) {
      supported.add(meanKey);
      patches.push({ sectionIndex: 1, paragraphIndex: position.mean, expectedText: `만족도 점수 평균 : ${reference.mean} / 10`, text: `만족도 점수 평균 : ${fixed2(mean)} / 10`, source: "quantitative" });
    }
    if (sd !== null) {
      supported.add(sdKey);
      patches.push({ sectionIndex: 1, paragraphIndex: position.sd, expectedText: `표준편차 : ${reference.sd}`, text: `표준편차 : ${fixed2(sd)}`, source: "quantitative" });
    }
  });

  const merged = new Map<string, HwpxParagraphPatch>();
  for (const patch of storedPatches) merged.set(`${patch.sectionIndex}:${patch.paragraphIndex}`, patch);
  for (const patch of patches) merged.set(`${patch.sectionIndex}:${patch.paragraphIndex}`, patch);
  return { patches: [...merged.values()], unsupportedEditKeys: Object.keys(edits).filter((key) => !supported.has(key)) };
}

/**
 * 저장된 DB 값으로부터 첫 번째 안전 패치 묶음을 만든다.
 *
 * 정성 카테고리/인용문·그래프는 별도의 반복 영역 컴파일러가 맡는다. 이 함수는 원본 자리를
 * 늘리지 않는 표지·제품 정보·기능별 정량 값부터 처리해 구조 보존 경로를 검증하기 위한 기반이다.
 */
export function buildRivalabsSwBasePatches(payload: StoredTemplateReportPayload): HwpxParagraphPatch[] {
  if (payload.template.id !== "rivalabs-sw") {
    throw new Error("리바랩스 SW 원본 전용 패치를 다른 템플릿에 적용할 수 없습니다.");
  }

  const patches: HwpxParagraphPatch[] = [];
  const companyName = payload.report.productInfo?.companyName?.trim();
  const serviceName = payload.report.productInfo?.serviceName?.trim();

  // 기존 DB에 값이 없는 필드는 원본 문구를 임의 추정해 덮어쓰지 않는다.
  if (companyName) {
    patches.push({ sectionIndex: 0, paragraphIndex: 26, expectedText: "리바랩스", text: companyName, source: "product-info" });
    patches.push({ sectionIndex: 1, paragraphIndex: 47, expectedText: "리바랩스", text: companyName, source: "product-info" });
  }
  if (serviceName) {
    patches.push({ sectionIndex: 0, paragraphIndex: 27, expectedText: "Usability Test Proposal for ‘캣독런’", text: `Usability Test Proposal for ‘${serviceName}’`, source: "product-info" });
    patches.push({ sectionIndex: 1, paragraphIndex: 57, expectedText: "캣독런", text: serviceName, source: "product-info" });
  }

  payload.report.quantStats.featureSatisfaction.forEach((feature, index) => {
    const position = FEATURE_PARAGRAPHS[index];
    if (!position) return;
    patches.push(
      {
        sectionIndex: 1,
        paragraphIndex: position.question,
        expectedText: featureQuestionText(index, REFERENCE_FEATURES[index].name),
        text: featureQuestionText(index, feature.name),
        source: "quantitative",
      },
      {
        sectionIndex: 1,
        paragraphIndex: position.mean,
        expectedText: `만족도 점수 평균 : ${REFERENCE_FEATURES[index].mean} / 10`,
        text: `만족도 점수 평균 : ${fixed2(feature.mean)} / 10`,
        source: "quantitative",
      },
      {
        sectionIndex: 1,
        paragraphIndex: position.sd,
        expectedText: `표준편차 : ${REFERENCE_FEATURES[index].sd}`,
        text: `표준편차 : ${fixed2(feature.sd)}`,
        source: "quantitative",
      },
    );
  });

  return patches;
}

/** 기능별 응답 요약 3칸을 저장된 정성 카테고리에서만 구성한다. AI 재호출은 없다. */
export function buildRivalabsSwQualitativeSummaryPatches(payload: StoredTemplateReportPayload): HwpxParagraphPatch[] {
  if (payload.template.id !== "rivalabs-sw") {
    throw new Error("리바랩스 SW 원본 전용 정성 패치를 다른 템플릿에 적용할 수 없습니다.");
  }
  const byKey = new Map(payload.qualitative.map((question) => [question.questionKey, question]));
  const patches: HwpxParagraphPatch[] = [];
  const polarities: SummaryPolarity[] = ["positive", "negative", "neutral"];

  payload.report.quantStats.featureSatisfaction.forEach((feature, index) => {
    const question = byKey.get(`feature:${feature.name}`);
    const positions = FEATURE_SUMMARY_PARAGRAPHS[index];
    const countPositions = FEATURE_COUNT_PARAGRAPHS[index];
    const reference = REFERENCE_SUMMARIES[index];
    if (!question || !positions || !reference) return;
    for (const [polarityIndex, polarity] of polarities.entries()) {
      const text = categorySummary(question.categories, polarity);
      if (!text) continue;
      // 일부 원본은 "[긍정 의견 요약]본문"을 하나의 스타일 혼합 문단으로 저장한다.
      // 이 문단을 통째로 바꾸면 제목의 볼드/색상 run까지 사라지므로, 템플릿 슬롯을 분리하기
      // 전에는 안전하게 건너뛴다.
      if (reference[polarityIndex].startsWith("[")) continue;
      patches.push({
        sectionIndex: 1,
        paragraphIndex: positions[polarity],
        expectedText: reference[polarityIndex],
        text,
        source: "qualitative",
      });
    }
    for (const polarity of polarities) {
      const countText = polarityCountText(question, polarity);
      if (!countText || !countPositions) continue;
      const countReference = ["26.6%(45건)", "70.4%(119건)", "3.0%(5건)"];
      // 기준 문구는 첫 기능만 별도 배열을 쓸 수 없으므로, 아래 원본 고정값 표에서 역참조한다.
      const referenceCounts = [
        ["26.6%(45건)", "70.4%(119건)", "3.0%(5건)"],
        ["42.4%(50건)", "53.4%(63건)", "4.2%(5건)"],
        ["33.3%(38건)", "41.2%(47건)", "25.4%(29건)"],
        ["26.0%(32건)", "54.5%(67건)", "19.5%(24건)"],
        ["25.2%(27건)", "64.5%(69건)", "10.3%(11건)"],
        ["28.5%(58건)", "68.0%(136건)", "3.5%(7건)"],
      ] as const;
      const polarityIndex = polarities.indexOf(polarity);
      patches.push({
        sectionIndex: 1,
        paragraphIndex: countPositions[polarity],
        expectedText: referenceCounts[index]?.[polarityIndex] ?? countReference[polarityIndex],
        text: countText,
        source: "qualitative",
      });
    }
  });
  return patches;
}

/**
 * 현재 DB의 확정 분석 결과를 원본 문단에 옮기는 전체 안전 패치 묶음.
 * 구조가 복합인 정성 상세 인용문/표는 여기서 억지로 평탄화하지 않는다.
 */
export function buildRivalabsSwStoredPatches(payload: StoredTemplateReportPayload): HwpxParagraphPatch[] {
  return [
    ...buildRivalabsSwBasePatches(payload),
    ...buildRivalabsSwQualitativeSummaryPatches(payload),
    ...buildRivalabsSwRecommendationPatches(payload),
  ];
}
