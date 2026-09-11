/**
 * **축소판(요약본) 만들기.** 전체 보고서에서 분량을 줄인 판이다.
 *
 * **기존 보고서 경로를 건드리지 않는다**(2026-09-09 담당자 지시: "기존의 보고서 생성 로직 +
 * 웹 뷰는 절대 건드리면 안 된다"). 그래서 이 파일은 **이미 만들어진 섹션을 받아서 줄이기만
 * 한다** — 새 렌더러도, 새 계산도, 새 프롬프트도 없다. 전체 보고서가 바뀌면 축소판도 자동으로
 * 따라간다.
 *
 * ## 무엇을 줄이나 — 항목은 남기고 **내용만** 줄인다 (2026-09-10 담당자 지시로 방향 수정)
 *
 * 첫 판은 문항별 상세를 통째로 빼서 11쪽까지 줄었는데, **"너무 축소됐다, 원래 들어가야 하는
 * 목차·항목은 다 들어가되 그 안의 내용만 줄어야 한다"**는 지적을 받았다. 그래서 지금은
 * 블록을 **하나도 빼지 않는다** — 장·절·문항 구성과 도표는 전체 보고서와 똑같고,
 * 분량의 대부분을 차지하던 **인용문 묶음만** 줄인다:
 *
 * - 극성(긍정·부정·중립)마다 **카테고리 한 묶음씩만** 남긴다(원래는 극성당 5~10묶음).
 * - 남긴 묶음 안의 **대표 인용문도 1건만** 남긴다(원래는 최대 3건).
 * - 극성 배너("1. 긍정 의견 (28.7%)")·인사이트 문장·도넛·점수표는 그대로 둔다 —
 *   이것들이 "무엇이 나왔는가"를 말해주는 뼈대다.
 *
 * 인용문 묶음은 `workspace.ts`의 `categoryHtml`이 `<div data-quote-category …>`로, 인용문은
 * `quoteHtml`이 `<div data-report-quote …>`로 감싸 두었다. 그 표식을 그대로 이용한다 —
 * 축소판 때문에 본문 HTML 생성 쪽에 새 표식을 넣지 않는다.
 */
import type { ReportBlock, ReportSectionContent } from "@/lib/report/sections";

/** 극성 하나당 남길 인용문 묶음 수. */
export const CATEGORIES_PER_POLARITY = 2;
/** 남긴 묶음 안에서 보여줄 대표 인용문 수. */
export const QUOTES_PER_CATEGORY = 2;

/**
 * `<div {marker} …> … </div>` 덩어리를 **여는 태그와 닫는 태그의 짝을 세어** 찾는다.
 * 인용문 묶음 안에 인용문 div가 또 들어 있어서(중첩), 정규식 하나로는 끝을 못 찾는다.
 */
function balancedDivs(html: string, marker: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const open = `<div ${marker}`;
  let from = 0;
  for (;;) {
    const start = html.indexOf(open, from);
    if (start < 0) return spans;
    let depth = 0;
    let cursor = start;
    for (;;) {
      const nextOpen = html.indexOf("<div", cursor + 1);
      const nextClose = html.indexOf("</div>", cursor + 1);
      if (nextClose < 0) return spans; // 닫히지 않은 HTML — 건드리지 않는다.
      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth += 1;
        cursor = nextOpen;
        continue;
      }
      if (depth === 0) {
        const end = nextClose + "</div>".length;
        spans.push({ start, end });
        from = end;
        break;
      }
      depth -= 1;
      cursor = nextClose;
    }
  }
}

/** 인용문 묶음 하나에서 대표 인용문을 `QUOTES_PER_CATEGORY`건만 남긴다. */
function trimQuotes(categoryHtml: string): string {
  const quotes = balancedDivs(categoryHtml, "data-report-quote");
  if (quotes.length <= QUOTES_PER_CATEGORY) return categoryHtml;
  // 뒤에서부터 지워야 앞쪽 인덱스가 밀리지 않는다.
  let result = categoryHtml;
  for (const span of quotes.slice(QUOTES_PER_CATEGORY).reverse()) {
    result = result.slice(0, span.start) + result.slice(span.end);
  }
  return result;
}

