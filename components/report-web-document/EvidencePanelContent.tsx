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

/** 사람이 직접 눈으로 확인해야 하는 항목 — 나머지(계산 방식 등)는 참고용 사실이다. */
const ACTION_BULLET_LABELS = new Set(["확인할 내용", "검증할 부분"]);

export type PolarityReviewTarget = {
  /** 확인 결과를 적용할 때 다시 만들 문항 블록을 찾는 기준. */
  blockId: string;
  questionKey: string;
  label: string;
  polarity: "positive" | "negative" | "neutral" | "";
  reason: string;
  signals: string[];
  quotes: string[];
};

const POLARITY_LABEL: Record<string, string> = { positive: "긍정", negative: "부정", neutral: "중립" };

/** 판정을 흔들리게 만든 표현에 형광펜을 친다 — "무엇을 보고 이 판정이 나왔는지"가 카드에서 바로 보이도록. */
function QuoteWithSignals({ quote, signals }: { quote: string; signals: string[] }) {
  const pattern = signals.filter(Boolean).map((signal) => signal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (!pattern) return <>{quote}</>;
  return (
    <>
      {quote.split(new RegExp(`(${pattern})`)).map((part, index) =>
        signals.includes(part)
          ? <mark key={`${part}-${index}`} className="rounded bg-[#ffe9b8] px-0.5 text-inherit">{part}</mark>
          : <span key={`${part}-${index}`}>{part}</span>,
      )}
    </>
  );
}

/**
 * 극성 판정 확인 카드(2026-09-02). **경고가 아니라 결정 화면이다.**
 *
 * 첫 판(같은 날 오전)은 사유·판단 기준·형광펜 설명·되돌리기 안내를 다 문장으로 적어 18줄이
 * 넘었고, "읽을 게 너무 많아 빨리 판단할 수 없다"는 지적을 받았다. 지금은 **판단에 실제로
 * 필요한 것만** 남긴다:
 *  - 무엇을 판단하나 → 묶음 이름 + 한 줄 사유
 *  - 무엇을 보고 판단하나 → 응답 원문(판정 근거가 된 표현에 형광펜)
 *  - 어떻게 결정하나 → 두 버튼. **판단 기준은 별도 문단이 아니라 버튼 밑 한 마디로** 붙인다
 *    (기준을 읽는 곳과 고르는 곳이 같아야 한 번에 끝난다).
 */
export function PolarityReviewCard({
  target,
  status,
  onDecide,
}: {
  target: PolarityReviewTarget;
  status: "idle" | "loading" | "error";
  onDecide: (polarity: PolarityReviewTarget["polarity"] | null) => void;
}) {
  const current = POLARITY_LABEL[target.polarity] ?? "미분류";
  const alternative = target.polarity === "neutral" ? "negative" : "neutral";
  const busy = status === "loading";
  const hint: Record<string, string> = { positive: "만족·칭찬", negative: "구체적 불편 있음", neutral: "취향·단순 감상" };
  return (
    <section className="mb-3 overflow-hidden rounded-xl border border-[#ecd6ae] bg-[#fffaf1]">
      <div className="px-3.5 pb-2.5 pt-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-[#b08a3c]">극성 확인</p>
        <p className="mt-1 text-[15px] font-bold leading-5 text-[#1f3554]">{target.label}</p>
        <p className="mt-1 text-[11px] leading-4 text-[#8a7c60]">감정 표현만 있고 구체적인 불편이 없습니다</p>
      </div>
      <ul className="space-y-1.5 border-t border-[#f0e3c8] bg-white px-3.5 py-2.5">
        {target.quotes.map((quote) => (
          <li key={quote} className="text-[12px] leading-5 text-[#354158]">“<QuoteWithSignals quote={quote} signals={target.signals} />”</li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2 border-t border-[#f0e3c8] p-2.5">
        {([target.polarity, alternative] as const).map((choice, index) => (
          <button
            key={choice}
            type="button"
            disabled={busy}
            onClick={() => onDecide(index === 0 ? null : choice)}
            className={`rounded-lg px-2 py-2 text-center disabled:opacity-60 ${index === 0 ? "border border-[#d9c49b] bg-white hover:bg-[#fffdf8]" : "bg-[#946313] hover:bg-[#7d5310]"}`}
          >
            <span className={`block text-xs font-bold ${index === 0 ? "text-[#946313]" : "text-white"}`}>
              {index === 0 ? `${current} 유지` : `${POLARITY_LABEL[choice]}으로 변경`}
            </span>
            <span className={`mt-0.5 block text-[10px] leading-3 ${index === 0 ? "text-[#a8905f]" : "text-white/75"}`}>
              {hint[choice]}
            </span>
          </button>
        ))}
      </div>
      {(busy || status === "error") && (
        <p className="border-t border-[#f0e3c8] px-3.5 py-2 text-[11px] text-[#8a7c60]">
          {busy ? "보고서에 반영하는 중..." : "반영하지 못했습니다. 다시 눌러주세요."}
        </p>
      )}
    </section>
  );
}

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

/** 도표·해석마다 "그래서 내가 뭘 봐야 하나"를 한 줄로. 근거 목록에 없으면 종류별 기본 문장. */
function actionLine(reference: AnalysisReference, actions: string[]): string {
  if (actions.length > 0) return actions.join(" ");
  return reference.kind === "제언"
    ? "AI가 쓴 초안입니다. 아래 근거와 어긋나는 문장이 있으면 본문에서 바로 고치세요."
    : "아래 근거만으로 이 내용이 설명되는지 보고, 빠진 근거가 있으면 본문을 고치세요.";
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
  // **기본 화면은 "확인할 것" 한 덩어리뿐이다**(2026-09-02 담당자 지적 — 여섯 줄을 다 읽어야
  // 뭘 봐야 하는지 알 수 있어 검토가 느려진다). 계산 과정·데이터 출처는 필요할 때만 펼친다.
  const details = reference.bullets.filter((bullet) => !ACTION_BULLET_LABELS.has(bullet.split(": ")[0]));
  const actions = reference.bullets
    .filter((bullet) => ACTION_BULLET_LABELS.has(bullet.split(": ")[0]))
    .map((bullet) => bullet.split(": ").slice(1).join(": "));
  return (
    <section key={reference.title} className="quote-context-updated rounded-xl border border-[#c9daf2] bg-[#f5f9ff] p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-[#1473e6]"><span className="h-1.5 w-1.5 rounded-full bg-[#1473e6]" />{reference.kind === "정량 계산" ? "현재 보고 있는 도표" : "현재 보고 있는 분석"}</p>
      <p className="mt-1.5 text-[17px] font-bold leading-6 tracking-[-0.035em] text-[#1f3554]">{reference.title}</p>
      <p className="mt-1.5 inline-flex rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-[#315c9c]">{reference.kind}</p>

      <div className="mt-3 rounded-lg border border-[#ecd6ae] bg-[#fffaf1] p-3">
        <p className="text-[11px] font-bold text-[#946313]">직접 확인할 것</p>
        <p className="mt-1 text-[13px] leading-6 text-[#4d4432]">{actionLine(reference, actions)}</p>
      </div>

      {details.length > 0 && (
        <details className="group mt-2 rounded-lg bg-white px-3 py-2">
          <summary className="cursor-pointer list-none text-[11px] font-bold text-[#5c7ba6] [&::-webkit-details-marker]:hidden">
            {reference.kind === "정량 계산" ? "이 그래프가 만들어진 방식" : "이 내용이 생성된 근거"} {details.length}가지
            <span className="ml-1 font-medium text-[#8a99ad] group-open:hidden">펼치기</span>
            <span className="ml-1 hidden font-medium text-[#8a99ad] group-open:inline">접기</span>
          </summary>
          <div className="mt-2 space-y-2 border-t border-[#eef2f7] pt-2">
            {details.map((bullet) => {
              const [label, ...rest] = bullet.split(": ");
              const body = rest.join(": ");
              return (
                <div key={bullet}>
                  <p className="text-[11px] font-bold text-[#7a8799]">{body ? label : "근거"}</p>
                  <p className="mt-0.5 text-[12px] leading-5 text-[#53627a]">{body || bullet}</p>
                </div>
              );
            })}
            <p className="pt-1 text-[11px] leading-4 text-[#96a1b1]">
              {reference.kind === "정량 계산"
                ? "값은 위 계산으로 자동 생성됩니다. 계산이 맞는지가 아니라 문항과 항목의 연결을 보세요."
                : "직접 인용문이 아니라 위 근거를 종합해 생성된 문장입니다."}
            </p>
          </div>
        </details>
      )}

      {reference.kind === "제언" && sourceFileUrl && (
        <>
          <button type="button" onClick={onRegenerate} disabled={recommendationStatus === "loading"} className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-[#1473e6] px-3 py-2.5 text-xs font-bold text-white hover:bg-[#0f65cf] disabled:cursor-wait disabled:opacity-70">
            {recommendationStatus === "loading" && <span className="inline-block size-3 animate-spin rounded-full border-2 border-white/45 border-t-white" />}
            {recommendationStatus === "loading" ? "근거를 바탕으로 다시 생성 중" : "AI로 제언 다시 생성"}
          </button>
          {recommendationStatus === "error" && <div className="mt-2 rounded-md bg-[#fff3f1] p-2 text-[11px] leading-5 text-[#b54747]">{recommendationError}<button type="button" onClick={onRegenerate} className="ml-1 font-bold underline">다시 시도</button></div>}
        </>
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
