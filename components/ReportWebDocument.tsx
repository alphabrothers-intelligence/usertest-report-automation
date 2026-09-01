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
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { QuoteCorrectionPanel } from "@/components/QuoteCorrectionPanel";
import { ActionPanel, PageFooter, SectionBanner, TableOfContents } from "@/components/report-web-document/ReportDocumentChrome";
import { ReportBackCoverPage, ReportCoverPage, ReportTocPage } from "@/components/report-web-document/ReportFrontMatter";
import { AnalysisReferenceContent, QuoteSourceContent } from "@/components/report-web-document/EvidencePanelContent";
import { BlockView } from "@/components/report-web-document/ReportBlockView";
import { ReviewFlagNotice } from "@/components/report/ReviewFlagNotice";
import type { ReviewFlag } from "@/lib/quant/reviewFlags";
import { useReportClipboard } from "@/components/report-web-document/useReportClipboard";
import { useReportEvidence } from "@/components/report-web-document/useReportEvidence";
import { useReportExport } from "@/components/report-web-document/useReportExport";
import { useReportNavigation } from "@/components/report-web-document/useReportNavigation";
import type { ReportWorkspaceSeed } from "@/lib/report/workspace";
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";
import type { ProductInfo } from "@/lib/productInfo/types";

export { applyTextFormat, BlockView, FormatButton, insertArrowLine } from "@/components/report-web-document/ReportBlockView";

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
  /** 텍스트 서식·전체 복사·인용문 검토 버튼을 스튜디오 상단 고정 헤더(ReportStudio.tsx)에서
   * 그릴 수 있도록, 이 문서 컴포넌트 내부 핸들러를 위로 노출한다. */
  onToolbarActionsChange?: (actions: { copy: () => void; openCorrections: () => void }) => void;
  productInfo: ProductInfo;
  onProductInfoChange: (next: ProductInfo) => void;
  /** "한 번 더 봐주세요" 표시(lib/quant/reviewFlags.ts). 대상 도표 바로 위에 붙는다.
   * 예전에는 마법사의 정량 검토 화면에만 있었는데, 그 단계를 없애면서 여기로 옮겼다 —
   * 어차피 고치는 곳이 여기라 이유도 여기 있어야 한다(2026-08-31 담당자 확인). */
  reviewFlags?: ReviewFlag[];
};

/** row-group(항목/주요 의견 표)은 행마다 자식 블록을 품고 있어, id로 블록을 찾거나
 * 바꿔치기하려면 한 단계 더 내려가봐야 한다. */
function findBlockById(blocks: ReportBlock[], id: string): ReportBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block;
    if (block.kind === "row-group") {
      for (const row of block.rows) {
        const found = findBlockById(row.blocks, id);
        if (found) return found;
      }
    }
  }
  return null;
}

function replaceBlockById(blocks: ReportBlock[], id: string, next: ReportBlock): ReportBlock[] {
  return blocks.map((block) => {
    if (block.id === id) return next;
    if (block.kind === "row-group") return { ...block, rows: block.rows.map((row) => ({ ...row, blocks: replaceBlockById(row.blocks, id, next) })) };
    return block;
  });
}

