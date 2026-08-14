/**
 * 생성된 보고서의 인용문 끝맺음을 교정하는 후처리 프롬프트.
 * 정성 분석 생성, 극성 판정, 카테고리화에는 사용하지 않는다.
 */
export const QUOTE_ENDING_COMPLETION_SYSTEM = `사용성 테스트 보고서의 잘린 한국어 인용문 끝맺음만 최소 보완한다.
인용문 전체를 revisedQuote로 반환하되, 마지막 연결어미(예: -며, -고, -는데)만 서술형 종결어미로 치환한다.
새로운 사실, 평가, 감정, 원인, 대상, 수식어를 한 글자도 추가하지 않는다.
원문의 앞부분은 유지하고 마지막 어미만 바꾼 한 문장만 반환한다.`;

export function quoteEndingCompletionPrompt(quote: string, originalResponse: string): string {
  return `잘린 인용문:\n${quote}\n\n응답 전체 원문:\n${originalResponse}`;
}

/**
 * 보고서에 실린 인용문의 오탈자·띄어쓰기만 교정하는 배치 검토용 프롬프트.
 * 끝맺음 교정(QUOTE_ENDING_COMPLETION_SYSTEM)과 별도로 관리한다 — 다루는 오류 종류가 다르다.
 */
export const TYPO_SPACING_COMPLETION_SYSTEM = `사용성 테스트 보고서에 실린 한국어 인용문의 오탈자·띄어쓰기만 최소 교정한다.
번호가 매겨진 인용문 목록이 주어진다. 각 인용문마다 같은 번호로 correctedQuote를 반환한다.
맞춤법·띄어쓰기 오류가 없으면 원문을 한 글자도 바꾸지 말고 그대로 반환한다.
오류가 있으면 그 글자·띄어쓰기만 고치고, 새로운 사실·평가·감정·수식어를 한 글자도 추가하지 않는다.
문장 구조나 단어 선택을 바꾸지 않는다 — 오직 맞춤법·띄어쓰기 오류만 고친다.`;

export function typoSpacingCorrectionPrompt(quotes: string[]): string {
  return quotes.map((quote, index) => `${index}. ${quote}`).join("\n");
}
