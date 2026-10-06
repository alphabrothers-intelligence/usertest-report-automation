"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { FontSize, TextStyle } from "@tiptap/extension-text-style";
import { registerEditor, setActiveEditor, unregisterEditor } from "@/lib/editor/activeEditor";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";
import { Pagination } from "@/lib/editor/pagination";
import { sectionToEditorHtml } from "@/lib/editor/toEditorHtml";
import { PageFooter } from "@/components/report-web-document/ReportDocumentChrome";
import { AtomContext, KeepStyle, PageBreak, ReportAtom, ReportDiv } from "./extensions";

/**
 * **한 장(章)을 하나로 이어진 문서로 편집한다**(A안, 2026-10-01 담당자 선택 → 같은 날 `/viewer` 반영 승인).
 *
 * 쪽은 화면 뒤에 A4 종이를 깔고, 편집기 본문은 그 위를 한 줄기로 흐른다. 쪽 경계는 `Pagination` 확장이
 * 간격 장식으로 맞춘다. 장마다 새 쪽에서 시작하므로 장 하나 = 편집기 하나다(원본 보고서와 같다).
 *
 * 편집기 서식은 **globals.css에 두지 않는다** — dev 서버가 그 파일만 옛 판으로 내보내 규칙이 통째로
 * 빠진 적이 있다(docs/TROUBLESHOOTING.md). 컴포넌트와 함께 실려 오게 한다.
 */
const PAGE_GAP_PX = 40;
export const EDITOR_CSS = `
.continuous-editor .editor-page-break { border-top: 1px dashed #9aa3b0; margin: 6px 0; }
.continuous-editor table { border-collapse: collapse; width: 100%; }
.continuous-editor .tableWrapper { overflow: visible; }
/* 비어 있는 자리 문단은 낮게 — 글을 쓰면 보통 문단 높이가 된다. */
.continuous-editor p[data-spacer]:has(> br.ProseMirror-trailingBreak:only-child) { font-size: 6pt; line-height: 1; margin: 0; min-height: 0; }
.continuous-editor .ProseMirror-selectednode { outline: 2px solid #4fc8e8; outline-offset: 2px; }
/* 그림(제목·차트) 안에는 편집기의 일반 서식(제목 여백 등)이 새어 들지 않는다 — 번호 제목 상자의 글자가
   아래로 밀려 상자가 깨져 보였다(2026-10-01 담당자 지적). */
.continuous-editor [data-atom-id] h1, .continuous-editor [data-atom-id] h2, .continuous-editor [data-atom-id] h3 { margin: 0; color: inherit; }
.continuous-editor [data-atom-id] { position: relative; }
/* 화면 전용 안내·버튼은 그림 사이에 끼지 않게 숨기고, 그림에 마우스를 올리면 오른쪽 위에 띄운다. */
.continuous-editor [data-atom-id] p[data-copy-ignore] { display: none; }
.continuous-editor [data-atom-id] div[data-copy-ignore] {
  position: absolute; top: 4px; right: 4px; z-index: 5; margin: 0 !important; opacity: 0; transition: opacity .15s;
  background: rgba(255,255,255,.95); border-radius: 4px; padding: 2px;
}
.continuous-editor [data-atom-id] div[data-copy-ignore] span { display: none; }
.continuous-editor [data-atom-id]:hover div[data-copy-ignore] { opacity: 1; }
/* 만족도 분포도는 점수 표와 한 덩어리로 넘어가되 쪽을 덜 차지하게. */
.continuous-editor [data-atom-id*="scorebox"] svg { max-height: 50mm; width: 100%; }
/* 사분면 + "영역별 참고 지표"는 원본 28쪽처럼 한 쪽에 붙여서 — 사분면은 크게, 참고 지표는 촘촘하게. */
.continuous-editor [data-atom-id*="quadrant"] [data-report-export] { width: 150mm; margin: 0 auto; }
.continuous-editor [data-atom-id*="quadrant"] section,
.continuous-editor [data-atom-id*="priority-reference"] section { margin-bottom: 0; }
.continuous-editor [data-atom-id*="priority-reference"] [data-report-export] { padding: 2mm 3mm; }
.continuous-editor [data-atom-id*="priority-reference"] h4 { margin: -2mm -3mm 2mm; padding: 1mm 0; }
.continuous-editor [data-atom-id*="priority-reference"] .grid { grid-template-columns: 62mm 1fr; gap: 3mm; }
.continuous-editor [data-atom-id*="priority-reference"] .grid > div:first-child { max-width: 62mm; }
.continuous-editor [data-atom-id*="priority-reference"] .text-xs { font-size: 8pt; line-height: 1.5; }
.continuous-editor [data-atom-id*="priority-reference"] .space-y-1\\.5 > * + * { margin-top: 1mm; }
/* ── 인쇄(PDF 저장) ── 화면의 쪽 하나 = PDF 한 쪽. 화면에만 있는 쪽 사이 띄움(40px)을 없애고, 종이·간격을
   그 값으로 다시 놓는다. 옛 블록 화면의 인쇄 규칙([data-section-page]에 여백·쪽 넘김)은 여기서 무력화한다. */
@media print {
  body [data-chapter] { --stride: 297mm !important; --gap: 0px !important; --page-gap-cut: ${PAGE_GAP_PX}px !important; break-before: page; page-break-before: always; }
  body [data-chapter] [data-section-page][data-a4-page] {
    position: absolute !important; padding: 0 !important; min-height: 0 !important; height: 297mm !important;
    border: 0 !important; box-shadow: none !important; break-after: auto !important; page-break-after: auto !important;
  }
  /* 편집기가 쪽을 직접 나눴으므로 브라우저가 따로 "자르지 말 것"을 적용하면 안 된다 — 옛 화면용 규칙
     (인용 묶음·표 행 break-inside: avoid)이 한 쪽보다 큰 인용 묶음을 통째로 다음 쪽으로 밀어 띠지만 남은
     쪽이 생겼다(2026-10-02 PDF 실측, 화면은 정상). */
  body [data-chapter] * { break-inside: auto !important; page-break-inside: auto !important; break-before: auto !important; break-after: auto !important; }
  body [data-chapter] .ProseMirror-selectednode { outline: none !important; }
}
/* 문단으로 푼 테두리 상자(종합 해석 등) — 쪽 경계에서 닫히고 다음 쪽에서 다시 열린다. */
.continuous-editor p[data-box] { border-left: 0.75pt solid #8ea7de; border-right: 0.75pt solid #8ea7de; }
.continuous-editor p[data-box="panel-title"] { border-top: 3pt solid #4fc8e8; margin-top: 6pt; }
.continuous-editor p[data-box="panel-title"] + p[data-box="panel"] { padding-top: 10pt !important; }
.continuous-editor p[data-box]:not(:has(+ p[data-box])) { border-bottom: 0.75pt solid #8ea7de; margin-bottom: 12pt; padding-bottom: 10pt !important; }
.continuous-editor [data-page-gap] + p[data-box="panel"] { border-top: 0.75pt solid #8ea7de; }
`;

