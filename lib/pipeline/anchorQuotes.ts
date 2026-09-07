/**
 * 인용문을 **원문으로 다시 쓰지 않고 위치로 지목**하게 하는 출력 형식.
 *
 * ## 왜
 *
 * 정성 분석 시간은 거의 전부 **출력 토큰**이 결정한다(실측: 출력 5,251토큰 / 149초 ≈ 35토큰/초).
 * 그런데 그 출력의 대부분은 모델이 응답자가 쓴 글을 **그대로 다시 타이핑한 것**이다 — 게다가
 * 지금 스키마는 같은 문장을 두 번 쓴다(`quotes`에 인용문 전체, `quoteEvidence.reasonSpan`에
 * 그 안의 근거 구간).
 *
 * 위치만 지목하게 하면 모델이 쓸 글자가 줄어 시간·비용이 같이 준다. **같은 문항·같은 25명으로
 * 실측(2026-09-01): 50초 → 29초(41%↓), 출력 5,501 → 2,519토큰(54%↓), 인용문 36개 전부
 * 원문에서 정확히 복원(36/36).**
 *
 * ## 품질에 영향이 없는 이유
 *
 * 모델이 읽는 입력도, 판단 규칙(프롬프트)도, 카테고리·극성·인사이트도 그대로다. 바뀌는 것은
 * **답을 적는 형식** 하나뿐이고, 이 파일이 저장 직전에 기존 모양(`quotes`/`quoteEvidence`)으로
 * 되돌리므로 그 뒤 단계(검증·저장·웹뷰·PDF)는 앵커를 알지도 못한다.
 *
 * 오히려 **verbatim이 구조적으로 보장된다.** 기존 방식은 모델이 원문을 옮겨 적다 한 글자만
 * 달라도 `retainOnlyVerifiedQuotes`가 그 인용문을 조용히 버렸는데, 앵커는 코드가 원문에서
 * 잘라내므로 애초에 달라질 수가 없다.
 *
 * ponytail: `QUALITATIVE_ANCHOR_QUOTES=0`은 **되돌릴 손잡이이지 영구 병행 스위치가 아니다.**
 * 14문항 전체 검증(극성 일치율 + 복원율)이 끝나면 둘 중 하나를 지운다 — 좋으면 옛 경로를,
 * 나쁘면 이 파일을. 두 경로를 오래 함께 두지 말 것(genericStats.ts에 적은 것과 같은 이유).
 */
import { z } from "zod";
import { NpsJudgmentSchema, type Stage2RawOutput } from "./stage2";
import { CONNECTIVE_ENDINGS } from "@/lib/report/quoteEnding";

/** 기본은 켜짐. 문제가 보이면 `QUALITATIVE_ANCHOR_QUOTES=0`으로 즉시 되돌린다. */
export const ANCHOR_QUOTES_ENABLED = (process.env.QUALITATIVE_ANCHOR_QUOTES ?? "1") !== "0";

/**
 * 인용문 하나의 위치. 글자 수를 세게 하지 않는다 — LLM은 카운팅에 약하지만 **옮겨 적기**는
 * 잘한다. 그래서 오프셋이 아니라 앞뒤 몇 글자를 그대로 적게 하고 코드가 찾는다.
 */