export function ReportWebDocument({ sections, setSections, checkpoint, reportData, activeSection, onActiveSectionChange, workspaceStatus, workspaceError, onRetry, sourceFileUrl, onToolbarActionsChange, productInfo, onProductInfoChange, reviewFlags = [] }: Props) {
  const documentContainerRef = useRef<HTMLDivElement>(null);
  const [pageGroups, setPageGroups] = useState<Record<string, string[][]>>({});
  const [selectedBlockRef, setSelectedBlockRef] = useState<{ numeral: string; id: string } | null>(null);
  const [correctionsPanelOpen, setCorrectionsPanelOpen] = useState(false);
  const { sectionElementsRef, scrollToSection, scrollToSubitem } = useReportNavigation({
    activeSection,
    onActiveSectionChange,
    sectionCount: sections.length,
  });
  const { copyActiveSection } = useReportClipboard({
    activeSection,
    documentContainerRef,
    sectionElementsRef,
  });
  const { downloadActiveSectionZip } = useReportExport({
    activeSection,
    sections,
    sectionElementsRef,
  });
  const {
    analysisReference,
    applyBatchCorrections,
    applyQuoteCompletion,
    generateQuoteCompletion,
    openQuoteSource,
    quoteCompletion,
    quoteCompletionStatus,
    quoteCompletionTarget,
    quotePanelOpen,
    quoteSource,
    quoteSourceStatus,
    recommendationError,
    recommendationStatus,
    regenerateRecommendation,
    resetQuoteCompletion,
    setQuotePanelOpen,
  } = useReportEvidence({
    sections,
    setSections,
    checkpoint,
    sourceFileUrl,
    documentContainerRef,
    quantStats: reportData?.quantStats ?? null,
  });

  function updateBlock(numeral: string, blockId: string, next: ReportBlock) {
    checkpoint();
    setSections((previous) =>
      previous.map((section) =>
        section.numeral !== numeral ? section : { ...section, blocks: replaceBlockById(section.blocks, blockId, next) },
      ),
    );
  }

  const selectedBlock = selectedBlockRef
    ? findBlockById(sections.find((section) => section.numeral === selectedBlockRef.numeral)?.blocks ?? [], selectedBlockRef.id)
    : null;

  // 복사/인용검토 버튼을 스튜디오 상단 고정 헤더에서 그리려면, 이 컴포넌트 내부에서만
  // 만들 수 있는 핸들러(activeSection 클로저 포함)를 부모로 노출해야 한다.
  useEffect(() => {
    onToolbarActionsChange?.({ copy: () => void copyActiveSection(), openCorrections: () => setCorrectionsPanelOpen(true) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, onToolbarActionsChange]);

  // 화면과 인쇄가 같은 A4 본문 폭에서 줄바꿈되도록 실제 렌더 높이를 측정해 블록을 페이지로
  // 묶는다. 긴 단일 블록은 브라우저가 문단/표 행 경계에서 자연 분할하도록 단독 페이지에 둔다.
  useLayoutEffect(() => {
    const root = documentContainerRef.current;
    if (!root || sections.length === 0) return;
    const measure = () => {
    const pxPerMm = 96 / 25.4;
    // 297mm에서 쪽 안쪽 여백을 뺀 값 — 아래는 푸터(L15) 자리라 위(18mm)보다 넓다.
    // **본문 쪽 <section>의 pt-/pb- 클래스와 반드시 같이 고쳐야 한다.** 어긋나면 블록이
    // 한 쪽 분량을 넘겨 담기고, 브라우저가 그 <section>을 인쇄에서 다시 쪼개면서
    // 푸터가 다음 쪽으로 밀려난다(2026-08-25 실측).
    const pageContentHeight = (297 - 18 - 26) * pxPerMm;
    const next: Record<string, string[][]> = {};
    for (const section of sections) {
      const pages: string[][] = [];
      let current: string[] = [];
      // 첫 물리 페이지에는 장 제목 배너가 들어가므로 그 높이를 먼저 예약한다.
      let used = 110;
      for (const block of section.blocks) {
        const element = root.querySelector<HTMLElement>(`[data-report-block-id="${CSS.escape(block.id)}"]`);
        // 블록 사이 간격은 안쪽 요소의 margin-bottom인데, 그 여백은 테두리 없는 래퍼 밖으로
        // 상쇄돼(margin collapsing) getBoundingClientRect에 안 잡힌다. 고정 8px로 어림하던
        // 예전 코드는 블록마다 4~5mm씩 적게 세어 쪽이 넘쳤다 — 실제 값을 읽어 더한다.
        const inner = element?.firstElementChild;
        const gap = inner ? parseFloat(getComputedStyle(inner).marginBottom) || 0 : 0;
        const height = element ? Math.ceil(element.getBoundingClientRect().height + Math.max(gap, 8)) : 0;
        if (current.length > 0 && used + height > pageContentHeight) {
          pages.push(current);
          current = [];
          used = 0;
        }
        current.push(block.id);
        used += height;
      }
      if (current.length > 0) pages.push(current);
      next[section.numeral] = pages.length > 0 ? pages : [section.blocks.map((block) => block.id)];
    }
    setPageGroups((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    // 계산 결과를 sections에 다시 기록하면 sections 변경 → 재측정 → setSections가 반복되는
    // 순환이 생긴다. 목차는 pageGroups에서 직접 쪽수를 계산하므로 측정 상태만 갱신한다.
    };
    measure();
    // 이미지 첨부 슬롯·차트는 첫 레이아웃 뒤에 자리를 잡아 블록 높이가 나중에 커진다. 최초
    // 1회만 재던 예전 코드는 그때의 작은 높이로 쪽을 묶어, 실제로는 322mm짜리 <section>이
    // 만들어지고 인쇄에서 브라우저가 그 쪽을 다시 쪼개 푸터가 다음 쪽으로 밀렸다
    // (2026-08-25 실측). 높이가 바뀌면 다시 묶는다 — 값이 같으면 위 JSON 비교에서 멈춘다.
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [sections]);

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

  // 푸터 쪽번호는 표지(1)·목차(2) 다음부터 이어져야 하므로, 장 경계와 무관한 통짜 목록으로 편다.
  const bodyPages = sections.flatMap((section) => {
    const groups = pageGroups[section.numeral] ?? [section.blocks.map((block) => block.id)];
    return groups.map((blockIds, pageIndex) => ({ section, blockIds, pageIndex }));
  });
  const footerBrand = productInfo.footerBrandName?.trim() || "Alphabrothers";
  const footerYear = productInfo.coverDate?.trim().match(/\d{4}/)?.[0] || String(new Date().getFullYear());

  return (
    // minmax(0,1fr) 대신 minmax(520px,1fr)를 쓴다 — 0 바닥이면 사이드 패널(특히 분석 근거
    // 430px)을 다 펼친 채로 화면 폭이 1300px 미만(흔한 노트북 해상도)이면 본문 열이 거의
    // 0으로 짜부라져 한글이 한 글자씩 세로로 줄바꿈되는(사실상 전체 문서가 깨져 보이는) 실측
    // 버그가 있었다(2026-08-12). 본문은 최소 520px을 보장하고, 화면이 그보다 좁으면 그리드가
    // 뷰포트보다 넓어지는데 — 이 div에 `overflow-x-auto`를 직접 주지 않는다. CSS 스펙상
    // overflow-x가 visible이 아니면 overflow-y도 강제로 auto로 계산되는데, 그러면 페이지
    // 전체 높이만큼(23000px+) 있는 이 div가 스스로 "스크롤 컨테이너"가 되어버려 (a) 안의
    // TableOfContents/ActionPanel의 position:sticky가 window가 아니라 이 컨테이너 기준으로
    // 계산되면서 전혀 안 붙어 있게 되고 (b) 마우스 휠 스크롤 자체가 죽어버리는(스크롤이 전혀
    // 안 되는) 실측 버그가 있었다(2026-08-12, Chrome DevTools Protocol로 synthetic wheel
    // 이벤트를 직접 쏴서 scrollY가 전혀 안 움직이는 것까지 재현 확인). overflow-x-auto 없이
    // 그냥 두면 grid가 body보다 넓어졌을 때 브라우저가 기본으로 페이지 자체를 가로 스크롤
    // 가능하게 만들어준다 — 별도 overflow 지정이 필요 없다.
    // 왼쪽 "분석 근거" 탭(펼쳤을 때 430px)이 본문보다 과하게 넓다는 지적(2026-08-12)으로
    // 320px로, 우측 패널은 텍스트 서식·복사·인용검토를 스튜디오 상단 고정 헤더로 옮기며 남는
    // 항목이 줄어 320px→260px로 줄였다. 본문 최소폭도 520px→560px로 올려 그만큼 더 넓게 보이게 한다.
    <div className={`mx-auto grid max-w-[2020px] gap-5 px-4 py-8 lg:px-7 ${quotePanelOpen ? "lg:grid-cols-[250px_320px_minmax(560px,1fr)_260px]" : "lg:grid-cols-[250px_52px_minmax(560px,1fr)_260px]"}`}>
      <TableOfContents sections={sections} activeSection={activeSection} onSelect={scrollToSection} onSelectSubitem={scrollToSubitem} />
      {!quotePanelOpen && (
        <button type="button" onClick={() => setQuotePanelOpen(true)} className="h-fit rounded-lg border border-[#c9daf2] bg-white px-2 py-4 text-xs font-bold text-[#315c9c] shadow-sm lg:sticky lg:top-28" style={{ writingMode: "vertical-rl" }}>분석 근거</button>
      )}
      {quotePanelOpen && (
        <aside className="h-fit rounded-xl border border-[#c9daf2] bg-white shadow-sm lg:sticky lg:top-36 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto">
          <div className="flex items-start justify-between border-b border-[#e3e8ef] px-4 py-3">
            <div><p className="text-xs font-semibold text-[#356df3]">분석 근거</p><p className="mt-1 text-sm font-bold text-[#263449]">{analysisReference?.kind === "정량 계산" ? "도표의 계산 근거" : analysisReference ? "종합 해석의 참고 근거" : "인용문과 원문 대조"}</p></div>
            <button type="button" onClick={() => setQuotePanelOpen(false)} className="rounded px-2 py-1 text-lg text-[#8a94a3] hover:bg-[#f2f5f9]" aria-label="원문 패널 접기">×</button>
          </div>
          <div className="p-4">
            {analysisReference && !quoteSource && quoteSourceStatus === "idle" && (
              <AnalysisReferenceContent
                reference={analysisReference}
                sourceFileUrl={sourceFileUrl}
                recommendationStatus={recommendationStatus}
                recommendationError={recommendationError}
                onRegenerate={() => void regenerateRecommendation()}
              />
            )}
            {!analysisReference && !quoteSource && quoteSourceStatus === "idle" && <section className="rounded-xl border border-[#e3e8ef] bg-[#f8fafc] p-4"><p className="text-sm font-bold text-[#53627a]">현재 영역의 분석 근거</p><p className="mt-2 text-xs leading-5 text-[#7a8799]">이 영역에는 직접 인용문이나 별도의 생성 해석이 없습니다. 결과 표·그래프 자체를 확인하는 구간입니다.</p></section>}
            {!analysisReference && <>
            {quoteSourceStatus === "loading" && <p className="text-sm text-[#748196]">원문을 찾고 있습니다...</p>}
            {quoteSourceStatus === "error" && <p className="text-sm leading-6 text-[#b54747]">원본 응답에서 인용문을 찾지 못했습니다.</p>}
            {quoteSource && quoteSourceStatus === "idle" && (
              <QuoteSourceContent
                quoteSource={quoteSource}
                quoteCompletionTarget={quoteCompletionTarget}
                quoteCompletionStatus={quoteCompletionStatus}
                quoteCompletion={quoteCompletion}
                onGenerateCompletion={(target) => void generateQuoteCompletion(target)}
                onResetCompletion={resetQuoteCompletion}
                onApplyCompletion={applyQuoteCompletion}
              />
            )}
            </>}
          </div>
        </aside>
      )}
      <article ref={documentContainerRef} className="flex min-w-[210mm] flex-col items-start gap-10">
        <ReportCoverPage productInfo={productInfo} onChange={(next) => { checkpoint(); onProductInfoChange(next); }} />
        <ReportTocPage sections={sections} pageGroups={pageGroups} onSectionsChange={(next) => { checkpoint(); setSections(next); }} />
        {bodyPages.map(({ section, blockIds, pageIndex }, bodyIndex) => (
          <section
            key={`${section.numeral}-${pageIndex}`}
            id={pageIndex === 0 ? `section-${section.numeral}` : undefined}
            ref={(el) => {
              if (pageIndex !== 0) return;
              if (el) sectionElementsRef.current.set(section.numeral, el);
              else sectionElementsRef.current.delete(section.numeral);
            }}
            data-section-page={section.numeral}
            data-a4-page
            className="relative box-border h-auto min-h-[297mm] w-[210mm] scroll-mt-36 overflow-visible border border-[#dfe3e9] bg-white px-[18mm] pb-[26mm] pt-[18mm] shadow-[0_12px_34px_rgba(28,39,55,.11)]"
          >
            {pageIndex === 0 ? <SectionBanner numeral={section.numeral} title={section.title} /> : null}
            {section.blocks.filter((block) => blockIds.includes(block.id)).map((block) => (
              <div
                key={block.id}
                data-report-block-id={block.id}
                data-review-flagged={reviewFlags.some((flag) => flag.targetBlockId === block.id) || undefined}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedBlockRef({ numeral: section.numeral, id: block.id })}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedBlockRef({ numeral: section.numeral, id: block.id }); }}
                className={`rounded transition-shadow ${selectedBlockRef?.numeral === section.numeral && selectedBlockRef.id === block.id ? "ring-2 ring-[#4fc8e8] ring-offset-2" : "hover:ring-1 hover:ring-[#c9d8ef]"}`}
              >
                <ReviewFlagNotice flags={reviewFlags.filter((flag) => flag.targetBlockId === block.id)} />
                <BlockView
                  block={block}
                  sourceFileUrl={sourceFileUrl}
                  onQuoteSource={(questionKey, quotes, groupLabel) => void openQuoteSource([{ questionKey, quotes }], groupLabel)}
                  onChange={(next) => updateBlock(section.numeral, block.id, next)}
                  selectedBlockId={selectedBlockRef?.numeral === section.numeral ? selectedBlockRef.id : undefined}
                  onSelectBlock={(id) => setSelectedBlockRef({ numeral: section.numeral, id })}
                />
              </div>
            ))}
            <PageFooter page={bodyIndex + 3} brand={footerBrand} year={footerYear} />
          </section>
        ))}
        <ReportBackCoverPage productInfo={productInfo} onChange={(next) => { checkpoint(); onProductInfoChange(next); }} />
      </article>
      <ActionPanel
        activeTitle={sections.find((section) => section.numeral === activeSection)?.title ?? "보고서 편집"}
        onDownload={() => void downloadActiveSectionZip()}
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
