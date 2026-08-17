"use client";

import type { RefObject } from "react";
import { downloadSectionExportsAsZip } from "@/lib/report/exportImage";
import type { ReportSectionContent } from "@/lib/report/sections";

type UseReportExportOptions = {
  activeSection: string;
  sections: ReportSectionContent[];
  sectionElementsRef: RefObject<Map<string, HTMLElement>>;
};

/** 현재 보고서 섹션의 차트·표 이미지를 기존 ZIP 형식으로 내보낸다. */
export function useReportExport({ activeSection, sections, sectionElementsRef }: UseReportExportOptions) {
  async function downloadActiveSectionZip() {
    const element = sectionElementsRef.current.get(activeSection);
    if (!element) return;
    const label = sections.find((section) => section.numeral === activeSection)?.title ?? "섹션";
    await downloadSectionExportsAsZip(element, `${label}_차트.zip`);
  }

  return { downloadActiveSectionZip };
}
