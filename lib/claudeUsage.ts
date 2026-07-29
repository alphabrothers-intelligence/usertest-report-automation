/**
 * Claude API 사용량 기록.
 *
 * 응답 원문·개인정보는 로그에 남기지 않고, 비용 검증에 필요한 토큰 수·호출 종류·소요 시간만
 * 서버 로그에 구조화해 남긴다. Vercel에서는 이 JSON 한 줄을 Runtime Logs에서 검색할 수 있다.
 */
export interface ClaudeUsageLike {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  inputTokenDetails?: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

/**
 * 한 번의 성공한 Claude 호출에서 확정된 사용량이다.
 *
 * 실패·중단된 스트림은 제공자가 사용량을 반환하지 않을 수 있으므로 이 레코드에는 넣지 않는다.
 * 따라서 DB 합계는 "응답에서 확인된 사용량"이며, 최종 청구서는 Anthropic 콘솔을 기준으로 한다.
 */
export interface ClaudeUsageRecord {
  label: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  noCacheTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  elapsedMs: number;
  attempt: number;
}

export function toClaudeUsageRecord(
  label: string,
  usage: ClaudeUsageLike | undefined,
  extra: { elapsedMs: number; attempt: number },
): ClaudeUsageRecord {
  return {
    label,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    noCacheTokens: usage?.inputTokenDetails?.noCacheTokens ?? null,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
    cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens ?? null,
    elapsedMs: extra.elapsedMs,
    attempt: extra.attempt,
  };
}

export function logClaudeUsage(
  label: string,
  usage: ClaudeUsageLike | undefined,
  extra: { elapsedMs?: number; attempt?: number; stepCount?: number } = {},
) {
  if (!usage) return;
  console.info(
    JSON.stringify({
      event: "claude_usage",
      label,
      inputTokens: usage.inputTokens ?? null,
      outputTokens: usage.outputTokens ?? null,
      totalTokens: usage.totalTokens ?? null,
      cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? null,
      cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? null,
      ...extra,
    }),
  );
}

export function usageFromResult(value: unknown): ClaudeUsageLike | undefined {
  if (!value || typeof value !== "object" || !("usage" in value)) return undefined;
  const usage = (value as { usage?: unknown }).usage;
  return usage && typeof usage === "object" ? (usage as ClaudeUsageLike) : undefined;
}
