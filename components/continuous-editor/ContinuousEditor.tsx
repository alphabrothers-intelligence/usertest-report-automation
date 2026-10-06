"use client";

import { useEffect, useState } from "react";
import type { ReportSectionContent } from "@/lib/report/sections";
import type { ReportWorkspaceSeed } from "@/lib/report/workspace";
import { ChapterEditor } from "./ChapterEditor";

/** `/editor` 시제품 — 한 장만 띄운다. 본 기능은 `/viewer`(ReportWebDocument)가 같은 `ChapterEditor`를 쓴다. */
export function ContinuousEditor({ sourceFileUrl, numeral }: { sourceFileUrl: string; numeral: string }) {
  const [section, setSection] = useState<ReportSectionContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/report-workspace?source=${encodeURIComponent(sourceFileUrl)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { ok: boolean; error?: string; workspace?: ReportWorkspaceSeed; savedDraft?: { sections: ReportSectionContent[] } | null }) => {
        if (cancelled) return;
        if (!payload.ok || !payload.workspace) throw new Error(payload.error || "보고서를 불러오지 못했습니다.");
        // 저장된 편집본이 있으면 그것을, 없으면 방금 만든 시드를 쓴다(기존 웹뷰와 같은 우선순위).
        const sections = payload.savedDraft?.sections?.length ? payload.savedDraft.sections : payload.workspace.sections;
        const found = sections.find((item) => item.numeral === numeral) ?? sections[0];
        if (!found) throw new Error("장을 찾지 못했습니다.");
        setSection(found);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
  }, [sourceFileUrl, numeral]);

  if (error) return <p className="p-10 text-sm text-[#c44848]">{error}</p>;
  if (!section) return <p className="p-10 text-sm text-[#94a0b2]">불러오는 중…</p>;
  return (
    <div className="flex min-h-screen justify-center bg-[#eef0f4] py-10">
      <ChapterEditor section={section} sourceFileUrl={sourceFileUrl} firstPage={1} footerBrand="Alphabrothers" footerYear={String(new Date().getFullYear())} />
    </div>
  );
}
