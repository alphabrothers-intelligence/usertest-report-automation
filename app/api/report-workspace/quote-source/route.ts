import { NextResponse } from "next/server";
import { z } from "zod";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { buildQuestionSpecs } from "@/lib/pipeline/questions";
import { needsReportQuoteEndingReview } from "@/lib/report/quoteEnding";

export const runtime = "nodejs";

const QuerySchema = z.object({
  source: z.string().url(),
  questionKey: z.string().min(1),
  quote: z.string().min(1),
});

const BodySchema = z.object({
  source: z.string().url(),
  questionKey: z.string().min(1),
  quotes: z.array(z.string().min(1)).min(1),
});

function normalized(value: string) {
  return value.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[\u200B\s]+/g, "");
}

function findNormalizedRange(source: string, quote: string) {
  const directStart = source.indexOf(quote);
  if (directStart >= 0) return { matchStart: directStart, matchEnd: directStart + quote.length };
  const normalizedChars: string[] = [];
  const sourceIndexes: number[] = [];
  for (let sourceIndex = 0; sourceIndex < source.length;) {
    const codePoint = source.codePointAt(sourceIndex);
    const character = codePoint === undefined ? "" : String.fromCodePoint(codePoint);
    const next = normalized(character);
    for (const normalizedCharacter of next) {
      normalizedChars.push(normalizedCharacter);
      sourceIndexes.push(sourceIndex);
    }
    sourceIndex += character.length || 1;
  }
  const start = normalizedChars.join("").indexOf(normalized(quote));
  if (start < 0) return { matchStart: -1, matchEnd: -1 };
  const endIndex = start + normalized(quote).length - 1;
  const lastCharacter = source.codePointAt(sourceIndexes[endIndex]);
  const lastLength = lastCharacter !== undefined && lastCharacter > 0xffff ? 2 : 1;
  return { matchStart: sourceIndexes[start], matchEnd: sourceIndexes[endIndex] + lastLength };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    source: url.searchParams.get("source"),
    questionKey: url.searchParams.get("questionKey"),
    quote: url.searchParams.get("quote"),
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "인용문 출처 정보가 올바르지 않습니다." }, { status: 400 });

  const loaded = await loadWallaFromUrl(parsed.data.source);
  if (!loaded.ok || !loaded.parsed) return NextResponse.json({ ok: false, error: "원본 데이터를 읽지 못했습니다." }, { status: 404 });
  const records = normalizeWallaRows(loaded.parsed.headerRow, loaded.parsed.dataRows);
  const spec = buildQuestionSpecs(records).find((question) => question.id === parsed.data.questionKey);
  if (!spec) return NextResponse.json({ ok: false, error: "인용문이 사용된 문항을 찾지 못했습니다." }, { status: 404 });

  const quoteKey = normalized(parsed.data.quote);
  const input = spec.inputs.find((candidate) => normalized(candidate.reason).includes(quoteKey));
  if (!input) return NextResponse.json({ ok: false, error: "원본 응답에서 해당 인용문을 찾지 못했습니다." }, { status: 404 });
  const range = findNormalizedRange(input.reason, parsed.data.quote);

  return NextResponse.json({
    ok: true,
    questionKey: spec.id,
    questionLabel: spec.label,
    respondentId: input.respondent_id,
    originalResponse: input.reason,
    quote: parsed.data.quote,
    ...range,
    needsReview: needsReportQuoteEndingReview(parsed.data.quote),
  });
}

export async function POST(request: Request) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "인용문 출처 정보가 올바르지 않습니다." }, { status: 400 });

  const loaded = await loadWallaFromUrl(parsed.data.source);
  if (!loaded.ok || !loaded.parsed) return NextResponse.json({ ok: false, error: "원본 데이터를 읽지 못했습니다." }, { status: 404 });
  const records = normalizeWallaRows(loaded.parsed.headerRow, loaded.parsed.dataRows);
  const spec = buildQuestionSpecs(records).find((question) => question.id === parsed.data.questionKey);
  if (!spec) return NextResponse.json({ ok: false, error: "인용문이 사용된 문항을 찾지 못했습니다." }, { status: 404 });

  const grouped = new Map<number, {
    respondentId: number;
    originalResponse: string;
    matches: Array<{ quote: string; matchStart: number; matchEnd: number; needsReview: boolean }>;
  }>();

  for (const quote of [...new Set(parsed.data.quotes)]) {
    const quoteKey = normalized(quote);
    const input = spec.inputs.find((candidate) => normalized(candidate.reason).includes(quoteKey));
    if (!input) continue;
    const range = findNormalizedRange(input.reason, quote);
    const entry = grouped.get(input.respondent_id) ?? {
      respondentId: input.respondent_id,
      originalResponse: input.reason,
      matches: [],
    };
    entry.matches.push({
      quote,
      ...range,
      needsReview: needsReportQuoteEndingReview(quote),
    });
    grouped.set(input.respondent_id, entry);
  }

  const sources = [...grouped.values()];
  if (sources.length === 0) return NextResponse.json({ ok: false, error: "원본 응답에서 해당 인용문을 찾지 못했습니다." }, { status: 404 });
  return NextResponse.json({ ok: true, questionKey: spec.id, questionLabel: spec.label, sources });
}
