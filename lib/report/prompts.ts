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
