"use client";

import { type ReactNode } from "react";
import type { FeatureStat } from "@/lib/quant/compute";
import type { ProductInfo } from "@/lib/productInfo/types";
import type { ReportWorkspaceSeed } from "@/lib/report/workspace";
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";
import { EditableBarChart } from "@/components/report/EditableBarChart";
import { EditableGroupedBarChart } from "@/components/report/EditableGroupedBarChart";
import { EditableNpsChart } from "@/components/report/EditableNpsChart";
import { EditablePolarityChart } from "@/components/report/EditablePolarityChart";
import { PriorityReferenceDiagram } from "@/components/report/PriorityReferenceDiagram";
import { EditableQuadrantChart } from "@/components/report/EditableQuadrantChart";
import { EditableRadarChart } from "@/components/report/EditableRadarChart";
import { EditableRankCompositionChart } from "@/components/report/EditableRankCompositionChart";
import { EditableStackedBarChart } from "@/components/report/EditableStackedBarChart";
import { ReportImageUploadSlots } from "@/components/report/ReportImageUploadSlots";
import { findBlock, findHtml } from "./model";

export function A4Page({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <article id={id} data-hwpx-print-page className={`hwpx-sheet ${className}`}>{children}</article>;
}

/**
 * 원본의 이미지 영역을 웹 미리보기에서도 실제 첨부 슬롯으로 둔다.
 * 아직 HWPX 이미지 위치와 연결하지 않은 POC이므로 해당 브라우저의 미리보기에만 저장한다.
 */
function OverviewCell({ children, editable = false, colSpan }: { children: ReactNode; editable?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} contentEditable={editable} suppressContentEditableWarning={editable}>{children}</td>;
}

/** Ⅰ.1 원본의 제품·서비스 개요: 이미지 3칸과 주요 기능 서술칸을 별도 구조로 복원한다. */
export function RivalabsOverviewReferencePage({ section, productInfo }: { section: ReportSectionContent; productInfo: ProductInfo | null | undefined }) {
  const remaining = section.blocks.filter((block) => !["overview-h1", "overview-company", "overview-service"].includes(block.id));
  const imageKey = `hwpx-preview:product-images:${productInfo?.companyName ?? "company"}:${productInfo?.serviceName ?? "service"}`;
  return <A4Page className="rivalabs-reference-page p-[15mm]" id="preview-section-I">
    <div className="rivalabs-chapter-heading"><div className="rivalabs-chapter-number">Ⅰ</div><h2>개요</h2></div>
    <div className="rivalabs-section-content">
      <div className="rivalabs-section-heading"><span>1</span><strong>제품 소개</strong></div>
      <table className="rivalabs-overview-table">
        <tbody>
          <tr><th colSpan={4}>제품 및 서비스 개요</th></tr>
          <tr><th>서비스 명</th><OverviewCell editable colSpan={3}>{productInfo?.serviceName ?? "서비스·제품명 입력"}</OverviewCell></tr>
          <tr><th>서비스 요약</th><OverviewCell editable colSpan={3}>{productInfo?.serviceSummary ?? "서비스 요약 입력"}</OverviewCell></tr>
          <tr><th>사업 영역</th><OverviewCell editable>{productInfo?.businessArea ?? "입력 필요"}</OverviewCell><th>산업 분야</th><OverviewCell editable>{productInfo?.industry ?? "입력 필요"}</OverviewCell></tr>
          <tr><th>운영 환경</th><OverviewCell editable>{productInfo?.operatingEnvironment ?? "입력 필요"}</OverviewCell><th>사업화 단계</th><OverviewCell editable>{productInfo?.businessStage ?? "입력 필요"}</OverviewCell></tr>
          <tr><th rowSpan={2}>주요 기능</th><td colSpan={3}><ReportImageUploadSlots key={imageKey} storageKey={imageKey} /></td></tr>
          <tr><OverviewCell editable colSpan={3}>{productInfo?.mainFeatures ?? "주요 기능 설명을 입력하세요."}</OverviewCell></tr>
        </tbody>
      </table>
      <RivalabsBlockList blocks={remaining} />
    </div>
  </A4Page>;
}

export function RivalabsFeatureReferencePage({
  feature,
  question,
  scoreboxHtml,
  emotionboxHtml,
  detailHtml,
  pageId,
  detailPageId,
  showChapterHeading,
}: {
  feature: FeatureStat | undefined;
  question: string;
  scoreboxHtml: string;
  emotionboxHtml: string;
  detailHtml: string;
  pageId: string;
  detailPageId: string;
  showChapterHeading: boolean;
}) {
  // scorebox에는 평균표와 "만족도 분포도" 제목까지 포함돼 있다. 원본처럼 셀 제목은
  // 이 컴포넌트가 한 번만 그리고, 여기서는 실제 히스토그램 SVG만 꺼낸다.
  const distributionHtml = scoreboxHtml.match(/<svg[\s\S]*?<\/svg>/i)?.[0] ?? "";
  const editPrefix = `feature:${feature?.name ?? "unknown"}`;

  return (
    <>
      <A4Page className="rivalabs-reference-page p-[15mm]" id={pageId}>
        {showChapterHeading ? <div className="rivalabs-chapter-heading">
          <div className="rivalabs-chapter-number">Ⅲ</div>
          <h2>기능별 고객 경험 평가</h2>
        </div> : null}
        <div className={`${showChapterHeading ? "mt-9" : "mt-1"} border-t-[4px] border-[#48c2e0]`}>
          <div className="rivalabs-section-heading"><span>1</span><strong>기능별 고객 경험 조사 결과</strong></div>
          <section className="rivalabs-feature-frame mt-5">
            <h3>Q. {question}</h3>
            <div className="rivalabs-score-strip">
              <strong data-hwpx-edit-key={`${editPrefix}:mean`} contentEditable suppressContentEditableWarning>만족도 점수 평균 : {feature?.mean.toFixed(2) ?? "-"} / 10</strong>
              <span><strong data-hwpx-edit-key={`${editPrefix}:sd`} contentEditable suppressContentEditableWarning>표준편차 : {feature?.sd.toFixed(2) ?? "-"}</strong><small>*평균에서의 흩어진 정도</small></span>
            </div>
            <div className="rivalabs-two-column mt-4">
              <div className="rivalabs-cell">
                <p className="rivalabs-cell-title">만족도 분포도</p>
                <div className="rivalabs-chart-slot report-rich-static" dangerouslySetInnerHTML={{ __html: distributionHtml }} />
              </div>
              <div className="rivalabs-cell">
                <p className="rivalabs-cell-title">주요 키워드 도출</p>
                <ReportImageUploadSlots key={editPrefix} storageKey={`hwpx-preview:feature-keyword:${editPrefix}`} emptyLabel="워드클라우드 이미지 첨부" maxImages={1} variant="wordcloud" />
              </div>
            </div>
            <div className="rivalabs-emotion-frame report-rich-static mt-5" dangerouslySetInnerHTML={{ __html: emotionboxHtml }} />
          </section>
        </div>
      </A4Page>

      <A4Page className="rivalabs-reference-page p-[15mm]" id={detailPageId}>
        <section className="rivalabs-opinion-detail" data-hwpx-edit-key={`${editPrefix}:detail`} contentEditable suppressContentEditableWarning>
          {detailHtml ? <div dangerouslySetInnerHTML={{ __html: detailHtml }} /> : <p className="text-slate-500">저장된 정성 분석 결과가 없습니다.</p>}
        </section>
      </A4Page>
    </>
  );
}

export function RivalabsConclusionReferencePage({ workspace }: { workspace: ReportWorkspaceSeed }) {
  const summary = findBlock(workspace, "conclusion-summary-table");
  const strategy = findHtml(workspace, "conclusion-strategy-table");
  const customer = findHtml(workspace, "conclusion-feature-customer-table");
  const summaryRows = summary?.kind === "row-group" ? summary.rows : [];
  const featureExperience = summaryRows.find((row) => row.id === "conclusion-row-feature-experience");
  const otherResults = summaryRows.filter((row) => row.id !== "conclusion-row-feature-experience");

  return <>
    <A4Page className="rivalabs-reference-page p-[15mm]" id="preview-conclusion">
      <div className="rivalabs-chapter-heading"><div className="rivalabs-chapter-number">Ⅸ</div><h2>종합 결과 및 제언</h2></div>
      <div className="mt-9 border-t-[4px] border-[#48c2e0]">
        <div className="rivalabs-section-heading"><span>1</span><strong>사용성테스트 결과 요약</strong></div>
        {summary?.kind === "row-group" ? <div className="rivalabs-conclusion-table mt-5">
          <div className="rivalabs-conclusion-label">항목</div><div className="rivalabs-conclusion-head">주요 의견</div>
          <div className="rivalabs-conclusion-label">기능별 고객<br />경험 평가</div>
          <div className="rivalabs-conclusion-body">
            <RivalabsBlockList blocks={featureExperience?.blocks ?? []} />
          </div>
          <div className="rivalabs-conclusion-label">기타 분석 결과</div>
          <div className="rivalabs-conclusion-body">
            {otherResults.map((row) => <section key={row.id} className="rivalabs-conclusion-result-row">
              <h3>{row.label}</h3>
              <RivalabsBlockList blocks={row.blocks} />
            </section>)}
          </div>
        </div> : <p className="mt-5 text-sm text-slate-500">저장된 사용성테스트 결과 요약이 없습니다.</p>}
      </div>
    </A4Page>

    <A4Page className="rivalabs-reference-page p-[15mm]" id="preview-strategy">
      <div className="border-t-[4px] border-[#48c2e0]">
        <div className="rivalabs-section-heading"><span>2</span><strong>개선 전략 제언</strong></div>
        <div className="rivalabs-conclusion-body report-rich-static mt-5" data-hwpx-edit-key="conclusion:strategy" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: strategy || "<p>저장된 개선 전략 제언이 없습니다.</p>" }} />
      </div>
      <div className="mt-12 border-t-[4px] border-[#48c2e0]">
        <div className="rivalabs-section-heading"><span>3</span><strong>기능별 고객 제언 종합</strong></div>
        <div className="rivalabs-conclusion-body report-rich-static mt-5" data-hwpx-edit-key="conclusion:customer" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: customer || "<p>저장된 기능별 고객 제언이 없습니다.</p>" }} />
      </div>
    </A4Page>
  </>;
}