/** 극성마다 묶음을 `CATEGORIES_PER_POLARITY`개만 남기고, 남긴 묶음의 인용문도 줄인다. */
export function trimCategoryHtml(html: string): string {
  const categories = balancedDivs(html, "data-quote-category");
  if (categories.length === 0) return html;

  const kept = new Map<string, number>();
  const pieces: { start: number; end: number; replacement: string }[] = [];
  for (const span of categories) {
    const chunk = html.slice(span.start, span.end);
    const polarity = chunk.match(/data-category-polarity="([^"]*)"/)?.[1] ?? "";
    const seen = kept.get(polarity) ?? 0;
    kept.set(polarity, seen + 1);
    pieces.push({ ...span, replacement: seen < CATEGORIES_PER_POLARITY ? trimQuotes(chunk) : "" });
  }

  let result = html;
  for (const piece of pieces.reverse()) {
    result = result.slice(0, piece.start) + piece.replacement + result.slice(piece.end);
  }
  return result;
}

/** `<태그 …> … </태그>` 하나를 짝을 세어 찾는다(중첩 대응). 없으면 null. */
function balancedTag(html: string, tag: string, from = 0): { start: number; end: number } | null {
  const start = html.indexOf(`<${tag}`, from);
  if (start < 0) return null;
  let depth = 0;
  let cursor = start;
  for (;;) {
    const nextOpen = html.indexOf(`<${tag}`, cursor + 1);
    const nextClose = html.indexOf(`</${tag}>`, cursor + 1);
    if (nextClose < 0) return null;
    if (nextOpen >= 0 && nextOpen < nextClose) { depth += 1; cursor = nextOpen; continue; }
    if (depth === 0) return { start, end: nextClose + tag.length + 3 };
    depth -= 1;
    cursor = nextClose;
  }
}

/**
 * **문항마다 반복되는 큰 도표를 걷어낸다**(2026-09-10 담당자 요청 — 라이트 버전 레이아웃).
 *
 * 축소판 분량의 대부분은 글이 아니라 문항마다 반복되는 도표다: 만족도 분포도(세로 막대 11칸)와
 * 감정 분석 도넛. 둘 다 **바로 옆에 같은 수치가 글자로 이미 있다**(평균·표준편차 배너, 긍정/부정/
 * 중립 %표). 그래서 도표만 빼면 정보는 그대로 두고 쪽수만 줄어든다.
 *
 * - 점수 박스(`…-scorebox`): 평균·표준편차 배너(첫 표)만 남기고 분포도 표를 뺀다.
 * - **감정 분석 도넛은 남긴다**(2026-09-10 담당자 결정 — 한 번 뺐다가 되돌렸다).
 */
function compactBlock(block: ReportBlock): ReportBlock {
  if (block.kind !== "rich-static") return block;
  if (/-scorebox$/.test(block.id)) {
    const first = balancedTag(block.html, "table");
    if (!first) return block;
    // **id도 바꾼다.** `ReportBlockView`는 `feature-qualitative-qN-scorebox`라는 id를 보고
    // 전용 틀(만족도 분포도 + 주요 키워드 이미지 칸)을 다시 그린다. html만 줄이면 그 틀이
    // 빈 상자로 남는다(2026-09-10 실측). id를 바꿔 일반 렌더링 경로를 타게 한다.
    return { ...block, id: `brief-${block.id}`, html: block.html.slice(first.start, first.end) };
  }
  return block;
}

function trimBlock(block: ReportBlock): ReportBlock {
  const compact = compactBlock(block);
  if (compact.kind !== "text" && compact.kind !== "rich-static") return compact;
  const html = trimCategoryHtml(compact.html);
  return html === compact.html ? compact : { ...compact, html };
}

/** **블록을 빼지 않는다** — 장·절·문항·도표는 전체 보고서와 같고 인용문 묶음만 줄인다. */
export function toBriefSections(sections: ReportSectionContent[]): ReportSectionContent[] {
  return sections.map((section) => ({ ...section, blocks: section.blocks.map(trimBlock) }));
}

/** "얼마나 줄었나"를 숫자로 보여주기 위한 집계. 화면 상단에 그대로 띄운다. */
export function briefStats(full: ReportSectionContent[], brief: ReportSectionContent[]) {
  const count = (sections: ReportSectionContent[]) => ({
    sections: sections.length,
    blocks: sections.reduce((sum, section) => sum + section.blocks.length, 0),
    // 글자 수는 분량 체감에 가장 가깝다(도표는 개수, 정성은 글이 대부분이라).
    chars: sections.reduce(
      (sum, section) =>
        sum +
        section.blocks.reduce((inner, block) => {
          const html = block.kind === "text" || block.kind === "rich-static" ? block.html : "";
          return inner + html.replace(/<[^>]+>/g, "").length;
        }, 0),
      0,
    ),
  });
  return { full: count(full), brief: count(brief) };
}
