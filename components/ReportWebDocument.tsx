"use client";

/**
 * 실제 생성된 보고서 내용을 진짜 문서처럼 연속 스크롤로 보여주는 웹 작업공간
 * (2026-07-25 재구성, PRD v1.5 후속). **예전엔 `activeSection` 하나만 조건부로 그려서
 * 목차를 클릭해야만 다른 장으로 "페이지가 통째로 바뀌는" 방식이었는데**, 사용자가 "목차를
 * 누르거나 스크롤하면 목차 글씨 색이 자동으로 바뀌면서 Ⅰ~Ⅸ가 죽 이어지는 진짜 문서처럼
 * 보이면 좋겠다"고 요청해 Ⅰ~Ⅸ 9개 섹션을 전부 A4 비율 카드로 연속 렌더링하고,
 * `IntersectionObserver`로 스크롤 위치에 따라 목차 활성 항목이 자동으로 바뀌게(스크롤스파이)
 * 바꿨다. 실제 PDF의 정확한 쪽 나눔 위치까지는 재현하지 않는다(섹션 단위 카드가 내용에 맞게
 * 자연스럽게 길어짐 — 사용자 확정 사항, react-pdf의 pt 단위 페이지 넘김 로직을 브라우저
 * CSS로 통째로 재구현하는 건 비용 대비 효과가 낮다고 판단).
 *
 * 섹션 내용은 `lib/report/workspace.ts`가 실제 QuantStats로 채운 `ReportSectionContent[]`를
 * 그대로 쓴다(차트/표/글 3종 블록, `lib/report/sections.ts`). 정성 데이터가 아직 없는 자리는
 * `pending: true`로 정직하게 "정성 분석 승인 후 표시"라고 보여준다.
 */
import { useEffect, useMemo, useRef, useState, type Dispatch, type FocusEvent, type MouseEvent, type ReactNode, type SetStateAction } from "react";
import { ReportPropertyPanel } from "@/components/ReportPropertyPanel";
import { RichReportEditor, writeRichClipboard } from "@/components/RichReportEditor";
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
import { elementToClipboardHtml, fragmentToClipboardHtml } from "@/lib/report/domClipboard";
import { downloadSectionExportsAsZip, downloadSvgAsPng } from "@/lib/report/exportImage";
import { escapeHtml, htmlToPlainText } from "@/lib/report/richText";
import { htmlToRtf } from "@/lib/report/rtfClipboard";
import { reportQuoteEndingToken, splitHighlightParts } from "@/lib/report/quoteEnding";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";
import { QuoteCorrectionPanel, type BatchCorrectionItem } from "@/components/QuoteCorrectionPanel";
import type { ReportWorkspaceSeed } from "@/lib/report/workspace";
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";

type Props = {
  sections: ReportSectionContent[];
  setSections: Dispatch<SetStateAction<ReportSectionContent[]>>;
  checkpoint: () => void;
  reportData: ReportWorkspaceSeed | null;
  activeSection: string;
  onActiveSectionChange: (numeral: string) => void;
  workspaceStatus: "idle" | "loading" | "ready" | "error";
  workspaceError?: string | null;
  onRetry: () => void;
  /** 저장된 보고서를 찾는 키. 없으면 데모이므로 AI 요약 호출은 숨긴다. */
  sourceFileUrl?: string | null;
};

type QuoteSourceResult = {
  questionLabel: string;
  groupLabel: string;
  sources: Array<{
    questionLabel?: string;
    sectionLabel?: string;
    respondentId: number;
    originalResponse: string;
    matches: Array<{ quote: string; matchStart: number; matchEnd: number; needsReview: boolean }>;
  }>;
};

type QuoteCompletionTarget = { quote: string; originalResponse: string };
type QuoteGroupReference = { groupLabel: string; sources: Array<{ questionKey: string; quotes: string[]; sectionLabel?: string }> };
type AnalysisReference = { title: string; kind: "종합 분석" | "종합 결과" | "제언"; bullets: string[] };