function RivalabsGenericBlock({ block }: { block: ReportBlock }) {
  if (block.kind === "heading") {
    if (block.variant === "numbered") return <div className="rivalabs-section-heading mt-7"><span>{block.number}</span><strong>{block.text}</strong></div>;
    if (block.variant === "question") return <h3 className="rivalabs-question">{block.number ? `${block.number}. ` : "Q. "}{block.text}</h3>;
    return <h3 className="rivalabs-subheading">{block.text}</h3>;
  }
  if (block.kind === "rich-static" || block.kind === "text") return <div className="rivalabs-generic-rich report-rich-static" data-hwpx-edit-key={`block:${block.id}`} contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: block.html }} />;
  if (block.kind === "table") {
    if (block.id === "feature-rank-table") return <FeatureRankSummaryTable block={block} />;
    if (block.id === "feature-importance-table") return <FeatureImportanceSummaryTable block={block} />;
    return <div className="rivalabs-data-table" data-hwpx-edit-key={`block:${block.id}`}><p>{block.title}</p><table><thead><tr>{block.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={`${block.id}-${index}`}>{row.map((cell, cellIndex) => <td key={cellIndex} contentEditable={typeof cell === "number"} suppressContentEditableWarning>{String(cell)}</td>)}</tr>)}</tbody></table></div>;
  }
  // /viewer에서 검증된 SVG 차트만 그대로 재사용한다. 이 경로에서 HTML/CSS로 차트를
  // 다시 그리면 축·격자·범례·PNG 출력이 달라져 원본 보고서 검토 경험이 깨진다.
  if (block.kind === "chart") return <EditableBarChart block={block} />;
  if (block.kind === "nps") return <EditableNpsChart block={block} />;
  if (block.kind === "polarity") return <EditablePolarityChart block={block} />;
  if (block.kind === "quadrant") return <EditableQuadrantChart block={block} onChange={() => undefined} />;
  if (block.kind === "priority-reference") return <PriorityReferenceDiagram block={block} />;
  if (block.kind === "rank-composition") return <EditableRankCompositionChart block={block} />;
  if (block.kind === "stacked-bar") return <EditableStackedBarChart block={block} />;
  if (block.kind === "grouped-bar") return <EditableGroupedBarChart block={block} />;
  if (block.kind === "radar") return <EditableRadarChart block={block} />;
  return null;
}

