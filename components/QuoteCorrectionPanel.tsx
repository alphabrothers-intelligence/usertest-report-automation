"use client";

/**
 * 문서 전체 인용문의 끝맺음·오탈자·띄어쓰기를 한 번에 검토하는 모달 패널.
 * 화면 서식은 왼쪽 근거 패널과 같은 애플 시스템을 쓴다(`.studio-ui`, 2026-09-11) —
 * 종류 칩·위험도 배지·항상 떠 있던 입력칸을 빼고, 한 항목을 **원래 문장(회색) →
 * 고친 문장(연파랑 형광펜)** 두 줄로만 보여준다. 취소선은 읽기를 방해해서 뺐다(2026-09-11). 직접 고칠 때만 입력칸을 펼친다.
 * `/api/report-workspace/text-corrections`(세션 E)를 문항별로 호출해 결과를 모으고,
 * 체크된 항목만 부모(`ReportWebDocument`)의 `onApply`로 넘긴다 — 실제 본문 DOM 수정은
 * 부모가 기존 `applyQuoteCompletion`과 같은 패턴으로 처리한다.
 */
import { useState } from "react";
import type { ReportSectionContent } from "@/lib/report/sections";

export type BatchCorrectionItem = {
  quote: string;
  suggestion: string;
  kind: "ending" | "typo" | "tone";
  risk: "low" | "review";
  questionKey: string;
  questionLabel?: string;
  /** 같은 문장이 여러 문항에 있을 때 몇 개였는지. 목록에는 한 줄로만 나온다(아래 runScan 주석). */
  questionCount?: number;
};

