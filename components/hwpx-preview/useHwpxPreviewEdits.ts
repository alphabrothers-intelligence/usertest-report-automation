"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { summarizeHwpxEditMappings, type HwpxPreviewDocument } from "./model";

const EDITABLE_SELECTOR = "[data-hwpx-edit-key]";

function editableKey(element: HTMLElement): string | null {
  return element.dataset.hwpxEditKey ?? null;
}

function initialDocument(sourceFileUrl?: string): HwpxPreviewDocument {
  return {
    version: 1,
    source: sourceFileUrl ?? "demo",
    updatedAt: new Date(0).toISOString(),
    edits: {},
  };
}

function readDocument(storageKey: string, sourceFileUrl?: string): HwpxPreviewDocument {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return initialDocument(sourceFileUrl);
    const parsed = JSON.parse(raw) as Partial<HwpxPreviewDocument>;
    if (parsed.version !== 1 || typeof parsed.edits !== "object" || !parsed.edits) return initialDocument(sourceFileUrl);
    return {
      version: 1,
      source: typeof parsed.source === "string" ? parsed.source : sourceFileUrl ?? "demo",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      edits: Object.fromEntries(Object.entries(parsed.edits).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    };
  } catch {
    return initialDocument(sourceFileUrl);
  }
}

export function useHwpxPreviewEdits(
  rootRef: RefObject<HTMLElement | null>,
  sourceFileUrl: string | undefined,
  ready: boolean,
) {
  const storageKey = `hwpx-preview-document:${sourceFileUrl ?? "demo"}`;
  const documentRef = useRef<HwpxPreviewDocument>(initialDocument(sourceFileUrl));
  const [edits, setEdits] = useState<Record<string, string>>({});

  useEffect(() => {
    const root = rootRef.current;
    if (!ready || !root) return;
    const document = readDocument(storageKey, sourceFileUrl);
    documentRef.current = document;
    setEdits(document.edits);
    const frame = window.requestAnimationFrame(() => {
      root.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR).forEach((element) => {
        const key = editableKey(element);
        const saved = key ? document.edits[key] : undefined;
        if (typeof saved === "string") element.innerHTML = saved;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ready, rootRef, sourceFileUrl, storageKey]);

  const persist = useCallback((nextEdits: Record<string, string>) => {
    const nextDocument: HwpxPreviewDocument = {
      version: 1,
      source: sourceFileUrl ?? "demo",
      updatedAt: new Date().toISOString(),
      edits: nextEdits,
    };
    documentRef.current = nextDocument;
    setEdits(nextEdits);
    window.localStorage.setItem(storageKey, JSON.stringify(nextDocument));
  }, [sourceFileUrl, storageKey]);

  const saveEdit = useCallback((event: FormEvent<HTMLElement>) => {
    const editable = (event.target as HTMLElement).closest<HTMLElement>(EDITABLE_SELECTOR);
    if (!editable) return;
    const key = editableKey(editable);
    if (!key) return;
    persist({ ...documentRef.current.edits, [key]: editable.innerHTML });
  }, [persist]);

  const collectEdits = useCallback(() => ({ ...documentRef.current.edits }), []);

  const resetEdits = useCallback(() => {
    window.localStorage.removeItem(storageKey);
    window.location.reload();
  }, [storageKey]);

  return {
    saveEdit,
    collectEdits,
    resetEdits,
    editSummary: summarizeHwpxEditMappings(edits),
  };
}
