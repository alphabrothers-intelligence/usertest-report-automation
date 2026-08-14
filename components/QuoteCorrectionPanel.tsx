"use client";

/**
 * 문서 전체 인용문의 끝맺음·오탈자·띄어쓰기를 한 번에 검토하는 모달 패널.
 * `/api/report-workspace/text-corrections`(세션 E)를 문항별로 호출해 결과를 모으고,
 * 체크된 항목만 부모(`ReportWebDocument`)의 `onApply`로 넘긴다 — 실제 본문 DOM 수정은
 * 부모가 기존 `applyQuoteCompletion`과 같은 패턴으로 처리한다.
 */
import { useState } from "react";
import { splitHighlightParts } from "@/lib/report/quoteEnding";
import type { ReportSectionContent } from "@/lib/report/sections";

export type BatchCorrectionItem = {
  quote: string;
  suggestion: string;
  kind: "ending" | "typo";
  risk: "low" | "review";
  questionKey: string;
  questionLabel?: string;
};

type ApiItem = { quote: string; suggestion: string; changedFrom: string; changedTo: string; kind: "ending" | "typo"; risk: "low" | "review" };

function collectDocumentQuotes(sections: ReportSectionContent[]): Map<string, Set<string>> {
  const byQuestion = new Map<string, Set<string>>();
  for (const section of sections) {
    for (const block of section.blocks) {
      if (block.kind !== "text" && block.kind !== "rich-static") continue;
      const doc = new DOMParser().parseFromString(block.html, "text/html");
      for (const node of Array.from(doc.body.querySelectorAll<HTMLElement>("[data-quote-text]"))) {
        const questionKey = node.getAttribute("data-quote-source");
        const encoded = node.getAttribute("data-quote-text");
        const quote = encoded ? decodeURIComponent(encoded) : "";
        if (!questionKey || !quote) continue;
        if (!byQuestion.has(questionKey)) byQuestion.set(questionKey, new Set());
        byQuestion.get(questionKey)!.add(quote);
      }
    }
  }
  return byQuestion;
}