const MM = 96 / 25.4;
/** 종이·여백은 기존 웹뷰 A4 카드와 같은 값이다(쪽 사이 간격은 `/viewer`의 gap-10 = 40px). */
export const PAGE = { width: 210 * MM, height: 297 * MM, top: 18 * MM, side: 18 * MM, bottom: 26 * MM, gap: PAGE_GAP_PX };
const CONTENT_HEIGHT = PAGE.height - PAGE.top - PAGE.bottom;
export const PAGE_STRIDE = PAGE.height + PAGE.gap;

export type ChapterEditorProps = {
  section: ReportSectionContent;
  sourceFileUrl?: string | null;
  /** 이 장 첫 쪽의 쪽 번호(표지·목차 다음부터 이어진다). */
  firstPage: number;
  footerBrand: string;
  footerYear: string;
  onPageCount?: (count: number) => void;
  /** 이 장의 제목 블록(번호 제목·문항 제목 그림)이 몇 번째 쪽(0부터)에 놓였는지 — 목차 쪽 번호에 쓴다. */
  onHeadingPages?: (pages: Record<string, number>) => void;
  onBlockChange?: (next: ReportBlock) => void;
  /** 본문을 고칠 때마다(잠깐 멈춘 뒤) 이 장의 편집기 HTML을 알린다 — 초안 저장에 실린다. */
  onHtmlChange?: (html: string) => void;
  onSelectBlock?: (blockId: string) => void;
  /** 장 맨 위 요소(목차 클릭 → 스크롤 목적지). */
  sectionRef?: (element: HTMLElement | null) => void;
};

