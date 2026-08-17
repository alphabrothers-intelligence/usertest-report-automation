import type { StoredTemplateReportPayload } from "./templatePayload";
import {
  FEATURE_COUNT_PARAGRAPHS,
  FEATURE_PARAGRAPHS,
  FEATURE_RECOMMENDATION_SLOTS,
  FEATURE_SUMMARY_PARAGRAPHS,
  REFERENCE_COUNTS,
  REFERENCE_FEATURES,
  REFERENCE_RECOMMENDATION_TEXT,
  REFERENCE_SUMMARIES,
  SUMMARY_POLARITIES,
  SUMMARY_POLARITY_LABEL,
  type SummaryPolarity,
} from "./rivalabsSwTemplateSlots";

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
  const polarities = SUMMARY_POLARITIES;

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
      const polarityIndex = polarities.indexOf(polarity);
      patches.push({
        sectionIndex: 1,
        paragraphIndex: countPositions[polarity],
        expectedText: REFERENCE_COUNTS[index][polarityIndex],
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
