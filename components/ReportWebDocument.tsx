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
import { ChapterEditor } from "@/components/continuous-editor/ChapterEditor";
import { AnalysisReferenceContent, PolarityReviewCard, QuoteSourceContent } from "@/components/report-web-document/EvidencePanelContent";
import { BlockView } from "@/components/report-web-document/ReportBlockView";
import { ReviewFlagNotice } from "@/components/report/ReviewFlagNotice";
import { SidebarIcon } from "@/components/report-web-document/ReportBlockView";
import type { ReviewFlag } from "@/lib/quant/reviewFlags";
import { useReportClipboard } from "@/components/report-web-document/useReportClipboard";
import { useReportEvidence } from "@/components/report-web-document/useReportEvidence";
import { useReportExport } from "@/components/report-web-document/useReportExport";
import { useReportNavigation } from "@/components/report-web-document/useReportNavigation";
import type { ReportWorkspaceSeed } from "@/lib/report/workspace";
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";
import { paginateBlocks, SECTION_BANNER_RESERVE_PX } from "@/lib/report/paginate";
import { mergeSplitParts, originalBlockId, splitBlockToFit, splitOversizedBlocks } from "@/lib/report/splitBlock";
import type { ProductInfo } from "@/lib/productInfo/types";

export { applyTextFormat, BlockView, FormatButton, insertArrowLine } from "@/components/report-web-document/ReportBlockView";

/** 상단 툴바가 그리는 동작 모음. **세 파일이 같은 모양을 각자 적지 말 것** — 패널을 하나
 * 더 만들 때 한쪽만 고쳐져 타입이 어긋난다(2026-09-11에 실제로 겪었다). */
export type ToolbarActions = {
  copy: () => void;
  openCorrections: () => void;
  toggleToc: () => void; tocOpen: boolean;
  toggleEvidence: () => void; evidenceOpen: boolean;
  toggleAction: () => void; actionOpen: boolean;
};

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
  onToolbarActionsChange?: (actions: ToolbarActions) => void;
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

/** 칸 안쪽 요소가 선택돼도 쪽 배치는 그 요소를 품은 **최상위 블록**에 건다. */
function topLevelBlockId(section: ReportSectionContent, id: string): string {
  return section.blocks.find((block) => block.id === id || findBlockById([block], id))?.id ?? id;
}

/** 쪽 배치 패널이 표 속성(표/행 탭)을 보여줄 블록 — 행 단위로 다음 쪽에 이어지는 블록. */
function isTableLike(block: ReportBlock | undefined): boolean {
  if (!block) return false;
  return block.kind === "table" || block.kind === "row-group" || (block.kind === "rich-static" && /<table[\s>]/.test(block.html));
}

function replaceBlockById(blocks: ReportBlock[], id: string, next: ReportBlock): ReportBlock[] {
  return blocks.map((block) => {
    if (block.id === id) return next;
    if (block.kind === "row-group") return { ...block, rows: block.rows.map((row) => ({ ...row, blocks: replaceBlockById(row.blocks, id, next) })) };
    return block;
  });
}

/** 쪼갠 조각마다 다시 붙는 껍데기(블록 바깥 여백·안내문·테두리) 몫. 실측 40~60px. */
/**
 * **화면에서 문서를 이 배율로 줄여 보여준다**(2026-09-17 담당자 요청: "A4가 화면을 꽉 채운다").
 * `transform`이 아니라 CSS `zoom`을 쓰는 이유 — zoom은 레이아웃까지 줄여서 트랙 폭도 같이
 * 줄고, `getBoundingClientRect`도 줄어든 값을 준다. 그래서 **측정과 용량을 같은 배율로 맞추기만**
 * 하면 쪽 나눔 계산이 그대로 성립한다(transform은 레이아웃을 안 줄여 빈 자리가 남는다).
 * **2026-09-17: 1로 되돌렸다(화면 축소 기능 보류).** 인쇄에서 zoom을 1로 풀면 카드가 1/배율
 * 만큼 커지는데, 쪽 묶기는 축소된 화면 기준으로 계산돼 있어서 **인쇄에서만 카드가 넘쳤다**
 * (실측: 저장된 케어클 보고서가 웹뷰 73쪽 → PDF 88쪽). 화면만 줄이려면 레이아웃을 건드리지
 * 않는 `transform: scale()`로 다시 만들어야 한다 — 그때는 문서 열 폭도 함께 보정할 것.
 */
const DOC_ZOOM = 1;

const SPLIT_WRAPPER_ALLOWANCE_PX = 60 * DOC_ZOOM;