export function QuoteCorrectionPanel({
  open,
  onClose,
  sections,
  sourceFileUrl,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  sections: ReportSectionContent[];
  sourceFileUrl: string | null;
  onApply: (items: BatchCorrectionItem[]) => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "done">("idle");
  const [items, setItems] = useState<BatchCorrectionItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState<Map<string, string>>(new Map());

  async function runScan() {
    if (!sourceFileUrl) return;
    setStatus("loading");
    try {
      const byQuestion = collectDocumentQuotes(sections);
      const results = await Promise.all([...byQuestion.entries()].map(async ([questionKey, quotes]) => {
        const response = await fetch("/api/report-workspace/text-corrections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: sourceFileUrl, questionKey, quotes: [...quotes] }),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) return [];
        const questionLabel = result.questionLabel as string | undefined;
        return (result.items as ApiItem[]).map((item) => ({ quote: item.quote, suggestion: item.suggestion, kind: item.kind, risk: item.risk, questionKey, questionLabel }));
      }));
      const flat = results.flat();
      setItems(flat);
      // 결정론적("low")으로 나온 항목만 기본 체크 — LLM이 손댄 항목은 항상 사람이 한 번은
      // 보게 하는 이 프로젝트의 표준 원칙(5자 diff 가드레일과 같은 취지)을 기본값에도 적용.
      setChecked(new Set(flat.filter((item) => item.risk === "low").map((item) => item.quote)));
      setEdited(new Map());
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  function toggle(quote: string) {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(quote)) next.delete(quote); else next.add(quote);
      return next;
    });
  }

  function toggleAll() {
    setChecked((previous) => (previous.size === items.length ? new Set() : new Set(items.map((item) => item.quote))));
  }

  function apply() {
    const applied = items
      .filter((item) => checked.has(item.quote))
      .map((item) => ({ ...item, suggestion: edited.get(item.quote) ?? item.suggestion }))
      .filter((item) => item.suggestion.trim() && item.suggestion !== item.quote);
    if (applied.length === 0) return;
    onApply(applied);
    setItems((previous) => previous.filter((item) => !checked.has(item.quote)));
    setChecked(new Set());
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e3e8ef] px-5 py-4">
          <div>
            <p className="text-base font-bold text-[#263449]">인용문 일괄 검토</p>
            <p className="mt-1 text-xs leading-5 text-[#7a8799]">문서 전체 인용문의 끝맺음·오탈자·띄어쓰기를 검토합니다. AI가 손댄 항목(&ldquo;확인 필요&rdquo;)은 적용 전 꼭 확인해주세요.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-lg text-[#8a94a3] hover:bg-[#f2f5f9]" aria-label="닫기">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {status === "idle" && <p className="text-sm leading-6 text-[#748196]">문서 전체 인용문을 검토합니다. AI 호출이 필요해 다소 시간이 걸릴 수 있습니다.</p>}
          {status === "loading" && <div className="flex items-center gap-2 text-sm text-[#748196]"><span className="inline-block size-3 animate-spin rounded-full border-2 border-[#c9daf2] border-t-[#315c9c]" />전체 인용문을 검토하고 있습니다...</div>}
          {status === "error" && <p className="text-sm leading-6 text-[#b54747]">검토에 실패했습니다. 다시 시도해주세요.</p>}
          {status === "done" && items.length === 0 && <p className="text-sm leading-6 text-[#748196]">교정이 필요한 인용문을 찾지 못했습니다.</p>}
          {items.length > 0 && (
            <>
              <label className="mb-3 flex items-center gap-2 text-xs font-semibold text-[#315c9c]">
                <input type="checkbox" checked={checked.size === items.length} onChange={toggleAll} />
                전체 선택 ({checked.size}/{items.length})
              </label>
              <div className="space-y-3">
                {items.map((item) => {
                  const value = edited.get(item.quote) ?? item.suggestion;
                  const parts = splitHighlightParts(item.quote, value);
                  return (
                    <div key={item.quote} className="rounded-lg border border-[#dbe3ee] p-3">
                      <div className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1 shrink-0" checked={checked.has(item.quote)} onChange={() => toggle(item.quote)} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                            <span className="rounded bg-[#eef0f3] px-1.5 py-0.5 text-[#596273]">{item.kind === "ending" ? "끝맺음" : "오탈자·띄어쓰기"}</span>
                            <span className={`rounded px-1.5 py-0.5 ${item.risk === "low" ? "bg-[#e7f6ec] text-[#2f7a4d]" : "bg-[#fff3f1] text-[#a64d32]"}`}>{item.risk === "low" ? "안전" : "확인 필요"}</span>
                            {item.questionLabel && <span className="font-medium text-[#9aa5b5]">{item.questionLabel}</span>}
                          </div>
                          <p className="mt-1.5 text-xs leading-5 text-[#8a94a3] line-through decoration-[#c9433c]/50">{item.quote}</p>
                          <p className="mt-1 text-xs leading-5 text-[#354158]">{parts.prefix}<mark className="rounded bg-[#cfe8ff] text-[#174e91]">{parts.middle}</mark>{parts.suffix}</p>
                          <input
                            type="text"
                            value={value}
                            onChange={(event) => setEdited((previous) => new Map(previous).set(item.quote, event.target.value))}
                            className="mt-2 w-full rounded border border-[#ccd5e0] px-2 py-1 text-xs text-[#354158]"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <div className="flex gap-2 border-t border-[#e3e8ef] px-5 py-4">
          {status !== "done" ? (
            <button type="button" onClick={() => void runScan()} disabled={!sourceFileUrl || status === "loading"} className="flex-1 rounded-lg bg-[#1473e6] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0f65cf] disabled:cursor-not-allowed disabled:opacity-60">
              {status === "loading" ? "검토 중..." : status === "error" ? "다시 시도" : "전체 인용문 검토 시작"}
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-[#ccd5e0] px-3 py-2.5 text-sm font-semibold text-[#667085]">닫기</button>
              <button type="button" onClick={apply} disabled={checked.size === 0} className="flex-1 rounded-lg bg-[#1473e6] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0f65cf] disabled:cursor-not-allowed disabled:opacity-60">선택 항목 적용 ({checked.size})</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
