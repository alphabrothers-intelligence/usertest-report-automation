/**
 * Claude 호출의 공통 안전장치.
 *
 * 타임아웃은 각 호출에도 명시해야 실제 HTTP 요청을 중단할 수 있다.
 * 이 래퍼는 그 요청이 일시적 오류로 실패했을 때만 제한적으로 한 번 재시도한다.
 * 무한 재시도는 크레딧·대기 시간을 다시 폭증시키므로 금지한다.
 */
import { streamText } from "ai";
import { logClaudeUsage, toClaudeUsageRecord, usageFromResult, type ClaudeUsageRecord } from "@/lib/claudeUsage";

// 정상적인 대형 구조화 응답은 90초를 넘길 수 있다(기존 실측 99초, Stage1 100명 단일
// 스모크 테스트 179.97초). 따라서 전체 요청에는 여유를 두고, 실질적인 hang 감지는
// 아래 chunkMs가 맡는다. 정상 스트림을 180초 근처에서 잘라내지 않도록 300초로 둔다.
export const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS ?? 300_000);
// 스트림 청크가 이 시간 동안 안 오면(=연결 먹통) 즉시 중단하고 재시도한다. 비스트리밍
// generateText가 간헐적으로 300초+ 멈추다 죽던 문제(2026-07-27 실측)를, 스트리밍 + 짧은
// 청크 타임아웃으로 60초 안에 감지·회복하도록 바꾼 것이 이 값의 존재 이유다.
export const CLAUDE_CHUNK_TIMEOUT_MS = Number(process.env.CLAUDE_CHUNK_TIMEOUT_MS ?? 60_000);
/**
 * AI SDK의 timeout 옵션은 제공자·런타임 조합에 따라 `result.output` 대기까지 항상
 * 강제 종료하지 못할 수 있다. AbortController를 함께 사용해 프로세스/서버리스 요청이
 * 5분 이상 붙잡히는 것을 막는다. 상세 감사 경로는 호출자가 더 큰 값을 넘길 수 있다.
 */
export const CLAUDE_HARD_TIMEOUT_MS = Number(process.env.CLAUDE_HARD_TIMEOUT_MS ?? 300_000);
const MAX_ATTEMPTS = Math.max(1, Number(process.env.CLAUDE_MAX_ATTEMPTS ?? 2));

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof candidate.status === "number") return candidate.status;
  return typeof candidate.response?.status === "number" ? candidate.response.status : undefined;
}