/**
 * 쪽에 이만큼(약 69mm) 넘게 남으면 다음 블록을 잘라서 채운다. 너무 작게 잡으면 조각이 두세
 * 줄짜리로 잘려 표가 지저분해지고, 너무 크게 잡으면 예전처럼 빈 자리가 남는다.
 *
 * **170px에서 260px로 올렸다(2026-09-17).** 경계에 걸린 블록이 실행마다 잘리기도 하고 안
 * 잘리기도 해서(글꼴 로딩 시점에 따라 잰 높이가 몇 px 달라진다) `check:page-fit`이 같은
 * 코드에서 통과·실패로 갈렸다. 문턱을 올리면 "아슬아슬한 자리"가 줄어 결과가 안정된다.
 */
const FILL_MIN_PX = 260 * DOC_ZOOM;

export function ReportWebDocument({ sections, setSections, checkpoint, reportData, activeSection, onActiveSectionChange, workspaceStatus, workspaceError, onRetry, sourceFileUrl, onToolbarActionsChange, productInfo, onProductInfoChange, reviewFlags = [] }: Props) {
  const documentContainerRef = useRef<HTMLDivElement>(null);
  // **본문은 이어진 편집기(Word식)로 그린다**(2026-10-01 담당자 승인). `?legacy=1`이면 예전 블록 쌓기 화면 —
  // 새 편집기에 문제가 생겼을 때 작업을 이어갈 비상구다. 기능을 다 옮기면 지운다.
  // 이 컴포넌트는 데이터를 받은 뒤 브라우저에서만 그려지므로 주소를 바로 읽어도 된다.
  const [editorMode] = useState(() => typeof window === "undefined" || !new URLSearchParams(window.location.search).has("legacy"));
  // 장별 쪽 수(편집기가 잰 값). 목차 쪽 번호와 이어지는 쪽 번호에 쓴다.
  const [chapterPages, setChapterPages] = useState<Record<string, number>>({});
  // 장별 제목 블록이 놓인 쪽(장 안에서 0부터). 목차 소제목 쪽 번호에 쓴다.
  const [headingPages, setHeadingPages] = useState<Record<string, Record<string, number>>>({});
  const [pageGroups, setPageGroups] = useState<Record<string, string[][]>>({});
  const [selectedBlockRef, setSelectedBlockRef] = useState<{ numeral: string; id: string } | null>(null);
  const [correctionsPanelOpen, setCorrectionsPanelOpen] = useState(false);
  // 본문 열은 A4(210mm=794px) 아래로 못 줄이므로(줄이면 패널이 문서를 덮는다), 화면이 좁을 때
  // 가로 스크롤 대신 접을 수 있게 한다 — 왼쪽 `분석 근거` 패널과 같은 방식.
  const [actionPanelOpen, setActionPanelOpen] = useState(true);
  // 목차를 접으면 그 폭을 왼쪽 `분석 근거` 패널이 가져간다(2026-09-02 담당자 요청) — 검토
  // 카드·인용문 대조는 넓을수록 읽기 쉬운데 목차는 늘 펼쳐둘 필요가 없다.
  const [tocOpen, setTocOpen] = useState(true);
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
    applyPolarityReview,
    polarityReviews,
    polarityReviewStatus,
    quotePanelOpen,
    quoteSource,
    readingBlockId,
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
    // 스크롤해서 도표 앞에 도착하면 오른쪽 편집 탭이 **클릭 없이** 그 도표로 열린다(담당자 요청).
    // 본문 문단(text)에서는 바꾸지 않는다 — 글을 읽어 내려가는 동안 방금 고르던 차트의 편집칸이
    // 사라지면 오히려 방해가 된다.
    onReadingBlockChange: (blockId) => {
      const section = sections.find((item) => findBlockById(item.blocks, blockId));
      const block = section ? findBlockById(section.blocks, blockId) : null;
      if (!section || !block || block.kind === "text") return;
      setSelectedBlockRef({ numeral: section.numeral, id: blockId });
    },
  });

  /**
   * 담당자가 손으로 지정한 쪽 배치를 켜고 끈다. 값은 장에 모여 있고 **최상위 블록의 원래 id**로
   * 저장한다 — 표 안쪽 칸을 클릭하면 칸 단위 요소가 선택되는데, 쪽 배치는 표 단위로만 걸리므로
   * 거기 저장하면 아무 일도 안 일어났다(2026-09-30 실측). 조각 id는 재측정 때마다 달라진다.
   */
  function toggleLayoutFlag(field: "pageBreakBefore" | "keepTogether" | "keepWithNext" | "rowBreak", numeral: string, blockId: string, on: boolean) {
    checkpoint();
    setSections((previous) =>
      previous.map((section) => {
        if (section.numeral !== numeral) return section;
        const id = originalBlockId(topLevelBlockId(section, blockId));
        const current = section[field] ?? [];
        return { ...section, [field]: on ? [...new Set([...current, id])] : current.filter((value) => value !== id) };
      }),
    );
  }

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
    onToolbarActionsChange?.({
      copy: () => void copyActiveSection(),
      openCorrections: () => setCorrectionsPanelOpen(true),
      // 목차는 접으면 열 자체가 사라지므로(세로 탭도 안 남긴다), 다시 여는 버튼은 위 툴바에 둔다.
      toggleToc: () => setTocOpen((open) => !open),
      tocOpen,
      toggleEvidence: () => setQuotePanelOpen((open) => !open),
      evidenceOpen: quotePanelOpen,
      toggleAction: () => setActionPanelOpen((open) => !open),
      actionOpen: actionPanelOpen,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection, onToolbarActionsChange, tocOpen, quotePanelOpen, actionPanelOpen]);

  // 화면과 인쇄가 같은 A4 본문 폭에서 줄바꿈되도록 실제 렌더 높이를 측정해 블록을 페이지로
  // 묶는다. 긴 단일 블록은 브라우저가 문단/표 행 경계에서 자연 분할하도록 단독 페이지에 둔다.
  useLayoutEffect(() => {
    const root = documentContainerRef.current;
    // 이어진 편집기는 스스로 쪽을 나눈다 — 블록을 쪼개고 묶는 옛 측정이 끼어들면 안 된다.
    if (!root || sections.length === 0 || editorMode) return;
    const measure = () => {
    const pxPerMm = (96 / 25.4) * DOC_ZOOM;
    // 297mm에서 쪽 안쪽 여백을 뺀 값 — 아래는 푸터(L15) 자리라 위(18mm)보다 넓다.
    // **본문 쪽 <section>의 pt-/pb- 클래스와 반드시 같이 고쳐야 한다.** 어긋나면 블록이
    // 한 쪽 분량을 넘겨 담기고, 브라우저가 그 <section>을 인쇄에서 다시 쪼개면서
    // 푸터가 다음 쪽으로 밀려난다(2026-08-25 실측).
    // 마지막 3mm는 **안전 여유**다. 높이를 화면(screen) 레이아웃에서 재는데 인쇄(print)에서는
    // 줄바꿈이 한 줄씩 달라질 수 있어, 딱 맞게 채운 쪽이 실제 인쇄에서 몇 mm 넘치면 브라우저가
    // 그 카드를 쪼개 **푸터만 있는 빈 장**을 만든다(2026-09-11 케어클 실측: Ⅱ장 카드가 301mm로
    // 나와 장마다 빈 장이 따라붙었다).
    // **10mm인 이유**: 예전엔 12mm였다. 블록 높이의 합이 실제보다 10mm쯤 **적게** 세어지던
    // 시절의 보정값인데, 지금은 반대로 **항상 조금 더 세어진다**(2026-09-15 케어클 14장 실측:
    // 합이 실제 렌더 높이보다 6~25px 크다 — 블록마다 형제 여백을 한 번씩 더 얹기 때문).
    // 12mm를 그대로 두니 쪽마다 한 문항씩 덜 들어가 **반만 찬 쪽이 줄줄이 생겼다**(문항 쌍
    // 하나가 917px인데 용량이 911px이라 6px 차이로 다음 쪽으로 밀렸다).
    // **2026-09-17: 10mm → 12mm로 되돌렸다.** 문서 배율(DOC_ZOOM 0.82)과 4대 가치 의견 표
    // 구조를 바꾸면서 다시 경계에 걸려, 같은 검사가 실행마다 통과·실패로 갈렸다(ezenauto
    // 33쪽 ↔ 34쪽). 화면에서는 넘치는 카드가 0개인데 인쇄에서만 한 쪽이 더 나오는, 아래에
    // 적힌 것과 같은 현상이다.
    // **4mm·8mm를 거쳐 10mm로 정했다.** 화면에서는 어느 카드도 297mm를 안 넘는데 **인쇄에서만
    // 한 쪽이 더 나오는** 일이 리바랩스에서 생긴다(인쇄에서 줄바꿈이 한 줄 달라진다). 8mm는
    // 실행마다 통과·실패가 갈리는 경계였고, 10mm에서 리바랩스 3회·전체 2회 연속 통과했다.
    // **이 값을 줄이려면 반드시 `npm run check:page-fit`을 여러 번 돌려서 확인할 것** —
    // 화면 스크린샷으로는 이 차이가 안 보이고, 한 번 통과한 것으로는 알 수 없다.
    const pageContentHeight = (297 - 18 - 26 - 12) * pxPerMm;

    // **한 쪽보다 큰 블록을 먼저 쪼갠다.** 카드가 한 장을 넘으면 브라우저가 카드를 제멋대로
    // 나누는데 그 조각에는 여백도 푸터도 없다 — PDF가 웹뷰와 달라지는 유일한 원인이다
    // (lib/report/splitBlock.ts 머리말). 만드는 쪽에서 미리 쪼개는 것이 1차 방어이고,
    // 길이를 예측할 수 없는 표·AI 해석은 여기서 실제 높이를 재서 자른다.
    // 쪼갤 때는 용량보다 `SPLIT_WRAPPER_ALLOWANCE_PX`만큼 작게 잡는다. 딱 맞춰 자르면 조각이
    // 경계선에 걸쳐(실측 997px 대 용량 945px) "한 쪽보다 큰 블록"으로 분류돼 앞 카드에 얹힌다.
    //
    // **높이는 화면 기준으로 잰다.** 인쇄에서는 화면 전용 장식(PNG 버튼·안내문)이 사라져 내용이
    // 더 짧아지므로, 화면에서 한 장에 들어가면 인쇄에서도 반드시 들어간다. 반대로 인쇄 기준으로
    // 재면 화면 카드가 몇 mm씩 넘쳐 푸터를 침범한다(2026-09-13 실측, 그래서 되돌렸다).
    // 담당자가 "쪼개지 않기"를 켠 블록이 이미 쪼개져 있으면 먼저 다시 붙인다 — 붙이기 전에
    // 재려고 하면 조각 상태 그대로 묶여서 설정이 아무 일도 안 한 것처럼 보인다.
    // **수렴 신호.** 쪽 나눔은 재고 → 자르고 → 다시 재기를 여러 번 돈다. 검사 스크립트가
    // "카드 수가 안 변한다"만 보고 인쇄하면, 카드 수는 그대로인데 내용이 아직 갈리는 중일 때
    // 인쇄돼 결과가 실행마다 달라진다(2026-09-17 실측: 같은 검사가 5 PASS ↔ 3 PASS).
    // 한 바퀴에서 아무것도 안 바꿨을 때만 이 표시를 남긴다.
    delete document.documentElement.dataset.layoutSettled;

    const merged = mergeSplitParts(sections);
    if (merged) {
      setSections(merged);
      return;
    }

    const split = splitOversizedBlocks(root, sections, pageContentHeight - SPLIT_WRAPPER_ALLOWANCE_PX);
    if (split) {
      setSections(split);
      return;
    }

    const next: Record<string, string[][]> = {};
    // 이번 측정에서 "앞 쪽을 채우려고 자를 블록" 하나. 한 번에 하나만 자르고 다시 잰다.
    // 쪼갤 수 없는 후보가 앞에 있으면 뒤 후보가 영영 안 채워졌다(2026-10-01 실측) — 전부 모아 차례로 시도한다.
    const fills: { id: string; room: number }[] = [];
    for (const section of sections) {
      const metrics = section.blocks.map((block, blockIndex) => {
        const element = root.querySelector<HTMLElement>(`[data-report-block-id="${CSS.escape(block.id)}"]`);
        // 블록 사이 간격은 안쪽 요소의 margin-bottom인데, 그 여백은 테두리 없는 래퍼 밖으로
        // 상쇄돼(margin collapsing) getBoundingClientRect에 안 잡힌다. 고정 8px로 어림하던
        // 예전 코드는 블록마다 4~5mm씩 적게 세어 쪽이 넘쳤다 — 실제 값을 읽어 더한다.
        const inner = element?.firstElementChild;
        const gap = inner ? parseFloat(getComputedStyle(inner).marginBottom) || 0 : 0;
        const height = element ? Math.ceil(element.getBoundingClientRect().height + Math.max(gap, 8 * DOC_ZOOM)) : 0;
        // **한 쪽보다 큰 블록은 인쇄에서 쪼개지게 표시한다.** 전역 `break-inside: avoid`
        // (globals.css)를 이런 블록에도 걸면 브라우저가 통째로 다음 쪽으로 밀었다가 거기서도
        // 못 넣어 **빈 쪽을 하나 만들고** 그제서야 쪼갠다(2026-09-11 실제 PDF 78쪽 중 50쪽이
        // 완전한 빈 쪽이었다). CSS만으로는 "내용이 한 쪽보다 큰가"를 알 수 없어 여기서 표시한다.
        if (element) {
          // "쪼개지 않기"를 지정한 블록은 인쇄에서도 쪼개지지 않게 표시하지 않는다.
          if (height > pageContentHeight && !(section.keepTogether ?? []).includes(block.id)) element.dataset.oversized = "true";
          else delete element.dataset.oversized;
        }
        return {
          id: block.id,
          height,
          isHeading: block.kind === "heading" || (block.kind === "text" && !!block.keepWithNext),
          // 담당자가 손으로 지정한 쪽 배치. 쪼개진 조각은 원래 id로 조회한다 —
          // "여기서 쪽 나누기"는 첫 조각에만 걸려야 한다.
          breakBefore: (section.pageBreakBefore ?? []).includes(originalBlockId(block.id)) && !/--p([2-9]|\d{2,})$/.test(block.id),
          keepTogether: (section.keepTogether ?? []).includes(block.id),
          // "다음 블록과 함께 두기"는 다음 블록 쪽에서 보면 "앞 블록과 붙여두기"다. 같은 블록의
          // 조각끼리는 붙일 필요가 없다(이미 이어진다).
          keepWithPrevious: (section.keepWithPrevious ?? []).includes(originalBlockId(block.id))
            || (blockIndex > 0
              && originalBlockId(section.blocks[blockIndex - 1].id) !== originalBlockId(block.id)
              && (section.keepWithNext ?? []).includes(originalBlockId(section.blocks[blockIndex - 1].id))),
        };
      });
      // 묶는 규칙은 축소판(`/brief`)과 공유한다 — lib/report/paginate.ts 참고.
      // 첫 물리 페이지에는 장 제목 배너가 들어가므로 그 높이를 먼저 예약한다.
      const pages = paginateBlocks(metrics, pageContentHeight, SECTION_BANNER_RESERVE_PX);
      next[section.numeral] = pages.length > 0 ? pages : [section.blocks.map((block) => block.id)];
      // **쪽에 남은 자리를 채운다**(2026-09-17 담당자 요청). 한 쪽에는 들어가지만 지금 쪽에
      // 남은 자리에는 안 들어가는 블록은 통째로 다음 쪽으로 밀려 **앞 쪽이 크게 비었다**.
      // 남은 자리가 의미 있을 때만(FILL_MIN_PX) 그 블록을 잘라 앞 쪽을 채우고 나머지를 넘긴다.
      {
        const heightOf = new Map(metrics.map((metric) => [metric.id, metric.height]));
        for (let index = 0; index < pages.length - 1; index += 1) {
          const used = pages[index].reduce((sum, id) => sum + (heightOf.get(id) ?? 0), 0)
            + (index === 0 ? SECTION_BANNER_RESERVE_PX : 0);
          const room = pageContentHeight - used - SPLIT_WRAPPER_ALLOWANCE_PX;
          const nextId = pages[index + 1][0];
          const metric = metrics.find((candidate) => candidate.id === nextId);
          if (!metric || metric.keepTogether || metric.breakBefore) continue;
          // "행 자동 나누기"를 켠 표는 두 줄(약 60px) 자리만 있어도 행을 잘라 채운다 — 260px 문턱을 그대로
          // 쓰면 쪽 끝 빈자리가 그보다 작을 때 켜도 아무 변화가 없었다(2026-10-01 담당자 지적).
          const rowBreakOn = (section.rowBreak ?? []).includes(originalBlockId(metric.id));
          if (room < (rowBreakOn ? 60 * DOC_ZOOM : FILL_MIN_PX) || metric.height <= room) continue;
          fills.push({ id: nextId, room });
        }
      }
    }
    // 블록 안쪽에도 `break-inside: avoid`가 걸린 자리가 있다(표의 행, 인용 묶음). 그중에도
    // 한 쪽보다 큰 것이 있으면 같은 빈 쪽 사고가 난다 — 4대 가치 의견 상자는 긍정·부정이
    // **한 행의 두 칸**이라 행 하나가 1,200px였다(2026-09-11 실측 50쪽 빈 쪽의 원인).
    for (const fill of fills) {
      const filled = splitBlockToFit(root, sections, fill.id, fill.room, pageContentHeight - SPLIT_WRAPPER_ALLOWANCE_PX);
      if (filled) {
        setSections(filled);
        return;
      }
    }
    for (const inner of root.querySelectorAll<HTMLElement>("[data-report-block-id] tr, [data-report-block-id] [data-quote-group]")) {
      if (inner.getBoundingClientRect().height > pageContentHeight) inner.dataset.oversized = "true";
      else delete inner.dataset.oversized;
    }
    setPageGroups((previous) => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    document.documentElement.dataset.layoutSettled = "1";
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
    // setSections는 useState의 setter라 바뀌지 않는다 — 넣으면 매 렌더 재측정이 도는 것처럼
    // 보이게 할 뿐이라 뺀다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, editorMode]);

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
  // 쪽 배치 패널은 고른 블록이 속한 **최상위 블록**에 대해 말한다.
  const layoutSection = sections.find((section) => section.numeral === selectedBlockRef?.numeral);
  const layoutTop = layoutSection && selectedBlockRef ? originalBlockId(topLevelBlockId(layoutSection, selectedBlockRef.id)) : null;
  const layoutBlock = layoutSection?.blocks.find((block) => originalBlockId(block.id) === layoutTop);
  const hasFlag = (field: "pageBreakBefore" | "keepTogether" | "keepWithNext" | "rowBreak") => !!layoutTop && (layoutSection?.[field] ?? []).includes(layoutTop);
  // 지정은 했는데 지금 배치에서 지켜지지 않은 경우 이유를 알린다 — 조용히 무시하면 "기능이 안 된다"로 읽힌다.
  const layoutNotice = (() => {
    if (!layoutSection || !layoutTop) return null;
    const groups = pageGroups[layoutSection.numeral] ?? [];
    const pageOf = (id: string) => groups.findIndex((ids) => ids.some((other) => originalBlockId(other) === id));
    const parts = layoutSection.blocks.filter((block) => originalBlockId(block.id) === layoutTop);
    if (hasFlag("keepWithNext")) {
      const nextIndex = layoutSection.blocks.indexOf(parts[parts.length - 1]) + 1;
      const next = layoutSection.blocks[nextIndex];
      if (next && pageOf(layoutTop) >= 0 && groups.findIndex((ids) => ids.includes(parts[parts.length - 1].id)) !== groups.findIndex((ids) => ids.includes(next.id))) {
        return "두 블록을 합치면 한 쪽보다 커서 함께 둘 수 없습니다.";
      }
    }
    return null;
  })();
  // 편집기 모드에서 목차가 쓰는 쪽 묶음: 장마다 잰 쪽 수만큼, 제목 블록은 편집기가 잰 그 쪽에 넣는다
  // (ReportTocPage가 소제목 쪽 번호를 "몇 번째 묶음에 있나"로 계산한다).
  const tocPageGroups = editorMode
    ? Object.fromEntries(sections.map((section) => {
      const groups: string[][] = Array.from({ length: chapterPages[section.numeral] ?? 1 }, () => []);
      for (const [id, page] of Object.entries(headingPages[section.numeral] ?? {})) groups[Math.min(page, groups.length - 1)]?.push(id);
      return [section.numeral, groups];
    }))
    : pageGroups;
  const chapterFirstPage: Record<string, number> = {};
  sections.reduce((next, section) => { chapterFirstPage[section.numeral] = next; return next + (chapterPages[section.numeral] ?? 1); }, 3);
  const bodyPages = sections.flatMap((section) => {
    const groups = pageGroups[section.numeral] ?? [section.blocks.map((block) => block.id)];
    return groups.map((blockIds, pageIndex) => ({ section, blockIds, pageIndex }));
  });
  const footerBrand = productInfo.footerBrandName?.trim() || "Alphabrothers";
  const footerYear = productInfo.coverDate?.trim().match(/\d{4}/)?.[0] || String(new Date().getFullYear());

  return (
    // 문서 열은 210mm 고정이고 `justify-center`로 남는 폭을 양쪽 여백에 균등하게 준다.
    // 예전엔 minmax(210mm,1fr)이라 트랙만 넓어지고 안의 A4(794px)는 그대로여서, 문서
    // 오른쪽에 아무것도 없는 빈 칸이 수백 px 생겼다(2026-09-11 담당자 지적). 아래 옛 주석의
    // 배경: minmax(0,1fr) 대신 최소폭을 준 이유 — 0 바닥이면 사이드 패널(특히 분석 근거
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
    <div
      style={{
        // **트랙 정의는 여기(인라인)에 둔다 — CSS 파일로 빼지 말 것.** globals.css에 뒀더니
        // 그 파일 하나가 stale일 때(dev 서버가 옛 CSS를 물고 있던 실측 사례, 2026-09-11)
        // 규칙이 통째로 없어져 3열이 1열로 쌓여버렸다. 인라인이면 JS 번들과 같이 움직인다.
        // 접힌 패널은 트랙 자체를 만들지 않는다 — 0px 트랙을 남기면 gap(24px)이 빈 띠로 남는다.
        gridTemplateColumns: [
          tocOpen ? "196px" : null,
          quotePanelOpen ? "minmax(250px,330px)" : null,
          `calc(210mm * ${DOC_ZOOM})`,
          actionPanelOpen ? "minmax(240px,320px)" : null,
        ].filter(Boolean).join(" "),
        // `safe`는 트랙 합이 화면보다 넓을 때만 start로 물러난다. 그냥 center면 왼쪽으로도
        // 넘쳐서 목차가 잘리고 음수 스크롤이 없어 영영 못 본다(1440px 실측).
        justifyContent: "safe center",
      }}
      // 좁은 화면에서는 한 줄로 쌓는다. 인라인 style을 이겨야 하므로 `!`(v4는 접미사)를 쓴다.
      className="grid gap-3 px-3 py-8 max-lg:grid-cols-1! xl:gap-6 2xl:px-7"
    >
      {tocOpen && (
        <TableOfContents sections={sections} activeSection={activeSection} onSelect={scrollToSection} onSelectSubitem={scrollToSubitem} onCollapse={() => setTocOpen(false)} />
      )}
      {quotePanelOpen && (
        <aside className="studio-ui h-fit rounded-[18px] bg-white lg:sticky lg:top-[184px] lg:max-h-[calc(100vh-200px)] lg:overflow-y-auto">
          <div className="flex items-center justify-between px-7 pb-4 pt-7">
            <p className="text-[15px] font-semibold leading-[1.3] tracking-[-0.01em] text-[#1d1d1f]">분석 근거</p>
            <button type="button" onClick={() => setQuotePanelOpen(false)} className="rounded-md p-1.5 text-[#7a7a7a] hover:text-[#1d1d1f]" title="분석 근거 패널 접기" aria-label="분석 근거 패널 접기"><SidebarIcon /></button>
          </div>
          <div className="px-7 pb-8">
            {/* 실무자가 확인해야 할 것을 한 곳에 모은다 — 정량 도표의 "요주의 표시"
                (lib/quant/reviewFlags.ts)와 정성 극성 확인(categoryPolarityNeedsReview)이
                계산 근거와 같은 패널에서, 지금 읽고 있는 자리에 맞춰 바뀐다. */}
            <ReviewFlagNotice flags={reviewFlags.filter((flag) => flag.targetBlockId === readingBlockId)} />
            {sourceFileUrl && polarityReviews.map((target) => (
              <PolarityReviewCard
                key={`${target.questionKey}-${target.label}`}
                target={target}
                status={polarityReviewStatus}
                onDecide={(polarity) => void applyPolarityReview(target, polarity)}
              />
            ))}
            {analysisReference && !quoteSource && quoteSourceStatus === "idle" && (
              <AnalysisReferenceContent
                reference={analysisReference}
                sourceFileUrl={sourceFileUrl}
                recommendationStatus={recommendationStatus}
                recommendationError={recommendationError}
                onRegenerate={() => void regenerateRecommendation()}
              />
            )}
            {/* 빈 상태도 "지금 어디에 있는지"를 말해야 한다. 회색 문장 한 줄만 두었더니 넓은 흰
                카드가 그대로 남아 담당자가 **패널이 고장 난 줄 알았다**(2026-09-11). 제목으로
                구간을 알려주고, 근거가 어디서 나타나는지까지 적는다. */}
            {!analysisReference && !quoteSource && quoteSourceStatus === "idle" && (
              <>
                <p className="text-[14px] font-semibold leading-[1.35] tracking-[-0.01em] text-[#1d1d1f]">표·그래프 구간</p>
                <p className="mt-4 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#333333]">
                  이 자리에는 인용문도 생성된 해석도 없습니다. 숫자는 raw data에서 그대로 계산됩니다.
                </p>
                <p className="mt-3 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#7a7a7a]">
                  아래 의견 묶음까지 내려가면 인용문과 원문이 여기에 나타납니다.
                </p>
              </>
            )}
            {!analysisReference && <>
            {quoteSourceStatus === "loading" && <p className="text-[13px] leading-[1.47] tracking-[-0.374px] text-[#7a7a7a]">원문을 찾고 있습니다...</p>}
            {quoteSourceStatus === "error" && <p className="text-[13px] leading-[1.47] tracking-[-0.374px] text-[#c2410c]">원본 응답에서 인용문을 찾지 못했습니다.</p>}
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
      <article ref={documentContainerRef} style={{ zoom: DOC_ZOOM }} className="flex min-w-[210mm] flex-col items-start gap-10">
        <ReportCoverPage productInfo={productInfo} onChange={(next) => { checkpoint(); onProductInfoChange(next); }} />
        <ReportTocPage sections={sections} pageGroups={tocPageGroups} onSectionsChange={(next) => { checkpoint(); setSections(next); }} />
        {editorMode && sections.map((section) => (
          <ChapterEditor
            key={section.numeral}
            section={section}
            sourceFileUrl={sourceFileUrl}
            firstPage={chapterFirstPage[section.numeral]}
            footerBrand={footerBrand}
            footerYear={footerYear}
            onPageCount={(count) => setChapterPages((previous) => (previous[section.numeral] === count ? previous : { ...previous, [section.numeral]: count }))}
            onHeadingPages={(pages) => setHeadingPages((previous) => ({ ...previous, [section.numeral]: pages }))}
            onBlockChange={(next) => updateBlock(section.numeral, next.id, next)}
            onHtmlChange={(editorHtml) => setSections((previous) => previous.map((item) => (item.numeral === section.numeral ? { ...item, editorHtml } : item)))}
            onSelectBlock={(id) => setSelectedBlockRef({ numeral: section.numeral, id })}
            sectionRef={(element) => {
              if (element) sectionElementsRef.current.set(section.numeral, element);
              else sectionElementsRef.current.delete(section.numeral);
            }}
          />
        ))}
        {!editorMode && bodyPages.map(({ section, blockIds, pageIndex }, bodyIndex) => (
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
                data-row-break={(section.rowBreak ?? []).includes(originalBlockId(block.id)) || undefined}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedBlockRef({ numeral: section.numeral, id: block.id })}
                onKeyDown={(event) => {
                  // Ctrl/⌘+Enter = Word의 쪽 나누기. ponytail: 커서 위치가 아니라 **이 블록 다음**에서
                  // 쪽을 넘긴다(블록 안 글을 커서에서 둘로 가르는 건 아직 없다).
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    const next = section.blocks.find((other, index) => index > section.blocks.indexOf(block) && originalBlockId(other.id) !== originalBlockId(block.id));
                    if (next) toggleLayoutFlag("pageBreakBefore", section.numeral, next.id, true);
                    return;
                  }
                  if (event.key === "Enter" || event.key === " ") setSelectedBlockRef({ numeral: section.numeral, id: block.id });
                }}
                className={`rounded transition-shadow ${selectedBlockRef?.numeral === section.numeral && selectedBlockRef.id === block.id ? "ring-2 ring-[#4fc8e8] ring-offset-2" : "hover:ring-1 hover:ring-[#c9d8ef]"}`}
              >
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
      {actionPanelOpen ? (
        <ActionPanel
          activeTitle={sections.find((section) => section.numeral === activeSection)?.title ?? "보고서 편집"}
          onDownload={() => void downloadActiveSectionZip()}
          selectedBlock={selectedBlock}
          onBlockChange={(next) => {
            if (selectedBlockRef) updateBlock(selectedBlockRef.numeral, selectedBlockRef.id, next);
          }}
          onCollapse={() => setActionPanelOpen(false)}
          layout={layoutSection && layoutTop ? {
            isTable: isTableLike(layoutBlock),
            pageBreakBefore: hasFlag("pageBreakBefore"),
            keepTogether: hasFlag("keepTogether"),
            keepWithNext: hasFlag("keepWithNext"),
            rowBreak: hasFlag("rowBreak"),
            notice: layoutNotice,
            onTogglePageBreakBefore: (on) => toggleLayoutFlag("pageBreakBefore", layoutSection.numeral, layoutTop, on),
            onToggleKeepTogether: (on) => toggleLayoutFlag("keepTogether", layoutSection.numeral, layoutTop, on),
            onToggleKeepWithNext: (on) => toggleLayoutFlag("keepWithNext", layoutSection.numeral, layoutTop, on),
            onToggleRowBreak: (on) => toggleLayoutFlag("rowBreak", layoutSection.numeral, layoutTop, on),
          } : null}
        />
      ) : null}
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
