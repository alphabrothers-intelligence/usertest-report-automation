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
import { useEffect, useMemo, useRef, useState, type Dispatch, type FocusEvent, type SetStateAction } from "react";
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
import { elementToClipboardHtml } from "@/lib/report/domClipboard";
import { downloadSectionExportsAsZip, downloadSvgAsPng } from "@/lib/report/exportImage";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";
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
    if (editor.innerHTML !== block.html) editor.innerHTML = block.html;
  }, [block.html]);

  function save() {
    const html = editorRef.current?.innerHTML;
    if (html && html !== block.html) onChange({ ...block, html });
  }

  async function generateSummary() {
    if (!sourceFileUrl || !block.summaryQuestionKey || summaryStatus === "loading") return;
    setSummaryStatus("loading");
    setSummaryError(null);
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
      setSummaryStatus("idle");
    } catch (error) {
      setSummaryStatus("error");
      setSummaryError(error instanceof Error ? error.message : "AI 요약 생성에 실패했습니다.");
    }
  }

  async function downloadEmbeddedChart(index: number) {
    const svg = editorRef.current?.querySelectorAll<SVGSVGElement>("svg")[index];
    if (!svg) return;
    await downloadSvgAsPng(svg, `${block.id}-그래프-${index + 1}.png`);
  }

  const hasEmbeddedCharts = /<svg[\s>]/i.test(block.html);

  return (
    <div className="mb-5 mt-3">
      {/* 이 블록은 표뿐 아니라 도넛차트+표 조합(Ⅲ/Ⅴ장 감정 분석)에도 쓰이므로 "표의 셀"이라는
         문구는 안 맞았다 — 일반화된 문구로 바꾸고, 바로 위 블록(제목 등)과 붙어 보이지 않게
         위쪽 여백을 줬다(2026-07-28 실측: 안내문이 위 헤딩에 달라붙어 보인다는 지적). */}
      <p data-copy-ignore className="mb-2 text-xs text-[#70675e]">클릭하면 바로 내용을 수정할 수 있습니다.</p>
      <div data-copy-ignore className="mb-2 flex flex-wrap items-center gap-2">
        {hasEmbeddedCharts && Array.from({ length: (block.html.match(/<svg[\s>]/gi) ?? []).length }).map((_, index) => (
          <button key={index} type="button" onClick={() => void downloadEmbeddedChart(index)} className="rounded border border-[#315c9c] px-2.5 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc]">
            그래프 {index + 1} PNG 다운로드
          </button>
        ))}
        {sourceFileUrl && block.summaryQuestionKey && (
          <button type="button" disabled={summaryStatus === "loading"} onClick={() => void generateSummary()} className="rounded border border-[#315c9c] px-2.5 py-1 text-xs font-semibold text-[#315c9c] hover:bg-[#edf3fc] disabled:cursor-wait disabled:opacity-60">
            {summaryStatus === "loading" ? "AI 요약 생성 중…" : "AI 요약 생성"}
          </button>
        )}
      </div>
      {summaryError && <p data-copy-ignore className="mb-2 text-xs text-[#a64d32]">{summaryError}</p>}
      <div
        ref={editorRef}
        className="report-rich-static rounded outline-none focus-within:ring-2 focus-within:ring-[#4fc8e8] focus-within:ring-offset-2"
        contentEditable
        suppressContentEditableWarning
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
  return (
    <aside className="h-fit rounded-xl border border-[#d7dce8] bg-white p-4 shadow-sm lg:sticky lg:top-24">
      <p className="mb-3 text-base font-bold text-[#315c9c]">목차</p>
      <nav className="space-y-1">
        {sections.map((section) => {
          const planSection = plan.find((p) => p.numeral === section.numeral);
          const active = section.numeral === activeSection;
          // 참고 이미지(FGI Transcript Studio)의 "선행 필요" 태그 패턴을 차용 — 이 섹션에 아직
          // 채워지지 않은 정성 블록이 있으면 목차에도 상태를 알려준다. 새 색상을 만들지 않고
          // BlockView의 pending 배지 팔레트(#f7e9e2/#a64d32)를 그대로 재사용해 "이 색 = 정성
          // 분석 대기"라는 의미를 목차·본문에서 일관되게 유지한다(2026-07-26).
          const hasPending = section.blocks.some((block) => block.kind === "text" && block.pending);
          return (
            <div key={section.numeral} className={`rounded-lg transition ${active ? "bg-[#315c9c]" : ""}`}>
              <button
                type="button"
                onClick={() => onSelect(section.numeral)}
                className={`block w-full rounded-lg px-3 pt-2 text-left ${active ? "text-white" : "hover:bg-[#edf3fc]"}`}
              >
                <span className="flex items-center gap-1.5">
                  <span className={`text-base font-bold ${active ? "text-white" : "text-[#1d5e9e]"}`}>
                    {section.numeral}. {section.title}
                  </span>
                  {hasPending && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        active ? "bg-white/20 text-white" : "bg-[#f7e9e2] text-[#a64d32]"
                      }`}
                    >
                      정성 대기
                    </span>
                  )}
                </span>
              </button>
              <div className="px-3 pb-2">
                {planSection?.subitems.map((item) => {
                  const headingBlock = section.blocks.find(
                    (block) => block.kind === "heading" && (block.variant === "numbered" || block.variant === "subheading") && block.text === item,
                  );
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onSelectSubitem(section.numeral, headingBlock?.id ?? null)}
                      className={`mt-1 block w-full rounded px-2 py-1 text-left text-sm leading-4 ${
                        active ? "text-[#dbe6f7] hover:bg-white/10" : "text-zinc-600 hover:bg-[#edf3fc]"
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
function ActionPanel({ onCopy, onDownload, selectedBlock, onBlockChange }: { onCopy: () => void; onDownload: () => void; selectedBlock: ReportBlock | null; onBlockChange: (next: ReportBlock) => void }) {
  return (
    <aside className="h-fit rounded-xl border border-[#d7dce8] bg-white shadow-sm lg:sticky lg:top-24">
      {/* 헤더를 옅은 배경 밴드로 구분해 목차/본문 밴드와 톤을 맞췄다(2026-07-26, 기능 변경
          없음 — 참고 이미지의 카드형 우측 패널에서 헤더 구획감을 참고했다). */}
      <p className="rounded-t-xl border-b border-[#d7dce8] bg-[#f7f9fc] px-4 py-2.5 text-sm font-bold text-[#315c9c]">
        현재 보고 있는 섹션
      </p>
      {/* 본문 텍스트를 클릭해 커서를 두면(또는 일부 선택하면) 여기 버튼으로 서식을 적용한다
          (2026-07-28 — 문단마다 있던 개별 도구모음을 없앤 대신 이 패널로 모았다). */}
      <div className="space-y-2 border-b border-[#d7dce8] p-4">
        <p className="text-sm font-bold text-[#315c9c]">텍스트 서식</p>
        <p className="text-xs text-[#70675e]">본문에서 서식을 넣을 위치를 클릭(또는 드래그로 선택)한 뒤 눌러주세요.</p>
        <div className="flex flex-wrap gap-1.5">
          <FormatButton label="굵게" title="굵게" onApply={() => applyTextFormat("bold")} className="font-bold" />
          <FormatButton label="기울임" title="기울임" onApply={() => applyTextFormat("italic")} className="italic" />
          <FormatButton label="밑줄" title="밑줄" onApply={() => applyTextFormat("underline")} className="underline" />
          <FormatButton label="제언 화살표" title="→ 제언 문단 추가" onApply={insertArrowLine} />
        </div>
      </div>
      <div className="space-y-2 p-4">
      <button
        type="button"
        onClick={onCopy}
        className="block w-full rounded border border-[#315c9c] px-3 py-2 text-left text-sm font-semibold text-[#315c9c] hover:bg-[#edf3fc]"
      >
        내용 전체 복사하기
      </button>
      <button
        type="button"
        onClick={onDownload}
        className="block w-full rounded border border-[#315c9c] px-3 py-2 text-left text-sm font-semibold text-[#315c9c] hover:bg-[#edf3fc]"
      >
        현재 섹션 차트 이미지 저장
      </button>
      </div>
      <div className="border-t border-[#d7dce8] p-4">
        <p className="mb-3 text-sm font-bold text-[#315c9c]">선택 요소 편집</p>
        <ReportPropertyPanel block={selectedBlock} onChange={onBlockChange} />
      </div>
    </aside>
  );
}

function BlockView({
  block,
  onChange,
  sourceFileUrl,
}: {
  block: ReportBlock;
  onChange: (next: ReportBlock) => void;
  sourceFileUrl?: string | null;
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
      />
    </div>
  );
}

export function ReportWebDocument({ sections, setSections, checkpoint, reportData, activeSection, onActiveSectionChange, workspaceStatus, workspaceError, onRetry, sourceFileUrl }: Props) {
  const documentContainerRef = useRef<HTMLDivElement>(null);
  const sectionElementsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [selectedBlockRef, setSelectedBlockRef] = useState<{ numeral: string; id: string } | null>(null);

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
    <div className="mx-auto grid max-w-[1720px] gap-6 px-4 py-7 lg:grid-cols-[270px_minmax(0,1fr)_310px] lg:px-7">
      <TableOfContents sections={sections} activeSection={activeSection} onSelect={scrollToSection} onSelectSubitem={scrollToSubitem} />
      <article ref={documentContainerRef} className="flex min-w-0 flex-col items-center gap-10">
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
            className="w-full max-w-[794px] scroll-mt-24 bg-white px-7 py-9 shadow-[0_5px_24px_rgba(15,23,42,.13)] sm:px-10 sm:py-12"
          >
            <SectionBanner numeral={section.numeral} title={section.title} />
            {section.blocks.map((block) => (
              <div
                key={block.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedBlockRef({ numeral: section.numeral, id: block.id })}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedBlockRef({ numeral: section.numeral, id: block.id }); }}
                className={`rounded transition-shadow ${selectedBlockRef?.numeral === section.numeral && selectedBlockRef.id === block.id ? "ring-2 ring-[#4fc8e8] ring-offset-2" : "hover:ring-1 hover:ring-[#c9d8ef]"}`}
              >
                <BlockView block={block} sourceFileUrl={sourceFileUrl} onChange={(next) => updateBlock(section.numeral, block.id, next)} />
              </div>
            ))}
          </section>
        ))}
      </article>
      <ActionPanel
        onCopy={() => void copyActiveSection()}
        onDownload={() => void downloadActiveSectionZip()}
        selectedBlock={selectedBlock}
        onBlockChange={(next) => {
          if (selectedBlockRef) updateBlock(selectedBlockRef.numeral, selectedBlockRef.id, next);
        }}
      />
    </div>
  );
}
