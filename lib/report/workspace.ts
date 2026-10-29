import type { ProductInfo } from "@/lib/productInfo/types";
import { richTextToHtml } from "@/lib/report/richText";
import type { QuantStats } from "@/lib/quant/compute";
import { normalizeQuantStats } from "@/lib/report/workspaceCompatibility";
import {
  analysisEvidenceHtml,
  escapeHtml,
  featureQualitativeBlocks,
  findSurveyQuestion,
  fourValueQualitativeBlocks,
  qualitativeBlock,
  qualitativeBlocks,
} from "@/lib/report/workspaceQualitative";
export { responseSummaryHtml, valueSummaryBoxHtml } from "@/lib/report/workspaceQualitative";
import { orderQualitativeQuestions, questionsByKeyPrefix, questionsByKeys } from "@/lib/report/workspaceQuestionOrder";
// 타입만 가져온다(import type) — reports.ts가 postgres를 import하지만, 타입 전용 import는
// 컴파일 시 제거되므로 클라이언트 번들에 DB 클라이언트가 딸려오지 않는다.
import type { QuestionWithApprovedCategories, RecommendationRow, SectionAnalyses } from "@/lib/db/reports";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";
import { NUMERALS, type SectionPlan } from "@/lib/agent/sectionPlan";
import { parseCompetitorTable } from "@/lib/pipeline/sectionAnalysis";
import { competitorComparisonBlock } from "@/lib/report/competitorTable";
import { buildConclusionSection } from "@/lib/report/workspaceConclusion";
import { buildOverviewSection } from "@/lib/report/workspaceOverview";
import { buildDemographicsSection } from "@/lib/report/workspaceDemographics";
import { buildFeatureSection } from "@/lib/report/workspaceFeatureExperience";
import { buildCorePurchaseFactorSection } from "@/lib/report/workspaceCorePurchaseFactor";
import { buildFourValuesSection } from "@/lib/report/workspaceFourValues";
import { buildUxQualitySection } from "@/lib/report/workspaceUxQuality";
import { buildCrossAnalysisSection } from "@/lib/report/workspaceCrossAnalysis";
import { buildJourneySection } from "@/lib/report/workspaceJourney";
import { buildNpsSection } from "@/lib/report/workspaceNps";
import { dataTableCss } from "@/lib/report/sectionStyle";
import type { ReportSectionContent, ReportBlock } from "@/lib/report/sections";

const CSS = dataTableCss();

/**
 * 브라우저 편집 작업공간으로 넘기는 보고서 모델. Ⅰ~Ⅸ 섹션을 `buildReportPlan()`의 numeral/
 * title 뼈대에 실제 QuantStats 값을 채운 `chart`/`table`/`text` 블록 목록으로 만든다
 * (PRD 3.3.1, 2026-07-25 재구성). PDF/DOCX/HWPX 렌더러의 레이아웃 구현과는 분리돼 있다 —
 * 웹에서 문장이나 차트를 편집해도 기존 독립 PDF 렌더러를 변경하지 않는다.
 *
 * 정성 데이터(카테고리·인용문·인사이트)는 DB에 저장된 승인 문항을 그대로 연결한다.
 * 아직 생성·승인되지 않은 문항만 `pending: true` 텍스트 블록으로 정직하게 비워 둔다.
 */
export type ReportWorkspaceSeed = {
  quantStats: QuantStats;
  productInfo?: ProductInfo | null;
  resultSummary?: string | null;
  sections: ReportSectionContent[];
};

/** raw data 헤더에서 받은 실제 설문 문항을 Q 번호로 안전하게 찾는다.
 * 헤더가 없는 과거 데이터도 렌더링이 멈추지 않도록 기본 제목을 함께 둔다. */
function questionText(stats: QuantStats, questionNo: number, fallback: string): string {
  return stats.surveyQuestions[questionNo - 1]?.question || fallback;
}

/** 섹션 Ⅲ: 기능별 고객 경험 평가 — 정량(만족도·순위)만, 정성(카테고리·인용문)은 대기 표시. */
/** 원본 분석 페이지처럼 제목띠와 본문을 하나의 표형 패널로 묶는다.
 * 편집 가능한 본문·복사·내보내기가 동일한 HTML 구조를 공유한다. */
