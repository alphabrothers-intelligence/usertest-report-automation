"use client";

import { useEffect, useMemo, useRef } from "react";
import { ReportPropertyPanel } from "@/components/ReportPropertyPanel";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";

export function SectionBanner({ numeral, title }: { numeral: string; title: string }) {
  return (
    <div className="mb-6 flex w-fit overflow-hidden">
      <div className="flex min-w-14 items-center justify-center bg-[#dfeaf5] px-4 text-2xl font-bold text-[#315c9c]">{numeral}</div>
      <div className="bg-[#5c73aa] px-9 py-3 text-[28px] font-bold tracking-[-0.04em] text-white">{title}</div>
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
          const planSection = plan.find((item) => item.numeral === section.numeral);
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
                {planSection?.subitems.map((item) => {
                  const headingBlock = section.blocks.find(
                    (block) => block.kind === "heading" && (block.variant === "numbered" || block.variant === "subheading") && block.text === item,
                  );
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => onSelectSubitem(section.numeral, headingBlock?.id ?? null)}
                      className={`block w-full rounded px-2 py-0.5 text-left text-xs leading-[1.4] ${active ? "text-[#397dc9] hover:bg-white/60" : "text-[#7a8493] hover:bg-[#edf3fc]"}`}
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
