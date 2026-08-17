import type { ReactNode } from "react";
import type { FeatureStat } from "@/lib/quant/compute";
import type { ReportWorkspaceSeed } from "@/lib/report/workspace";
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";
import { findHtml, keywordCandidates } from "./model";

export function A4Page({ children, className = "", id }: { children: ReactNode; className?: string; id?: string }) {
  return <article id={id} data-hwpx-print-page className={`hwpx-sheet ${className}`}>{children}</article>;
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
  const keywords = keywordCandidates(detailHtml);
  const tableEnd = scoreboxHtml.indexOf("</table>");
  const distributionHtml = tableEnd >= 0
    ? scoreboxHtml.slice(tableEnd + "</table>".length)
    : scoreboxHtml;
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
                <div className="rivalabs-keyword-slot" data-hwpx-edit-key={`${editPrefix}:keywords`} contentEditable suppressContentEditableWarning>
                  {keywords.length > 0 ? keywords.map((keyword, index) => (
                    <span key={keyword} className={`keyword-${index % 4}`}>{keyword}</span>
                  )) : <span className="text-sm text-slate-400">정성 분석 결과에서 키워드를 불러옵니다.</span>}
                </div>
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
  const featureSummary = findHtml(workspace, "conclusion-feature-summary-table");
  const featureBullets = findHtml(workspace, "conclusion-feature-summary-bullets");
  const evidence = findHtml(workspace, "conclusion-evidence-table");
  const strategy = findHtml(workspace, "conclusion-strategy-table");
  const customer = findHtml(workspace, "conclusion-feature-customer-table");
  const points = workspace.quantStats.relativeImportance.map((importance) => ({
    ...importance,
    satisfaction: workspace.quantStats.featureSatisfaction.find((feature) => feature.name === importance.name)?.mean ?? 0,
  }));

  return <>
    <A4Page className="rivalabs-reference-page p-[15mm]" id="preview-conclusion">
      <div className="rivalabs-chapter-heading"><div className="rivalabs-chapter-number">Ⅸ</div><h2>종합 결과 및 제언</h2></div>
      <div className="mt-9 border-t-[4px] border-[#48c2e0]">
        <div className="rivalabs-section-heading"><span>1</span><strong>사용성테스트 결과 요약</strong></div>
        <div className="rivalabs-conclusion-table mt-5">
          <div className="rivalabs-conclusion-label">항목</div><div className="rivalabs-conclusion-head">주요 의견</div>
          <div className="rivalabs-conclusion-label">기능별 고객<br />경험 평가</div>
          <div className="rivalabs-conclusion-body">
            <p className="mb-3 font-bold">기능별 상대 중요도-만족도 그래프</p>
            <div className="rivalabs-quadrant" aria-label="기능별 상대 중요도와 만족도">
              <span className="quad-y">상대 만족도</span><span className="quad-x">상대 중요도</span>
              {points.map((point, index) => <i key={point.name} style={{ left: `${Math.max(8, Math.min(92, ((point.score + 5) / 10) * 100))}%`, bottom: `${Math.max(8, Math.min(92, point.satisfaction * 10))}%` }} title={`${point.name}: 중요도 ${point.score.toFixed(2)}, 만족도 ${point.satisfaction.toFixed(2)}`}>{index + 1}</i>)}
            </div>
            <div className="mt-4 report-rich-static" dangerouslySetInnerHTML={{ __html: featureSummary }} />
            <div className="report-rich-static" dangerouslySetInnerHTML={{ __html: featureBullets }} />
          </div>
          <div className="rivalabs-conclusion-label">기타 분석 결과</div>
          <div className="rivalabs-conclusion-body report-rich-static" dangerouslySetInnerHTML={{ __html: evidence }} />
        </div>
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
  if (block.kind === "table") return <div className="rivalabs-data-table" data-hwpx-edit-key={`block:${block.id}`}><p>{block.title}</p><table><thead><tr>{block.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={`${block.id}-${index}`}>{row.map((cell, cellIndex) => <td key={cellIndex} contentEditable={typeof cell === "number"} suppressContentEditableWarning>{String(cell)}</td>)}</tr>)}</tbody></table></div>;
  if (block.kind === "chart") return <div className="rivalabs-data-chart"><p>{block.title}</p><div className="rivalabs-bars">{block.items.map((item) => <div key={item.id}><i style={{ height: `${Math.max(4, ((item.value - block.axisMin) / Math.max(block.axisMax - block.axisMin, 1)) * 100)}%`, background: block.color }} /><span>{item.label}</span><b>{item.value.toFixed(2)}{block.unit}</b></div>)}</div></div>;
  if (block.kind === "nps") return <div className="rivalabs-nps"><p>{block.title}</p><strong>NPS {block.npsScore}</strong><span>추천 {block.promoterPct}% · 중립 {block.passivePct}% · 비추천 {block.detractorPct}%</span></div>;
  if (block.kind === "polarity") return <div className="rivalabs-polarity"><p>{block.title}</p><div><i style={{ width: `${block.positive}%`, background: block.positiveColor ?? "#b9c8ed" }} /><i style={{ width: `${block.negative}%`, background: block.negativeColor ?? "#fde4d0" }} /><i style={{ width: `${block.neutral}%`, background: block.neutralColor ?? "#e8e8e8" }} /></div><small>{block.positiveLabel ?? "긍정"} {block.positive}% · {block.negativeLabel ?? "부정"} {block.negative}% · {block.neutralLabel ?? "중립"} {block.neutral}%</small></div>;
  if (block.kind === "quadrant") return <div className="rivalabs-data-chart"><p>{block.title}</p><div className="rivalabs-quadrant">{block.items.map((item, index) => <i key={item.id} style={{ left: `${Math.max(8, Math.min(92, ((item.importance - block.xMin) / Math.max(block.xMax - block.xMin, 1)) * 100))}%`, bottom: `${Math.max(8, Math.min(92, ((item.satisfaction - block.yMin) / Math.max(block.yMax - block.yMin, 1)) * 100))}%` }} title={item.name}>{index + 1}</i>)}</div></div>;
  if (block.kind === "rank-composition") return <div className="rivalabs-data-table"><p>{block.title}</p><table><thead><tr><th>순위</th>{block.candidates.map((candidate) => <th key={candidate.name}>{candidate.name}</th>)}</tr></thead><tbody>{block.rows.map((row) => <tr key={row.rank}><td>{row.rank}위</td>{block.candidates.map((candidate) => <td key={candidate.name}>{row.segments.find((segment) => segment.name === candidate.name)?.percentage ?? 0}%</td>)}</tr>)}</tbody></table></div>;
  if (block.kind === "stacked-bar") return <div className="rivalabs-data-table"><p>{block.title}</p><table><thead><tr><th>구분</th>{block.categories.map((category) => <th key={category.name}>{category.name}</th>)}</tr></thead><tbody>{block.rows.map((row) => <tr key={row.label}><td>{row.label}</td>{block.categories.map((category) => <td key={category.name}>{row.segments.find((segment) => segment.name === category.name)?.value ?? 0}{block.unit}</td>)}</tr>)}</tbody></table></div>;
  if (block.kind === "grouped-bar") return <div className="rivalabs-data-table"><p>{block.title}</p><table><thead><tr><th>항목</th>{block.series.map((series) => <th key={series.name}>{series.name}</th>)}</tr></thead><tbody>{block.categories.map((category) => <tr key={category.label}><td>{category.label}</td>{block.series.map((series) => <td key={series.name}>{category.values.find((value) => value.series === series.name)?.value ?? 0}{block.unit}</td>)}</tr>)}</tbody></table></div>;
  if (block.kind === "radar") return <div className="rivalabs-data-table"><p>{block.title}</p><table><thead><tr><th>항목</th>{block.series.map((series) => <th key={series.name}>{series.name}</th>)}</tr></thead><tbody>{block.indicators.map((indicator, index) => <tr key={indicator}><td>{indicator}</td>{block.series.map((series) => <td key={series.name}>{series.values[index] ?? 0}</td>)}</tr>)}</tbody></table></div>;
  return <div className="rivalabs-data-chart"><p>{block.title}</p><div className="rivalabs-priority-grid"><b>개선 필요성 높음</b><b>중요 개선</b><b>긴급 개선</b><b>개선 필요성 보통</b><b>개선 권장</b><b>개선 필요성 낮음</b></div></div>;
}

export function RivalabsSectionReferencePage({ section }: { section: ReportSectionContent }) {
  return <A4Page className="rivalabs-reference-page p-[15mm]" id={`preview-section-${section.numeral}`}>
    <div className="rivalabs-chapter-heading"><div className="rivalabs-chapter-number">{section.numeral}</div><h2>{section.title}</h2></div>
    <div className="rivalabs-section-content">{section.blocks.map((block) => <RivalabsGenericBlock key={block.id} block={block} />)}</div>
  </A4Page>;
}