export function ChapterEditor({ section, sourceFileUrl, firstPage, footerBrand, footerYear, onPageCount, onHeadingPages, onBlockChange, onHtmlChange, onSelectBlock, sectionRef }: ChapterEditorProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingPagesRef = useRef("");
  // 쪽 나눔이 다시 끝날 때마다 올라간다 — 제목 블록의 쪽 위치를 그때 다시 잰다.
  const [layoutTick, setLayoutTick] = useState(0);
  useEffect(() => {
    // 간격 장식이 그려진 뒤에 재야 실제 쪽이 나온다 — 다음 프레임에 잰다.
    const frame = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root || !onHeadingPages) return;
      const top = root.getBoundingClientRect().top;
      const found: Record<string, number> = {};
      root.querySelectorAll<HTMLElement>("[data-atom-id]").forEach((atom) => {
        if (!atom.querySelector("[id]")) return;
        found[atom.dataset.atomId ?? ""] = Math.floor((atom.getBoundingClientRect().top - top) / PAGE_STRIDE);
      });
      const key = JSON.stringify(found);
      if (key !== headingPagesRef.current) { headingPagesRef.current = key; onHeadingPages(found); }
    });
    return () => cancelAnimationFrame(frame);
  }, [layoutTick, onHeadingPages]);
  const [pages, setPages] = useState(1);
  // 편집기 내용은 **처음 한 번만** 블록에서 만든다 — 이후 글은 편집기가 들고 있다. 그림(차트 등)은
  // 매번 최신 블록으로 그리므로 오른쪽 수정 탭의 변경이 바로 보인다.
  // ponytail: 서버가 블록을 통째로 다시 만들어 주는 경우(극성 재판정 등)는 아직 편집기에 반영 안 된다.
  const [html] = useState(() => section.editorHtml || sectionToEditorHtml(section));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "항목 | 주요 의견" 표 칸 안의 그림도 찾을 수 있게 안쪽 블록까지 펼친다.
  const blocks = useMemo(() => {
    const map = new Map<string, ReportBlock>();
    const add = (list: ReportBlock[]) => list.forEach((block) => {
      map.set(block.id, block);
      if (block.kind === "row-group") block.rows.forEach((row) => add(row.blocks));
    });
    add(section.blocks);
    return map;
  }, [section.blocks]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // 가로 막대 커서(gapcursor)는 끈다 — 그림·표 사이에는 항상 자리 문단이 있다(toEditorHtml SPACER).
      StarterKit.configure({ link: false, gapcursor: false }),
      TableKit.configure({ table: { resizable: false } }),
      KeepStyle,
      // 툴바의 정렬·글자 크기. 정렬은 문단·제목에만 건다.
      TextAlign.configure({ types: ["paragraph", "heading"] }),
      TextStyle,
      FontSize,
      ReportAtom,
      ReportDiv,
      PageBreak,
      Pagination.configure({
        geometry: { contentHeight: CONTENT_HEIGHT, pageStride: PAGE_STRIDE },
        onPages: (count) => {
          setPages(count);
          onPageCount?.(count);
          setLayoutTick((tick) => tick + 1);
        },
      }),
    ],
    content: html,
    // 글자마다 상위 상태를 바꾸면 보고서 전체가 다시 그려진다 — 타이핑이 멈춘 뒤 한 번만 알린다.
    onUpdate: ({ editor: current }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => onHtmlChange?.(current.getHTML()), 400);
    },
    editorProps: { attributes: { class: "report-rich-editor continuous-editor outline-none" } },
    // 상단 툴바가 "지금 쓰고 있는 장"에 명령을 보내도록 기억해 둔다(lib/editor/activeEditor.ts).
    onFocus: ({ editor: current }) => setActiveEditor(current),
    onSelectionUpdate: ({ editor: current }) => setActiveEditor(current),
    onCreate: ({ editor: current }) => registerEditor(current),
    onDestroy: () => { if (editor) unregisterEditor(editor); },
  });

  const atomContext = useMemo(() => ({
    blocks,
    numeral: section.numeral,
    title: section.title,
    sourceFileUrl,
    onBlockChange: (next: ReportBlock) => onBlockChange?.(next),
    onSelectBlock: (id: string) => onSelectBlock?.(id),
  }), [blocks, section.numeral, section.title, sourceFileUrl, onBlockChange, onSelectBlock]);

  return (
    <div
      id={`section-${section.numeral}`}
      ref={(element) => { rootRef.current = element; sectionRef?.(element); }}
      data-chapter={section.numeral}
      className="relative scroll-mt-36"
      // 종이 위치·높이는 CSS 변수로 — 인쇄 서식이 쪽 사이 띄움만 0으로 바꾸면 그대로 A4 쪽에 맞는다.
      style={{ width: PAGE.width, height: `calc(${pages} * var(--stride) - var(--gap))`, ["--stride" as string]: `${PAGE_STRIDE}px`, ["--gap" as string]: `${PAGE.gap}px`, ["--page-gap-cut" as string]: "0px" }}
    >
      <style>{EDITOR_CSS}</style>
      {Array.from({ length: pages }, (_, index) => (
        // 종이 한 장 = 웹뷰 카드 한 장. `data-section-page`는 쪽 수 검사·목차 스크롤이 센다.
        <div key={index} data-section-page={section.numeral} data-a4-page aria-hidden className="absolute left-0 box-border border border-[#dfe3e9] bg-white shadow-[0_12px_34px_rgba(28,39,55,.11)]" style={{ top: `calc(${index} * var(--stride))`, width: PAGE.width, height: PAGE.height }}>
          <PageFooter page={firstPage + index} brand={footerBrand} year={footerYear} />
        </div>
      ))}
      <div className="absolute" style={{ top: PAGE.top, left: PAGE.side, right: PAGE.side }}>
        <AtomContext.Provider value={atomContext}>
          <EditorContent editor={editor} />
        </AtomContext.Provider>
      </div>
    </div>
  );
}
