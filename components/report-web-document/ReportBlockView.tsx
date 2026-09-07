"use client";

import { useEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { RichReportEditor } from "@/components/RichReportEditor";
import { EditableBarChart } from "@/components/report/EditableBarChart";
import { EditableRankCompositionChart } from "@/components/report/EditableRankCompositionChart";
import { EditableJourneyLineChart, EditableWaterfallChart } from "@/components/report/EditableJourneyCharts";
import { EditableStackedBarChart } from "@/components/report/EditableStackedBarChart";
import { EditableGroupedBarChart } from "@/components/report/EditableGroupedBarChart";
import { EditableRadarChart } from "@/components/report/EditableRadarChart";
import { EditableNpsChart } from "@/components/report/EditableNpsChart";
import { EditableQuadrantChart } from "@/components/report/EditableQuadrantChart";
import { PriorityReferenceDiagram } from "@/components/report/PriorityReferenceDiagram";
import { EditablePolarityChart } from "@/components/report/EditablePolarityChart";
import { EditableTable } from "@/components/report/EditableTable";
import { ReportImageUploadSlots } from "@/components/report/ReportImageUploadSlots";
import { cleanQuoteEndingReviewMarkup, markQuoteEndingReviews } from "@/components/report-web-document/quoteEndingMarkup";
import { downloadSvgAsPng } from "@/lib/report/exportImage";
import { reportQuoteReviewToken } from "@/lib/report/quoteEnding";
import { scaleNoteFromQuestion, type ReportBlock } from "@/lib/report/sections";
import { DATA_TABLE, REPORT_TEXT, SUBSECTION_BANNER, tablePalette } from "@/lib/report/sectionStyle";

/** 표 셀 테두리는 문서 전체가 같은 토큰을 쓴다(sectionStyle.ts) — 색 리터럴을 다시 쓰지 말 것. */
function rowGroupCell(background?: string) {
  return { border: `${DATA_TABLE.borderWidth}pt solid ${tablePalette(0).border}`, backgroundColor: background };
}

/**
 * 개요/설문 항목처럼 병합 셀이 있는 표는 데이터 배열로 단순화하면 원본의 행·열 병합과
 * 테두리가 사라진다. 따라서 HTML 표 구조는 그대로 두고, 사용자가 원하는 셀의 텍스트만
 * 직접 편집하게 한다. 변경값은 blur 시점에 한 번만 저장하므로 타이핑마다 문서 전체가
 * 재렌더링되어 커서가 튀는 문제도 피한다.
 */
function EditableRichStaticBlock({
  block,
  onChange,
  sourceFileUrl,
  compact,
  showEmbeddedChartControls = true,
}: {
  block: Extract<ReportBlock, { kind: "rich-static" }>;
  onChange: (next: ReportBlock) => void;
  sourceFileUrl?: string | null;
  /** 표 셀 안(row-group)처럼 이미 테두리로 둘러싸인 자리에서는 안내문과 바깥 여백을 뺀다 —
   * 행마다 안내문이 반복되면 표가 끊겨 보인다(2026-08-18). */
  compact?: boolean;
  showEmbeddedChartControls?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [summaryStatus, setSummaryStatus] = useState<"idle" | "loading" | "error">("idle");
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.contains(document.activeElement)) return;
    editor.innerHTML = block.html;
    markQuoteEndingReviews(editor, reportQuoteReviewToken);
  }, [block.html]);

  function save() {
    const clone = editorRef.current?.cloneNode(true) as HTMLElement | undefined;
    if (clone) cleanQuoteEndingReviewMarkup(clone);
    const html = clone?.innerHTML;
    if (html && html !== block.html) onChange({ ...block, html });
  }

  function setSummaryButtonLabel(label: string) {
    const button = editorRef.current?.querySelector<HTMLButtonElement>("[data-ai-summary]");
    if (button) button.textContent = label;
  }

  async function generateSummary() {
    if (!sourceFileUrl || !block.summaryQuestionKey || summaryStatus === "loading") return;
    setSummaryStatus("loading");
    setSummaryError(null);
    setSummaryButtonLabel("AI 요약 생성 중…");
    try {
      const response = await fetch("/api/report-summaries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: sourceFileUrl, questionKey: block.summaryQuestionKey }),
      });
      const result = await response.json() as { ok: boolean; html?: string; error?: string; summaryKind?: "polarity" | "value" };
      if (!response.ok || !result.ok || !result.html) throw new Error(result.error || "AI 요약 생성에 실패했습니다.");

      let nextHtml = result.html;
      // Ⅲ장 표의 오른쪽 응답 요약만 바꾸고 도넛·퍼센트 표는 그대로 둔다.
      if (result.summaryKind === "polarity") {
        const documentHtml = new DOMParser().parseFromString(block.html, "text/html");
        const nextSummary = new DOMParser().parseFromString(result.html, "text/html").body.firstElementChild;
        const currentSummary = Array.from(documentHtml.body.querySelectorAll<HTMLElement>("[data-summary-key]")).find(
          (node) => node.dataset.summaryKey === block.summaryQuestionKey,
        );
        if (!nextSummary || !currentSummary) throw new Error("현재 응답 요약 박스를 찾지 못했습니다.");
        currentSummary.replaceWith(nextSummary);
        nextHtml = documentHtml.body.innerHTML;
      }
      onChange({ ...block, html: nextHtml });
      setSummaryButtonLabel("AI 요약 다시 생성");
      setSummaryStatus("idle");
    } catch (error) {
      setSummaryStatus("error");
      setSummaryError(error instanceof Error ? error.message : "AI 요약 생성에 실패했습니다.");
      setSummaryButtonLabel("AI 요약 생성");
    }
  }

  function onEditorClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-ai-summary]")) {
      event.preventDefault();
      event.stopPropagation();
      void generateSummary();
    }
  }

  // contentEditable 내부의 버튼을 누르면 기본 동작상 편집 영역이 먼저 blur될 수 있다.
  // 이때 직전 HTML이 저장되며 비동기 결과가 덮일 여지가 있으므로, 버튼을 누르는 동안에는
  // 선택/포커스를 유지한다. click은 그대로 발생해 generateSummary만 실행된다.
  function onEditorMouseDown(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-ai-summary]")) event.preventDefault();

    // 개요의 "입력 필요"는 실제 보고서 내용이 아닌 안내문이다. 사용자가 해당 셀/문장을
    // 누르는 즉시 비워, 일반 입력 필드의 placeholder처럼 바로 작성할 수 있게 한다.
    const placeholder = target.closest<HTMLElement>("[data-empty-placeholder='true']");
    if (placeholder && placeholder.textContent?.trim() === placeholder.dataset.placeholder) {
      placeholder.textContent = "";
      placeholder.removeAttribute("data-empty-placeholder");
      placeholder.removeAttribute("data-placeholder");
      placeholder.style.removeProperty("color");
    }
  }

  async function downloadEmbeddedChart(index: number) {
    const svg = editorRef.current?.querySelectorAll<SVGSVGElement>("svg")[index];
    if (!svg) return;
    await downloadSvgAsPng(svg, `${block.id}-그래프-${index + 1}.png`);
  }

  function handleChartDownload(event: MouseEvent<HTMLButtonElement>) {
    const index = Number(event.currentTarget.dataset.chartIndex);
    if (Number.isInteger(index) && index >= 0) void downloadEmbeddedChart(index);
  }

  const hasEmbeddedCharts = /<svg[\s>]/i.test(block.html);
  const chartLabel = (index: number) => {
    if (block.id.includes("scorebox")) return "만족도 분포도";
    if (block.id.includes("emotionbox")) return "주관식 응답 감정 분석 도넛";
    return `차트 ${index + 1}`;
  };

  return (
    <div className={compact ? "" : "mb-5 mt-3"}>
      {/* 이 블록은 표뿐 아니라 도넛차트+표 조합(Ⅲ/Ⅴ장 감정 분석)에도 쓰이므로 "표의 셀"이라는
         문구는 안 맞았다 — 일반화된 문구로 바꾸고, 바로 위 블록(제목 등)과 붙어 보이지 않게
         위쪽 여백을 줬다(2026-07-28 실측: 안내문이 위 헤딩에 달라붙어 보인다는 지적). */}
      {!compact && <p data-copy-ignore className="mb-2 text-xs text-[#70675e]">클릭하면 바로 내용을 수정할 수 있습니다.</p>}
      {showEmbeddedChartControls && <div data-copy-ignore className="mb-2 flex flex-wrap items-center gap-2">
        {hasEmbeddedCharts && Array.from({ length: (block.html.match(/<svg[\s>]/gi) ?? []).length }).map((_, index) => (
          <button key={index} type="button" data-chart-index={index} onClick={handleChartDownload} className="rounded border border-[#315c9c] px-2.5 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">
            {chartLabel(index)} PNG 다운로드
          </button>
        ))}
      </div>}
      {summaryError && <p data-copy-ignore className="mb-2 text-xs text-[#a64d32]">{summaryError}</p>}
      <div
        ref={editorRef}
        className="report-rich-static rounded outline-none focus-within:ring-2 focus-within:ring-[#4fc8e8] focus-within:ring-offset-2"
        contentEditable
        suppressContentEditableWarning
        onClick={onEditorClick}
        onMouseDown={onEditorMouseDown}
        onBlur={save}
      />
    </div>
  );
}

