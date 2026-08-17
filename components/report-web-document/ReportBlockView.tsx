"use client";

import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { RichReportEditor } from "@/components/RichReportEditor";
import { EditableBarChart } from "@/components/report/EditableBarChart";
import { EditableRankCompositionChart } from "@/components/report/EditableRankCompositionChart";
import { EditableStackedBarChart } from "@/components/report/EditableStackedBarChart";
import { EditableGroupedBarChart } from "@/components/report/EditableGroupedBarChart";
import { EditableRadarChart } from "@/components/report/EditableRadarChart";
import { EditableNpsChart } from "@/components/report/EditableNpsChart";
import { EditableQuadrantChart } from "@/components/report/EditableQuadrantChart";
import { PriorityReferenceDiagram } from "@/components/report/PriorityReferenceDiagram";
import { EditablePolarityChart } from "@/components/report/EditablePolarityChart";
import { EditableTable } from "@/components/report/EditableTable";
import { cleanQuoteEndingReviewMarkup, markQuoteEndingReviews } from "@/components/report-web-document/quoteEndingMarkup";
import { downloadSvgAsPng } from "@/lib/report/exportImage";
import { reportQuoteEndingToken } from "@/lib/report/quoteEnding";
import type { ReportBlock } from "@/lib/report/sections";

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
}: {
  block: Extract<ReportBlock, { kind: "rich-static" }>;
  onChange: (next: ReportBlock) => void;
  sourceFileUrl?: string | null;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [summaryStatus, setSummaryStatus] = useState<"idle" | "loading" | "error">("idle");
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.contains(document.activeElement)) return;
    editor.innerHTML = block.html;
    markQuoteEndingReviews(editor, reportQuoteEndingToken);
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
    <div className="mb-5 mt-3">
      {/* 이 블록은 표뿐 아니라 도넛차트+표 조합(Ⅲ/Ⅴ장 감정 분석)에도 쓰이므로 "표의 셀"이라는
         문구는 안 맞았다 — 일반화된 문구로 바꾸고, 바로 위 블록(제목 등)과 붙어 보이지 않게
         위쪽 여백을 줬다(2026-07-28 실측: 안내문이 위 헤딩에 달라붙어 보인다는 지적). */}
      <p data-copy-ignore className="mb-2 text-xs text-[#70675e]">클릭하면 바로 내용을 수정할 수 있습니다.</p>
      <div data-copy-ignore className="mb-2 flex flex-wrap items-center gap-2">
        {hasEmbeddedCharts && Array.from({ length: (block.html.match(/<svg[\s>]/gi) ?? []).length }).map((_, index) => (
          <button key={index} type="button" data-chart-index={index} onClick={handleChartDownload} className="rounded border border-[#315c9c] px-2.5 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">
            {chartLabel(index)} PNG 다운로드
          </button>
        ))}
      </div>
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

export function FormatButton({ label, title, onApply, className }: { label: string; title: string; onApply: () => void; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onApply}
      className={`rounded border border-[#d7dce8] px-2.5 py-1.5 text-sm font-semibold text-[#315c9c] hover:bg-[#edf3fc] ${className ?? ""}`}
    >
      {label}
    </button>
  );
}

// 마법사 정량 리뷰 화면(components/wizard/QuantReviewStep.tsx)이 같은 블록→컴포넌트 매핑을
// 재사용하기 위해 export한다 — 두 곳에서 이 switch가 따로 자라면 어긋나기 쉽다.
export function BlockView({
  block,
  onChange,
  sourceFileUrl,
  onQuoteSource,
}: {
  block: ReportBlock;
  onChange: (next: ReportBlock) => void;
  sourceFileUrl?: string | null;
  onQuoteSource?: (questionKey: string, quotes: string[], groupLabel: string) => void;
}) {
  if (block.kind === "heading") {
    const saveHeading = (event: FocusEvent<HTMLElement>) => {
      const text = event.currentTarget.textContent?.trim() ?? "";
      if (text && text !== block.text) onChange({ ...block, text });
    };
    // id: 목차의 소제목 클릭 → 여기로 직접 스크롤(TableOfContents 참고). scroll-mt-24는
    // studio 헤더(sticky)에 상단이 가려지지 않게 하는 여백이다.
    if (block.variant === "numbered") {
      return (
        <div id={block.id} className="mb-7 grid scroll-mt-24 grid-cols-[64px_minmax(0,1fr)] border border-[#6388e6] text-[#111827]">
          <div contentEditable suppressContentEditableWarning onBlur={(event) => {
            const number = event.currentTarget.textContent?.trim() ?? "";
            if (number !== (block.number ?? "")) onChange({ ...block, number });
          }} className="flex min-h-14 items-center justify-center border-r border-[#6388e6] bg-[#e1e8f7] text-2xl font-medium outline-none focus:bg-[#d4e3fb]">{block.number}</div>
          <h2 contentEditable suppressContentEditableWarning onBlur={saveHeading} className="flex min-h-14 items-center px-6 text-[23px] font-semibold tracking-[-0.035em] outline-none focus:bg-[#f8fbff]">{block.text}</h2>
        </div>
      );
    }
    if (block.variant === "question") {
      return (
        <div id={block.id} className="mb-4 mt-7 scroll-mt-24 border-b-4 border-[#4fc8e8] pb-3">
          <h3 className="text-[21px] font-medium leading-[1.45] tracking-[-0.035em] text-[#111827]">
            {block.number ? `${block.number}. ` : ""}
            <span contentEditable suppressContentEditableWarning onBlur={saveHeading} className="outline-none focus:bg-[#f8fbff]">{block.text}</span>
          </h3>
        </div>
      );
    }
    return <h3 id={block.id} contentEditable suppressContentEditableWarning onBlur={saveHeading} className="mb-3 mt-6 scroll-mt-24 text-[21px] font-semibold tracking-[-0.035em] text-[#111827] outline-none focus:bg-[#f8fbff]">{block.text}</h3>;
  }
  if (block.kind === "chart") return <EditableBarChart block={block} />;
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
    return <EditableRichStaticBlock block={block} onChange={onChange} sourceFileUrl={sourceFileUrl} />;
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
