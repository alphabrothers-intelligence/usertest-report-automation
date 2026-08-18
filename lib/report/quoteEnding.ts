/**
 * 보고서 편집 화면 전용 끝맺음 판정.
 * 정성 분석 Stage 1의 절 분리·극성·인용문 생성에는 관여하지 않으며, 생성이 끝난 보고서에서
 * 사용자가 문장형 인용문을 검수할 때 표시와 수정 버튼을 제공하는 데만 사용한다.
 */
/**
 * 종결어미 자체가 오타라 문장이 끝맺어지지 않은 경우. 실제 raw data에 "…생각합니나."처럼
 * "-ㅂ니다/습니다/입니다"를 "-니나"로 잘못 적은 응답이 있다(2026-08-18 사용자 지적).
 * **마침표로 끝나 있어도 종결이 성립하지 않으므로** 정상 종결 판정보다 먼저 본다 — 안 그러면
 * 마침표 때문에 정상으로 통과해 빨간 하이라이트에도, 끝맺음 보완 대상에도 안 잡힌다.
 *
 * "니나" 앞 음절의 ㅂ 받침을 확인하는 이유: "어머니나"(명사 + 보조사 '나')처럼 종결어미가
 * 아닌 경우까지 잡으면 "어머니다."로 원문을 망가뜨린다. "-ㅂ니다" 계열은 앞 음절에 반드시
 * ㅂ 받침이 있다(합/습/입/갑/옵…)는 점으로 구분한다. 같은 부류의 종결어미 오타를 더
 * 발견하면 이 함수에 조건을 추가할 것.
 */
function malformedEnding(trimmed: string): { token: string; index: number } | null {
  const match = trimmed.match(/([가-힣]니나)[.!?~\s]*$/);
  if (!match || match.index === undefined) return null;
  const syllable = match[1].codePointAt(0);
  if (syllable === undefined || (syllable - 0xac00) % 28 !== 17) return null;
  return { token: match[1], index: match.index };
}

export function reportQuoteEndingToken(quote: string): string | null {
  const trimmed = quote.trim();
  const malformed = malformedEnding(trimmed);
  if (malformed) return malformed.token;
  if (!trimmed || /(다|요|네|죠|까|랑|ㅎ+|ㅋ+|!|\?|\.|~|요\)|다\))$/.test(trimmed)) return null;
  return trimmed.match(/([가-힣]+(?:지만|는데|은데|인데|으나|거나|반면|한데|면서|으면서|으며|어서|아서|여서|니까|으니까|므로|으므로|라서|다가|고|을|를|이|은|는|의|에|와|도|만|음|함|임|됨|짐))$/)?.[1] ?? null;
}

export function needsReportQuoteEndingReview(quote: string): boolean {
  return reportQuoteEndingToken(quote) !== null;
}

/**
 * 띄어쓰기가 빠진 채 붙어 있는 한글 덩어리("아오그냥입히면겁나귀여워", "우리반려견꾸미는").
 * 사전 없이 판정할 수 없으므로 길이 휴리스틱을 쓰되, "만족스러웠습니다"처럼 한 낱말로도
 * 길어지는 종결형 어미는 떼고 센다(2026-08-18 리바랩스 raw data 실측으로 임계값 결정 —
 * 8자 그대로면 정상 낱말 126건이 걸리고, 어미를 떼면 88건까지 줄면서 실제 오류 위주가 된다).
 * ponytail: 길이 휴리스틱이라 오탐이 남는다("다이나믹아일랜드") — 빨간 하이라이트는 "검토
 * 대상"이라는 표시일 뿐이고 실제 교정 여부는 일괄 검토의 LLM이 정하므로 감수한다. 오탐이
 * 거슬릴 정도로 늘면 형태소 분석기 도입을 검토할 것.
 */