function previewStorageKey(sourceFileUrl: string | null | undefined, blockId: string) {
  return `viewer:image:${sourceFileUrl ?? "demo"}:${blockId}`;
}

/** /viewer에서도 HWPX 미리보기와 같은 문항별 정량 프레임을 사용한다.
 * 저장된 scorebox HTML에서 실제 히스토그램 SVG만 재사용해 제목이 중복되지 않는다. */
function FeatureScoreboxPreview({ block, sourceFileUrl }: { block: Extract<ReportBlock, { kind: "rich-static" }>; sourceFileUrl?: string | null }) {
  const mean = block.html.match(/만족도 점수 평균\s*:\s*([^<]+)/i)?.[1]?.trim() ?? "-";
  const sd = block.html.match(/표준편차\s*:\s*([^<]+)/i)?.[1]?.trim() ?? "-";
  const histogram = block.html.match(/<svg[\s\S]*?<\/svg>/i)?.[0] ?? "";
  return <section className="rivalabs-feature-frame viewer-feature-frame">
    <div className="rivalabs-score-strip">
      <strong>만족도 점수 평균 : {mean}</strong>
      <span><strong>표준편차 : {sd}</strong><small>*평균에서의 흩어진 정도</small></span>
    </div>
    <div className="rivalabs-two-column mt-4">
      <div className="rivalabs-cell">
        <p className="rivalabs-cell-title">만족도 분포도</p>
        <div className="rivalabs-chart-slot report-rich-static" dangerouslySetInnerHTML={{ __html: histogram }} />
      </div>
      <div className="rivalabs-cell">
        <p className="rivalabs-cell-title">주요 키워드 도출</p>
        <ReportImageUploadSlots storageKey={previewStorageKey(sourceFileUrl, block.id)} emptyLabel="워드클라우드 이미지 첨부" maxImages={1} variant="wordcloud" />
      </div>
    </div>
  </section>;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textFromHtml(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").trim();
}

function overviewValue(html: string, label: string) {
  const labelPattern = escapeRegExp(label);
  const match = html.match(new RegExp(`<td[^>]*>\\s*${labelPattern}\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, "i"));
  return textFromHtml(match?.[1] ?? "");
}

function patchOverviewValue(html: string, label: string, next: string) {
  const labelPattern = escapeRegExp(label);
  const escaped = next.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return html.replace(new RegExp(`(<td[^>]*>\\s*${labelPattern}\\s*<\\/td>\\s*<td[^>]*>)[\\s\\S]*?(<\\/td>)`, "i"), `$1${escaped}$2`);
}

/** 기존 workspace HTML은 그대로 저장하고, 웹 화면에서만 주요 기능 셀을 이미지+설명 구조로 보강한다. */
function ViewerOverviewService({ block, sourceFileUrl, onChange }: { block: Extract<ReportBlock, { kind: "rich-static" }>; sourceFileUrl?: string | null; onChange: (next: ReportBlock) => void }) {
  const fields = {
    serviceName: overviewValue(block.html, "서비스 명"),
    summary: overviewValue(block.html, "서비스 요약"),
    businessArea: overviewValue(block.html, "사업 영역"),
    industry: overviewValue(block.html, "산업 분야"),
    environment: overviewValue(block.html, "운영 환경"),
    stage: overviewValue(block.html, "사업화 단계"),
    mainFeatures: overviewValue(block.html, "주요 기능"),
  };
  const save = (label: string, value: string) => onChange({ ...block, html: patchOverviewValue(block.html, label, value) });
  const palette = tablePalette(0);
  const cellBorder = `${DATA_TABLE.borderWidth}pt solid ${palette.border}`;
  const labelStyle = { border: cellBorder, background: palette.header, textAlign: "center" as const, fontWeight: 700, padding: "8px 6px", verticalAlign: "middle" as const };
  const valueStyle = { border: cellBorder, padding: "8px 10px", verticalAlign: "middle" as const };
  const editable = (label: string, value: string, className = "") => <div contentEditable suppressContentEditableWarning className={`viewer-overview-edit ${className}`} onBlur={(event) => save(label, event.currentTarget.textContent?.trim() ?? "")}>{value || "입력 필요"}</div>;

  return <table className="viewer-overview-table" style={{ width: "100%", marginBottom: 18, borderCollapse: "collapse", tableLayout: "fixed", color: "#111827", fontSize: `${DATA_TABLE.fontSize}pt` }}>
    <tbody>
      <tr><th colSpan={4} style={{ ...labelStyle, background: palette.title, color: "#111827" }}>제품 및 서비스 개요</th></tr>
      <tr><th style={labelStyle}>서비스 명</th><td colSpan={3} style={valueStyle}>{editable("서비스 명", fields.serviceName)}</td></tr>
      <tr><th style={labelStyle}>서비스 요약</th><td colSpan={3} style={valueStyle}>{editable("서비스 요약", fields.summary, "is-left")}</td></tr>
      <tr><th style={labelStyle}>사업 영역</th><td style={valueStyle}>{editable("사업 영역", fields.businessArea)}</td><th style={labelStyle}>산업 분야</th><td style={valueStyle}>{editable("산업 분야", fields.industry)}</td></tr>
      <tr><th style={labelStyle}>운영 환경</th><td style={valueStyle}>{editable("운영 환경", fields.environment)}</td><th style={labelStyle}>사업화 단계</th><td style={valueStyle}>{editable("사업화 단계", fields.stage)}</td></tr>
      <tr><th style={{ ...labelStyle, width: 110 }}>주요 기능</th><td colSpan={3} className="viewer-overview-main-feature" style={{ ...valueStyle, padding: 0, verticalAlign: "top" }}>
        <ReportImageUploadSlots storageKey={previewStorageKey(sourceFileUrl, block.id)} emptyLabel="제품·서비스 이미지 첨부" />
        {editable("주요 기능", fields.mainFeatures, "viewer-overview-feature-text is-left")}
      </td></tr>
    </tbody>
  </table>;
}

/**
 * 본문 어딘가의 contentEditable에 굵게/기울임/밑줄/제언 화살표를 적용한다. 패널 버튼은
 * `onMouseDown`에서 `preventDefault()`로 버튼 자신이 포커스를 가져가는 걸 막는다 — 그래야
 * 지금 커서가 있던 편집 영역의 선택(Selection)이 그대로 유지된 상태로 `execCommand`가 그
 * 선택에 곧바로 적용된다(포커스가 실제로 안 옮겨가므로 별도 Range 저장·복원이 필요 없다).
 * `execCommand`는 대상 contentEditable에 네이티브 "input" 이벤트를 발생시키므로, 그 블록의
 * RichReportEditor가 이미 붙여둔 onInput(emitChange)이 그대로 반응해 상태에 반영된다.
 */
export function applyTextFormat(command: "bold" | "italic" | "underline") {
  document.execCommand(command);
}

export function insertArrowLine() {
  const active = document.activeElement as HTMLElement | null;
  if (!active || active.getAttribute("contenteditable") !== "true") return;
  const line = document.createElement("p");
  line.setAttribute("data-report-kind", "arrow");
  line.innerHTML = "<strong><em>→ 개선 필요 사항을 입력하세요.</em></strong>";
  active.appendChild(line);
  const range = document.createRange();
  range.selectNodeContents(line);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  active.dispatchEvent(new InputEvent("input", { bubbles: true }));
}

export function FormatButton({ label, title, onApply, className }: { label: ReactNode; title: string; onApply: () => void; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onApply}
      // 글자 라벨("굵게")이 아니라 아이콘을 넣는다(2026-09-02 담당자 요청 — 첨부한 편집기 아이콘
      // 형태). 뜻은 title/aria-label로 남긴다.
      className={`flex size-9 items-center justify-center rounded-md text-[#3f4c5f] hover:bg-white ${className ?? ""}`}
    >
      {label}
    </button>
  );
}

/** 편집 아이콘 — 첨부된 참고 이미지와 같은 얇은 선/글자 형태. */
export function UndoIcon({ flip }: { flip?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={flip ? { transform: "scaleX(-1)" } : undefined}>
      <path d="M9.5 14.5 5 10l4.5-4.5" />
      <path d="M5 10h8.5a5.5 5.5 0 0 1 0 11H10" />
    </svg>
  );
}

/** 사이드바 여닫기 — 첨부 이미지와 같은 "칸이 나뉜 패널" 아이콘. `side`로 어느 쪽 칸인지 표시한다.
 * 세 패널(목차·분석 근거·보고서 작업)의 접기 버튼이 전부 이 아이콘을 쓴다 — ×로 두면 무엇이
 * 닫히는지, 어디서 다시 여는지 알 수 없다(2026-09-02 담당자 지적). */
export function SidebarIcon({ side = "left" }: { side?: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinejoin="round">
      <rect x="3.2" y="4.2" width="17.6" height="15.6" rx="3" />
      <path d={side === "left" ? "M10 4.2v15.6" : "M14 4.2v15.6"} />
    </svg>
  );
}

export function FormatGlyph({ variant }: { variant: "bold" | "italic" | "underline" }) {
  const style = variant === "bold" ? "font-bold" : variant === "italic" ? "italic font-serif" : "";
  return (
    <span className="relative inline-flex flex-col items-center leading-none">
      <span className={`text-[17px] ${style}`}>A</span>
      {variant === "underline" && <span className="mt-[2px] h-[1.5px] w-[15px] rounded bg-current" />}
    </span>
  );
}

// 마법사 정량 리뷰 화면(components/wizard/QuantReviewStep.tsx)이 같은 블록→컴포넌트 매핑을
// 재사용하기 위해 export한다 — 두 곳에서 이 switch가 따로 자라면 어긋나기 쉽다.
export function BlockView({
  block,
  onChange,
  sourceFileUrl,
  onQuoteSource,
  selectedBlockId,
  onSelectBlock,
  compact,
}: {
  block: ReportBlock;
  onChange: (next: ReportBlock) => void;
  sourceFileUrl?: string | null;
  onQuoteSource?: (questionKey: string, quotes: string[], groupLabel: string) => void;
  /** 표 셀 안에 중첩된 블록이면 안내문·바깥 여백을 줄인다. */
  compact?: boolean;
  /** row-group 자식처럼 최상위 블록 목록 바깥에 중첩된 블록도 개별 선택(사이드 속성 패널)이
   * 되게 하려고 선택 상태를 아래로 흘려보낸다 — 없으면(최상위 호출) 중첩 자식이 없는
   * 블록이므로 그냥 무시된다. */
  selectedBlockId?: string;
  onSelectBlock?: (id: string) => void;
}) {
  if (block.kind === "heading") {
    const saveHeading = (event: FocusEvent<HTMLElement>) => {
      const text = event.currentTarget.textContent?.trim() ?? "";
      // 척도 주석은 문항 원문에서 도출한 값이라, 문항을 고치면 같이 다시 뽑아야 한다.
      if (text && text !== block.text) onChange({ ...block, text, note: scaleNoteFromQuestion(text) ?? undefined });
    };
    // id: 목차의 소제목 클릭 → 여기로 직접 스크롤(TableOfContents 참고). scroll-mt-24는
    // studio 헤더(sticky)에 상단이 가려지지 않게 하는 여백이다.
    if (block.variant === "numbered") {
      return (
        <div id={block.id} className="grid scroll-mt-24 text-[#111827]" style={{ gridTemplateColumns: `${SUBSECTION_BANNER.numberWidth}pt minmax(0,1fr)`, minHeight: `${SUBSECTION_BANNER.height}pt`, marginTop: `${SUBSECTION_BANNER.marginTop}pt`, marginBottom: `${SUBSECTION_BANNER.marginBottom}pt`, border: `${SUBSECTION_BANNER.borderWidth}pt solid ${SUBSECTION_BANNER.borderColor}` }}>
          <div contentEditable suppressContentEditableWarning onBlur={(event) => {
            const number = event.currentTarget.textContent?.trim() ?? "";
            if (number !== (block.number ?? "")) onChange({ ...block, number });
          }} className="flex items-center justify-center font-medium outline-none focus:bg-[#d4e3fb]" style={{ minHeight: `${SUBSECTION_BANNER.height - SUBSECTION_BANNER.borderWidth * 2}pt`, borderRight: `${SUBSECTION_BANNER.borderWidth}pt solid ${SUBSECTION_BANNER.borderColor}`, backgroundColor: SUBSECTION_BANNER.numberBackground, fontSize: `${SUBSECTION_BANNER.fontSize}pt` }}>{block.number}</div>
          <h2 contentEditable suppressContentEditableWarning onBlur={saveHeading} className="flex items-center px-3 font-semibold tracking-[-0.035em] outline-none focus:bg-[#f8fbff]" style={{ minHeight: `${SUBSECTION_BANNER.height - SUBSECTION_BANNER.borderWidth * 2}pt`, fontSize: `${SUBSECTION_BANNER.fontSize}pt` }}>{block.text}</h2>
        </div>
      );
    }
    if (block.variant === "question") {
      return (
        // 원본 37쪽: 문항 → (오른쪽 정렬) 척도 주석 → 시안 밑줄 순서. 밑줄 두께·색은 실측 토큰.
        <div id={block.id} className="mb-5 mt-7 scroll-mt-24 pb-2.5" style={{ borderBottom: `${REPORT_TEXT.questionUnderlineWidth}pt solid ${REPORT_TEXT.questionUnderlineColor}` }}>
          <h3 className="text-[18px] font-medium leading-[1.5] tracking-[-0.035em] text-[#111827]">
            {block.number ? `${block.number}. ` : ""}
            <span contentEditable suppressContentEditableWarning onBlur={saveHeading} className="outline-none focus:bg-[#f8fbff]">{block.text}</span>
          </h3>
          {block.note && <p className="mt-1 text-right text-[#111827]" style={{ fontSize: `${REPORT_TEXT.noteFontSize}pt` }}>{block.note}</p>}
        </div>
      );
    }
    return <h3 id={block.id} contentEditable suppressContentEditableWarning onBlur={saveHeading} className="mb-3 mt-6 scroll-mt-24 text-[21px] font-semibold tracking-[-0.035em] text-[#111827] outline-none focus:bg-[#f8fbff]">{block.text}</h3>;
  }
  // row-group도 원본 표 서식 토큰을 쓴다 — 예전엔 회색 테두리(#d4d4d8)라 다른 표와 어긋났다.
  // row-group: 원본 "항목 | 주요 의견" 표 전체를 진짜 <table>로 그린다. 오른쪽 칸에 인터랙티브
  // 차트가 들어가는 행이 있어 정적 HTML 표로는 못 만들지만, <td> 안에 React 자식 블록을 그리면
  // 테두리는 표 하나로 이어진다(sections.ts의 ReportRowGroupBlock 주석 참고).
  if (block.kind === "row-group") {
    const updateChild = (rowId: string, next: ReportBlock) =>
      onChange({
        ...block,
        rows: block.rows.map((row) => (row.id !== rowId ? row : { ...row, blocks: row.blocks.map((b) => (b.id === next.id ? next : b)) })),
      });
    return (
      <table className="mb-3 w-full table-fixed border-collapse text-[#111827]">
        {block.headers && (
          <thead>
            <tr>
              {block.headers.map((header, index) => (
                <th key={header} style={rowGroupCell(tablePalette(0).title)} className={`p-2 text-center font-bold ${index === 0 ? "w-[18%]" : ""}`}>{header}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.id}>
              <td style={rowGroupCell(tablePalette(0).header)} className="w-[18%] p-2 text-center align-middle font-bold">{row.label}</td>
              <td style={rowGroupCell()} className="p-3 align-top">
                <div className="space-y-3">
                  {row.blocks.map((child) => (
                    <div
                      key={child.id}
                      role="button"
                      tabIndex={0}
                      // stopPropagation: 최상위 목록에서 이 표 전체에도 선택 핸들러가 걸려있어서
                      // (ReportWebDocument.tsx), 막지 않으면 자식을 눌러도 표 전체가 선택돼
                      // 사이드 패널에서 사분면 차트 등 자식 고유 편집 항목을 못 연다.
                      onClick={(event) => { event.stopPropagation(); onSelectBlock?.(child.id); }}
                      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.stopPropagation(); onSelectBlock?.(child.id); } }}
                      className={`rounded transition-shadow ${selectedBlockId === child.id ? "ring-2 ring-[#4fc8e8] ring-offset-2" : "hover:ring-1 hover:ring-[#c9d8ef]"}`}
                    >
                      <BlockView
                        block={child}
                        sourceFileUrl={sourceFileUrl}
                        onQuoteSource={onQuoteSource}
                        onChange={(next) => updateChild(row.id, next)}
                        selectedBlockId={selectedBlockId}
                        onSelectBlock={onSelectBlock}
                        compact
                      />
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (block.kind === "chart") return <EditableBarChart block={block} />;
  if (block.kind === "journey-line") return <EditableJourneyLineChart block={block} />;
  if (block.kind === "waterfall") return <EditableWaterfallChart block={block} />;
  if (block.kind === "rank-composition") return <EditableRankCompositionChart block={block} />;
  if (block.kind === "stacked-bar") return <EditableStackedBarChart block={block} />;
  if (block.kind === "grouped-bar") return <EditableGroupedBarChart block={block} />;
  if (block.kind === "radar") return <EditableRadarChart block={block} />;
  if (block.kind === "nps") return <EditableNpsChart block={block} />;
  if (block.kind === "quadrant") return <EditableQuadrantChart block={block} onChange={onChange} />;
  if (block.kind === "priority-reference") return <PriorityReferenceDiagram block={block} />;
  if (block.kind === "polarity") return <EditablePolarityChart block={block} />;
  if (block.kind === "table") return <EditableTable block={block} onChange={onChange} />;
  // rich-static: PDF의 OverviewTable/SurveyQuestionTable처럼 병합 셀·테두리·색상이 있는
  // 읽기 전용 표. RichReportEditor는 table/border/width 스타일을 전부 제거하므로 편집기를
  // 거치지 않고 그대로 렌더링한다(2026-07-26).
  if (block.kind === "rich-static") {
    if (/^feature-qualitative-q\d+-scorebox$/.test(block.id)) {
      return <FeatureScoreboxPreview block={block} sourceFileUrl={sourceFileUrl} />;
    }
    if (/^feature-qualitative-q\d+-emotionbox$/.test(block.id)) {
      return <div className="rivalabs-emotion-frame viewer-emotion-frame"><EditableRichStaticBlock block={block} onChange={onChange} sourceFileUrl={sourceFileUrl} compact showEmbeddedChartControls={false} /></div>;
    }
    if (block.id === "overview-service") {
      return <ViewerOverviewService block={block} sourceFileUrl={sourceFileUrl} onChange={onChange} />;
    }
    return <EditableRichStaticBlock block={block} onChange={onChange} sourceFileUrl={sourceFileUrl} compact={compact} />;
  }
  // text 블록: 정성 분석 대기 중이면 편집 도구 없이 안내 문구만 보여준다(채울 실제 내용이
  // 없는데 서식 도구를 주는 건 혼란만 준다 — 2026-07-25 결정).
  if (block.pending) {
    return (
      <div className="mb-4 rounded-xl border border-dashed border-[#d8d1c6] bg-[#faf9f6] p-4">
        <div className="mb-1 flex items-center gap-2">
          <span className="rounded bg-[#f7e9e2] px-2 py-0.5 text-xs font-semibold text-[#a64d32]">정성 분석 대기</span>
          <p className="text-sm font-bold text-[#544c44]">{block.label}</p>
        </div>
        <p className="text-sm leading-6 text-[#81786e]" dangerouslySetInnerHTML={{ __html: block.html }} />
      </div>
    );
  }
  // styled: 극성 배너 색상 등 서식이 있는 정성 콘텐츠도 이제 편집기로 연다. 편집기는
  // 안전 목록의 인라인 스타일을 보존하므로, 배너·문단 여백·강조가 사라지지 않으면서
  // 사용자가 실제 문장을 그 자리에서 수정할 수 있다.
  if (block.styled) {
    return (
      <div className="mb-4">
        <RichReportEditor
          label={block.label}
          value={block.html}
          onChange={(html) => onChange({ ...block, html })}
          onQuoteSource={onQuoteSource}
        />
      </div>
    );
  }
  return (
    <div className="mb-4">
      <RichReportEditor
        label={block.label}
        value={block.html}
        onChange={(html) => onChange({ ...block, html })}
        onQuoteSource={onQuoteSource}
      />
    </div>
  );
}