const ANALYSIS_EVIDENCE_BY_BLOCK: Record<string, AnalysisReference> = {
  "feature-analysis-summary": { title: "기능별 중요 순위 및 만족도 종합 해석", kind: "종합 분석", bullets: ["정량 근거: 기능별 상대 중요도 점수, 만족도 평균, 응답 분포를 함께 비교했습니다.", "우선순위 판단: 중요도는 높지만 만족도가 낮은 기능과 두 값이 모두 낮은 기능을 구분했습니다.", "정성 근거: 각 기능의 부정·중립 인용문에서 반복된 튜토리얼 부족, 조작 불편, 진행 지연 등의 원인을 묶었습니다.", "해석 연결: 동일 문제가 여러 기능에서 반복되는 경우 개별 기능 문제가 아니라 온보딩·진행 구조의 공통 문제로 판단했습니다."] },
  "core-analysis-summary": { title: "핵심구매요소 종합 분석", kind: "종합 분석", bullets: ["정량 근거: 구매요소별 선택 비율과 순위, 상위 응답 집중도를 확인했습니다.", "정성 근거: 구매 결정에 영향을 준 이유와 구매를 망설이게 한 이유를 원문 카테고리별로 대조했습니다.", "해석 연결: 선택 비율이 높고 같은 이유가 반복된 요소는 핵심 구매 동인으로, 중요하지만 불만이 반복된 요소는 개선 과제로 분류했습니다."] },
  "four-values-analysis-summary": { title: "4대 가치 만족도 종합 해석", kind: "종합 분석", bullets: ["정량 근거: 기능적·감성적·사회공공적·경제적 가치의 평균, 표준편차와 항목 간 차이를 비교했습니다.", "정성 근거: 각 가치 표의 긍정 의견과 부정 의견을 모두 사용해 점수가 형성된 이유를 확인했습니다.", "해석 연결: 평균이 높아도 부정 의견이 반복되면 강점으로 단정하지 않고 유지·보완 과제로 분리했습니다."] },
  "ux-analysis-summary": { title: "사용자 경험 품질 종합 분석", kind: "종합 분석", bullets: ["정량 근거: 실용성·즐거움의 세부 항목 평균과 항목별 격차를 확인했습니다.", "정성 근거: 사용 과정에서 반복된 이해 어려움, 조작 부담, 몰입 저하 의견을 함께 대조했습니다.", "해석 연결: 낮은 점수와 같은 불편 원문이 함께 확인된 경험 구간을 우선 개선 대상으로 판단했습니다."] },
  "ux-analysis-detail": { title: "사용자 경험 품질 상세 분석", kind: "종합 분석", bullets: ["세부 근거: 각 UX 품질 항목의 평균과 응답 분포를 항목별로 비교했습니다.", "원문 대조: 점수가 낮거나 편차가 큰 항목에 연결된 실제 불편 의견을 확인했습니다.", "판단 방식: 정량 저점과 동일한 불편이 반복되는 사용 구간을 구체적인 개선 대상으로 정리했습니다."] },
  "cross-age-analysis": { title: "연령대별 차이 분석", kind: "종합 분석", bullets: ["연령대별 기능 만족도, 4대 가치, UX 품질 평균을 동일 척도에서 비교했습니다.", "집단별 응답자 수가 작은 경우 평균 차이를 단정하지 않고 참고 경향으로 처리했습니다.", "특정 연령대에서만 반복된 저점과 불편 의견이 함께 있는지 확인해 차이의 원인을 해석했습니다."] },
  "cross-gender-analysis": { title: "성별 차이 분석", kind: "종합 분석", bullets: ["성별 기능 만족도, 4대 가치, UX 품질 평균을 동일 척도에서 비교했습니다.", "평균 차이뿐 아니라 각 집단의 응답 분포와 표본 크기를 함께 확인했습니다.", "한 집단에서 반복적으로 나타난 불편 원문이 있을 때만 차이의 가능 원인으로 연결했습니다."] },
  "nps-reference-and-summary": { title: "종합 만족도 및 NPS 결과", kind: "종합 결과", bullets: ["종합 만족도 점수와 점수대별 응답 분포를 사용했습니다.", "NPS는 추천 고객 비율에서 비추천 고객 비율을 뺀 값으로 산정했습니다.", "추천·중립·비추천 집단의 주관식 이유를 대조해 지수 상승·하락 요인을 함께 정리했습니다."] },
  "conclusion-feature-summary-table": { title: "기능별 고객 경험 종합 결과", kind: "종합 결과", bullets: ["기능별 중요도와 만족도를 교차해 우선·차우선·비우선 개선 영역을 분류했습니다.", "각 기능의 긍정·부정·중립 의견에서 반복 빈도가 높은 요지를 연결했습니다.", "점수와 원문이 같은 방향을 가리키는지 확인한 뒤 최종 기능별 결과로 요약했습니다."] },
  "conclusion-feature-summary-bullets": { title: "기능별 고객 경험 결과 요약", kind: "종합 결과", bullets: ["앞선 기능별 정량 순위와 만족도 결과를 다시 사용했습니다.", "기능별 정성 분석에서 반복된 강점·불편·개선 요구를 한 문장으로 압축했습니다.", "근거가 엇갈리는 기능은 확정 평가 대신 추가 검토 항목으로 남겼습니다."] },
  "conclusion-evidence-table": { title: "사용성테스트 결과 종합", kind: "종합 결과", bullets: ["정량 근거: 기능, 가치, UX 품질, 종합 만족도와 NPS 결과를 종합했습니다.", "정성 근거: 긍정·부정·중립 의견의 반복 카테고리와 대표 인용문을 사용했습니다.", "종합 방식: 여러 섹션에서 동시에 확인되는 문제와 강점을 우선해 최종 결과를 구성했습니다."] },
  "conclusion-strategy-table": { title: "개선 전략 제언", kind: "제언", bullets: ["중요도가 높고 만족도가 낮은 문제를 가장 먼저 검토했습니다.", "여러 기능에서 반복되거나 핵심 이용 흐름을 막는 문제에 더 높은 우선순위를 부여했습니다.", "사용자 원문에서 제시된 개선 요구와 실제 구현 가능 범위를 연결해 단기·중기 방향으로 정리했습니다."] },
  "conclusion-feature-customer-table": { title: "기능별 고객 제언 종합", kind: "제언", bullets: ["기능별 부정 의견과 사용자가 직접 제안한 개선 아이디어를 모았습니다.", "서로 비슷한 요구는 하나의 실행 과제로 묶고 반복 응답이 많은 요구를 앞에 배치했습니다.", "정량 결과와 충돌하는 제언은 확정 과제가 아니라 추가 검증이 필요한 가설로 구분했습니다."] },
};

function markQuoteEndingReviews(root: HTMLElement) {
  for (const note of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-ending-note]"))) note.remove();
  for (const previousMarker of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-ending-token]"))) {
    previousMarker.replaceWith(...Array.from(previousMarker.childNodes));
  }
  for (const quoteNode of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-text]"))) {
    const quote = decodeURIComponent(quoteNode.dataset.quoteText ?? "");
    const token = reportQuoteEndingToken(quote);
    quoteNode.removeAttribute("data-quote-ending-review");
    if (!token) continue;
    const paragraph = quoteNode.querySelector("p");
    if (!paragraph) continue;
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
    const target = [...textNodes].reverse().find((node) => node.data.lastIndexOf(token) >= 0);
    if (!target) continue;
    const start = target.data.lastIndexOf(token);
    const marker = document.createElement("span");
    marker.dataset.quoteEndingToken = "true";
    marker.textContent = token;
    target.replaceWith(document.createTextNode(target.data.slice(0, start)), marker, document.createTextNode(target.data.slice(start + token.length)));
    quoteNode.dataset.quoteEndingReview = "true";
  }
}

function cleanQuoteEndingReviewMarkup(root: HTMLElement) {
  for (const note of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-ending-note]"))) note.remove();
  for (const marker of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-ending-token]"))) marker.replaceWith(...Array.from(marker.childNodes));
  for (const quoteNode of Array.from(root.querySelectorAll<HTMLElement>("[data-quote-ending-review]"))) quoteNode.removeAttribute("data-quote-ending-review");
}

function QuoteWithEndingReview({ quote, needsReview }: { quote: string; needsReview: boolean }) {
  const token = needsReview ? reportQuoteEndingToken(quote) : null;
  if (!token) return <>“{quote}”</>;
  const start = quote.lastIndexOf(token);
  return <>“{quote.slice(0, start)}<span className="decoration-dotted decoration-[1.5px] underline underline-offset-4 decoration-[#d36b62]">{token}</span>{quote.slice(start + token.length)}”</>;
}

function HighlightedOriginal({ text, matches }: { text: string; matches: QuoteSourceResult["sources"][number]["matches"] }) {
  const ranges = matches
    .filter((match) => match.matchStart >= 0 && match.matchEnd > match.matchStart)
    .sort((a, b) => a.matchStart - b.matchStart);
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.matchStart < cursor) return;
    parts.push(text.slice(cursor, range.matchStart));
    parts.push(<mark key={`${range.matchStart}-${index}`} className="rounded bg-[#fff0a8] px-0.5 text-inherit">{text.slice(range.matchStart, range.matchEnd)}</mark>);
    cursor = range.matchEnd;
  });
  parts.push(text.slice(cursor));
  return <>{parts}</>;
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
    markQuoteEndingReviews(editor);
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

function SectionBanner({ numeral, title }: { numeral: string; title: string }) {
  return (
    <div className="mb-6 flex w-fit overflow-hidden">
      <div className="flex min-w-14 items-center justify-center bg-[#dfeaf5] px-4 text-2xl font-bold text-[#315c9c]">{numeral}</div>
      <div className="bg-[#5c73aa] px-9 py-3 text-[28px] font-bold tracking-[-0.04em] text-white">{title}</div>
    </div>
  );
}

/** 목차 사이드바 — 큰 제목을 클릭하면 섹션 맨 위로, 소제목을 클릭하면 그 소제목에 해당하는
 * 본문 heading 블록으로 바로 스크롤한다(2026-07-28, 예전엔 소제목이 단순 라벨 텍스트라 클릭이
 * 안 됐다). 스크롤 중엔 활성 항목이 스크롤스파이(`ReportWebDocument`의 `IntersectionObserver`)
 * 로 자동 갱신된다. */
