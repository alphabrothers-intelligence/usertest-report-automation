"use client";

import type { ReactNode } from "react";
import type { AnalysisReference } from "@/components/report-web-document/analysisEvidence";
import { reportQuoteReviewToken } from "@/lib/report/quoteEnding";

export type QuoteSourceResult = {
  questionLabel: string;
  groupLabel: string;
  sources: Array<{
    questionLabel?: string;
    sectionLabel?: string;
    respondentId: number;
    originalResponse: string;
    matches: Array<{ quote: string; matchStart: number; matchEnd: number; needsReview: boolean }>;
  }>;
};

export type QuoteCompletionTarget = { quote: string; originalResponse: string };
export type QuoteCompletion = { completedQuote: string; changedFrom: string; changedTo: string };

// needsReview(서버 판정)는 끝맺음 전용이라 "문장 끝맺음 자동 수정" 버튼에만 쓰고,
// 하이라이트 구간은 띄어쓰기 검토까지 포함하도록 여기서 다시 판정한다.
function QuoteWithEndingReview({ quote }: { quote: string; needsReview?: boolean }) {
  const token = reportQuoteReviewToken(quote);
  if (!token) return <>“{quote}”</>;
  const start = quote.lastIndexOf(token);
  return <>“{quote.slice(0, start)}<span className="decoration-dotted decoration-[1.5px] underline underline-offset-4 decoration-[#d36b62]">{token}</span>{quote.slice(start + token.length)}”</>;
}