function shouldRetry(error: unknown) {
  const status = statusOf(error);
  if (status === 408 || status === 409 || status === 429) return true;
  if (status !== undefined && status >= 500) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /timeout|timed out|headers timeout|ECONNRESET|socket hang up|rate.?limit/i.test(message);
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function withClaudeGuard<T>(
  label: string,
  operation: () => Promise<T>,
  options: { onUsage?: (usage: ClaudeUsageRecord) => void } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      const result = await operation();
      const elapsedMs = Date.now() - startedAt;
      console.info(`[claude] ${label} succeeded in ${elapsedMs}ms (attempt ${attempt}/${MAX_ATTEMPTS})`);
      const usage = usageFromResult(result);
      logClaudeUsage(label, usage, { elapsedMs, attempt });
      options.onUsage?.(toClaudeUsageRecord(label, usage, { elapsedMs, attempt }));
      return result;
    } catch (error) {
      lastError = error;
      const elapsedMs = Date.now() - startedAt;
      const retryable = shouldRetry(error);
      console.error(`[claude] ${label} failed in ${elapsedMs}ms (attempt ${attempt}/${MAX_ATTEMPTS}, status ${statusOf(error) ?? "unknown"}, retryable ${retryable})`, error);
      if (attempt === MAX_ATTEMPTS || !retryable) break;
      // 모든 작업이 동시에 재시도하며 다시 레이트리밋을 치지 않도록 jitter를 준다.
      const delayMs = 700 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
      console.warn(`[claude] ${label} retrying in ${delayMs}ms`);
      await wait(delayMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`[claude] ${label} failed`);
}

/**
 * 구조화 출력(Output.object)을 **스트리밍**으로 받는다. generateText(비스트리밍)는 출력이
 * 크면(Stage1 32K/Stage2 16K) HTTP 연결이 간헐적으로 멈추는(hang) 문제가 Anthropic 공식
 * 문서에 명시돼 있고 실측으로 재현됐다(2026-07-27: Stage2가 27~99초에 되기도, 300초+ 멈추다
 * 죽기도 함 — 출력량이 아니라 연결 자체가 먹통). streamText + chunkMs 타임아웃으로 바꾸면
 * 스트림이 계속 흐르는 정상 요청은 그대로 통과하고, 멈춘 요청만 60초 안에 잘라 재시도한다.
 * result.output(PromiseLike)이 스키마 검증된 최종 객체를 준다. usage는 withClaudeGuard의
 * usageFromResult가 로깅에 쓴다.
 */
export async function streamStructured<T>(
  options: Record<string, unknown> & { hardTimeoutMs?: number },
  traceLabel?: string,
): Promise<{ output: T; usage: unknown }> {
  const { hardTimeoutMs, ...streamOptions } = options;
  const externalSignal = streamOptions.abortSignal as AbortSignal | undefined;
  const abortController = new AbortController();
  const abortSignal = externalSignal
    ? AbortSignal.any([externalSignal, abortController.signal])
    : abortController.signal;
  const effectiveHardTimeoutMs = Math.max(1_000, hardTimeoutMs ?? CLAUDE_HARD_TIMEOUT_MS);
  const hardTimeout = setTimeout(() => {
    abortController.abort(new Error(`[claude] ${traceLabel ?? "stream"} hard timeout after ${effectiveHardTimeoutMs}ms`));
  }, effectiveHardTimeoutMs);
  const providedOnChunk = options.onChunk;
  const providedOnError = options.onError;
  const providedOnFinish = options.onFinish;
  let chunkCount = 0;
  try {
    const result = streamText({
      ...(streamOptions as Parameters<typeof streamText>[0]),
      abortSignal,
      timeout: { chunkMs: CLAUDE_CHUNK_TIMEOUT_MS, totalMs: CLAUDE_TIMEOUT_MS },
    // 데이터 원문은 로그로 남기지 않는다. 첫 청크 수신 여부와 총 청크 수만 기록해
    // "연결이 열리지 않음"과 "구조화 결과 검증 실패"를 구분할 수 있게 한다.
      onChunk: (event) => {
      chunkCount += 1;
      if (chunkCount === 1 && traceLabel) {
        console.info(`[claude] ${traceLabel} first stream chunk received`);
      }
      if (typeof providedOnChunk === "function") {
        providedOnChunk(event);
      }
      },
    // streamText는 스트리밍 중 오류를 throw 대신 스트림 파트로 전달할 수 있다.
    // 이 로그가 있어야 연결 종료·스키마 오류·제공자 오류를 "프로세스가 조용히 끝남"과
    // 구분할 수 있다. 원문·응답 내용은 절대 남기지 않는다.
      onError: ({ error }) => {
      console.error(`[claude] ${traceLabel ?? "stream"} stream error`, error);
      if (typeof providedOnError === "function") {
        providedOnError({ error });
      }
      },
      onFinish: (event) => {
      if (traceLabel) {
        console.info(`[claude] ${traceLabel} stream finished (${chunkCount} chunks, reason ${event.finishReason})`);
      }
      if (typeof providedOnFinish === "function") {
        providedOnFinish(event);
      }
      },
    });
  // `result.output`은 내부적으로 스트림을 소비해 finalStep을 만든다. 여기서 먼저
  // consumeStream()을 별도로 호출하면 동일 스트림을 두 번 tee하여 CLI 환경에서 최종
  // output Promise가 끝나지 않을 수 있다. 최종 구조화 결과 Promise 하나만 기다린다.
    const output = (await result.output) as T;
    if (traceLabel) {
      console.info(`[claude] ${traceLabel} structured output validated (${chunkCount} chunks)`);
    }
    const usage = await result.usage;
    return { output, usage };
  } finally {
    clearTimeout(hardTimeout);
  }
}

/**
 * 긴 자유 형식 본문을 **스트리밍**으로 받는다.
 *
 * 섹션 종합 해석처럼 JSON 스키마가 필요 없는 결과도 `generateText`로 받으면, 대형 출력에서
 * HTTP 연결이 조용히 멈추는 문제를 다시 만들 수 있다. 따라서 Stage1·Stage2의
 * `streamStructured`와 동일한 chunk/hard timeout 정책을 적용한다.
 */
export async function streamPlainText(
  options: Record<string, unknown> & { hardTimeoutMs?: number },
  traceLabel?: string,
): Promise<{ text: string; usage: unknown }> {
  const { hardTimeoutMs, ...streamOptions } = options;
  const externalSignal = streamOptions.abortSignal as AbortSignal | undefined;
  const abortController = new AbortController();
  const abortSignal = externalSignal
    ? AbortSignal.any([externalSignal, abortController.signal])
    : abortController.signal;
  const effectiveHardTimeoutMs = Math.max(1_000, hardTimeoutMs ?? CLAUDE_HARD_TIMEOUT_MS);
  const hardTimeout = setTimeout(() => {
    abortController.abort(new Error(`[claude] ${traceLabel ?? "stream"} hard timeout after ${effectiveHardTimeoutMs}ms`));
  }, effectiveHardTimeoutMs);
  const providedOnChunk = options.onChunk;
  const providedOnError = options.onError;
  const providedOnFinish = options.onFinish;
  let chunkCount = 0;

  try {
    const result = streamText({
      ...(streamOptions as Parameters<typeof streamText>[0]),
      abortSignal,
      timeout: { chunkMs: CLAUDE_CHUNK_TIMEOUT_MS, totalMs: CLAUDE_TIMEOUT_MS },
      onChunk: (event) => {
        chunkCount += 1;
        if (chunkCount === 1 && traceLabel) {
          console.info(`[claude] ${traceLabel} first stream chunk received`);
        }
        if (typeof providedOnChunk === "function") {
          providedOnChunk(event);
        }
      },
      onError: ({ error }) => {
        console.error(`[claude] ${traceLabel ?? "stream"} stream error`, error);
        if (typeof providedOnError === "function") {
          providedOnError({ error });
        }
      },
      onFinish: (event) => {
        if (traceLabel) {
          console.info(`[claude] ${traceLabel} stream finished (${chunkCount} chunks, reason ${event.finishReason})`);
        }
        if (typeof providedOnFinish === "function") {
          providedOnFinish(event);
        }
      },
    });
    const text = await result.text;
    const usage = await result.usage;
    return { text, usage };
  } finally {
    clearTimeout(hardTimeout);
  }
}