const AnchorQuoteSchema = z.object({
  r: z.number().describe("이 인용이 나온 응답자 번호(respondent_id)"),
  from: z.string().describe("인용이 시작되는 지점의 원문 앞부분 6~10글자. 원문 그대로 옮겨 적을 것"),
  to: z.string().describe("인용이 끝나는 지점의 원문 뒷부분 6~10글자. 원문 그대로 옮겨 적을 것"),
  // **선택 항목으로 두면 안 된다.** optional이던 시절 모델은 이 두 필드를 **문항 통째로**
  // 건너뛰었고, 그 문항의 보고서 인용문에는 볼드+밑줄 강조가 하나도 안 붙었다(2026-09-04
  // 실측: 14문항 중 7문항이 강조 0건, 나머지는 27/27처럼 거의 전부 — 전부 아니면 전무였다).
  // 필수로 두어도 위험은 없다 — 엉뚱한 위치를 적으면 코드가 인용문 안에서 못 찾아 표시만
  // 생략되고 인용문 자체는 그대로 남는다.
  reason_from: z.string().describe("인용문 안에서 근거·이유 구간이 시작되는 앞부분 4~8글자. 모든 인용문에 반드시 채울 것"),
  reason_to: z.string().describe("그 근거 구간이 끝나는 뒷부분 4~8글자. 모든 인용문에 반드시 채울 것"),
});

const AnchorCategorySchema = z.object({
  label: z.string().describe("대괄호 없이 카테고리명만 (예: GPS 및 걸음 수 측정 부정확성 문제)"),
  // **개수를 묻지 않는다.** 세는 일은 코드가 한다 — 언어 모델은 개수를 감으로 적어서, 예전
  // 스키마(clause_count 숫자)는 총합과 카테고리 합이 어긋나 문항이 통째로 실패하는 일이
  // 잦았고(2026-09-04 실측) 실행할 때마다 비율이 흔들렸다.
  respondents: z.array(z.number()).describe("이 카테고리에 해당하는 응답자 번호 전부. 인용으로 뽑지 않은 응답자도 빠짐없이 넣을 것"),
  quotes: z.array(AnchorQuoteSchema).describe("대표 인용 2~4개를 원문 위치로 지목"),
  insight: z.string().describe("관찰·시사점 톤의 인사이트 한 줄. 화살표 기호는 붙이지 않음"),
});

export const AnchorCombinedOutputSchema = z.object({
  groups: z.array(z.object({
    polarity: z.enum(["positive", "negative", "neutral"]),
    categories: z.array(AnchorCategorySchema),
  })),
  nps_judgment: NpsJudgmentSchema.optional(),
});

export type AnchorCombinedOutput = z.infer<typeof AnchorCombinedOutputSchema>;

/**
 * 시스템 프롬프트 뒤에 붙이는 형식 지시. **판단 규칙은 건드리지 않는다** — 인용문을 어떻게
 * 적을지만 덮어쓴다. 실측(2026-09-01)에서 이 문구 그대로 36/36 복원됐으므로 임의로 다듬지 말 것.
 */
export const ANCHOR_FORMAT_NOTE = `
[출력 형식 변경 — 이 지시가 인용문 형식에 대한 기존 지시보다 우선한다]
인용문을 글자로 다시 쓰지 마라. 대신 원문 안에서의 **위치**를 지목한다.
- r: 그 인용이 나온 응답자 번호
- from: 인용이 시작되는 지점의 원문 앞부분 6~10글자 (원문 그대로)
- to: 인용이 끝나는 지점의 원문 뒷부분 6~10글자 (원문 그대로)
from~to 사이의 실제 문장은 코드가 원문에서 잘라낸다. 요약하거나 고쳐 쓰지 마라.
**인용문마다 reason_from / reason_to를 반드시 채운다.** 그 인용문에서 판단의 근거가 된
핵심 구간(보통 한 문장 안의 한 어절~한 절)을 같은 방식으로 지목한다. 인용문 전체를 통째로
지목하지는 말고, 비워 두지도 마라 — 보고서는 이 구간을 굵게+밑줄로 표시한다.

[개수 대신 목록 — 이 지시가 clause_count에 대한 기존 지시보다 우선한다]
카테고리마다 개수를 세지 마라. 대신 respondents에 **그 카테고리에 해당하는 응답자 번호를
전부** 나열한다. 대표 인용으로 뽑지 않은 응답자도 반드시 포함한다. 개수와 비율은 코드가
이 목록에서 계산한다.
한 응답자가 서로 다른 논점을 말했다면 각각의 카테고리에 그 번호를 넣는다(긍정과 부정에
동시에 들어갈 수 있다). 같은 카테고리 안에서는 한 번만 넣는다.
`;