const SPACING_RUN_MIN = 8;
export function reportQuoteSpacingToken(quote: string): string | null {
  for (const run of quote.match(/[가-힣]{8,}/g) ?? []) {
    if (run.replace(/(습?니다|니당|네요|어요|아요|세요|더라구요)$/, "").length >= SPACING_RUN_MIN) return run;
  }
  return null;
}

/**
 * 말투 검토는 "지웠을 때 뜻이 남는가"로 두 등급을 나눈다(2026-08-18 사용자와 합의).
 * - FILLER: 지워도 정보량이 0인 잡음(ㅋㅋ, ㅠㅠ, 아오). 감정 신호는 이미 극성 판정이 담고
 *   있으므로 인용문에서 빼도 보고서가 잃는 게 없다 → 결정론적으로 자동 제안한다.
 * - FLAGGED: "겁나/존나"처럼 강도가 정보인 강조어와 보고서에 실을 수 없는 욕설. 지우면
 *   응답자 의도를 우리가 축소·각색하는 것이라 자동 수정하지 않고 검토 목록에만 올린다.
 * ponytail: 소사전이라 신조어를 다 못 잡는다 — 실사용에서 새로 발견되는 표현을 여기에
 * 추가하는 걸로 충분하고, 사전이 두 자릿수를 넘어가면 별도 파일로 뺄 것.
 */
const FILLER_WORDS = ["아오", "헐", "아씨", "어휴", "에휴", "하하", "호호", "음", "어"];
const FLAGGED_WORDS = ["겁나", "존나", "존내", "좆", "씨발", "시발", "ㅅㅂ", "병신", "지랄", "개같", "엿같"];

function fillerTokens(quote: string): string[] {
  return quote.split(/\s+/).filter((word) => FILLER_WORDS.includes(word.replace(/[.,!?~]+$/, "")));
}

/** 자동 수정 없이 사람이 판단해야 하는 말투 — 있으면 그 표현을 돌려준다. */
export function reportQuoteFlaggedWord(quote: string): string | null {
  return FLAGGED_WORDS.find((word) => quote.includes(word)) ?? null;
}

