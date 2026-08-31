"use client";

import { useEffect, useMemo, useRef } from "react";
import { ReportPropertyPanel } from "@/components/ReportPropertyPanel";
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";
import { REPORT_TEXT, SECTION_BANNER, sectionRomanGlyph } from "@/lib/report/sectionStyle";

/**
 * 본문 쪽 하단 푸터(레이아웃 L15). 원본 3쪽을 150dpi로 렌더해 실측한 값이다(2026-08-25):
 * 점선 규칙 y=277.4mm(x 15.4~195.3mm), 좌측 `2025 by Alphabrothers`(x 17.4mm, 8pt),
 * 정중앙 `- 3 -`(11.5pt), 우측 ALPHA BROTHERS 워드마크(글자폭 32.8mm).
 *
 * 표지·목차는 자체 쪽번호를 갖고 판권면에는 푸터가 없으므로 본문 쪽에만 붙인다.
 * `data-copy-ignore` — 한글 서식 복사에는 인쇄용 머리말/꼬리말이 들어가면 안 된다.
 * `data-print-keep` — 그렇다고 인쇄에서까지 빠지면 안 된다. 복사 제외와 인쇄 제외는 다른
 * 문제이며, 인쇄 규칙(globals.css)이 `data-copy-ignore`를 통째로 숨기므로 여기서 되살린다.
 */
export function PageFooter({ page, brand, year }: { page: number; brand: string; year: string }) {
  return (
    <div data-copy-ignore data-print-keep className="pointer-events-none absolute inset-x-[15.4mm] bottom-[10mm] select-none">
      <div className="border-t border-dotted border-[#404040]" />
      <div className="relative mt-[2.2mm] flex items-center justify-between text-[#222]">
        <span style={{ fontSize: `${REPORT_TEXT.footerFontSize}pt` }}>{year} by {brand}</span>
        <span className="absolute inset-x-0 text-center" style={{ fontSize: `${REPORT_TEXT.pageNumberFontSize}pt` }}>- {page} -</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/alphabrothers-logo.png" alt="" className="h-auto w-[38mm]" />
      </div>
    </div>
  );
}

export function SectionBanner({ numeral, title }: { numeral: string; title: string }) {
  return (
    <div className="flex w-fit overflow-hidden" style={{ height: `${SECTION_BANNER.height}pt`, marginBottom: `${SECTION_BANNER.marginBottom}pt` }}>
      <div className="flex shrink-0 items-center justify-center font-bold" style={{ width: `${SECTION_BANNER.badgeWidth}pt`, backgroundColor: SECTION_BANNER.badgeBackground, color: SECTION_BANNER.badgeColor, fontSize: `${SECTION_BANNER.badgeFontSize}pt` }}>{sectionRomanGlyph(numeral)}</div>
      <div className="flex shrink-0 items-center justify-center font-bold tracking-[-0.04em]" style={{ width: `${SECTION_BANNER.titleWidth}pt`, backgroundColor: SECTION_BANNER.titleBackground, color: SECTION_BANNER.titleColor, fontSize: `${SECTION_BANNER.titleFontSize}pt` }}>{title}</div>
    </div>
  );
}

export function TableOfContents({
  sections,
  activeSection,
  onSelect,
  onSelectSubitem,
}: {
  sections: ReportSectionContent[];
  activeSection: string;
  onSelect: (numeral: string) => void;
  onSelectSubitem: (numeral: string, headingBlockId: string | null) => void;
}) {
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
          // **소목차는 그 장이 실제로 가진 절 제목에서 뽑는다.** 예전에는 리바랩스 기준 고정
          // 목차(`buildReportPlan`)에서 **번호로** 찾아 짝지었는데, 데이터마다 장 구성이 달라지면
          // 같은 번호가 다른 장을 가리킨다 — 이젠오토 화면에서 `Ⅳ. 고객 여정` 아래에
          // `핵심구매요소 조사 결과`가 붙어 나왔다(2026-08-31 담당자 지적). 본문 블록은 맞았고
          // 이 목록만 다른 출처를 보고 있었다. 출처를 본문 하나로 합친다.
          const subitems = section.blocks.filter(
            (block) => block.kind === "heading" && (block.variant === "numbered" || block.variant === "subheading"),
          );
          const active = section.numeral === activeSection;
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
                    <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold ${active ? "bg-white text-[#1473e6]" : "bg-[#f7e9e2] text-[#a64d32]"}`}>
                      정성 대기
                    </span>
                  )}
                </span>
              </button>
              <div className="px-2 pb-1">
                {subitems.map((block) => (
                  <button
                    key={block.id}
                    type="button"
                    onClick={() => onSelectSubitem(section.numeral, block.id)}
                    className={`block w-full rounded px-2 py-0.5 text-left text-xs leading-[1.4] ${active ? "text-[#397dc9] hover:bg-white/60" : "text-[#7a8493] hover:bg-[#edf3fc]"}`}
                  >
                    · {block.kind === "heading" ? block.text : ""}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export function ActionPanel({
  activeTitle,
  onDownload,
  selectedBlock,
  onBlockChange,
}: {
  activeTitle: string;
  onDownload: () => void;
  selectedBlock: ReportBlock | null;
  onBlockChange: (next: ReportBlock) => void;
}) {
  return (
    <aside className="h-fit rounded-xl border border-[#c9daf2] bg-white shadow-[0_10px_30px_rgba(31,55,88,0.08)] lg:sticky lg:top-36 lg:flex lg:max-h-[calc(100vh-10rem)] lg:flex-col lg:overflow-hidden">
      <div className="border-b border-[#e3e8ef] px-5 py-4">
        <p className="text-xs font-semibold text-[#8a94a3]">보고서 작업</p>
        <p className="mt-1 text-base font-bold text-[#263449]">{activeTitle}</p>
      </div>
      <div className="lg:min-h-0 lg:overflow-y-auto">
        <div className="space-y-2 p-5">
          <button type="button" onClick={onDownload} className="block w-full rounded-lg bg-[#1473e6] px-3 py-2.5 text-left text-sm font-semibold text-white hover:bg-[#0f65cf]">
            현재 섹션 차트 이미지 저장
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
