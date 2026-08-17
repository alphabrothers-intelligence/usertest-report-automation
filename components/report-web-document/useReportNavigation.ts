"use client";

import { useEffect, useRef, type RefObject } from "react";

type UseReportNavigationOptions = {
  activeSection: string;
  onActiveSectionChange: (numeral: string) => void;
  sectionCount: number;
};

type ReportNavigation = {
  sectionElementsRef: RefObject<Map<string, HTMLElement>>;
  scrollToSection: (numeral: string) => void;
  scrollToSubitem: (numeral: string, headingBlockId: string | null) => void;
};

/** 보고서 목차 이동과 스크롤 위치 기반 활성 섹션 감지를 전담한다. */
export function useReportNavigation({
  activeSection,
  onActiveSectionChange,
  sectionCount,
}: UseReportNavigationOptions): ReportNavigation {
  const sectionElementsRef = useRef<Map<string, HTMLElement>>(new Map());

  // 스크롤스파이 콜백은 observer를 재생성하지 않고도 최신 값을 참조해야 한다.
  const activeSectionRef = useRef(activeSection);
  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  const onActiveSectionChangeRef = useRef(onActiveSectionChange);
  useEffect(() => {
    onActiveSectionChangeRef.current = onActiveSectionChange;
  }, [onActiveSectionChange]);

  useEffect(() => {
    const targets = Array.from(sectionElementsRef.current.values());
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        );
        const numeral = topMost.target.getAttribute("data-section-page");
        if (numeral && numeral !== activeSectionRef.current) {
          onActiveSectionChangeRef.current(numeral);
        }
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 },
    );

    targets.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sectionCount]);

  function scrollToSection(numeral: string) {
    sectionElementsRef.current.get(numeral)?.scrollIntoView({ behavior: "smooth", block: "start" });
    onActiveSectionChange(numeral);
  }

  function scrollToSubitem(numeral: string, headingBlockId: string | null) {
    const target = headingBlockId ? document.getElementById(headingBlockId) : null;
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    else sectionElementsRef.current.get(numeral)?.scrollIntoView({ behavior: "smooth", block: "start" });
    onActiveSectionChange(numeral);
  }

  return { sectionElementsRef, scrollToSection, scrollToSubitem };
}