/** 어떤 방법으로 인용문을 찾아냈는지. 로그에 남겨 **구제 로직이 실제로 일하는지** 본다. */
export type AnchorStrategy =
  | "exact"          // 적어준 그대로 원문에 있음
  | "normalized"     // 공백·따옴표 모양만 다름(엑셀↔모델 사이에서 흔함)
  | "sentence_tail"  // 시작은 찾았고 끝을 못 찾음 → 문장 끝까지
  | "sentence_head"  // 끝은 찾았고 시작을 못 찾음 → 문장 처음부터
  | "other_respondent"; // 응답자 번호가 틀림 → 그 조각이 유일하게 있는 응답자로 교정

/** 끝내 못 찾은 앵커의 사유. **개수만 세면 원인을 못 찾는다**(2026-09-02 실측: 372개 중 1개가
 *  빠졌는데 로그에 개수만 있어 재현 전까지 이유를 알 수 없었다). */
export type AnchorFailure = {
  respondentId: number;
  from: string;
  to: string;
  /** `no_source` 응답자 번호가 입력에 없고 조각으로도 못 찾음 · `from_missing` 시작 조각이
   *  어디에도 없음 · `to_missing` 끝 조각도 문장 끝 추정도 실패 */
  reason: "no_source" | "from_missing" | "to_missing";
};

export type AnchorResolveStats = {
  total: number;
  resolved: number;
  /** 방법별 건수 — `exact` 외가 늘면 프롬프트나 경계 처리를 손볼 신호다. */
  byStrategy: Record<AnchorStrategy, number>;
  failures: AnchorFailure[];
  /** 입력에 없는 응답자 번호를 모델이 적어 버린 건수. 늘면 프롬프트를 손볼 신호다. */
  droppedRespondents: number;
  /** 너무 긴 인용문을 한 논점으로 좁힌 건수. */
  narrowed: number;
  /** 너무 긴데 근거 구간이 없어 좁힐 수 없어 버린 건수. */
  overlongDropped: number;
  /** 버리면 그 카테고리에 인용이 하나도 안 남아 예외로 남긴 긴 인용문 건수. */
  overlongKept: number;
};

/**
 * 공백·따옴표 모양만 통일한 사본과, 그 위치를 원문 위치로 되돌리는 표를 같이 만든다.
 *
 * **하위 검증(`isVerbatimClause`)이 쓰는 정규화와 같은 규칙이어야 한다** — 여기서 느슨하게
 * 찾아낸 인용문이 저장 직전 검증에서 다시 걸러지면 아무 의미가 없다.
 */
function normalizedIndex(source: string): { text: string; origin: number[] } {
  let text = "";
  const origin: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
      .normalize("NFKC")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"');
    if (/^[\u200B\s]*$/.test(ch)) continue;
    for (const c of ch) {
      text += c;
      origin.push(i);
    }
  }
  return { text, origin };
}

const normalizeAnchor = (value: string) =>
  value.normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u200B\s]+/g, "");

/** 문장 경계. 인용문 끝을 추정할 때 쓴다. */
const SENTENCE_END = /[.!?。\n]/;

type Resolved = { text: string; strategy: AnchorStrategy };

/**
 * 앵커 하나를 원문에서 잘라낸다. **여러 방법을 순서대로 시도한다** — 하나 실패했다고 바로
 * 버리면 모델이 공백 하나만 다르게 적어도 인용문이 통째로 사라진다(2026-09-02 담당자 요청:
 * "최대한 놓친 인용문이 없도록").
 *
 * 어느 방법으로 찾든 **반환값은 항상 원문에서 잘라낸 조각**이다 — 지어내지 않는다.
 */
