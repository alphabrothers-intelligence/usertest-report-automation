"use client";

import { useCallback, useEffect, type FormEvent, type RefObject } from "react";

const EDITABLE_SELECTOR = "[data-hwpx-edit-key]";

function storageKey(prefix: string, element: HTMLElement): string | null {
  const editKey = element.dataset.hwpxEditKey;
  return editKey ? `${prefix}${editKey}` : null;
}

export function useHwpxPreviewEdits(
  rootRef: RefObject<HTMLElement | null>,
  sourceFileUrl: string | undefined,
  ready: boolean,
) {
  const storagePrefix = `hwpx-preview-edits:${sourceFileUrl ?? "demo"}:`;

  useEffect(() => {
    const root = rootRef.current;
    if (!ready || !root) return;
    const frame = window.requestAnimationFrame(() => {
      root.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR).forEach((element) => {
        const key = storageKey(storagePrefix, element);
        const saved = key ? window.localStorage.getItem(key) : null;
        if (saved !== null) element.innerHTML = saved;
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ready, rootRef, storagePrefix]);

  const saveEdit = useCallback((event: FormEvent<HTMLElement>) => {
    const editable = (event.target as HTMLElement).closest<HTMLElement>(EDITABLE_SELECTOR);
    if (!editable) return;
    const key = storageKey(storagePrefix, editable);
    if (key) window.localStorage.setItem(key, editable.innerHTML);
  }, [storagePrefix]);

  const collectEdits = useCallback((): Record<string, string> => {
    const edits: Record<string, string> = {};
    rootRef.current?.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR).forEach((element) => {
      const editKey = element.dataset.hwpxEditKey;
      const key = storageKey(storagePrefix, element);
      const saved = key ? window.localStorage.getItem(key) : null;
      if (editKey && saved !== null) edits[editKey] = saved;
    });
    return edits;
  }, [rootRef, storagePrefix]);

  const resetEdits = useCallback(() => {
    rootRef.current?.querySelectorAll<HTMLElement>(EDITABLE_SELECTOR).forEach((element) => {
      const key = storageKey(storagePrefix, element);
      if (key) window.localStorage.removeItem(key);
    });
    window.location.reload();
  }, [rootRef, storagePrefix]);

  return { saveEdit, collectEdits, resetEdits };
}