function TableOfContents({
  sections,
  activeSection,
  onSelect,
  onSelectSubitem,
}: {
  sections: ReportSectionContent[];
  activeSection: string;
  onSelect: (numeral: string) => void;
  /** 소제목 클릭 — 해당 heading 블록의 id로 직접 스크롤한다(id를 못 찾으면 섹션 맨 위로). */
  onSelectSubitem: (numeral: string, headingBlockId: string | null) => void;
}) {
  // subitems는 featureNames와 무관(featureNames는 III의 긴 source 설명에만 쓰이는데, 여기선
  // 짧은 subitems만 렌더링하므로 빈 배열로 충분하다).
  const plan = useMemo(() => buildReportPlan([]), []);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>(`[data-toc-section="${activeSection}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeSection]);
  return (
    <aside className="h-fit bg-transparent px-1 py-2 lg:sticky lg:top-28 lg:flex lg:max-h-[calc(100vh-8rem)] lg:flex-col lg:overflow-hidden">
      <p className="px-2 text-xl font-bold tracking-[-0.03em] text-[#20242c]">목차</p>
      <p className="mb-2 mt-0.5 px-2 text-xs text-[#8a94a3]">보고서 작성 현황</p>
      <nav ref={navRef} className="min-h-0 space-y-0.5 pr-1 lg:overflow-y-auto lg:overscroll-contain">
        {sections.map((section) => {
          const planSection = plan.find((p) => p.numeral === section.numeral);
          const active = section.numeral === activeSection;
          // 참고 이미지(FGI Transcript Studio)의 "선행 필요" 태그 패턴을 차용 — 이 섹션에 아직
          // 채워지지 않은 정성 블록이 있으면 목차에도 상태를 알려준다. 새 색상을 만들지 않고
          // BlockView의 pending 배지 팔레트(#f7e9e2/#a64d32)를 그대로 재사용해 "이 색 = 정성
          // 분석 대기"라는 의미를 목차·본문에서 일관되게 유지한다(2026-07-26).
          const hasPending = section.blocks.some((block) => block.kind === "text" && block.pending);
          return (
            <div key={section.numeral} data-toc-section={section.numeral} className={`rounded-md transition ${active ? "bg-[#eaf3ff]" : ""}`}>
              <button
                type="button"
                onClick={() => onSelect(section.numeral)}
                className={`block w-full rounded-md px-2 py-1 text-left ${active ? "text-[#1473e6]" : "hover:bg-[#edf3fc]"}`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`text-[13px] font-bold leading-[1.4] ${active ? "text-[#1473e6]" : "text-[#4b5565]"}`}>
                    {section.numeral}. {section.title}
                  </span>
                  {hasPending && (
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${
                        active ? "bg-white text-[#1473e6]" : "bg-[#f7e9e2] text-[#a64d32]"
                      }`}
                    >
                      정성 대기
                    </span>
                  )}
                </span>
              </button>
              <div className="px-2 pb-1">
                {planSection?.subitems.map((item) => {
                  const headingBlock = section.blocks.find(
                    (block) => block.kind === "heading" && (block.variant === "numbered" || block.variant === "subheading") && block.text === item,
                  );
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onSelectSubitem(section.numeral, headingBlock?.id ?? null)}
                      className={`block w-full rounded px-2 py-0.5 text-left text-xs leading-[1.4] ${
                        active ? "text-[#397dc9] hover:bg-white/60" : "text-[#7a8493] hover:bg-[#edf3fc]"
                      }`}
                    >
                      · {item}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
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
function applyTextFormat(command: "bold" | "italic" | "underline") {
  document.execCommand(command);
}

function insertArrowLine() {
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

function FormatButton({ label, title, onApply, className }: { label: string; title: string; onApply: () => void; className?: string }) {
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

/** 우측 액션 패널 — 현재 스크롤스파이로 활성화된 섹션 하나에 대해 동작한다(2026-07-25 신규,
 * 예전엔 같은 동작이 섹션 카드 하단에 인라인 버튼으로 있었다). */
function ActionPanel({ activeTitle, onCopy, onDownload, onOpenCorrections, selectedBlock, onBlockChange }: { activeTitle: string; onCopy: () => void; onDownload: () => void; onOpenCorrections: () => void; selectedBlock: ReportBlock | null; onBlockChange: (next: ReportBlock) => void }) {
  return (
    // "선택 요소 편집"(예: 비교 집단이 많은 그룹 막대그래프)이 길어지면 sticky 패널 자체 높이가
    // 뷰포트를 넘어서는데, sticky는 top 위치에 고정된 뒤로는 페이지 스크롤을 따라가지 않으므로
    // 아래쪽 항목이 화면 밖으로 잘려서 영영 안 보였다(2026-07-30 사용자 실측 신고). 패널
    // 자체에 최대 높이 + 내부 세로 스크롤을 줘서, 페이지와 별개로 패널 안에서 스크롤해
    // 잘린 항목까지 내려갈 수 있게 한다.
    <aside className="h-fit rounded-xl border border-[#c9daf2] bg-white shadow-[0_10px_30px_rgba(31,55,88,0.08)] lg:sticky lg:top-36 lg:flex lg:max-h-[calc(100vh-10rem)] lg:flex-col lg:overflow-hidden">
      {/* 헤더를 옅은 배경 밴드로 구분해 목차/본문 밴드와 톤을 맞췄다(2026-07-26, 기능 변경
          없음 — 참고 이미지의 카드형 우측 패널에서 헤더 구획감을 참고했다). */}
      <div className="border-b border-[#e3e8ef] px-5 py-4"><p className="text-xs font-semibold text-[#8a94a3]">보고서 작업</p><p className="mt-1 text-base font-bold text-[#263449]">{activeTitle}</p></div>
      <div className="lg:min-h-0 lg:overflow-y-auto">
      {/* 본문 텍스트를 클릭해 커서를 두면(또는 일부 선택하면) 여기 버튼으로 서식을 적용한다
          (2026-07-28 — 문단마다 있던 개별 도구모음을 없앤 대신 이 패널로 모았다). */}
      <div className="space-y-2 border-b border-[#e3e8ef] p-5">
        <p className="text-sm font-bold text-[#263449]">텍스트 서식</p>
        <p className="text-xs text-[#70675e]">본문에서 서식을 넣을 위치를 클릭(또는 드래그로 선택)한 뒤 눌러주세요.</p>
        <div className="flex flex-wrap gap-1.5">
          <FormatButton label="굵게" title="굵게" onApply={() => applyTextFormat("bold")} className="font-bold" />
          <FormatButton label="기울임" title="기울임" onApply={() => applyTextFormat("italic")} className="italic" />
          <FormatButton label="밑줄" title="밑줄" onApply={() => applyTextFormat("underline")} className="underline" />
          <FormatButton label="제언 화살표" title="→ 제언 문단 추가" onApply={insertArrowLine} />
        </div>
      </div>
      <div className="space-y-2 p-5">
      <button
        type="button"
        onClick={onCopy}
        className="block w-full rounded-lg border border-[#b9cbe3] px-3 py-2.5 text-left text-sm font-semibold text-[#315f9d] hover:bg-[#f2f7ff]"
      >
        내용 전체 복사하기
      </button>
      <button
        type="button"
        onClick={onDownload}
        className="block w-full rounded-lg bg-[#1473e6] px-3 py-2.5 text-left text-sm font-semibold text-white hover:bg-[#0f65cf]"
      >
        현재 섹션 차트 이미지 저장
      </button>
      <button
        type="button"
        onClick={onOpenCorrections}
        className="block w-full rounded-lg border border-[#b9cbe3] px-3 py-2.5 text-left text-sm font-semibold text-[#315f9d] hover:bg-[#f2f7ff]"
      >
        인용문 일괄 검토
      </button>
      </div>
      <div className="border-t border-[#e3e8ef] p-5">
        <p className="mb-3 text-sm font-bold text-[#315c9c]">선택 요소 편집</p>
        <ReportPropertyPanel block={selectedBlock} onChange={onBlockChange} />
      </div>
      </div>
    </aside>
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

export function ReportWebDocument({ sections, setSections, checkpoint, reportData, activeSection, onActiveSectionChange, workspaceStatus, workspaceError, onRetry, sourceFileUrl }: Props) {
  const documentContainerRef = useRef<HTMLDivElement>(null);
  const sectionElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [selectedBlockRef, setSelectedBlockRef] = useState<{ numeral: string; id: string } | null>(null);
  const [quoteSource, setQuoteSource] = useState<QuoteSourceResult | null>(null);
  const [quoteSourceStatus, setQuoteSourceStatus] = useState<"idle" | "loading" | "error">("idle");
  const [quoteCompletion, setQuoteCompletion] = useState<{ completedQuote: string; changedFrom: string; changedTo: string } | null>(null);
  const [quoteCompletionStatus, setQuoteCompletionStatus] = useState<"idle" | "loading" | "error">("idle");
  const [quoteCompletionTarget, setQuoteCompletionTarget] = useState<QuoteCompletionTarget | null>(null);
  const [quotePanelOpen, setQuotePanelOpen] = useState(true);
  const [analysisReference, setAnalysisReference] = useState<AnalysisReference | null>(null);
  const [analysisBlockId, setAnalysisBlockId] = useState<string | null>(null);
  const [recommendationStatus, setRecommendationStatus] = useState<"idle" | "loading" | "error">("idle");
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [correctionsPanelOpen, setCorrectionsPanelOpen] = useState(false);
  const quoteSourceRequestRef = useRef(0);
  const activeEvidenceKeyRef = useRef<string | null>(null);

  // RichReportEditor와 rich-static은 contentEditable 내부 HTML을 각각 effect에서 주입한다.
  // 부모 렌더 시점에만 표시하면 그 뒤의 innerHTML 주입에 검토 마커가 덮일 수 있으므로,
  // 보고서 전체 DOM이 확정된 다음 프레임에 모든 인용문을 한 번 더 표시한다.
  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const container = documentContainerRef.current;
        if (container) markQuoteEndingReviews(container);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [sections, quoteSource]);

  async function openQuoteSource(sources: QuoteGroupReference["sources"], groupLabel: string) {
    if (!sourceFileUrl) return;
    const requestId = ++quoteSourceRequestRef.current;
    setQuotePanelOpen(true);
    setQuoteSourceStatus("loading");
    setQuoteCompletion(null);
    setQuoteCompletionStatus("idle");
    setQuoteCompletionTarget(null);
    const results = await Promise.all(sources.map(async (source) => {
      const response = await fetch("/api/report-workspace/quote-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceFileUrl, questionKey: source.questionKey, quotes: source.quotes }),
      });
      const result = await response.json();
      return { response, result };
    }));
    if (requestId !== quoteSourceRequestRef.current) return;
    const successful = results.filter(({ response, result }) => response.ok && result.ok);
    if (successful.length === 0) {
      setQuoteSourceStatus("error");
      return;
    }
    setQuoteSource({
      questionLabel: successful.length === 1 ? successful[0].result.questionLabel : `${successful.length}개 문항`,
      groupLabel,
      sources: successful.flatMap(({ result }, index) => result.sources.map((source: QuoteSourceResult["sources"][number]) => ({ ...source, questionLabel: result.questionLabel, sectionLabel: sources[index]?.sectionLabel }))),
    });
    setQuoteSourceStatus("idle");
  }

  useEffect(() => {
    const container = documentContainerRef.current;
    if (!container) return;
    let frame = 0;

    const quoteSourcesFor = (root: HTMLElement): { label: string; sources: QuoteGroupReference["sources"] } | null => {
      const marker = root.querySelector<HTMLElement>("[data-quote-group-source]");
      if (!marker) return null;
      const label = root.matches("table") ? "긍정·부정 의견" : decodeURIComponent(marker.dataset.quoteGroupLabel ?? "인용 의견");
      const grouped = new Map<string, { questionKey: string; quotes: string[]; sectionLabel?: string }>();
      const quoteGroups = root.matches("[data-quote-group]") ? [root] : Array.from(root.querySelectorAll<HTMLElement>("[data-quote-group]"));
      for (const quoteGroup of quoteGroups) {
        const groupMarker = quoteGroup.querySelector<HTMLElement>("[data-quote-group-source]") ?? marker;
        const questionKey = groupMarker.dataset.quoteGroupSource ?? "";
        const sectionsInGroup = Array.from(quoteGroup.querySelectorAll<HTMLElement>("[data-quote-section]"));
        const partitions = sectionsInGroup.length > 0 ? sectionsInGroup : [quoteGroup];
        for (const partition of partitions) {
          const sectionLabel = partition.dataset.quoteSection ?? decodeURIComponent(groupMarker.dataset.quoteGroupLabel ?? label);
          const quotes = Array.from(partition.querySelectorAll<HTMLElement>("[data-quote-text]"))
            .map((node) => decodeURIComponent(node.dataset.quoteText ?? "")).filter(Boolean);
          if (questionKey && quotes.length > 0) grouped.set(`${questionKey}:${sectionLabel}`, { questionKey, quotes: [...new Set(quotes)], sectionLabel });
        }
      }
      const sources = [...grouped.values()];
      return sources.length > 0 ? { label, sources } : null;
    };

    const updateEvidence = () => {
      const readingLine = window.innerHeight * 0.32;
      const containerRect = container.getBoundingClientRect();
      const readingPointX = Math.min(window.innerWidth - 1, Math.max(0, containerRect.left + Math.min(containerRect.width / 2, 360)));
      const readingPoint = document.elementFromPoint(readingPointX, readingLine) as HTMLElement | null;
      const reportSections = Array.from(container.querySelectorAll<HTMLElement>("[data-section-page]"));
      const sectionAtReadingPoint = readingPoint?.closest<HTMLElement>("[data-section-page]");
      const currentSection = sectionAtReadingPoint ?? reportSections.find((section) => {
        const rect = section.getBoundingClientRect();
        return rect.top <= readingLine && rect.bottom >= readingLine;
      }) ?? reportSections.reduce<HTMLElement | null>((nearest, section) => {
        if (!nearest) return section;
        const rect = section.getBoundingClientRect();
        const nearestRect = nearest.getBoundingClientRect();
        return Math.abs(rect.top - readingLine) < Math.abs(nearestRect.top - readingLine) ? section : nearest;
      }, null);
      if (!currentSection) return;

      // 화면의 실제 읽기선에 닿은 본문 블록만 사용한다. 섹션 전체에서 "가장 가까운" 근거를
      // 고르면 근거가 없는 공백·표·그래프에서도 이전/다음 인용문이 잘못 붙는 문제가 생긴다.
      const blockAtReadingPoint = readingPoint?.closest<HTMLElement>("[data-report-block-id]");
      const blockId = blockAtReadingPoint?.dataset.reportBlockId ?? "";
      const reference = ANALYSIS_EVIDENCE_BY_BLOCK[blockId];
      const quoteGroupAtReadingPoint = readingPoint?.closest<HTMLElement>("[data-quote-group]");
      const quoteScope = quoteGroupAtReadingPoint && !quoteGroupAtReadingPoint.closest("[data-analysis-evidence]") && !reference
        ? quoteGroupAtReadingPoint.closest<HTMLElement>("table") ?? quoteGroupAtReadingPoint
        : null;

      if (!reference && !quoteScope) {
        const key = `none:${currentSection.dataset.sectionPage}`;
        if (activeEvidenceKeyRef.current === key) return;
        activeEvidenceKeyRef.current = key;
        quoteSourceRequestRef.current += 1;
        setQuoteSource(null);
        setQuoteSourceStatus("idle");
        setAnalysisReference(null);
        setAnalysisBlockId(null);
        setQuotePanelOpen(true);
        return;
      }

      if (reference) {
        const key = `analysis:${blockId}`;
        if (activeEvidenceKeyRef.current === key) return;
        activeEvidenceKeyRef.current = key;
        quoteSourceRequestRef.current += 1;
        setQuoteSource(null);
        setQuoteSourceStatus("idle");
        setQuoteCompletion(null);
        setQuoteCompletionTarget(null);
        setAnalysisReference(reference);
        setAnalysisBlockId(blockId);
        setQuotePanelOpen(true);
        return;
      }

      const quoteContext = quoteScope ? quoteSourcesFor(quoteScope) : null;
      if (!quoteContext) return;
      const key = `quote:${quoteContext.label}:${quoteContext.sources.flatMap((source) => [source.questionKey, ...source.quotes]).join("|")}`;
      if (activeEvidenceKeyRef.current === key) return;
      activeEvidenceKeyRef.current = key;
      setAnalysisReference(null);
      setAnalysisBlockId(null);
      void openQuoteSource(quoteContext.sources, quoteContext.label);
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateEvidence);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    // 보고서 바깥 레이아웃이 독립 스크롤 컨테이너로 바뀌어도 동일하게 동작한다.
    document.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
    // openQuoteSource는 선택된 컨텍스트가 바뀔 때만 호출되는 외부 요청 함수다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);

  async function regenerateRecommendation() {
    if (!sourceFileUrl || recommendationStatus === "loading" || !analysisBlockId) return;
    const target = analysisBlockId === "conclusion-strategy-table" ? "strategy" : analysisBlockId === "conclusion-feature-customer-table" ? "customer" : null;
    if (!target) return;
    setRecommendationStatus("loading");
    setRecommendationError(null);
    try {
      const response = await fetch("/api/report-workspace/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: sourceFileUrl, target }),
      });
      const result = await response.json() as { ok: boolean; block?: ReportBlock; error?: string };
      if (!response.ok || !result.ok || !result.block) throw new Error(result.error || "제언을 다시 생성하지 못했습니다.");
      checkpoint();
      setSections((previous) => previous.map((section) => ({
        ...section,
        blocks: section.blocks.map((block) => block.id === analysisBlockId ? result.block as ReportBlock : block),
      })));
      setRecommendationStatus("idle");
    } catch (error) {
      setRecommendationStatus("error");
      setRecommendationError(error instanceof Error ? error.message : "제언을 다시 생성하지 못했습니다.");
    }
  }

  async function generateQuoteCompletion(target: QuoteCompletionTarget) {
    if (quoteCompletionStatus === "loading") return;
    setQuoteCompletionTarget(target);
    setQuoteCompletion(null);
    setQuoteCompletionStatus("loading");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch("/api/report-workspace/quote-completion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(target),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || !result.ok) {
        setQuoteCompletionStatus("error");
        return;
      }
      setQuoteCompletion({ completedQuote: result.completedQuote, changedFrom: result.changedFrom, changedTo: result.changedTo });
      setQuoteCompletionStatus("idle");
    } catch {
      setQuoteCompletionStatus("error");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function applyQuoteCompletion() {
    if (!quoteCompletion || !quoteCompletionTarget) return;
    checkpoint();
    const encodedQuote = encodeURIComponent(quoteCompletionTarget.quote);
    setSections((previous) => previous.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => {
        if (block.kind !== "text" && block.kind !== "rich-static") return block;
        const doc = new DOMParser().parseFromString(block.html, "text/html");
        const quoteNode = Array.from(doc.body.querySelectorAll<HTMLElement>("[data-quote-text]")).find((node) => node.dataset.quoteText === encodedQuote);
        const quoteParagraph = quoteNode?.closest("[data-report-quote]")?.querySelector("p");
        if (!quoteParagraph) return block;
        quoteParagraph.textContent = `“${quoteCompletion.completedQuote}”`;
        quoteParagraph.setAttribute("data-edited-quote", "true");
        quoteNode?.setAttribute("data-quote-text", encodeURIComponent(quoteCompletion.completedQuote));
        quoteNode?.querySelector("[data-quote-completion-source]")?.remove();
        return { ...block, html: doc.body.innerHTML };
      }),
    })));
    setQuoteSource((current) => current ? {
      ...current,
      sources: current.sources.map((source) => ({
        ...source,
        matches: source.matches.map((match) => match.quote === quoteCompletionTarget.quote
          ? { ...match, quote: quoteCompletion.completedQuote, needsReview: false }
          : match),
      })),
    } : current);
    setQuoteCompletion(null);
    setQuoteCompletionTarget(null);
  }

  /**
   * 일괄 검토 패널(`QuoteCorrectionPanel`)에서 체크된 항목을 한 번에 본문에 반영한다.
   * 단건 적용(`applyQuoteCompletion`)과 같은 DOMParser 치환 패턴을 여러 인용문으로 일반화한
   * 것 — 다른 점은 적용 표시를 boolean 속성(`data-edited-quote`)뿐 아니라 변경된 부분만
   * `<mark data-edited-quote-diff>`로 감싸 영구적인 빨간 하이라이트로 남긴다는 것이다.
   */
  function applyBatchCorrections(items: BatchCorrectionItem[]) {
    if (items.length === 0) return;
    checkpoint();
    const byEncodedQuote = new Map(items.map((item) => [encodeURIComponent(item.quote), item]));
    setSections((previous) => previous.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => {
        if (block.kind !== "text" && block.kind !== "rich-static") return block;
        const doc = new DOMParser().parseFromString(block.html, "text/html");
        let changed = false;
        for (const quoteNode of Array.from(doc.body.querySelectorAll<HTMLElement>("[data-quote-text]"))) {
          const item = byEncodedQuote.get(quoteNode.getAttribute("data-quote-text") ?? "");
          const quoteParagraph = item ? quoteNode.closest("[data-report-quote]")?.querySelector("p") : null;
          if (!item || !quoteParagraph) continue;
          const { prefix, middle, suffix } = splitHighlightParts(item.quote, item.suggestion);
          quoteParagraph.innerHTML = `“${escapeHtml(prefix)}<mark data-edited-quote-diff style="background-color:#fee2e2">${escapeHtml(middle)}</mark>${escapeHtml(suffix)}”`;
          quoteParagraph.setAttribute("data-edited-quote", "true");
          quoteNode.setAttribute("data-quote-text", encodeURIComponent(item.suggestion));
          changed = true;
        }
        return changed ? { ...block, html: doc.body.innerHTML } : block;
      }),
    })));
  }

  // 스크롤스파이 콜백 안에서 최신 activeSection/onActiveSectionChange를 읽기 위한 ref —
  // observer 자체는 섹션 개수가 바뀌지 않는 한 재구독할 필요가 없다(스크롤마다 activeSection이
  // 바뀌는데, 그때마다 effect를 재구독하면 옵저버가 계속 재생성돼 낭비다).
  const activeSectionRef = useRef(activeSection);
  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);
  const onActiveSectionChangeRef = useRef(onActiveSectionChange);
  useEffect(() => {
    onActiveSectionChangeRef.current = onActiveSectionChange;
  }, [onActiveSectionChange]);

  // 스크롤스파이: 뷰포트 상단 15~30% 부근을 지나는 섹션을 활성으로 표시한다. TOC 클릭으로
  // 스크롤이 시작돼도 결국 이 옵저버가 같은 섹션을 활성으로 재확인해줄 뿐이라, "프로그래매틱
  // 스크롤 중엔 옵저버 끄기" 같은 별도 방어 로직은 필요 없다(클릭이 가리키는 섹션과 옵저버가
  // 최종 감지할 섹션이 항상 같다).
  useEffect(() => {
    const targets = Array.from(sectionElementsRef.current.values());
    if (targets.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top < b.boundingClientRect.top ? a : b));
        const numeral = topMost.target.getAttribute("data-section-page");
        if (numeral && numeral !== activeSectionRef.current) {
          onActiveSectionChangeRef.current(numeral);
        }
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections.length]);

  /**
   * 본문을 드래그해 복사하는 경우에도 버튼 복사와 동일하게 HTML·RTF·평문을 함께 제공한다.
   *
   * 브라우저 기본 CF_HTML은 화면의 빈 <p>와 CSS margin을 운영체제별로 축약한다. 특히 한글은
   * 이 경로에서 빈 문단을 제거해 카테고리 사이가 붙는 사례가 확인됐다. 선택 범위를 화면 밖
   * staging에 잠시 붙여 실제 계산 스타일을 인라인화한 뒤, HTML과 RTF(\par)를 명시적으로
   * 넣으면 한글이 어느 형식을 택해도 굵게·밑줄·기울임·빈 문단을 해석할 수 있다.
   */
  useEffect(() => {
    const copySelectionForHancom = (event: globalThis.ClipboardEvent) => {
      // `tryOfficeCompatibleCopy()`가 만든 내부 선택은 기본 브라우저 경로를 보존한다.
      if (document.documentElement.hasAttribute("data-report-office-copy")) return;
      const root = documentContainerRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return;

      const html = fragmentToClipboardHtml(range.cloneContents());
      if (!html.replace(/<[^>]+>|&nbsp;|\s/g, "")) return;
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      event.preventDefault();
      clipboard.setData("text/html", html);
      clipboard.setData("text/rtf", htmlToRtf(html));
      clipboard.setData("text/plain", htmlToPlainText(html));
    };
    document.addEventListener("copy", copySelectionForHancom, true);
    return () => document.removeEventListener("copy", copySelectionForHancom, true);
  }, []);

  function scrollToSection(numeral: string) {
    sectionElementsRef.current.get(numeral)?.scrollIntoView({ behavior: "smooth", block: "start" });
    onActiveSectionChange(numeral); // 즉시 하이라이트(낙관적) — 스크롤이 끝나면 옵저버가 재확인
  }

  /** 목차 소제목 클릭 — 그 소제목에 대응하는 heading 블록(id로 표시해둔)으로 바로 스크롤한다.
   * id를 못 찾았으면(예전 초안 등) 섹션 맨 위로라도 이동한다. */
  function scrollToSubitem(numeral: string, headingBlockId: string | null) {
    const target = headingBlockId ? document.getElementById(headingBlockId) : null;
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    else sectionElementsRef.current.get(numeral)?.scrollIntoView({ behavior: "smooth", block: "start" });
    onActiveSectionChange(numeral);
  }

  function updateBlock(numeral: string, blockId: string, next: ReportBlock) {
    checkpoint();
    setSections((previous) =>
      previous.map((section) =>
        section.numeral !== numeral
          ? section
          : { ...section, blocks: section.blocks.map((block) => (block.id === blockId ? next : block)) },
      ),
    );
  }

  const selectedBlock = selectedBlockRef
    ? sections.find((section) => section.numeral === selectedBlockRef.numeral)?.blocks.find((block) => block.id === selectedBlockRef.id) ?? null
    : null;

  // 중요: 사용자가 본문을 직접 드래그해 복사할 때는 브라우저 기본 복사 경로를 그대로 쓴다.
  // Chromium/Safari가 실제 선택 DOM을 macOS의 네이티브 HTML 클립보드 형식으로 직렬화한다.
  // 이전처럼 copy 이벤트를 가로채 `preventDefault()`로 커스텀 문자열을 넣으면 한글이 이를
  // 일반 텍스트로 취급해 bold/underline/italic/color가 사라졌다. 버튼 복사만
  // `writeRichClipboard()`의 별도 Office 호환 경로를 사용한다.

  async function copyActiveSection() {
    const el = sectionElementsRef.current.get(activeSection);
    if (!el) return;
    await writeRichClipboard(elementToClipboardHtml(el));
  }

  async function downloadActiveSectionZip() {
    const el = sectionElementsRef.current.get(activeSection);
    if (!el) return;
    const label = sections.find((s) => s.numeral === activeSection)?.title ?? "섹션";
    await downloadSectionExportsAsZip(el, `${label}_차트.zip`);
  }

  if (!reportData || sections.length === 0) {
    const isLoading = workspaceStatus === "loading";
    const isError = workspaceStatus === "error";
    return (
      <div className="mx-auto max-w-4xl p-8">
        <div className="mb-8 bg-white px-7 py-9 shadow-[0_5px_24px_rgba(15,23,42,.13)] sm:px-10 sm:py-12">
          <SectionBanner numeral="I" title="개요" />
          {isLoading ? (
            <p className="text-base text-zinc-600">저장된 정량·정성 분석 결과와 보고서 블록을 불러오는 중입니다.</p>
          ) : isError ? (
            <div className="space-y-3">
              <p className="text-base font-semibold text-[#a64d32]">보고서 내용을 불러오지 못했습니다.</p>
              <p className="text-sm leading-6 text-zinc-600">{workspaceError || "저장된 분석 결과를 확인한 뒤 다시 시도해주세요."}</p>
              <button type="button" onClick={onRetry} className="rounded border border-[#315c9c] px-3 py-2 text-sm font-semibold text-[#315c9c] hover:bg-[#edf3fc]">다시 불러오기</button>
            </div>
          ) : (
            <p className="text-base text-zinc-600">실제 보고서를 생성하면 raw data 정량 결과와 보고서 본문이 이 화면에 섹션별로 표시됩니다.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    // minmax(0,1fr) 대신 minmax(520px,1fr)를 쓴다 — 0 바닥이면 사이드 패널(특히 분석 근거
    // 430px)을 다 펼친 채로 화면 폭이 1300px 미만(흔한 노트북 해상도)이면 본문 열이 거의
    // 0으로 짜부라져 한글이 한 글자씩 세로로 줄바꿈되는(사실상 전체 문서가 깨져 보이는) 실측
    // 버그가 있었다(2026-08-12). 본문은 최소 520px을 보장하고, 그래도 안 맞으면(화면이 아주
    // 좁으면) 그리드 전체를 가로 스크롤하게 한다 — 글자가 세로로 뭉개지는 것보다 훨씬 낫다.
    <div className={`mx-auto grid max-w-[2200px] gap-5 overflow-x-auto px-4 py-8 lg:px-7 ${quotePanelOpen ? "lg:grid-cols-[250px_430px_minmax(520px,1fr)_320px]" : "lg:grid-cols-[250px_52px_minmax(520px,1fr)_320px]"}`}>
      <TableOfContents sections={sections} activeSection={activeSection} onSelect={scrollToSection} onSelectSubitem={scrollToSubitem} />
      {!quotePanelOpen && (
        <button type="button" onClick={() => setQuotePanelOpen(true)} className="h-fit rounded-lg border border-[#c9daf2] bg-white px-2 py-4 text-xs font-bold text-[#315c9c] shadow-sm lg:sticky lg:top-28" style={{ writingMode: "vertical-rl" }}>분석 근거</button>
      )}
      {quotePanelOpen && (
        <aside className="h-fit rounded-xl border border-[#c9daf2] bg-white shadow-sm lg:sticky lg:top-36 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto">
          <div className="flex items-start justify-between border-b border-[#e3e8ef] px-4 py-3">
            <div><p className="text-xs font-semibold text-[#356df3]">분석 근거</p><p className="mt-1 text-sm font-bold text-[#263449]">{analysisReference ? "종합 해석의 참고 근거" : "인용문과 원문 대조"}</p></div>
            <button type="button" onClick={() => setQuotePanelOpen(false)} className="rounded px-2 py-1 text-lg text-[#8a94a3] hover:bg-[#f2f5f9]" aria-label="원문 패널 접기">×</button>
          </div>
          <div className="p-4">
            {analysisReference && !quoteSource && quoteSourceStatus === "idle" && (
              <section key={analysisReference.title} className="quote-context-updated rounded-xl border border-[#c9daf2] bg-[#f5f9ff] p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#1473e6]"><span className="h-1.5 w-1.5 rounded-full bg-[#1473e6]" />현재 보고 있는 분석</p>
                <p className="mt-1.5 text-[18px] font-bold leading-6 tracking-[-0.035em] text-[#1f3554]">{analysisReference.title}</p>
                <p className="mt-2 inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#315c9c]">{analysisReference.kind}</p>
                <div className="mt-4 border-t border-[#d9e6f7] pt-3"><p className="text-sm font-bold text-[#354158]">이 내용이 생성된 근거</p><ul className="mt-2 space-y-2">{analysisReference.bullets.map((bullet) => <li key={bullet} className="flex gap-2 text-xs leading-5 text-[#53627a]"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#5c83bc]" />{bullet}</li>)}</ul><p className="mt-3 rounded-lg bg-white p-2.5 text-[11px] leading-5 text-[#7a8799]">직접 인용문이 아니라 위 정량·정성 근거를 종합해 생성된 내용입니다.</p></div>
                {analysisReference.kind === "제언" && sourceFileUrl && (
                  <div className="mt-3 border-t border-[#d9e6f7] pt-3">
                    <p className="text-xs font-bold text-[#354158]">제언 AI 작업</p>
                    <p className="mt-1 text-[11px] leading-5 text-[#7a8799]">현재 정량·정성 근거는 유지하고 제언 초안만 다시 생성합니다. 생성 후 본문에서 직접 수정할 수 있습니다.</p>
                    <button type="button" onClick={() => void regenerateRecommendation()} disabled={recommendationStatus === "loading"} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#1473e6] px-3 py-2.5 text-xs font-bold text-white hover:bg-[#0f65cf] disabled:cursor-wait disabled:opacity-70">
                      {recommendationStatus === "loading" && <span className="inline-block size-3 animate-spin rounded-full border-2 border-white/45 border-t-white" />}
                      {recommendationStatus === "loading" ? "근거를 바탕으로 다시 생성 중" : "AI로 제언 다시 생성"}
                    </button>
                    {recommendationStatus === "error" && <div className="mt-2 rounded-md bg-[#fff3f1] p-2 text-[11px] leading-5 text-[#b54747]">{recommendationError}<button type="button" onClick={() => void regenerateRecommendation()} className="ml-1 font-bold underline">다시 시도</button></div>}
                  </div>
                )}
              </section>
            )}
            {!analysisReference && !quoteSource && quoteSourceStatus === "idle" && <section className="rounded-xl border border-[#e3e8ef] bg-[#f8fafc] p-4"><p className="text-sm font-bold text-[#53627a]">현재 영역의 분석 근거</p><p className="mt-2 text-xs leading-5 text-[#7a8799]">이 영역에는 직접 인용문이나 별도의 생성 해석이 없습니다. 결과 표·그래프 자체를 확인하는 구간입니다.</p></section>}
            {!analysisReference && <>
            {quoteSourceStatus === "loading" && <p className="text-sm text-[#748196]">원문을 찾고 있습니다...</p>}
            {quoteSourceStatus === "error" && <p className="text-sm leading-6 text-[#b54747]">원본 응답에서 인용문을 찾지 못했습니다.</p>}
            {quoteSource && quoteSourceStatus === "idle" && (
              <>
                <section key={`${quoteSource.groupLabel}-${quoteSource.questionLabel}`} className="quote-context-updated rounded-xl border border-[#c9daf2] bg-[#f5f9ff] p-3.5">
                  <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#1473e6]"><span className="h-1.5 w-1.5 rounded-full bg-[#1473e6]" />현재 보고 있는 분석</p>
                  <p className="mt-1.5 text-[18px] font-bold leading-6 tracking-[-0.035em] text-[#1f3554]">{quoteSource.groupLabel}</p>
                  <div className="mt-3 border-t border-[#d9e6f7] pt-2.5"><p className="text-[11px] font-bold text-[#66758b]">대상 문항</p><p className="mt-1 text-[15px] font-semibold leading-6 tracking-[-0.025em] text-[#315c9c]">{quoteSource.questionLabel}</p></div>
                </section>
                <p className="mt-4 text-[11px] leading-5 text-[#7a8799]">사용된 인용문 {quoteSource.sources.reduce((count, source) => count + source.matches.length, 0)}건 · 원문 응답 {quoteSource.sources.length}건입니다. 확인할 응답만 펼쳐보세요.</p>
                <div className="mt-3 space-y-3">
                  {quoteSource.sources.map((source, sourceIndex) => (
                    <div key={`${source.sectionLabel}-${source.respondentId}-${source.originalResponse}`}>
                    {source.sectionLabel && source.sectionLabel !== quoteSource.sources[sourceIndex - 1]?.sectionLabel && <div className={`mb-2 mt-4 rounded-md px-3 py-2 text-sm font-bold ${source.sectionLabel.includes("부정") ? "bg-[#fff0e5] text-[#a64d32]" : source.sectionLabel.includes("중립") ? "bg-[#eef0f3] text-[#596273]" : "bg-[#eaf3ff] text-[#315c9c]"}`}>{source.sectionLabel}</div>}
                    <details open className="group rounded-lg border border-[#e3e8ef] bg-[#f7f9fc]">
                      <summary className="cursor-pointer list-none p-3 [&::-webkit-details-marker]:hidden"><p className="text-xs font-bold text-[#315c9c]">{source.questionLabel ? `${source.questionLabel} · ` : ""}응답자 {source.respondentId}번 <span className="ml-1 font-medium text-[#7a8799]">인용 {source.matches.length}건</span></p><p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[#53627a]"><QuoteWithEndingReview quote={source.matches[0]?.quote ?? ""} needsReview={source.matches[0]?.needsReview ?? false} /></p><p className="mt-2 text-[11px] font-semibold text-[#315c9c] group-open:hidden">원문 펼쳐 보기</p><p className="mt-2 hidden text-[11px] font-semibold text-[#315c9c] group-open:block">원문 접기</p></summary>
                      <div className="border-t border-[#e3e8ef] p-3">
                        <div className="space-y-2">
                          {source.matches.map((match) => (
                            <div key={match.quote} className="rounded-md border border-[#dbe3ee] bg-white p-2.5">
                              <p className="text-[10px] font-bold text-[#748196]">보고서 인용문</p>
                              <p className="mt-1 text-xs leading-5 text-[#354158]"><QuoteWithEndingReview quote={match.quote} needsReview={match.needsReview} /></p>
                              {match.needsReview && quoteCompletionTarget?.quote !== match.quote && <button type="button" onClick={() => void generateQuoteCompletion({ quote: match.quote, originalResponse: source.originalResponse })} className="mt-2 rounded-md border border-[#efc1bc] bg-[#fff7f6] px-2.5 py-1.5 text-xs font-bold text-[#b54747] hover:bg-[#fff0ee]">문장 끝맺음 자동 수정</button>}
                              {quoteCompletionTarget?.quote === match.quote && quoteCompletionStatus === "loading" && <div className="mt-2 flex items-center gap-2 rounded-md border border-[#efc1bc] bg-[#fff7f6] px-2.5 py-2 text-xs font-semibold text-[#a64d32]"><span className="inline-block size-3 animate-spin rounded-full border-2 border-[#e7aaa4] border-t-[#b54747]" />문장 끝맺음을 확인하고 있습니다.</div>}
                              {quoteCompletionTarget?.quote === match.quote && quoteCompletionStatus === "error" && <div className="mt-2 rounded bg-[#fff5f3] p-2 text-xs leading-5 text-[#b54747]">보완안을 만들지 못했습니다. 본문의 인용문은 그대로 유지되며 직접 수정할 수 있습니다.<button type="button" onClick={() => void generateQuoteCompletion({ quote: match.quote, originalResponse: source.originalResponse })} className="ml-1 font-bold underline">다시 시도</button></div>}
                              {quoteCompletionTarget?.quote === match.quote && quoteCompletion && <div className="mt-2 rounded-md border border-[#cfe0f5] bg-[#f7faff] p-2"><p className="text-[10px] font-bold text-[#356df3]">보완안 · 끝어미만 변경</p><p className="mt-1 text-xs leading-5 text-[#354158]">{quoteCompletion.completedQuote.slice(0, quoteCompletion.completedQuote.length - quoteCompletion.changedTo.length)}<mark className="rounded bg-[#cfe8ff] text-[#174e91]">{quoteCompletion.changedTo}</mark></p><div className="mt-2 flex gap-2"><button type="button" onClick={() => { setQuoteCompletionTarget(null); setQuoteCompletion(null); setQuoteCompletionStatus("idle"); }} className="flex-1 rounded border border-[#ccd5e0] px-2 py-1.5 text-[11px] font-semibold text-[#667085]">유지</button><button type="button" onClick={applyQuoteCompletion} className="flex-1 rounded bg-[#1473e6] px-2 py-1.5 text-[11px] font-semibold text-white">적용</button></div></div>}
                            </div>
                          ))}
                        </div>
                        <p className="mb-1 mt-3 text-[10px] font-bold text-[#748196]">응답 원문</p>
                        <p className="whitespace-pre-wrap text-sm leading-7 text-[#354158]"><HighlightedOriginal text={source.originalResponse} matches={source.matches} /></p>
                      </div>
                    </details>
                    </div>
                  ))}
                </div>
              </>
            )}
            </>}
          </div>
        </aside>
      )}
      <article ref={documentContainerRef} className="flex min-w-0 flex-col items-start gap-10">
        {sections.map((section) => (
          <section
            key={section.numeral}
            id={`section-${section.numeral}`}
            ref={(el) => {
              if (el) sectionElementsRef.current.set(section.numeral, el);
              else sectionElementsRef.current.delete(section.numeral);
            }}
            data-section-page={section.numeral}
            // scroll-mt-24: 목차 클릭 시 studio 헤더(sticky)에 섹션 상단이 가려지지 않게.
            // max-w-[794px]: A4 폭 비율 — "실제 문서 크기처럼" 요청에 맞춘 페이지 카드 크기.
            className="w-full max-w-[860px] scroll-mt-36 border border-[#dfe3e9] bg-white px-7 py-9 shadow-[0_12px_34px_rgba(28,39,55,.11)] sm:px-12 sm:py-12"
          >
            <SectionBanner numeral={section.numeral} title={section.title} />
            {section.blocks.map((block) => (
              <div
                key={block.id}
                data-report-block-id={block.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedBlockRef({ numeral: section.numeral, id: block.id })}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedBlockRef({ numeral: section.numeral, id: block.id }); }}
                className={`rounded transition-shadow ${selectedBlockRef?.numeral === section.numeral && selectedBlockRef.id === block.id ? "ring-2 ring-[#4fc8e8] ring-offset-2" : "hover:ring-1 hover:ring-[#c9d8ef]"}`}
              >
                <BlockView block={block} sourceFileUrl={sourceFileUrl} onQuoteSource={(questionKey, quotes, groupLabel) => void openQuoteSource([{ questionKey, quotes }], groupLabel)} onChange={(next) => updateBlock(section.numeral, block.id, next)} />
              </div>
            ))}
          </section>
        ))}
      </article>
      <ActionPanel
        activeTitle={sections.find((section) => section.numeral === activeSection)?.title ?? "보고서 편집"}
        onCopy={() => void copyActiveSection()}
        onDownload={() => void downloadActiveSectionZip()}
        onOpenCorrections={() => setCorrectionsPanelOpen(true)}
        selectedBlock={selectedBlock}
        onBlockChange={(next) => {
          if (selectedBlockRef) updateBlock(selectedBlockRef.numeral, selectedBlockRef.id, next);
        }}
      />
      <QuoteCorrectionPanel
        open={correctionsPanelOpen}
        onClose={() => setCorrectionsPanelOpen(false)}
        sections={sections}
        sourceFileUrl={sourceFileUrl ?? null}
        onApply={applyBatchCorrections}
      />
    </div>
  );
}