type ApiItem = { quote: string; suggestion: string; changedFrom: string; changedTo: string; kind: "ending" | "typo" | "tone"; risk: "low" | "review" };

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
  /** 입력칸은 "직접 고치기"를 누른 항목에만 펼친다 — 전부 띄워두면 목록이 읽히지 않는다. */
  const [editing, setEditing] = useState<Set<string>>(new Set());

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
      // **같은 문장은 한 줄로 합친다.** 교정 결과는 문장 텍스트에만 달려 있고, 실제 반영
      // (useReportEvidence의 applyBatchCorrections)도 문서 전체에서 같은 텍스트를 한꺼번에
      // 바꾼다. 그런데 목록은 문항별로 나열해서, 여러 문항에 같은 문장이 있으면
      // (실측: 케어클 "없음"이 'GLOW'·'SHOT' 두 문항에) React key가 충돌하고
      // (`Encountered two children with the same key`) 체크 상태도 서로 엉켰다 —
      // checked/edited가 인용문 텍스트를 키로 쓰기 때문. 합치면 셋 다 한 번에 맞는다.
      const merged = new Map<string, BatchCorrectionItem>();
      for (const item of results.flat()) {
        const found = merged.get(item.quote);
        if (found) found.questionCount = (found.questionCount ?? 1) + 1;
        else merged.set(item.quote, { ...item, questionCount: 1 });
      }
      const flat = [...merged.values()];
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

  const riskyCount = items.filter((item) => item.risk !== "low").length;
  const KIND_LABEL: Record<BatchCorrectionItem["kind"], string> = { ending: "끝맺음", typo: "오탈자·띄어쓰기", tone: "말투" };

  return (
    <div className="studio-ui fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-[18px] bg-white">
        <div className="flex items-start justify-between gap-5 px-12 pb-7 pt-10">
          <div>
            <p className="text-[32px] font-semibold leading-[1.1] tracking-[-0.374px] text-[#1d1d1f]">인용문 검토</p>
            <p className="mt-3.5 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#333333]">
              {status === "done" && items.length > 0
                ? <>문서 전체에서 {items.length}건을 찾았습니다.{riskyCount > 0 && <span className="text-[#c2410c]"> {riskyCount}건은 뜻이 바뀔 수 있어 빼두었습니다.</span>}</>
                : "문서 전체 인용문의 끝맺음·오탈자·띄어쓰기·말투를 한 번에 훑습니다."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-[22px] leading-none text-[#7a7a7a] hover:text-[#1d1d1f]" aria-label="닫기">×</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-[#e0e0e0]">
          {status === "idle" && <p className="px-12 py-8 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#7a7a7a]">AI 호출이 필요해 30초쯤 걸립니다.</p>}
          {status === "loading" && <p className="px-12 py-8 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#7a7a7a]">인용문을 훑고 있습니다...</p>}
          {status === "error" && <p className="px-12 py-8 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#c2410c]">검토에 실패했습니다. 다시 시도해주세요.</p>}
          {status === "done" && items.length === 0 && <p className="px-12 py-8 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#7a7a7a]">고칠 인용문을 찾지 못했습니다.</p>}

          {items.map((item) => {
            const value = edited.get(item.quote) ?? item.suggestion;
            const unchanged = value === item.quote;
            const open = editing.has(item.quote);
            return (
              <div key={item.quote} className={`flex gap-5 border-b border-[#f0f0f0] px-12 py-6 ${open ? "bg-[#fafafc]" : ""}`}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked.has(item.quote)}
                  aria-label={`${item.quote} 적용`}
                  onClick={() => toggle(item.quote)}
                  className={`mt-1 size-5 shrink-0 rounded-full ${checked.has(item.quote) ? "bg-[#0066cc]" : "border border-[#d2d2d7] bg-white"}`}
                >
                  {checked.has(item.quote) && <svg viewBox="0 0 24 24" className="size-5 p-1 text-white" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-[1.47] tracking-[-0.374px] text-[#7a7a7a]">{item.quote}</p>
                  {unchanged
                    ? <p className="mt-1.5 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#c2410c]">강조어·비속어는 지우면 응답자 의도가 바뀌므로 자동으로 고치지 않습니다. 아래에서 직접 다듬어주세요.</p>
                    : <p className="mt-1.5 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]"><mark className="rounded-[2px] bg-[#dce7fa] text-[#1d1d1f]">{value}</mark></p>}
                  {open && (
                    <input
                      type="text"
                      value={value}
                      onChange={(event) => setEdited((previous) => new Map(previous).set(item.quote, event.target.value))}
                      className="mt-2.5 w-full rounded-[11px] border border-[#e0e0e0] px-4 py-3 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f] outline-none focus:border-[#0071e3]"
                    />
                  )}
                  <p className="mt-2.5 text-[14px] leading-[1.43] tracking-[-0.224px] text-[#7a7a7a]">
                    {KIND_LABEL[item.kind]}
                    {item.risk !== "low" && <span className="font-semibold text-[#c2410c]"> · 뜻이 바뀔 수 있어 빼두었습니다</span>}
                    {item.questionLabel && ` · ${item.questionLabel}`}
                    {(item.questionCount ?? 1) > 1 && ` 외 ${(item.questionCount ?? 1) - 1}문항`}
                    {" · "}
                    <button type="button" onClick={() => setEditing((previous) => { const next = new Set(previous); if (next.has(item.quote)) next.delete(item.quote); else next.add(item.quote); return next; })} className="text-[#0066cc]">
                      {open ? "접기" : "직접 고치기"}
                    </button>
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-5 border-t border-[#e0e0e0] px-12 py-7">
          {status !== "done" ? (
            <button type="button" onClick={() => void runScan()} disabled={!sourceFileUrl || status === "loading"} className="rounded-full bg-[#0066cc] px-[22px] py-[11px] text-[13px] leading-none tracking-[-0.374px] text-white hover:bg-[#0071e3] disabled:cursor-not-allowed disabled:opacity-60">
              {status === "loading" ? "검토 중..." : status === "error" ? "다시 시도" : "검토 시작"}
            </button>
          ) : (
            <button type="button" onClick={apply} disabled={checked.size === 0} className="rounded-full bg-[#0066cc] px-[22px] py-[11px] text-[13px] leading-none tracking-[-0.374px] text-white hover:bg-[#0071e3] disabled:cursor-not-allowed disabled:opacity-40">
              {checked.size}건 수정하기
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded-full bg-[#f0f0f2] px-[22px] py-[11px] text-[13px] leading-none tracking-[-0.374px] text-[#1d1d1f] hover:bg-[#e6e6eb]">닫기</button>
          {status === "done" && <span className="ml-auto text-[14px] leading-[1.43] tracking-[-0.224px] text-[#7a7a7a]">체크한 항목만 본문에 반영됩니다</span>}
        </div>
      </div>
    </div>
  );
}
