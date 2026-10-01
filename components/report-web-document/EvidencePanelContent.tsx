"use client";

/**
 * 왼쪽 `분석 근거` 패널의 내용물. **문서 본문이 아니라 작업 화면이라, 원본 보고서 양식이
 * 아닌 애플 디자인 시스템을 쓴다**(2026-09-11 담당자 결정). 규칙 셋:
 *  - 색은 역할로 나눈다. 파랑 `#0066cc`는 "누를 것"(링크·주 버튼)에만, 극성색은 "데이터의 뜻"
 *    에만 쓴다. 극성색은 문서가 쓰는 값과 **같은 값**이어야 한다(lib/report/workspace.ts의
 *    POLARITY_BANNER) — 패널에서 고른 색이 문서에 그대로 나타나야 하기 때문.
 *  - 상자를 겹치지 않는다. 구분은 괘선(#f0f0f0 / #e0e0e0)과 여백으로만.
 *  - 본문 17px/1.47/-0.374px. 예전 11~13px는 "가독성이 제일 우선순위"라는 요구와 맞지 않았다.
 */
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

/**
 * 패널 안의 동작 버튼. **글씨만 파랗게 두지 말 것**(2026-09-11 담당자 지적: "버튼으로 생각되지
 * 않습니다, 너무 글씨만 있어요"). 애플 시스템을 쓰더라도 누를 것은 알약 배경을 입어야 한다 —
 * `variant="plain"`은 본문 안 링크(접기/펼치기)에만 쓴다.
 */