/** 자모 잡음·감탄사를 걷어낸 인용문. 걷어낼 게 없거나 남는 게 없으면 null. */
export function reportQuoteFillerCleanup(quote: string): string | null {
  const cleaned = quote
    .replace(/[ㄱ-ㅎㅏ-ㅣ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !FILLER_WORDS.includes(word.replace(/[.,!?~]+$/, "")))
    .join(" ")
    .replace(/\s+([.,!?~])/g, "$1")
    .trim();
  return cleaned && cleaned !== quote.trim() ? cleaned : null;
}

/** 본문에서 빨간 하이라이트로 표시할 검토 대상 구간(끝맺음 → 띄어쓰기 → 말투 순). */
export function reportQuoteReviewToken(quote: string): string | null {
  return reportQuoteEndingToken(quote)
    ?? reportQuoteSpacingToken(quote)
    ?? reportQuoteFlaggedWord(quote)
    ?? quote.match(/[ㄱ-ㅎㅏ-ㅣ]+/)?.[0]
    ?? fillerTokens(quote)[0]
    ?? null;
}

/** 한국어 용언 어간을 새 의미 없이 격식체 종결형으로 바꾼다. */
function formalizeStem(stem: string): string | null {
  const last = stem.codePointAt(stem.length - 1);
  if (last === undefined || last < 0xac00 || last > 0xd7a3) return null;
  const jongseong = (last - 0xac00) % 28;
  // ㄹ 받침은 ㄹ을 빼고 ㅂ니다를 붙인다(알→압니다, 살→삽니다).
  if (jongseong === 8) {
    const withoutRieul = last - 8;
    return `${stem.slice(0, -1)}${String.fromCodePoint(withoutRieul + 17)}니다.`;
  }
  if (jongseong === 0) {
    const withBieup = String.fromCodePoint(last + 17);
    return `${stem.slice(0, -1)}${withBieup}니다.`;
  }
  return `${stem}습니다.`;
}

/**
 * 연결어미와 설문 메모체를 보고서용 종결형으로 최소 치환한다. LLM을 거치지 않는 가장 보수적인
 * 경로 — quote-completion 라우트와 text-corrections 배치 라우트가 공유한다.
 */
export function deterministicEndingCompletion(quote: string): string | null {
  // 종결어미 오타는 뒤에 붙은 문장부호까지 걷어내고 올바른 종결형으로 되돌린다
  // (예: "…생각합니나." → "…생각합니다."). malformedEnding과 같은 부류를 다룬다.
  const malformed = malformedEnding(quote.trim());
  if (malformed) return `${quote.trim().slice(0, malformed.index)}${malformed.token.slice(0, -1)}다.`;
  if (quote.endsWith("인데")) return `${quote.slice(0, -2)}입니다.`;
  for (const ending of ["으면서", "으므로", "으니까", "으나", "지만", "는데", "은데", "으며", "면서", "므로", "니까", "어서", "아서", "여서", "라서", "다가", "거나", "고"]) {
    if (quote.endsWith(ending)) return formalizeStem(quote.slice(0, -ending.length));
  }
  if (quote.endsWith("됨")) return `${quote.slice(0, -1)}됩니다.`;
  if (quote.endsWith("함")) return `${quote.slice(0, -1)}합니다.`;
  if (quote.endsWith("임")) return `${quote.slice(0, -1)}입니다.`;
  if (quote.endsWith("음")) return formalizeStem(quote.slice(0, -1));
  return null;
}

/**
 * 두 문자열의 공통 접두/접미를 분리해 {접두, 변경된 가운데, 접미} 세 조각으로 돌려준다.
 * 하이라이트 렌더링(일괄 검토 패널의 미리보기, 적용 후 본문 마킹)에 쓰는 순수 분할 —
 * 길이 제한 가드는 없다(가드는 boundedDiff가 담당).
 */
export function splitHighlightParts(original: string, revised: string): { prefix: string; middle: string; suffix: string } {
  let prefix = 0;
  while (prefix < original.length && prefix < revised.length && original[prefix] === revised[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < original.length - prefix &&
    suffix < revised.length - prefix &&
    original[original.length - 1 - suffix] === revised[revised.length - 1 - suffix]
  ) suffix += 1;
  return { prefix: revised.slice(0, prefix), middle: revised.slice(prefix, revised.length - suffix), suffix: revised.slice(revised.length - suffix) };
}

/**
 * 두 문자열의 공통 접두/접미를 잘라내고 남는 변경 구간만 돌려준다. 변경 구간이 maxLen을
 * 넘으면 null — "끝맺음만"·"오탈자 한두 글자만" 같은 최소 보정 가드레일에 쓴다.
 */
export function boundedDiff(original: string, revised: string, maxLen: number): { changedFrom: string; changedTo: string } | null {
  const { prefix, middle: changedTo, suffix } = splitHighlightParts(original, revised);
  const changedFrom = original.slice(prefix.length, original.length - suffix.length);
  if (!changedFrom && !changedTo) return null;
  if (changedFrom.length > maxLen || changedTo.length > maxLen) return null;
  return { changedFrom, changedTo };
}

/**
 * 일괄 검토용 diff. 띄어쓰기만 바뀐 교정은 원문 글자를 하나도 바꾸지 않으므로 길이 가드를
 * 적용하지 않는다 — 안 그러면 "아오그냥입히면겁나귀여워"처럼 공백을 여러 개 넣어야 하는
 * 교정이 5자 가드에 걸려 조용히 버려진다(2026-08-18).
 */
export function correctionDiff(original: string, revised: string, maxLen: number) {
  const spacingOnly = original.replace(/\s+/g, "") === revised.replace(/\s+/g, "");
  return boundedDiff(original, revised, spacingOnly ? Infinity : maxLen);
}
