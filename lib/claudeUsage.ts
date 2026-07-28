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