function resolveOne(source: string, from: string, to: string): Resolved | null {
  if (!from) return null;

  // 1) 적어준 그대로.
  const exactStart = source.indexOf(from);
  if (exactStart >= 0 && to) {
    const end = source.indexOf(to, exactStart + from.length);
    if (end >= 0) return { text: source.slice(exactStart, end + to.length), strategy: "exact" };
    // from 과 to 가 겹치는 아주 짧은 인용.
    if (source.startsWith(to, exactStart)) {
      return { text: source.slice(exactStart, exactStart + to.length), strategy: "exact" };
    }
  }

  // 2) 공백·따옴표 모양만 다른 경우. 정규화 사본에서 찾고 원문 위치로 되돌린다.
  const norm = normalizedIndex(source);
  const nFrom = normalizeAnchor(from);
  const nTo = normalizeAnchor(to);
  const nStart = nFrom ? norm.text.indexOf(nFrom) : -1;
  if (nStart >= 0 && nTo) {
    const nEnd = norm.text.indexOf(nTo, nStart + nFrom.length);
    if (nEnd >= 0) {
      return {
        text: source.slice(norm.origin[nStart], norm.origin[nEnd + nTo.length - 1] + 1),
        strategy: "normalized",
      };
    }
  }

  // 3) 시작은 찾았는데 끝을 못 찾음 → 그 지점부터 문장 끝까지. 끝 경계를 잘못 적는 것이
  //    가장 흔한 실수라(요약해서 적거나 뒷부분을 다르게 씀) 여기서 대부분 구제된다.
  const start = exactStart >= 0 ? exactStart : nStart >= 0 ? norm.origin[nStart] : -1;
  if (start >= 0) {
    const rest = source.slice(start);
    const cut = rest.search(SENTENCE_END);
    const text = (cut >= 0 ? rest.slice(0, cut + 1) : rest).trim();
    if (text) return { text, strategy: "sentence_tail" };
  }

  // 4) 끝만 찾음 → 그 문장의 처음부터 끝 조각까지.
  if (nTo) {
    const nEndOnly = norm.text.indexOf(nTo);
    if (nEndOnly >= 0) {
      const endOrigin = norm.origin[nEndOnly + nTo.length - 1] + 1;
      const before = source.slice(0, endOrigin);
      let head = 0;
      for (let i = before.length - 1; i >= 0; i -= 1) {
        if (SENTENCE_END.test(before[i])) { head = i + 1; break; }
      }
      const text = source.slice(head, endOrigin).trim();
      if (text) return { text, strategy: "sentence_head" };
    }
  }

  return null;
}

/**
 * 앵커 출력을 **기존 모양**(`quotes: string[]` + `quoteEvidence`)으로 되돌린다.
 * 이 함수를 지나고 나면 하위 단계는 앵커 여부를 알 수 없다.
 */
/**
 * 인용문이 길면 **근거 구간이 들어 있는 조각 하나로 좁힌다**(2026-09-04 담당자 지적).
 *
 * 설문 답변에는 "장점: 1. … / 2. … 단점: 1. … / 2. …"처럼 여러 논점이 한 칸에 들어 있는 경우가
 * 흔한데, 모델이 그 전체를 한 인용문으로 지목하면 부정 카테고리에 장점까지 딸려 들어간다
 * (실측: 326자짜리 인용문 하나에 장점 2개 + 단점 3개). 원본 발행 보고서의 인용문은 중앙값
 * 48자·최대 129자이므로 그 상한을 넘을 때만 좁힌다.
 *
 * 좁히는 방식은 **원문의 연속 구간을 고르는 것뿐**이라 verbatim이 깨지지 않는다. 근거 구간을
 * 못 찾으면 좁힐 기준이 없으므로 그 인용문은 쓰지 않는다 — 어느 논점을 인용한 것인지 모르는
 * 덩어리를 보고서에 싣는 것보다 낫다.
 */