type TableBlock = Extract<ReportBlock, { kind: "table" }>;

function HorizontalSummaryTable({
  title,
  rows,
  editKey,
}: {
  title: string;
  rows: Array<{ label: string; values: Array<string | number> }>;
  editKey: string;
}) {
  const count = Math.max(1, ...rows.map((row) => row.values.length));
  return <div className="rivalabs-data-table rivalabs-horizontal-summary" data-hwpx-edit-key={editKey}>
    <p>{title}</p>
    <table>
      <tbody>{rows.map((row, rowIndex) => <tr key={row.label}>
        <th>{row.label}</th>
        {Array.from({ length: count }, (_, index) => {
          const value = row.values[index] ?? "-";
          const emphasis = rowIndex > 0 ? (index === 0 ? "is-best" : index === count - 1 ? "is-lowest" : "") : "";
          return <td key={`${row.label}-${index}`} className={emphasis} contentEditable={typeof value === "number"} suppressContentEditableWarning>{String(value)}</td>;
        })}
      </tr>)}</tbody>
    </table>
  </div>;
}

function FeatureRankSummaryTable({ block }: { block: TableBlock }) {
  return <HorizontalSummaryTable
    title="기능별 만족도 순위 종합"
    editKey={`block:${block.id}`}
    rows={[
      { label: "순위", values: block.rows.map((row, index) => row[0] ?? `${index + 1}위`) },
      { label: "기능", values: block.rows.map((row) => row[1] ?? "-") },
      { label: "평균 만족도", values: block.rows.map((row) => row[2] ?? "-") },
    ]}
  />;
}

