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