export function PanelButton({
  children,
  onClick,
  variant = "secondary",
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const skin = variant === "primary"
    ? "bg-[#0066cc] text-white hover:bg-[#0071e3]"
    : "bg-[#f0f0f2] text-[#1d1d1f] hover:bg-[#e6e6eb]";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center rounded-full px-4 py-2 text-[13px] font-semibold leading-none tracking-[-0.224px] disabled:cursor-not-allowed disabled:opacity-50 ${skin}`}
    >
      {children}
    </button>
  );
}

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

/** 문서(lib/report/workspace.ts POLARITY_BANNER)와 **같은 값**. 여기서 색을 새로 만들지 말 것. */
const POLARITY_COLOR: Record<string, { bg: string; fg: string }> = {
  positive: { bg: "#c0cdef", fg: "#1e293b" },
  negative: { bg: "#fde4d0", fg: "#c2410c" },
  neutral: { bg: "#e8e8e8", fg: "#52525b" },
};

/** 판정을 고를 때 담당자가 실제로 던지는 질문. 극성 이름이 아니라 이 말이 제목이 된다. */
const POLARITY_ANSWER: Record<string, string> = { negative: "불평이다", neutral: "감상이다", positive: "칭찬이다" };

/**
 * 극성 판정 확인 카드. **봐야 하는 건 응답 문장뿐이다.**
 *
 * 2026-09-11 담당자 지적("갈색이 별로고 뭘 봐야 할지 모르겠다")으로 다시 짰다. 사유 문장·
 * 판단 기준 캡션·감정어 형광펜을 전부 뺐다 — 감정어에 색을 칠하면 "이 색만 보면 된다"로
 * 읽혀 판단이 오히려 좁아진다. 대신 응답을 본문 크기로 키워 카드의 주인공으로 두고,
 * 제목이 곧 질문이 되게 했다. 두 버튼은 문서의 극성 배너색을 그대로 입는다 — **누를 색이
 * 곧 보고서에 찍힐 색**이라 글을 읽지 않아도 무엇을 고르는지 보인다.
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
  const alternative = target.polarity === "neutral" ? "negative" : "neutral";
  const busy = status === "loading";
  const options = [
    { key: target.polarity, answer: POLARITY_ANSWER[target.polarity] ?? "그대로 둔다", caption: `${POLARITY_LABEL[target.polarity] ?? "현재"} 그대로 · 현재`, decide: null },
    { key: alternative, answer: POLARITY_ANSWER[alternative], caption: `${POLARITY_LABEL[alternative]}으로 옮김`, decide: alternative },
  ] as const;
  const current = POLARITY_COLOR[target.polarity] ?? POLARITY_COLOR.neutral;

  return (
    <section className="studio-ui mb-7 border-b border-[#e0e0e0] pb-7">
      <p className="text-[14px] leading-[1.43] tracking-[-0.224px] text-[#7a7a7a]">판정 확인</p>
      <p className="mt-5 text-[14px] font-semibold leading-[1.35] tracking-[-0.374px] text-[#1d1d1f]">
        이 응답은 {POLARITY_ANSWER[target.polarity] === "불평이다" ? "불평" : "감상"}인가요,{" "}
        {POLARITY_ANSWER[alternative] === "감상이다" ? "감상" : "불평"}인가요?
      </p>
      <p className="mt-3.5 text-[13px] font-semibold leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]">{target.label}</p>
      <p className="mt-3 inline-block rounded-full px-3 py-1 text-[14px] font-semibold leading-[1.29] tracking-[-0.224px]" style={{ background: current.bg, color: current.fg }}>
        지금은 {POLARITY_LABEL[target.polarity] ?? "미분류"} 의견
      </p>

      <ul className="mt-6 border-b border-[#f0f0f0]">
        {target.quotes.map((quote) => (
          <li key={quote} className="border-t border-[#f0f0f0] py-[18px] text-[13px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]">{quote}</li>
        ))}
      </ul>

      <div className="mt-6 flex gap-2.5">
        {options.map((option) => {
          const color = POLARITY_COLOR[option.key] ?? POLARITY_COLOR.neutral;
          return (
            <div key={option.key || "current"} className="flex-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecide(option.decide)}
                className="w-full rounded-full px-4 py-3.5 text-center text-[13px] font-semibold leading-none tracking-[-0.374px] disabled:opacity-60"
                style={{ background: color.bg, color: color.fg }}
              >
                {option.answer}
              </button>
              <p className="mt-2 text-center text-[14px] leading-[1.43] tracking-[-0.224px] text-[#7a7a7a]">{option.caption}</p>
            </div>
          );
        })}
      </div>

      {(busy || status === "error") && (
        <p className="mt-4 text-[14px] leading-[1.43] tracking-[-0.224px] text-[#7a7a7a]">
          {busy ? "보고서에 반영하는 중..." : "반영하지 못했습니다. 다시 눌러주세요."}
        </p>
      )}
    </section>
  );
}

export type QuoteCompletionTarget = { quote: string; originalResponse: string };
export type QuoteCompletion = { completedQuote: string; changedFrom: string; changedTo: string };

/**
 * 끝맺음이 잘린 자리 표시. **본문(globals.css의 `[data-quote-ending-token]`)과 같은 붉은
 * 배경을 쓴다** — 예전에는 패널만 붉은 점선 밑줄이라 같은 것이 두 모양으로 보였다
 * (2026-09-11 담당자 지적). 이 표시는 화면 전용이고 저장·인쇄·복사본에는 들어가지 않는다.
 */
function QuoteWithEndingReview({ quote }: { quote: string; needsReview?: boolean }) {
  const token = reportQuoteReviewToken(quote);
  if (!token) return <>{quote}</>;
  const start = quote.lastIndexOf(token);
  return <>{quote.slice(0, start)}<mark className="rounded-[2px] bg-[#ffd8d3] text-inherit shadow-[0_0_0_1px_rgba(211,107,98,.08)]">{token}</mark>{quote.slice(start + token.length)}</>;
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
    parts.push(<mark key={`${range.matchStart}-${index}`} className="rounded-[2px] bg-[#fff0a8] text-[#1d1d1f]">{text.slice(range.matchStart, range.matchEnd)}</mark>);
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
    <section key={reference.title} className="quote-context-updated studio-ui">
      <p className="text-[14px] font-semibold leading-[1.43] tracking-[-0.224px] text-[#0066cc]">
        {reference.kind === "정량 계산" ? "지금 보고 있는 도표" : "지금 보고 있는 분석"}
      </p>
      <p className="mt-3.5 text-[14px] font-semibold leading-[1.35] tracking-[-0.374px] text-[#1d1d1f]">{reference.title}</p>
      <p className="mt-5 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]">{actionLine(reference, actions)}</p>

      {details.length > 0 && (
        <details className="group mt-4">
          <summary className="cursor-pointer list-none text-[13px] leading-[1.47] tracking-[-0.374px] text-[#0066cc] [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">{reference.kind === "정량 계산" ? "계산 방식 보기" : "생성 근거 보기"}</span>
            <span className="hidden group-open:inline">접기</span>
          </summary>
          <div className="mt-4 border-t border-[#f0f0f0]">
            {details.map((bullet) => {
              const [label, ...rest] = bullet.split(": ");
              const body = rest.join(": ");
              return (
                <div key={bullet} className="border-b border-[#f0f0f0] py-4">
                  <p className="text-[14px] leading-[1.43] tracking-[-0.224px] text-[#7a7a7a]">{body ? label : "근거"}</p>
                  <p className="mt-1.5 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#333333]">{body || bullet}</p>
                </div>
              );
            })}
            <p className="pt-4 text-[14px] leading-[1.43] tracking-[-0.224px] text-[#7a7a7a]">
              {reference.kind === "정량 계산"
                ? "값은 위 계산으로 자동 생성됩니다. 계산이 맞는지가 아니라 문항과 항목의 연결을 보세요."
                : "직접 인용문이 아니라 위 근거를 종합해 생성된 문장입니다."}
            </p>
          </div>
        </details>
      )}

      {reference.kind === "제언" && sourceFileUrl && (
        <>
          <button type="button" onClick={onRegenerate} disabled={recommendationStatus === "loading"} className="mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-[#0066cc] px-[22px] py-[11px] text-[13px] leading-none tracking-[-0.374px] text-white hover:bg-[#0071e3] disabled:cursor-wait disabled:opacity-70">
            {recommendationStatus === "loading" && <span className="inline-block size-3 animate-spin rounded-full border-2 border-white/45 border-t-white" />}
            {recommendationStatus === "loading" ? "다시 생성 중" : "AI로 제언 다시 생성"}
          </button>
          {recommendationStatus === "error" && <p className="mt-3 text-[14px] leading-[1.43] tracking-[-0.224px] text-[#c2410c]">{recommendationError}<button type="button" onClick={onRegenerate} className="ml-1.5 text-[#0066cc]">다시 시도</button></p>}
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
  const quoteCount = quoteSource.sources.reduce((count, source) => count + source.matches.length, 0);
  return (
    <section className="quote-context-updated studio-ui" key={`${quoteSource.groupLabel}-${quoteSource.questionLabel}`}>
      <p className="text-[14px] font-semibold leading-[1.43] tracking-[-0.224px] text-[#0066cc]">지금 보고 있는 분석</p>
      <p className="mt-3.5 text-[14px] font-semibold leading-[1.35] tracking-[-0.374px] text-[#1d1d1f]">{quoteSource.groupLabel}</p>
      <p className="mt-2.5 text-[14px] leading-[1.43] tracking-[-0.224px] text-[#7a7a7a]">{quoteSource.questionLabel} · 인용 {quoteCount}건</p>

      <div className="mt-5 border-b border-[#f0f0f0]">
        {quoteSource.sources.map((source, sourceIndex) => (
          <div key={`${source.sectionLabel}-${source.respondentId}-${source.originalResponse}`}>
            {source.sectionLabel && source.sectionLabel !== quoteSource.sources[sourceIndex - 1]?.sectionLabel && (
              <p className="border-t border-[#e0e0e0] pb-1 pt-5 text-[14px] font-semibold leading-[1.29] tracking-[-0.224px] text-[#7a7a7a]">{source.sectionLabel}</p>
            )}
            {/* **원문은 기본 펼침이다**(2026-09-11 담당자 요청 — "누르지 않아도 처음부터 보였으면").
                한때 패널이 길어진다는 이유로 접어뒀는데, 인용문이 원문의 어디서 왔는지 대조하는
                것이 이 패널의 본래 일이라 접으면 매번 한 번씩 더 눌러야 한다. 접는 쪽으로
                되돌리지 말 것. */}
            <details open className="group border-t border-[#f0f0f0]">
              <summary className="cursor-pointer list-none py-[18px] [&::-webkit-details-marker]:hidden">
                <span className="block text-[13px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]">
                  <QuoteWithEndingReview quote={source.matches[0]?.quote ?? ""} needsReview={source.matches[0]?.needsReview ?? false} />
                </span>
                <span className="mt-2.5 block text-[14px] leading-[1.43] tracking-[-0.224px] text-[#7a7a7a]">
                  {source.questionLabel ? `${source.questionLabel} · ` : ""}{source.respondentId}번
                  {source.matches.length > 1 ? ` · 인용 ${source.matches.length}건` : ""}
                  {source.matches.some((match) => match.needsReview) ? <span className="font-semibold text-[#c2410c]"> · 끝맺음 없음</span> : null}
                  <span className="text-[#0066cc]"> · <span className="group-open:hidden">원문</span><span className="hidden group-open:inline">접기</span></span>
                </span>
              </summary>
              <div className="pb-[18px]">
                {source.matches.map((match, matchIndex) => (
                  <div key={match.quote} className="mb-3">
                    {/* 첫 인용문은 위 요약 줄에 이미 있다 — 원문을 기본 펼침으로 되돌린 뒤
                        같은 문장이 연달아 두 번 찍혀서, 둘째 인용문부터만 여기 적는다. */}
                    {matchIndex > 0 && (
                      <p className="mb-1.5 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]"><QuoteWithEndingReview quote={match.quote} needsReview={match.needsReview} /></p>
                    )}
                    {match.needsReview && quoteCompletionTarget?.quote !== match.quote && (
                      <PanelButton onClick={() => onGenerateCompletion({ quote: match.quote, originalResponse: source.originalResponse })}>끝맺음 고치기</PanelButton>
                    )}
                    {quoteCompletionTarget?.quote === match.quote && quoteCompletionStatus === "loading" && (
                      <p className="text-[14px] leading-[1.43] tracking-[-0.224px] text-[#7a7a7a]">끝맺음을 확인하고 있습니다.</p>
                    )}
                    {quoteCompletionTarget?.quote === match.quote && quoteCompletionStatus === "error" && (
                      <><p className="text-[14px] leading-[1.43] tracking-[-0.224px] text-[#c2410c]">보완안을 만들지 못했습니다. 인용문은 그대로 있고 직접 고칠 수 있습니다.</p><div className="mt-2"><PanelButton onClick={() => onGenerateCompletion({ quote: match.quote, originalResponse: source.originalResponse })}>다시 시도</PanelButton></div></>
                    )}
                    {quoteCompletionTarget?.quote === match.quote && quoteCompletion && (
                      <div>
                        <p className="text-[13px] leading-[1.47] tracking-[-0.374px] text-[#1d1d1f]">
                          {quoteCompletion.completedQuote.slice(0, quoteCompletion.completedQuote.length - quoteCompletion.changedTo.length)}
                          <mark className="rounded-[2px] bg-[#dce7fa] text-[#1d1d1f]">{quoteCompletion.changedTo}</mark>
                        </p>
                        <div className="mt-2.5 flex gap-2">
                          <PanelButton variant="primary" onClick={onApplyCompletion}>적용</PanelButton>
                          <PanelButton onClick={onResetCompletion}>그대로 두기</PanelButton>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <p className="mt-1 rounded-[11px] bg-[#f5f5f7] px-5 py-4 text-[13px] leading-[1.47] tracking-[-0.374px] text-[#333333] whitespace-pre-wrap">
                  <HighlightedOriginal text={source.originalResponse} matches={source.matches} />
                </p>
              </div>
            </details>
          </div>
        ))}
      </div>
    </section>
  );
}
