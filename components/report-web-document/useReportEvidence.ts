"use client";

import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { BatchCorrectionItem } from "@/components/QuoteCorrectionPanel";
import { ANALYSIS_EVIDENCE_BY_BLOCK, type AnalysisReference } from "@/components/report-web-document/analysisEvidence";
import { markQuoteEndingReviews } from "@/components/report-web-document/quoteEndingMarkup";
import type { QuoteCompletionTarget, QuoteSourceResult } from "@/components/report-web-document/EvidencePanelContent";
import { reportQuoteEndingToken, splitHighlightParts } from "@/lib/report/quoteEnding";
import { escapeHtml } from "@/lib/report/richText";
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";

type RequestStatus = "idle" | "loading" | "error";
type QuoteCompletion = { completedQuote: string; changedFrom: string; changedTo: string };
type QuoteGroupReference = {
  groupLabel: string;
  sources: Array<{ questionKey: string; quotes: string[]; sectionLabel?: string }>;
};

type UseReportEvidenceInput = {
  sections: ReportSectionContent[];
  setSections: Dispatch<SetStateAction<ReportSectionContent[]>>;
  checkpoint: () => void;
  sourceFileUrl?: string | null;
  documentContainerRef: RefObject<HTMLDivElement | null>;
};

export function useReportEvidence({
  sections,
  setSections,
  checkpoint,
  sourceFileUrl,
  documentContainerRef,
}: UseReportEvidenceInput) {
  const [quoteSource, setQuoteSource] = useState<QuoteSourceResult | null>(null);
  const [quoteSourceStatus, setQuoteSourceStatus] = useState<RequestStatus>("idle");
  const [quoteCompletion, setQuoteCompletion] = useState<QuoteCompletion | null>(null);
  const [quoteCompletionStatus, setQuoteCompletionStatus] = useState<RequestStatus>("idle");
  const [quoteCompletionTarget, setQuoteCompletionTarget] = useState<QuoteCompletionTarget | null>(null);
  const [quotePanelOpen, setQuotePanelOpen] = useState(true);
  const [analysisReference, setAnalysisReference] = useState<AnalysisReference | null>(null);
  const [analysisBlockId, setAnalysisBlockId] = useState<string | null>(null);
  const [recommendationStatus, setRecommendationStatus] = useState<RequestStatus>("idle");
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const quoteSourceRequestRef = useRef(0);
  const activeEvidenceKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const container = documentContainerRef.current;
        if (container) markQuoteEndingReviews(container, reportQuoteEndingToken);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [documentContainerRef, sections, quoteSource]);

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
    document.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentContainerRef, sections]);

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

  function resetQuoteCompletion() {
    setQuoteCompletionTarget(null);
    setQuoteCompletion(null);
    setQuoteCompletionStatus("idle");
  }

  return {
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
  };
}
