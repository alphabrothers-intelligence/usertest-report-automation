import { headTrim, narrowQuoteToEvidence } from "@/lib/pipeline/anchorQuotes";
import { buildQuoteDisplayText } from "@/lib/pipeline/stage2";
import { CONNECTIVE_ENDINGS } from "@/lib/report/quoteEnding";

const MAX_QUOTE_CHARS = 130;
const MARK = /\*\*__([\s\S]+?)__\*\*/;
/** 절 경계: 문장 끝(소수점 제외)·줄바꿈·쉼표·목록 구분자. */
const CLAUSE_BREAK = /[.!?]+(?=\s|$)\s*|\n+|,\s*|\s*\/\s*/g;
/** 강조 한 곳의 최대 길이. 인용문 거의 전체를 칠한 것은 "절대 안 된다"는 지적(2026-09-30 리바랩스). */
const MAX_SPAN_CHARS = 70;
/**
 * 강조 끝에서 절 끝까지 남은 말이 이 정도로 짧으면 강조에 포함한다. 한국어는 평가·이유가 절
 * **끝**에 온다 — "육성을 해도 모습이 바뀌지 않는점"만 칠하면 "~은 아쉬웠다"가 빠져 무엇이 근거인지
 * 안 읽힌다(2026-09-30 담당자 지적).
 */
const TAIL_CHARS = 15;

function bigrams(text: string): Set<string> {
  const compact = text.replace(/[^가-힣A-Za-z0-9]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < compact.length - 1; i += 1) out.add(compact.slice(i, i + 2));
  return out;
}

function overlap(text: string, target: Set<string>): number {
  let score = 0;
  for (const gram of bigrams(text)) if (target.has(gram)) score += 1;
  return score;
}

function clausesOf(text: string): string[] {
  const out: string[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CLAUSE_BREAK)) {
    out.push(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
  }
  out.push(text.slice(cursor));
  return out.map((clause) => clause.trim()).filter((clause) => clause.length >= 4);
}

/**
 * 인용문에서 **인사이트를 뒷받침하는 절** 하나를 고른다 — 카테고리명·인사이트와 겹치는 두 글자
 * 조각이 가장 많은 절을, 첫 겹침 어절부터 **절 끝까지**. 겹침이 없어도 비워두지 않는다
 * (담당자 기준은 "모든 인용문에 근거 강조") — 그때는 가장 앞의 절을 쓴다.
 * ponytail: 글자 겹침 휴리스틱이라 동의어("편의"↔"편리")는 못 잡는다. 모델이 준 근거 구간이
 * 우선이고 이건 그게 없을 때의 대체다.
 */
function pickEvidenceClause(quote: string, target: Set<string>): string | null {
  let best: { text: string; score: number } | null = null;
  for (const text of clausesOf(quote)) {
    const score = overlap(text, target);
    if (!best || score > best.score) best = { text, score };
  }
  if (!best || best.score === 0) return best?.text ?? null;
  const first = [...best.text.matchAll(/\S+/g)].find((word) => overlap(word[0], target) > 0);
  return first ? best.text.slice(first.index) : best.text;
}

/** 앞 어절을 덜어 `limit` 이하로. 가능하면 "~는데·~고" 같은 연결어미 **뒤**에서 시작한다(절 경계). */
function trimFront(span: string, limit: number): string {
  if (span.length <= limit) return span;
  const words = [...span.matchAll(/\S+/g)];
  const fits = (i: number) => span.length - words[i].index <= limit;
  const atClause = (i: number) => /[,，]$/.test(words[i - 1][0]) || CONNECTIVE_ENDINGS.some((ending) => words[i - 1][0].endsWith(ending));
  for (let i = 1; i < words.length - 1; i += 1) if (fits(i) && atClause(i)) return span.slice(words[i].index);
  for (let i = 1; i < words.length - 1; i += 1) if (fits(i)) return span.slice(words[i].index);
  return span;
}

