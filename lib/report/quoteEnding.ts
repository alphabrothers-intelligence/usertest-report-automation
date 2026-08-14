/**
 * 보고서 편집 화면 전용 끝맺음 판정.
 * 정성 분석 Stage 1의 절 분리·극성·인용문 생성에는 관여하지 않으며, 생성이 끝난 보고서에서
 * 사용자가 문장형 인용문을 검수할 때 표시와 수정 버튼을 제공하는 데만 사용한다.
 */
export function reportQuoteEndingToken(quote: string): string | null {
  const trimmed = quote.trim();
  if (!trimmed || /(다|요|네|죠|까|랑|ㅎ+|ㅋ+|!|\?|\.|~|요\)|다\))$/.test(trimmed)) return null;
  return trimmed.match(/([가-힣]+(?:지만|는데|은데|인데|으나|거나|반면|한데|면서|으면서|으며|어서|아서|여서|니까|으니까|므로|으므로|라서|다가|고|을|를|이|은|는|의|에|와|도|만|음|함|임|됨|짐))$/)?.[1] ?? null;
}

export function needsReportQuoteEndingReview(quote: string): boolean {
  return reportQuoteEndingToken(quote) !== null;
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