function originalAnalysisPanelHtml(title: string, content: string, actionHtml = ""): string {
  return [
    `<div style="margin:6pt 0 12pt;border:0.75pt solid #8ea7de;border-top:3pt solid #4fc8e8;font-family:'맑은 고딕','Malgun Gothic','Apple SD Gothic Neo',sans-serif;font-size:10.8pt;line-height:1.75;color:#111827">`,
    `<p style="margin:0;padding:7pt 10pt;text-align:center;background-color:${CSS.palette.title};border-bottom:${CSS.border};font-weight:700;color:#111827">${actionHtml}[ ${escapeHtml(title)} ]</p>`,
    `<div style="padding:10pt 14pt">${content}</div>`,
    `</div>`,
  ].join("");
}

/** sectionAnalysis.ts가 생성하는 섹션 단위 종합 해석 4종의 제목·구성.
 * 여기 없는 크로스분석(crossAnalysis)은 웹 문서에 별도 재생성 버튼을 아직 두지 않는다. */
export type SectionAnalysisRegenKey = "featureExperience" | "corePurchaseFactor" | "fourValues" | "uxQuality";
const SECTION_ANALYSIS_TITLES: Record<SectionAnalysisRegenKey, string> = {
  featureExperience: "기능별 중요 순위 및 만족도 종합 해석",
  corePurchaseFactor: "핵심구매요소 중요 순위 및 만족도 종합 해석",
  fourValues: "4대 가치 만족도 종합 해석",
  uxQuality: "사용자 경험 품질 평가 결과 분석",
};

/** "정성 분석 대기"였던 섹션 종합 해석(핵심구매요소·UX 품질)이나, 저장된 LLM 분석 없이 규칙
 * 기반 폴백만 나오던 섹션(기능별·4대 가치)에 공통으로 붙이는 재생성 버튼. 클릭하면
 * /api/report-section-analysis가 sectionAnalysis.ts를 다시 돌려 이 패널을 새로 채운다. */
function sectionAiRegenerateButtonHtml(section: SectionAnalysisRegenKey): string {
  return `<button type="button" data-copy-ignore contenteditable="false" data-ai-summary="${escapeHtml(section)}" style="float:right;border:1px solid #315c9c;border-radius:3pt;background:#ffffff;color:#315c9c;padding:3pt 7pt;font-size:9pt;font-weight:700;cursor:pointer">AI 분석 재생성</button>`;
}

/** sectionAnalysis.ts가 만든 텍스트(analysis)를 패널 HTML로 렌더링한다. 웹 문서 최초
 * 렌더링과 재생성 버튼 응답(app/api/report-section-analysis/route.ts) 양쪽이 이 함수 하나를
 * 공유해, 버튼으로 교체된 패널이 페이지를 새로고침했을 때 나오는 것과 항상 같은 모양이 되게 한다. */
/** 패널 제목 배너가 이미 "… 종합 해석"/"… 세부 해석"이므로, 본문 첫 줄의 [종합 해석]/[세부 해석]
 * 라벨은 같은 말이 두 번 보이게 한다(2026-08-18 지적). 이 라벨은 uxQuality 분할·PDF 렌더러가
 * 쓰는 구조 마커라 생성 단계에서 없앨 수 없어, 화면에 넣기 직전에만 벗긴다. */
function stripAnalysisLabel(text: string): string {
  return text.replace(/^\s*\[(?:종합|세부) 해석\]\s*/u, "").trim();
}

export function sectionAnalysisPanelHtml(section: SectionAnalysisRegenKey, analysis: string): string {
  const button = sectionAiRegenerateButtonHtml(section);
  if (section === "uxQuality") {
    const splitIndex = analysis.indexOf("[세부 해석]");
    const overview = splitIndex >= 0 ? analysis.slice(0, splitIndex).trim() : analysis;
    const detail = splitIndex >= 0 ? analysis.slice(splitIndex).trim() : "";
    return (
      originalAnalysisPanelHtml("사용자 경험 품질 평가 종합 해석", richTextToHtml(stripAnalysisLabel(overview)), button) +
      (detail ? originalAnalysisPanelHtml("사용자 경험 품질 세부 해석", richTextToHtml(stripAnalysisLabel(detail))) : "")
    );
  }
  const title = SECTION_ANALYSIS_TITLES[section];
  const panel = originalAnalysisPanelHtml(title, richTextToHtml(stripAnalysisLabel(analysis)), button);
  return section === "corePurchaseFactor" ? panel : analysisEvidenceHtml(title, panel);
}