const MAX_QUOTE_CHARS = 130;
/**
 * 문장 끝, 목록 구분자(`/`), 번호 항목(`1.`) — 설문 답변이 실제로 쓰는 경계들.
 * **소수점을 문장 끝으로 보면 안 된다**(실측: "하루 1.5km"가 "1." 뒤에서 잘려 인용문이
 * "5km 정도를…"로 시작했다). 그래서 마침표류는 **뒤에 공백이나 문장 끝이 올 때만**, 번호
 * 항목은 **점 뒤가 숫자가 아닐 때만** 경계로 본다("1.보물상자"처럼 공백 없는 목록도 있다).
 */
const SEGMENT_BREAK = /[.!?]+(?=\s|$)\s*|\n+|\s*\/\s*|(?<=\s)\d+\.(?!\d)\s*/g;

export function narrowQuoteToEvidence(quote: string, span: string | null): string | null {
  if (quote.length <= MAX_QUOTE_CHARS) return quote;
  if (!span) return null;
  const spanStart = quote.indexOf(span);
  if (spanStart < 0) return null;

  // 경계(문장 끝·구분자·번호) 자체는 조각에 포함하지 않는다 — 앞뒤에 "/"나 "1."이 붙어 남는다.
  const segments: [number, number][] = [];
  let cursor = 0;
  for (const match of quote.matchAll(SEGMENT_BREAK)) {
    if (match.index > cursor) segments.push([cursor, match.index]);
    cursor = match.index + match[0].length;
  }
  segments.push([cursor, quote.length]);

  // 근거 구간이 걸쳐 있는 조각들을 찾는다. **한 조각 안에 들어 있을 때만 좁히면** 두 문장에
  // 걸친 근거에서는 통째로 포기하게 되어 372자짜리 인용문이 그대로 남았다(2026-09-07 실측).
  const spanEnd = spanStart + span.length - 1;
  const first = segments.findIndex(([start, end]) => spanStart >= start && spanStart < end);
  const last = segments.findIndex(([start, end]) => spanEnd >= start && spanEnd < end);
  if (first < 0 || last < 0) return quote;

  // **조건·이유 절은 데려온다.** 앞 조각이 "~는데/~어서/~면"처럼 뒷말을 요구하는 어미로
  // 끝나면 그것까지 포함해야 뜻이 유지된다 — "겨울이라 잘 못 나가서 그런지 / 보상이 적게
  // 느껴졌어요"에서 뒤 조각만 남기면 응답자가 붙인 단서가 사라진다.
  let from = segments[first][0];
  const to = segments[last][1];
  for (let back = first - 1; back >= 0; back -= 1) {
    const previous = quote.slice(segments[back][0], segments[back][1]).trim();
    if (!CONNECTIVE_ENDINGS.some((ending) => previous.endsWith(ending))) break;
    if (quote.slice(segments[back][0], to).trim().length > MAX_QUOTE_CHARS) break;
    from = segments[back][0];
  }
  return quote.slice(from, to).trim();
}

