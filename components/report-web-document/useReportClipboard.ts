"use client";

import { useEffect, type RefObject } from "react";
import { writeRichClipboard } from "@/components/RichReportEditor";
import { elementToClipboardHtml, fragmentToClipboardHtml } from "@/lib/report/domClipboard";
import { htmlToPlainText } from "@/lib/report/richText";
import { htmlToRtf } from "@/lib/report/rtfClipboard";

type UseReportClipboardOptions = {
  activeSection: string;
  documentContainerRef: RefObject<HTMLDivElement | null>;
  sectionElementsRef: RefObject<Map<string, HTMLElement>>;
};

/** 선택 영역과 섹션 버튼 복사를 한글 호환 HTML·RTF·평문으로 제공한다. */
export function useReportClipboard({
  activeSection,
  documentContainerRef,
  sectionElementsRef,
}: UseReportClipboardOptions) {
  useEffect(() => {
    const copySelectionForHancom = (event: globalThis.ClipboardEvent) => {
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
  }, [documentContainerRef]);

  async function copyActiveSection() {
    const element = sectionElementsRef.current.get(activeSection);
    if (!element) return;
    await writeRichClipboard(elementToClipboardHtml(element));
  }

  return { copyActiveSection };
}