/** 저장된 raw data 정량 결과와 이미 생성된 결과 요약을 편집 가능한 웹 섹션 콘텐츠로 변환한다. */
/**
 * 옛 고정 목차(리바랩스 기준 9장)의 출력 번호 → 표준목차 시트 식별자.
 *
 * 둘은 **같지 않다**. 시트에는 조건부 장인 `IV 고객 여정`이 네 번째 자리에 있어서, 리바랩스처럼
 * 그 장이 없는 데이터는 다섯 번째 장(핵심구매요소)이 출력 번호로는 Ⅳ가 된다. 옛 경로는 이
 * 어긋남 없이 번호를 그대로 키로 썼으므로, 새 키(식별자)로 옮기면서 한 번만 변환한다.
 *
 * ponytail: 옛 고정 목차(`buildReportPlan`)가 지워지면 이 표도 같이 지운다.
 */
const LEGACY_ID_BY_NUMERAL: Record<string, string> = {
  IV: "V", // 핵심구매요소
  V: "VI", // 4대 가치 만족도
  VI: "VII", // 사용자 경험 품질 평가
  VII: "VIII", // 교차 분석
  VIII: "IX", // 종합 만족도 및 NPS 지수
  IX: "X", // 종합 결과 및 제언
};

export function buildReportWorkspaceSeed(input: {
  quantStats: QuantStats;
  productInfo?: ProductInfo | null;
  fileName?: string | null;
  resultSummary?: string | null;
  /** DB에 저장된 정성 분석 결과(문항+카테고리). 없으면 정성 섹션은 "대기"로 표시된다. */
  qualitative?: QuestionWithApprovedCategories[] | null;
  /** DB에 저장된 제언 초안(승인 여부 무관). 없으면 Ⅸ장 제언은 "대기"로 표시된다. */
  recommendations?: RecommendationRow[] | null;
  /** DB에 저장된 섹션 단위 정성 분석(Ⅲ.2·Ⅳ·Ⅴ.2·Ⅵ.2). 없으면 규칙 기반 fallback/대기 표시. */
  sectionAnalyses?: SectionAnalyses | null;
  /**
   * 역할 분류 에이전트가 만든 장 목록(PRD 2.2.2절 3단계). 주면 **그 데이터에 실제로 있는
   * 장만** 그 순서·번호로 나온다(케어클은 고객 여정 장이 생기고, 정리습관은 가치·UX 장이
   * 빠진다). 없으면 예전처럼 리바랩스 기준 9장 고정 목차를 쓴다.
   */
  sectionPlan?: SectionPlan | null;
}): ReportWorkspaceSeed {
  const { productInfo, fileName, resultSummary } = input;
  const stats = normalizeQuantStats(input.quantStats);
  const qual = orderQualitativeQuestions(stats, input.qualitative ?? []);
  const recommendations = input.recommendations ?? [];
  const sa = input.sectionAnalyses ?? {};
  const plan = buildReportPlan(stats.featureSatisfaction.map((f) => f.name));

  // 키는 **표준목차 시트의 고정 식별자**(I~X)다. 출력 번호(numeral)는 생성된 장에만 순서대로
  // 붙으므로 키로 쓰면 안 된다 — 이젠오토는 교차 분석이 여섯 번째 장이지만 식별자는 VIII이다.
  const blocksById: Record<string, ReportBlock[]> = {
    I: buildOverviewSection(stats, productInfo, fileName),
    // 유사 서비스 경험의 주관식(만족 이유)은 분석·저장까지 되는데 어느 장에도 배치되지 않았다
    // (2026-09-30 케어클·리바랩스 실측). 원본처럼 "유사 서비스 경험" 표 바로 아래에 싣는다.
    II: [
      ...buildDemographicsSection(stats),
      ...qualitativeBlocks("demo-prior-service-qual", questionsByKeys(qual, ["priorService"])),
      // 경쟁재 장단점 표(케어클 원본 9쪽) — 섹션 분석이 경험자 서술을 브랜드별로 요약한 결과가 있을 때만.
      ...(() => {
        const rows = parseCompetitorTable(sa.competitorTable);
        return rows.length
          ? [competitorComparisonBlock({ id: "demo-prior-service-competitors", rows, respondentCount: stats.demographics.priorServiceDetail?.experienced })]
          : [];
      })(),
    ],
    IV: buildJourneySection(stats),
    III: buildFeatureSection(stats, qual, sa.featureExperience, {
      featureQualitativeBlocks,
      questionsByKeyPrefix,
      questionText,
      sectionAnalysisPanelHtml: (analysis) => sectionAnalysisPanelHtml("featureExperience", analysis),
      analysisEvidenceHtml,
      originalAnalysisPanelHtml,
      sectionAiRegenerateButtonHtml: () => sectionAiRegenerateButtonHtml("featureExperience"),
    }),
    V: buildCorePurchaseFactorSection(stats, sa.corePurchaseFactor, {
      questionText,
      sectionAnalysisPanelHtml: (analysis) => sectionAnalysisPanelHtml("corePurchaseFactor", analysis),
      originalAnalysisPanelHtml,
      sectionAiRegenerateButtonHtml: () => sectionAiRegenerateButtonHtml("corePurchaseFactor"),
    }),
    VI: buildFourValuesSection(stats, qual, sa.fourValues, sa.fourValueItems, {
      fourValueQualitativeBlocks,
      questionsByKeyPrefix,
      sectionAnalysisPanelHtml: (analysis) => sectionAnalysisPanelHtml("fourValues", analysis),
      analysisEvidenceHtml,
      originalAnalysisPanelHtml,
      sectionAiRegenerateButtonHtml: () => sectionAiRegenerateButtonHtml("fourValues"),
    }),
    VII: buildUxQualitySection(stats, sa.uxQuality, {
      sectionAnalysisPanelHtml: (analysis) => sectionAnalysisPanelHtml("uxQuality", analysis),
      originalAnalysisPanelHtml,
      sectionAiRegenerateButtonHtml: () => sectionAiRegenerateButtonHtml("uxQuality"),
    }),
    VIII: buildCrossAnalysisSection(stats, sa.crossAnalysis),
    IX: buildNpsSection(stats, qual, {
      questionsByKeys,
      findSurveyQuestion,
      qualitativeBlock,
      serviceName: productInfo?.serviceName,
    }),
    X: buildConclusionSection(stats, resultSummary, qual, recommendations),
  };

  // 에이전트 목차가 있으면 **그 데이터에 실제로 있는 장만** 그 순서·번호로 낸다.
  // 없으면 예전처럼 리바랩스 기준 9장 고정 목차(numeral이 곧 식별자였다).
  const planned: ReportSectionContent[] = input.sectionPlan
    ? input.sectionPlan.chapters.map((chapter) => ({
      numeral: chapter.numeral,
      title: chapter.title,
      blocks: blocksById[chapter.id] ?? [],
    }))
    : plan.map((section) => ({
      numeral: section.numeral,
      title: section.title,
      blocks: blocksById[LEGACY_ID_BY_NUMERAL[section.numeral] ?? section.numeral] ?? [],
    }));

  // **블록이 하나도 없는 장은 빼고 번호를 다시 매긴다.** 그 데이터에 없는 문항이라 안쪽 블록을
  // 전부 만들지 않은 장(예: 연령·성별 정보가 없는 raw data의 교차 분석)이 제목만 남아 목차와
  // 본문에 빈 장으로 나왔다(2026-09-07 5종 점검). 빼기만 하면 번호가 건너뛰므로 다시 매긴다.
  const sections: ReportSectionContent[] = planned
    .filter((section) => section.blocks.length > 0)
    .map((section, index) => ({ ...section, numeral: NUMERALS[index] ?? section.numeral }));

  return { quantStats: stats, productInfo, resultSummary, sections };
}