function FeatureImportanceSummaryTable({ block }: { block: TableBlock }) {
  return <HorizontalSummaryTable
    title="기능별 중요 순위 종합"
    editKey={`block:${block.id}`}
    rows={[
      { label: "순위", values: block.rows.map((row, index) => row[0] ?? `${index + 1}위`) },
      { label: "기능", values: block.rows.map((row) => row[1] ?? "-") },
      { label: "상대 중요도", values: block.rows.map((row) => row[2] ?? "-") },
    ]}
  />;
}

function RivalabsBlockList({ blocks }: { blocks: ReportBlock[] }) {
  return <>{blocks.map((block) => <RivalabsGenericBlock key={block.id} block={block} />)}</>;
}

/** Ⅲ장에서 문항별 분석 다음에 빠져 있던 정량 결과 페이지를 원본 순서로 렌더링한다. */
export function RivalabsFeatureMetricsReferencePages({ section }: { section: ReportSectionContent }) {
  const start = section.blocks.findIndex((block) => block.id === "feature-satisfaction-heading");
  const end = section.blocks.findIndex((block) => block.id === "feature-analysis-heading");
  if (start < 0) return null;
  const blocks = section.blocks.slice(start, end >= 0 ? end : undefined);
  const satisfaction = blocks.filter((block) => ["feature-satisfaction", "feature-rank-table"].includes(block.id));
  const importance = blocks.filter((block) => ["feature-q12", "feature-rank-composition", "feature-importance-table"].includes(block.id));
  const quadrant = blocks.filter((block) => ["feature-importance-satisfaction-quadrant", "feature-priority-reference"].includes(block.id));
  return <>
    <A4Page className="rivalabs-reference-page p-[15mm]" id="preview-feature-metrics-satisfaction"><RivalabsBlockList blocks={satisfaction} /></A4Page>
    <A4Page className="rivalabs-reference-page p-[15mm]" id="preview-feature-metrics-importance"><RivalabsBlockList blocks={importance} /></A4Page>
    <A4Page className="rivalabs-reference-page p-[15mm]" id="preview-feature-metrics-quadrant"><RivalabsBlockList blocks={quadrant} /></A4Page>
  </>;
}

/** Ⅴ장의 가치별 긍정·부정 표를 A4 단위로 나누어, 뒤쪽 문항이 잘려 사라지지 않게 한다. */
export function RivalabsFourValuesReferencePages({ section }: { section: ReportSectionContent }) {
  const starts = section.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => /^four-values-qualitative-q\d+$/.test(block.id));
  if (!starts.length) return <RivalabsSectionReferencePage section={section} />;
  const analysisStart = section.blocks.findIndex((block) => block.id === "values-analysis-heading");
  const intro = section.blocks.slice(0, starts[0].index);
  const groups = starts.map(({ index }, groupIndex) => section.blocks.slice(index, starts[groupIndex + 1]?.index ?? analysisStart));
  const analysis = analysisStart >= 0 ? section.blocks.slice(analysisStart) : [];
  return <>
    {groups.map((group, index) => <A4Page key={group[0]?.id ?? index} className="rivalabs-reference-page p-[15mm]" id={index === 0 ? "preview-section-V" : `preview-section-V-${index + 1}`}>
      {index === 0 ? <><div className="rivalabs-chapter-heading"><div className="rivalabs-chapter-number">Ⅴ</div><h2>{section.title}</h2></div><div className="rivalabs-section-content"><RivalabsBlockList blocks={intro} /><RivalabsBlockList blocks={group} /></div></> : <RivalabsBlockList blocks={group} />}
    </A4Page>)}
    {analysis.length > 0 ? <A4Page className="rivalabs-reference-page p-[15mm]" id="preview-section-V-analysis"><RivalabsBlockList blocks={analysis} /></A4Page> : null}
  </>;
}

export function RivalabsSectionReferencePage({ section }: { section: ReportSectionContent }) {
  return <A4Page className="rivalabs-reference-page p-[15mm]" id={`preview-section-${section.numeral}`}>
    <div className="rivalabs-chapter-heading"><div className="rivalabs-chapter-number">{section.numeral}</div><h2>{section.title}</h2></div>
    <div className="rivalabs-section-content">{section.blocks.map((block) => <RivalabsGenericBlock key={block.id} block={block} />)}</div>
  </A4Page>;
}
