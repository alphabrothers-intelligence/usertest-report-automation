import type { ProductInfo } from "@/lib/productInfo/types";
import type { QuantStats } from "@/lib/quant/compute";
import { headingBlock, richStaticBlock, type ReportBlock } from "@/lib/report/sections";

const OVERVIEW = {
  labelBg: "#dfe6f7",
  navy: "#315c9c",
  border: "#d4d4d8",
  subtext: "#52525b",
  bannerBg: "#c0cdef",
  stageBg: "#eef2fb",
} as const;

type OverviewCell = {
  label: string;
  value?: string | null;
  wide?: boolean;
  alignLeft?: boolean;
  tall?: boolean;
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function reportName(productInfo?: ProductInfo | null, fileName?: string | null): string {
  return productInfo?.serviceName ?? fileName?.replace(/\.[^.]+$/, "") ?? "사용성 테스트";
}

function overviewTableHtml(title: string, rows: OverviewCell[][]): string {
  const border = `1px solid ${OVERVIEW.border}`;
  const cellHtml = (cell: OverviewCell, valueColSpan: number) => {
    const labelCell = `<td style="width:110px;background:${OVERVIEW.labelBg};font-weight:700;text-align:center;vertical-align:middle;padding:8px 6px;border:${border}">${escapeHtml(cell.label)}</td>`;
    const align = cell.alignLeft ? "left" : "center";
    const valign = cell.tall ? "top" : "middle";
    const extra = cell.tall ? "height:150px;" : "";
    const span = valueColSpan > 1 ? ` colspan="${valueColSpan}"` : "";
    const valueCell = cell.value
      ? `<td${span} style="padding:8px 10px;border:${border};text-align:${align};vertical-align:${valign};line-height:1.5;${extra}">${escapeHtml(cell.value)}</td>`
      : `<td${span} data-empty-placeholder="true" data-placeholder="입력 필요" style="padding:8px 10px;border:${border};text-align:${align};vertical-align:${valign};color:${OVERVIEW.subtext};${extra}">입력 필요</td>`;
    return labelCell + valueCell;
  };
  const body = rows
    .map((cells) => `<tr>${cells.map((cell) => cellHtml(cell, cells.length === 1 ? 3 : 1)).join("")}</tr>`)
    .join("");
  return `<table style="border-collapse:collapse;width:100%;border:${border};font-size:13px;color:#111827;margin:0 0 14px"><tbody><tr><td colspan="4" style="background:${OVERVIEW.labelBg};text-align:center;font-weight:700;color:${OVERVIEW.navy};padding:8px 5px;border:${border}">${escapeHtml(title)}</td></tr>${body}</tbody></table>`;
}

function overviewBulletsHtml(items: { label: string; value?: string | null }[]): string {
  const rows = items.map((item) => {
    const value = item.value
      ? `<span>${escapeHtml(item.value)}</span>`
      : `<span data-empty-placeholder="true" data-placeholder="입력 필요" style="color:${OVERVIEW.subtext}">입력 필요</span>`;
    return `<p style="margin:0 0 5px;font-size:13px;line-height:1.5"><span style="font-weight:700">• ${escapeHtml(item.label)} : </span>${value}</p>`;
  }).join("");
  return `<div style="padding:2px 4px 6px">${rows}</div>`;
}

function surveyTableHtml(surveyQuestions: { stage: string; question: string }[]): string {
  const border = `1px solid ${OVERVIEW.border}`;
  const headCell = (label: string, width?: string) =>
    `<th style="${width ? `width:${width};` : ""}background:${OVERVIEW.bannerBg};color:${OVERVIEW.navy};font-weight:700;text-align:center;padding:8px 5px;border:${border}">${label}</th>`;
  if (!surveyQuestions.length) {
    return `<table style="border-collapse:collapse;width:100%;border:${border};font-size:13px;color:#111827"><thead><tr>${headCell("단계", "120px")}${headCell("문항", "60px")}${headCell("주요 활동")}</tr></thead><tbody><tr><td colspan="3" style="padding:12px;text-align:center;color:${OVERVIEW.subtext};border:${border}">raw data 헤더를 확인하면 설문 문항이 표시됩니다.</td></tr></tbody></table>`;
  }
  const stages = surveyQuestions.reduce<{ stage: string; questions: string[] }[]>((groups, row) => {
    const last = groups[groups.length - 1];
    if (last && last.stage === row.stage) last.questions.push(row.question);
    else groups.push({ stage: row.stage, questions: [row.question] });
    return groups;
  }, []);
  let questionNumber = 0;
  const bodyRows: string[] = [];
  for (const stage of stages) {
    stage.questions.forEach((question, questionIndex) => {
      questionNumber += 1;
      const stageCell = questionIndex === 0
        ? `<td rowspan="${stage.questions.length}" style="width:120px;background:${OVERVIEW.stageBg};font-weight:700;text-align:center;vertical-align:middle;padding:6px;border:${border}">${escapeHtml(stage.stage)}</td>`
        : "";
      bodyRows.push(`<tr>${stageCell}<td style="width:60px;font-weight:700;text-align:center;padding:6px 5px;border:${border}">Q${questionNumber}</td><td style="padding:6px 10px;border:${border};line-height:1.4">${escapeHtml(question)}</td></tr>`);
    });
  }
  return `<table style="border-collapse:collapse;width:100%;border:${border};font-size:13px;color:#111827"><thead><tr>${headCell("단계", "120px")}${headCell("문항", "60px")}${headCell("주요 활동")}</tr></thead><tbody>${bodyRows.join("")}<tr><td colspan="3" style="background:${OVERVIEW.bannerBg};color:${OVERVIEW.navy};font-weight:700;text-align:center;padding:8px;border:${border}">총 ${questionNumber} 문항</td></tr></tbody></table>`;
}

export function buildOverviewSection(
  stats: QuantStats,
  productInfo: ProductInfo | null | undefined,
  fileName: string | null | undefined,
): ReportBlock[] {
  const serviceName = reportName(productInfo, fileName);
  return [
    headingBlock({ id: "overview-h1", variant: "numbered", number: "1", text: "제품 소개" }),
    richStaticBlock({
      id: "overview-company",
      html: overviewTableHtml("기업 개요", [
        [{ label: "기업명", value: productInfo?.companyName }, { label: "홈페이지", value: productInfo?.homepage }],
        [{ label: "대표자", value: productInfo?.representative }, { label: "업무 담당자", value: productInfo?.contactPerson }],
      ]),
    }),
    richStaticBlock({
      id: "overview-service",
      html: overviewTableHtml("제품 및 서비스 개요", [
        [{ label: "서비스 명", value: productInfo?.serviceName ?? serviceName, wide: true }],
        [{ label: "서비스 요약", value: productInfo?.serviceSummary, wide: true, alignLeft: true }],
        [{ label: "사업 영역", value: productInfo?.businessArea }, { label: "산업 분야", value: productInfo?.industry }],
        [{ label: "운영 환경", value: productInfo?.operatingEnvironment }, { label: "사업화 단계", value: productInfo?.businessStage }],
        [{ label: "주요 기능", value: productInfo?.mainFeatures, wide: true, alignLeft: true, tall: true }],
      ]),
    }),
    headingBlock({ id: "overview-h2", variant: "numbered", number: "2", text: "사용성 테스트 진행 일정" }),
    richStaticBlock({
      id: "overview-schedule",
      html: overviewBulletsHtml([
        { label: "일  시", value: productInfo?.testPeriod },
        { label: "테스트 대상", value: productInfo?.testTarget ?? `${stats.respondentCount}명` },
        { label: "담당자", value: productInfo?.testManager },
      ]),
    }),
    headingBlock({ id: "overview-h3", variant: "numbered", number: "3", text: "사용성 테스트 설문 항목" }),
    richStaticBlock({ id: "overview-survey", html: surveyTableHtml(stats.surveyQuestions ?? []) }),
  ];
}
