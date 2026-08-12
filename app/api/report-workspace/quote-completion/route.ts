import { NextResponse } from "next/server";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { z } from "zod";
import { CLAUDE_TIMEOUT_MS, withClaudeGuard } from "@/lib/pipeline/claudeGuard";
import { QUOTE_ENDING_COMPLETION_SYSTEM, quoteEndingCompletionPrompt } from "@/lib/report/prompts";

const BodySchema = z.object({
  quote: z.string().min(1).max(1000),
  originalResponse: z.string().min(1).max(5000),
});
const CompletionSchema = z.object({
  revisedQuote: z.string(),
});
const MODEL = process.env.ANTHROPIC_STAGE2_MODEL ?? "claude-sonnet-5";

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

/** 연결어미와 설문 메모체를 보고서용 종결형으로 최소 치환한다. */
function deterministicCompletion(quote: string): string | null {
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

export async function POST(request: Request) {
  try {
    const body = BodySchema.safeParse(await request.json());
    if (!body.success) return NextResponse.json({ ok: false, error: "인용문 정보가 올바르지 않습니다." }, { status: 400 });
    // `어려웠으며` → `어려웠습니다.`처럼 의미를 더하지 않고 마지막 연결어미만 치환할 수
    // 있는 경우는 LLM을 거치지 않는다. AI가 "불편했습니다" 같은 새 평가를 덧붙일 여지를
    // 원천적으로 없애기 위한 가장 보수적인 경로다.
    const deterministic = deterministicCompletion(body.data.quote);
    if (deterministic) {
      let prefixLength = 0;
      while (prefixLength < body.data.quote.length && prefixLength < deterministic.length && body.data.quote[prefixLength] === deterministic[prefixLength]) prefixLength += 1;
      return NextResponse.json({
        ok: true,
        completedQuote: deterministic,
        changedFrom: body.data.quote.slice(prefixLength),
        changedTo: deterministic.slice(prefixLength),
      });
    }
    const { output } = await withClaudeGuard("quote-ending-completion", () => generateText({
      model: anthropic(MODEL),
      instructions: { role: "system", content: QUOTE_ENDING_COMPLETION_SYSTEM },
      prompt: quoteEndingCompletionPrompt(body.data.quote, body.data.originalResponse),
      output: Output.object({ schema: CompletionSchema }),
      maxOutputTokens: 300,
      reasoning: "none",
      timeout: CLAUDE_TIMEOUT_MS,
    }));
    const revisedQuote = output.revisedQuote.trim();
    let prefixLength = 0;
    while (prefixLength < body.data.quote.length && prefixLength < revisedQuote.length && body.data.quote[prefixLength] === revisedQuote[prefixLength]) prefixLength += 1;
    // 마지막 어미만 바꾼 것이 아니라면 적용하지 않는다. 기존 문장을 통째로 유지한 뒤
    // 의미를 덧붙이는 형태도 길이 제한으로 함께 차단한다.
    const changedFrom = body.data.quote.slice(prefixLength);
    const changedTo = revisedQuote.slice(prefixLength);
    if (!revisedQuote || !/[.!?。]$/.test(revisedQuote) || prefixLength < body.data.quote.length - 5 || changedFrom.length > 5 || changedTo.length > 5) {
      return NextResponse.json({ ok: false, error: "끝맺음만 바꾼 안전한 보완안을 만들지 못했습니다." }, { status: 422 });
    }
    return NextResponse.json({ ok: true, completedQuote: revisedQuote, changedFrom, changedTo });
  } catch (error) {
    console.error("[quote-completion]", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "끝맺음 보완에 실패했습니다." }, { status: 500 });
  }
}