export function resolveAnchorQuotes(
  output: AnchorCombinedOutput,
  inputs: { respondent_id: number; reason: string }[],
): { groups: Stage2RawOutput[]; nps_judgment?: AnchorCombinedOutput["nps_judgment"]; stats: AnchorResolveStats } {
  const reasonOf = new Map(inputs.map((input) => [input.respondent_id, input.reason]));
  const stats: AnchorResolveStats = {
    total: 0,
    resolved: 0,
    byStrategy: { exact: 0, normalized: 0, sentence_tail: 0, sentence_head: 0, other_respondent: 0 },
    failures: [],
    droppedRespondents: 0,
    narrowed: 0,
    overlongDropped: 0,
    overlongKept: 0,
  };
  const knownRespondents = new Set(inputs.map((input) => input.respondent_id));

  /** 응답자 번호가 틀렸을 때 — 그 조각이 **유일하게** 들어 있는 응답자를 찾는다.
   *  여러 명에게 있으면 누구 말인지 알 수 없으므로 포기한다(엉뚱한 사람 말로 붙이지 않는다). */
  const findByFragment = (from: string): { source: string } | null => {
    const needle = normalizeAnchor(from);
    if (needle.length < 4) return null; // 너무 짧은 조각은 우연히 여러 곳에 있다.
    const hits = inputs.filter((input) => normalizeAnchor(input.reason).includes(needle));
    return hits.length === 1 ? { source: hits[0].reason } : null;
  };

  const groups = output.groups.map((group) => {
    const categories = group.categories.map((category) => {
      const quotes: string[] = [];
      const quoteEvidence: { quote: string; reasonSpan: string }[] = [];
      const overlong: string[] = [];
      for (const anchor of category.quotes) {
        stats.total += 1;
        const source = reasonOf.get(anchor.r);

        let resolved = source ? resolveOne(source, anchor.from, anchor.to) : null;
        // 5) 응답자 번호가 틀렸거나 그 응답자에게 없는 조각 → 유일하게 가진 응답자로 교정.
        if (!resolved) {
          const other = findByFragment(anchor.from);
          const viaOther = other ? resolveOne(other.source, anchor.from, anchor.to) : null;
          if (viaOther) resolved = { text: viaOther.text, strategy: "other_respondent" };
        }

        if (!resolved) {
          stats.failures.push({
            respondentId: anchor.r,
            from: anchor.from,
            to: anchor.to,
            reason: !source ? "no_source"
              : normalizeAnchor(anchor.from) && normalizedIndex(source).text.includes(normalizeAnchor(anchor.from))
                ? "to_missing"
                : "from_missing",
          });
          continue;
        }

        // 근거 구간은 **인용문 안에서** 다시 찾는다. 없으면 표시만 생략되고 인용문은 남는다.
        const span = anchor.reason_from && anchor.reason_to
          ? resolveOne(resolved.text, anchor.reason_from, anchor.reason_to)
          : null;
        // 여러 논점이 한 덩어리로 잡힌 인용문은 근거 구간이 있는 조각으로 좁힌다.
        const text = narrowQuoteToEvidence(resolved.text, span?.text ?? null);
        if (!text) {
          // 좁힐 기준(근거 구간)이 없는 긴 인용문. 원칙적으로 버리지만, 이게 이 카테고리의
          // 마지막 하나면 **인용이 아예 없는 항목**이 되므로 그때는 남긴다(2026-09-07).
          overlong.push(resolved.text);
          continue;
        }
        if (text !== resolved.text) stats.narrowed += 1;
        stats.resolved += 1;
        stats.byStrategy[resolved.strategy] += 1;
        quotes.push(text);
        if (span) quoteEvidence.push({ quote: text, reasonSpan: span.text });
      }
      if (quotes.length === 0 && overlong.length > 0) {
        quotes.push(overlong[0]);
        stats.overlongKept += 1;
      }
      stats.overlongDropped += overlong.length - (quotes.length === 1 && overlong.length > 0 && quotes[0] === overlong[0] ? 1 : 0);

      // 개수는 여기서 센다. 입력에 없는 응답자 번호와 중복은 버린다 — 모델이 번호를 지어내도
      // 비율이 부풀지 않게 하는 유일한 방어선이다.
      const respondents = [...new Set(category.respondents)].filter((id) => {
        if (knownRespondents.has(id)) return true;
        stats.droppedRespondents += 1;
        return false;
      });
      return { label: category.label, clause_count: respondents.length, respondents, quotes, quoteEvidence, insight: category.insight };
    });
    return {
      polarity: group.polarity,
      total_clause_count: categories.reduce((sum, category) => sum + category.clause_count, 0),
      categories,
    };
  });

  return { groups, nps_judgment: output.nps_judgment, stats };
}