function HighlightedOriginal({ text, matches }: { text: string; matches: QuoteSourceResult["sources"][number]["matches"] }) {
  const ranges = matches
    .filter((match) => match.matchStart >= 0 && match.matchEnd > match.matchStart)
    .sort((a, b) => a.matchStart - b.matchStart);
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.matchStart < cursor) return;
    parts.push(text.slice(cursor, range.matchStart));
    parts.push(<mark key={`${range.matchStart}-${index}`} className="rounded bg-[#fff0a8] px-0.5 text-inherit">{text.slice(range.matchStart, range.matchEnd)}</mark>);
    cursor = range.matchEnd;
  });
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export function AnalysisReferenceContent({
  reference,
  sourceFileUrl,
  recommendationStatus,
  recommendationError,
  onRegenerate,
}: {
  reference: AnalysisReference;
  sourceFileUrl?: string | null;
  recommendationStatus: "idle" | "loading" | "error";
  recommendationError: string | null;
  onRegenerate: () => void;
}) {
  return (
    <section key={reference.title} className="quote-context-updated rounded-xl border border-[#c9daf2] bg-[#f5f9ff] p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#1473e6]"><span className="h-1.5 w-1.5 rounded-full bg-[#1473e6]" />현재 보고 있는 분석</p>
      <p className="mt-1.5 text-[18px] font-bold leading-6 tracking-[-0.035em] text-[#1f3554]">{reference.title}</p>
      <p className="mt-2 inline-flex rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-[#315c9c]">{reference.kind}</p>
      <div className="mt-4 border-t border-[#d9e6f7] pt-3">
        <p className="text-sm font-bold text-[#354158]">이 내용이 생성된 근거</p>
        <ul className="mt-2 space-y-2">
          {reference.bullets.map((bullet) => <li key={bullet} className="flex gap-2 text-xs leading-5 text-[#53627a]"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#5c83bc]" />{bullet}</li>)}
        </ul>
        <p className="mt-3 rounded-lg bg-white p-2.5 text-[11px] leading-5 text-[#7a8799]">직접 인용문이 아니라 위 정량·정성 근거를 종합해 생성된 내용입니다.</p>
      </div>
      {reference.kind === "제언" && sourceFileUrl && (
        <div className="mt-3 border-t border-[#d9e6f7] pt-3">
          <p className="text-xs font-bold text-[#354158]">제언 AI 작업</p>
          <p className="mt-1 text-[11px] leading-5 text-[#7a8799]">현재 정량·정성 근거는 유지하고 제언 초안만 다시 생성합니다. 생성 후 본문에서 직접 수정할 수 있습니다.</p>
          <button type="button" onClick={onRegenerate} disabled={recommendationStatus === "loading"} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#1473e6] px-3 py-2.5 text-xs font-bold text-white hover:bg-[#0f65cf] disabled:cursor-wait disabled:opacity-70">
            {recommendationStatus === "loading" && <span className="inline-block size-3 animate-spin rounded-full border-2 border-white/45 border-t-white" />}
            {recommendationStatus === "loading" ? "근거를 바탕으로 다시 생성 중" : "AI로 제언 다시 생성"}
          </button>
          {recommendationStatus === "error" && <div className="mt-2 rounded-md bg-[#fff3f1] p-2 text-[11px] leading-5 text-[#b54747]">{recommendationError}<button type="button" onClick={onRegenerate} className="ml-1 font-bold underline">다시 시도</button></div>}
        </div>
      )}
    </section>
  );
}

export function QuoteSourceContent({
  quoteSource,
  quoteCompletionTarget,
  quoteCompletionStatus,
  quoteCompletion,
  onGenerateCompletion,
  onResetCompletion,
  onApplyCompletion,
}: {
  quoteSource: QuoteSourceResult;
  quoteCompletionTarget: QuoteCompletionTarget | null;
  quoteCompletionStatus: "idle" | "loading" | "error";
  quoteCompletion: QuoteCompletion | null;
  onGenerateCompletion: (target: QuoteCompletionTarget) => void;
  onResetCompletion: () => void;
  onApplyCompletion: () => void;
}) {
  return (
    <>
      <section key={`${quoteSource.groupLabel}-${quoteSource.questionLabel}`} className="quote-context-updated rounded-xl border border-[#c9daf2] bg-[#f5f9ff] p-3.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#1473e6]"><span className="h-1.5 w-1.5 rounded-full bg-[#1473e6]" />현재 보고 있는 분석</p>
        <p className="mt-1.5 text-[18px] font-bold leading-6 tracking-[-0.035em] text-[#1f3554]">{quoteSource.groupLabel}</p>
        <div className="mt-3 border-t border-[#d9e6f7] pt-2.5"><p className="text-[11px] font-bold text-[#66758b]">대상 문항</p><p className="mt-1 text-[15px] font-semibold leading-6 tracking-[-0.025em] text-[#315c9c]">{quoteSource.questionLabel}</p></div>
      </section>
      <p className="mt-4 text-[11px] leading-5 text-[#7a8799]">사용된 인용문 {quoteSource.sources.reduce((count, source) => count + source.matches.length, 0)}건 · 원문 응답 {quoteSource.sources.length}건입니다. 확인할 응답만 펼쳐보세요.</p>
      <div className="mt-3 space-y-3">
        {quoteSource.sources.map((source, sourceIndex) => (
          <div key={`${source.sectionLabel}-${source.respondentId}-${source.originalResponse}`}>
            {source.sectionLabel && source.sectionLabel !== quoteSource.sources[sourceIndex - 1]?.sectionLabel && <div className={`mb-2 mt-4 rounded-md px-3 py-2 text-sm font-bold ${source.sectionLabel.includes("부정") ? "bg-[#fff0e5] text-[#a64d32]" : source.sectionLabel.includes("중립") ? "bg-[#eef0f3] text-[#596273]" : "bg-[#eaf3ff] text-[#315c9c]"}`}>{source.sectionLabel}</div>}
            <details open className="group rounded-lg border border-[#e3e8ef] bg-[#f7f9fc]">
              <summary className="cursor-pointer list-none p-3 [&::-webkit-details-marker]:hidden">
                <p className="text-xs font-bold text-[#315c9c]">{source.questionLabel ? `${source.questionLabel} · ` : ""}응답자 {source.respondentId}번 <span className="ml-1 font-medium text-[#7a8799]">인용 {source.matches.length}건</span></p>
                <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[#53627a]"><QuoteWithEndingReview quote={source.matches[0]?.quote ?? ""} needsReview={source.matches[0]?.needsReview ?? false} /></p>
                <p className="mt-2 text-[11px] font-semibold text-[#315c9c] group-open:hidden">원문 펼쳐 보기</p><p className="mt-2 hidden text-[11px] font-semibold text-[#315c9c] group-open:block">원문 접기</p>
              </summary>
              <div className="border-t border-[#e3e8ef] p-3">
                <div className="space-y-2">
                  {source.matches.map((match) => (
                    <div key={match.quote} className="rounded-md border border-[#dbe3ee] bg-white p-2.5">
                      <p className="text-[10px] font-bold text-[#748196]">보고서 인용문</p>
                      <p className="mt-1 text-xs leading-5 text-[#354158]"><QuoteWithEndingReview quote={match.quote} needsReview={match.needsReview} /></p>
                      {match.needsReview && quoteCompletionTarget?.quote !== match.quote && <button type="button" onClick={() => onGenerateCompletion({ quote: match.quote, originalResponse: source.originalResponse })} className="mt-2 rounded-md border border-[#efc1bc] bg-[#fff7f6] px-2.5 py-1.5 text-xs font-bold text-[#b54747] hover:bg-[#fff0ee]">문장 끝맺음 자동 수정</button>}
                      {quoteCompletionTarget?.quote === match.quote && quoteCompletionStatus === "loading" && <div className="mt-2 flex items-center gap-2 rounded-md border border-[#efc1bc] bg-[#fff7f6] px-2.5 py-2 text-xs font-semibold text-[#a64d32]"><span className="inline-block size-3 animate-spin rounded-full border-2 border-[#e7aaa4] border-t-[#b54747]" />문장 끝맺음을 확인하고 있습니다.</div>}
                      {quoteCompletionTarget?.quote === match.quote && quoteCompletionStatus === "error" && <div className="mt-2 rounded bg-[#fff5f3] p-2 text-xs leading-5 text-[#b54747]">보완안을 만들지 못했습니다. 본문의 인용문은 그대로 유지되며 직접 수정할 수 있습니다.<button type="button" onClick={() => onGenerateCompletion({ quote: match.quote, originalResponse: source.originalResponse })} className="ml-1 font-bold underline">다시 시도</button></div>}
                      {quoteCompletionTarget?.quote === match.quote && quoteCompletion && <div className="mt-2 rounded-md border border-[#cfe0f5] bg-[#f7faff] p-2"><p className="text-[10px] font-bold text-[#356df3]">보완안 · 끝어미만 변경</p><p className="mt-1 text-xs leading-5 text-[#354158]">{quoteCompletion.completedQuote.slice(0, quoteCompletion.completedQuote.length - quoteCompletion.changedTo.length)}<mark className="rounded bg-[#cfe8ff] text-[#174e91]">{quoteCompletion.changedTo}</mark></p><div className="mt-2 flex gap-2"><button type="button" onClick={onResetCompletion} className="flex-1 rounded border border-[#ccd5e0] px-2 py-1.5 text-[11px] font-semibold text-[#667085]">유지</button><button type="button" onClick={onApplyCompletion} className="flex-1 rounded bg-[#1473e6] px-2 py-1.5 text-[11px] font-semibold text-white">적용</button></div></div>}
                    </div>
                  ))}
                </div>
                <p className="mb-1 mt-3 text-[10px] font-bold text-[#748196]">응답 원문</p>
                <p className="whitespace-pre-wrap text-sm leading-7 text-[#354158]"><HighlightedOriginal text={source.originalResponse} matches={source.matches} /></p>
              </div>
            </details>
          </div>
        ))}
      </div>
    </>
  );
}
