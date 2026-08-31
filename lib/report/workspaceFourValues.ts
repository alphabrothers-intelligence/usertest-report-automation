import type { QuestionWithApprovedCategories } from "@/lib/db/reports";
import type { QuantStats } from "@/lib/quant/compute";
import { genericOf } from "@/lib/report/genericStats";
import { meanChart } from "@/lib/report/workspaceCharts";
import {
  headingBlock,
  richStaticBlock,
  tableBlock,
  type ReportBlock,
} from "@/lib/report/sections";

export type FourValuesServices = {
  fourValueQualitativeBlocks: (
    stats: QuantStats,
    idPrefix: string,
    questions: QuestionWithApprovedCategories[],
    itemsText?: string,
  ) => ReportBlock[];
  questionsByKeyPrefix: (questions: QuestionWithApprovedCategories[], prefix: string) => QuestionWithApprovedCategories[];
  sectionAnalysisPanelHtml: (analysis: string) => string;
  analysisEvidenceHtml: (title: string, content: string) => string;
  originalAnalysisPanelHtml: (title: string, content: string, actionHtml?: string) => string;
  sectionAiRegenerateButtonHtml: () => string;
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 옛 경로(`lib/pipeline/questions.ts`)의 영문 문항 키 ↔ `genericOf()` 폴백이 쓰는 축 이름.
 *
 * 이름으로만 이으면 **`사회·공공적 가치` 하나가 안 붙는다** — 옛 label 이 `사회·공공적 **이슈**
 * 가치 만족도`라 부분 문자열이 아니다(2026-08-31 실측. 예전 코드도 종합 해석에서 같은 이유로
 * 이 축만 근거를 못 찾고 있었다). 네 개짜리 닫힌 목록이므로 추측하지 말고 그냥 적어둔다.
 *
 * ponytail: 옛 경로가 지워지면 이 표도 같이 지운다 — 새 경로는 키가 `values:{축 이름}`이다.
 */
const LEGACY_VALUE_KEYS: Record<string, string> = {
  "기능적 가치": "values:functional",
  "심미적 가치": "values:aesthetic",
  "경제적 가치": "values:economic",
  "사회·공공적 가치": "values:social",
};

/**
 * 가치 축 하나에 붙는 정성 문항을 찾는다.
 *
 * **문항 키가 경로마다 다르다.** 옛 경로는 `values:functional`처럼 영문 고정 키를 쓰고 축
 * 이름은 label 에만 있는데, 새 경로(`lib/agent/questionSpecs.ts`)는 `values:{축 이름}`이다.
 * 축 이름은 raw data 에서 오므로 **그쪽이 기준이고, 키를 맞추려 들지 않는다.**
 * 못 찾으면 그 축은 정성 대기다 — 엉뚱한 문항을 붙이느니 비워두는 편이 낫다.
 */
export function findValueQuestion(
  questions: QuestionWithApprovedCategories[],
  axisName: string,
): QuestionWithApprovedCategories | undefined {
  const byKey = (key: string) => questions.find((question) => question.question_key === key);
  const normalize = (value: string) => value.replace(/[\s·]/g, "");
  const axis = normalize(axisName);
  return byKey(`values:${axisName}`)
    ?? byKey(LEGACY_VALUE_KEYS[axisName] ?? "")
    ?? questions.find((question) => {
      const label = normalize(question.label);
      return label.includes(axis) || axis.includes(label);
    });
}

/** Ⅴ장 "2"의 저장 분석이 없을 때 사용하는 기존 규칙 기반 종합 해석. */
function buildFourValuesAnalysisText(
  rows: { label: string; mean: number; sd: number }[],
  qualitative: QuestionWithApprovedCategories[],
  questionsByKeyPrefix: FourValuesServices["questionsByKeyPrefix"],
): string {
  const ranked = [...rows].sort((a, b) => b.mean - a.mean);
  // 패널 제목 배너가 이미 "4대 가치 만족도 종합 해석"이므로 본문 라벨은 중복이다(2026-08-18).
  const parts: string[] = [];
  parts.push(`<p style="margin:0 0 3pt">• '${escapeHtml(ranked[0].label)}'의 만족도가 ${ranked[0].mean.toFixed(2)}점으로 가장 높고, '${escapeHtml(ranked[ranked.length - 1].label)}'가 ${ranked[ranked.length - 1].mean.toFixed(2)}점으로 가장 낮음.</p>`);
  const valuesQual = questionsByKeyPrefix(qualitative, "values:");
  for (const row of ranked) {
    const question = findValueQuestion(valuesQual, row.label);
    const negatives = question?.categories.filter((c) => c.polarity === "negative").slice(0, 3).map((c) => c.label) ?? [];
    if (negatives.length > 0) {
      parts.push(`<p style="margin:0 0 3pt">• '${escapeHtml(row.label)}'(${row.mean.toFixed(2)}점): ${negatives.map(escapeHtml).join(", ")} 관련 개선 필요</p>`);
    }
  }
  return parts.join("");
}

/** 섹션 Ⅴ: 4대 가치 만족도. */
export function buildFourValuesSection(
  stats: QuantStats,
  qualitative: QuestionWithApprovedCategories[],
  analysis: string | undefined,
  itemsText: string | undefined,
  services: FourValuesServices,
): ReportBlock[] {
  // **축 이름은 raw data 헤더에서, 개수는 방법론에서.** "4대 가치"는 이 조사가 항상 쓰는
  // 틀의 이름이라 세어서 만들지 않는다(담당자 확인 2026-08-28) — 오분류 하나로 장 제목이
  // "3대 가치 만족도"가 되면 안 된다. 이름만 데이터에서 오므로 프로젝트마다 문구는 달라진다.
  const rows = genericOf(stats).valueAxes.map((axis) => ({ label: axis.name, mean: axis.mean, sd: axis.sd }));
  // 가치 문항을 아예 안 받은 raw data가 있다(정리습관). 그 장은 목차에서 드롭되지만, 빌더는
  // 목차와 무관하게 먼저 실행되므로 여기서 막지 않으면 빈 배열에 `[0]`을 찍어 죽는다.
  if (rows.length === 0) return [];
  return [
    headingBlock({ id: "values-result-heading", variant: "numbered", number: "1", text: "4대 가치 만족도 조사 결과" }),
    ...services.fourValueQualitativeBlocks(stats, "four-values-qualitative", services.questionsByKeyPrefix(qualitative, "values:"), itemsText),
    headingBlock({ id: "values-analysis-heading", variant: "numbered", number: "2", text: "4대 가치 만족도 조사 결과 분석" }),
    meanChart("four-values-chart", "4대 가치 만족도 종합 결과", rows.map((r) => ({ name: r.label, mean: r.mean }))),
    tableBlock({
      id: "four-values-table",
      title: "4대 가치 만족도",
      headers: ["가치", "평균", "표준편차"],
      rows: rows.map((r) => [r.label, r.mean, r.sd]),
    }),
    richStaticBlock({
      id: "four-values-analysis-summary",
      html: analysis
        ? services.sectionAnalysisPanelHtml(analysis)
        : services.analysisEvidenceHtml("4대 가치 만족도 종합 해석", services.originalAnalysisPanelHtml(
          "4대 가치 만족도 종합 해석",
          buildFourValuesAnalysisText(rows, qualitative, services.questionsByKeyPrefix),
          services.sectionAiRegenerateButtonHtml(),
        )),
      summaryQuestionKey: "fourValues",
      summaryKind: "section",
    }),
  ];
}