/**
 * 인용문 한 문장이 거의 통째로 강조 대상일 때는 **뒤를** 덜어 이유절(~해서·~는데)에서 끝낸다.
 * 앞을 덜면 "있어 매우 편리하다고 느꼈다"처럼 시작이 어색해진다(2026-09-30 실측).
 * 연결어미 경계가 없으면 앞을 덜어낸다.
 */
function trimToReason(span: string, limit: number): string {
  if (span.length <= limit) return span;
  const words = [...span.matchAll(/\S+/g)];
  for (let i = words.length - 2; i >= 1; i -= 1) {
    const word = words[i][0];
    const end = words[i].index + word.length;
    if (end <= limit && end >= 8 && (/[,，]$/.test(word) || CONNECTIVE_ENDINGS.some((ending) => word.endsWith(ending)))) {
      return span.slice(0, end).replace(/[,，]$/, "");
    }
  }
  return trimFront(span, limit);
}

/**
 * 강조 구간을 다듬는다 — (1) 절 끝까지 몇 글자 안 남았으면 거기까지 늘리고(평가어 포함),
 * (2) 길면 **앞을** 덜고(뒤를 자르면 "…해당 게임은"처럼 이유가 끊긴다), (3) 인용문 거의 전부면
 * 앞을 더 덜어 `buildQuoteDisplayText`의 "통째 강조 금지"에 걸려 사라지지 않게 한다.
 */
function shapeSpan(span: string, text: string): string {
  const at = text.indexOf(span);
  if (at < 0) return span;
  let end = at + span.length;
  const rest = text.slice(end);
  const breakAt = rest.search(/[.!?]+(?=\s|$)|\n|,|\s\/\s/);
  const tail = breakAt < 0 ? rest : rest.slice(0, breakAt);
  if (tail.trim().length > 0 && tail.trim().length <= TAIL_CHARS) end += tail.replace(/\s+$/, "").length;
  let shaped = text.slice(at, end).trim();
  shaped = trimFront(shaped, MAX_SPAN_CHARS);
  if (text.length > 25) shaped = trimToReason(shaped, Math.floor(text.length * 0.85));
  return shaped.length >= 4 ? shaped : span;
}

/**
 * 저장된 인용문을 보고서에 싣기 직전의 마지막 보정. **어떤 raw data·어떤 생성 경로에서 온
 * 인용문이든** 여기를 거치므로 다음을 보장한다(2026-09-30 케어클·리바랩스 실측):
 *  1. 130자를 넘는 인용문을 통째로 싣지 않는다 — 근거 절 주변으로 좁히고, 못 좁히면 앞에서 자른다.
 *  2. 근거 강조(볼드+밑줄)가 비어 있으면 인사이트와 가장 많이 겹치는 절을 강조한다.
 *  3. 강조는 한 곳, 이유·평가어가 끊기지 않게 절 끝까지, 길면 앞을 덜어 MAX_SPAN_CHARS 이하.
 * 자르는 방법은 원문의 연속 구간 고르기뿐이라 verbatim은 그대로다.
 */
export function prepareQuote(quote: string, display: string | undefined, context: string): { quote: string; display: string } {
  const target = bigrams(context);
  const marked = display?.match(MARK)?.[1] ?? null;
  let span = marked ?? pickEvidenceClause(quote, target);

  let text = quote;
  if (quote.length > MAX_QUOTE_CHARS) {
    const narrowed = span ? narrowQuoteToEvidence(quote, span) : null;
    text = narrowed && narrowed.length <= MAX_QUOTE_CHARS ? narrowed : headTrim(quote);
    if (span && !text.includes(span)) span = pickEvidenceClause(text, target);
  }

  if (span) span = shapeSpan(span, text);
  if (text === quote && marked && span === marked) return { quote, display: display! };
  return { quote: text, display: span ? buildQuoteDisplayText(text, [{ quote: text, reasonSpan: span }]) : text };
}
