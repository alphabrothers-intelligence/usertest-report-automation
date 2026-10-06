import type { ReportBlock, ReportSectionContent, ReportTableBlock } from "@/lib/report/sections";
import { DATA_TABLE, REPORT_TEXT, tablePalette } from "@/lib/report/sectionStyle";

/**
 * 블록 목록을 **하나로 이어진 편집 문서**(TipTap HTML)로 바꾼다 — A안 시제품(2026-10-01).
 *
 * 글(`text`)과 그림 없는 표(`rich-static`)는 편집 가능한 문단·표로 풀어 넣는다. 그래야 커서가
 * 블록 경계를 넘어가고 Enter/Backspace로 내용이 밀리고 당겨진다. 제목·차트·도넛 상자처럼
 * 구조가 정해진 블록은 문서 안의 "그림"(`data-report-atom`)으로 넣고 기존 렌더러를 그대로 쓴다.
 */
export const BANNER_ATOM_ID = "__section-banner__";

/** 문서 안 그림으로 넣을 블록인지. 글·표는 풀어서 편집하게 하고 나머지는 그대로 그린다. */
export function isAtomBlock(block: ReportBlock): boolean {
  if (block.kind === "text") return false;
  // "항목 | 주요 의견" 표는 진짜 표로 푼다 — 그림 하나로 두면 한 쪽보다 길 때 바닥글을 뚫고 넘쳤다(2026-10-01 Ⅸ장).
  if (block.kind === "row-group") return false;
  // 문항 제목(Q6. …)·소제목은 편집 가능한 제목으로 푼다 — 그림이면 커서가 앞에 못 가서 Enter·Backspace로
  // 위치를 옮길 수 없었다(2026-10-01 담당자 지적). 번호 상자 제목(1 | …)만 그림으로 남긴다.
  if (block.kind === "heading") return block.variant === "numbered";
  // 일반 표는 편집 가능한 진짜 표로 푼다 — 쪽 끝에서 **행 단위로** 넘어가야 한다(Word 표 속성).
  // 색 규칙이 특수한 표(NPS 구간 색)는 아직 그림으로 둔다.
  if (block.kind === "table") return !!block.npsBands;
  if (block.kind === "rich-static") return /<(svg|img)[\s>]/i.test(block.html);
  return true;
}

/** 화면 전용 장식과 블록 편집기용 표식을 걷어낸다. */
function cleanHtml(html: string): string {
  return html
    // 인용문은 블록 편집기에서 `display:inline` 문단으로 감싸져 있다 — 이어진 문서에서는 한 줄짜리 문단이다.
    .replace(/display:\s*inline;?\s*margin:\s*0/g, "margin:0 0 4pt")
    .replace(/display:\s*inline;?/g, "")
    ;
}

/**
 * 인용 묶음의 숨은 출처 마커(`<span hidden data-quote-group-source …>`)는 편집 문서에 들어가면 빈 글자가
 * 된다 — 그 속성을 **묶음 div 자체로 옮긴다**. 근거 패널은 묶음 자신도 마커로 본다(useReportEvidence).
 */
function liftQuoteGroupMarkers(html: string): string {
  if (!html.includes("data-quote-group-source")) return html;
  const root = document.createElement("div");
  root.innerHTML = html;
  root.querySelectorAll<HTMLElement>("span[data-quote-group-source]").forEach((marker) => {
    const group = marker.parentElement;
    if (group) {
      // **이름을 바꿔 옮긴다** — `[data-quote-group-source]`를 숨기는 기존 서식(globals.css)이 묶음 전체를
      // 숨겨 버렸다(2026-10-02 실측: Ⅲ장 인용문이 통째로 사라짐).
      const source = marker.getAttribute("data-quote-group-source");
      const label = marker.getAttribute("data-quote-group-label");
      if (source !== null) group.setAttribute("data-group-source", source);
      if (label !== null) group.setAttribute("data-group-label", label);
    }
    marker.remove();
  });
  return root.innerHTML;
}

/**
 * **테두리 상자(종합 해석 등)를 문단으로 푼다.** 상자를 그림 하나로 두면 한 쪽보다 길 때 쪽 끝·바닥글을
 * 뚫고 넘쳤다(2026-10-01 담당자 지적 "아주 심각한 오류"). 문단으로 풀면 쪽마다 나뉘어 들어간다.
 * 상자 모양은 문단마다 `data-box`로 표시하고 테두리는 CSS(globals.css)가 그린다 — 쪽 경계에서
 * 상자가 닫히고 다음 쪽에서 다시 열린다(Word 표가 쪽을 넘을 때와 같다).
 * ponytail: 재생성 버튼(AI 분석 재생성)은 아직 옮기지 않았다 — 기능 재건 단계에서 툴바로 옮긴다.
 */
function flattenBoxes(html: string): string {
  const root = document.createElement("div");
  root.innerHTML = html;
  const box = [...root.querySelectorAll<HTMLElement>("div[style*='border']")].find((element) => element.querySelector("p"));
  if (!box) return html;
  box.querySelectorAll("button").forEach((button) => button.remove());
  const paragraphs = [...box.querySelectorAll<HTMLElement>("p")];
  paragraphs.forEach((paragraph, index) => {
    const title = index === 0 && /background-color/.test(paragraph.getAttribute("style") ?? "");
    paragraph.setAttribute("data-box", title ? "panel-title" : "panel");
    if (title) return;
    // 문단 사이 여백(margin)은 상자 테두리를 끊는다 — 안쪽 여백(padding)으로 옮긴다.
    const { marginTop, marginBottom, paddingLeft } = paragraph.style;
    paragraph.style.margin = "0";
    paragraph.style.paddingTop = marginTop || "0";
    paragraph.style.paddingBottom = marginBottom || "0";
    paragraph.style.paddingLeft = `calc(${paddingLeft || "0pt"} + 14pt)`;
    paragraph.style.paddingRight = "14pt";
  });
  return paragraphs.map((paragraph) => paragraph.outerHTML).join("");
}

const escapeHtml = (value: string | number) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 표 블록을 원본 팔레트(제목 띠·머리글 배경·테두리)를 입힌 HTML 표로. */
function tableHtml(block: ReportTableBlock): string {
  const palette = tablePalette(block.paletteIndex);
  const cell = `border:1px solid ${palette.border};padding:4pt 6pt;text-align:center`;
  const columns = Math.max(block.headers.length, ...block.rows.map((row) => row.length));
  const title = block.title ? `<tr><th colspan="${columns}" style="${cell};background-color:${palette.title};font-weight:700">${escapeHtml(block.title)}</th></tr>` : "";
  const head = block.headers.some((header) => header) ? `<tr>${block.headers.map((header) => `<th style="${cell};background-color:${palette.header};font-weight:700">${escapeHtml(header)}</th>`).join("")}</tr>` : "";
  const body = block.rows.map((row) => `<tr>${row.map((value, index) => `<td style="${cell}${index === 0 && block.labelColumn ? `;background-color:${palette.header};font-weight:700` : ""}">${escapeHtml(value)}</td>`).join("")}</tr>`).join("");
  return `<table>${title}${head}${body}</table>`;
}

/** 문항 제목: 기존 웹뷰(ReportBlockView)와 같은 크기·밑줄. 척도 주석이 있으면 밑줄은 주석 아래로 간다. */
function questionHeadingHtml(block: Extract<ReportBlock, { kind: "heading" }>): string {
  const underline = `border-bottom:${REPORT_TEXT.questionUnderlineWidth}pt solid ${REPORT_TEXT.questionUnderlineColor};padding-bottom:7pt`;
  const text = `${block.number ? `${block.number}. ` : ""}${escapeHtml(block.text)}`;
  if (block.variant === "subheading") return `<h3 style="font-size:12pt;font-weight:700;margin:14pt 0 6pt">${text}</h3>`;
  const title = `<h3 style="font-size:18px;font-weight:500;line-height:1.5;margin:21pt 0 ${block.note ? "2pt" : "15pt"};${block.note ? "" : underline}">${text}</h3>`;
  return block.note
    ? `${title}<p style="text-align:right;font-size:${REPORT_TEXT.noteFontSize}pt;margin:0 0 15pt;${underline}">${escapeHtml(block.note)}</p>`
    : title;
}

/** 커서가 놓일 문단이 없는 경계 — 그림이나 표로 시작/끝나는 조각 사이에는 빈 문단을 둔다. */
const startsSolid = (html: string) => /^(<div data-report-block-id[^>]*>)?<(div data-report-atom|table)/.test(html);
const endsSolid = (html: string) => /(<\/table>|data-report-atom="[^"]*"><\/div>)(<\/div>)?$/.test(html);
/**
 * Word처럼 **그림·표 사이에도 항상 문단 하나**가 있게 한다. 없으면 편집기가 그 자리에 가로 막대 커서
 * (gap cursor)를 띄워 Word와 다르게 보였다(2026-10-01 담당자 지적). 빈 문단은 CSS로 낮게 그려서
 * 원래 배치를 거의 바꾸지 않고, 글을 쓰기 시작하면 보통 문단이 된다.
 */
const SPACER = `<p data-spacer=""></p>`;

export function sectionToEditorHtml(section: ReportSectionContent): string {
  const html = sectionToEditorParts(section);
  const out: string[] = [];
  html.forEach((part, index) => {
    if (index > 0 && startsSolid(part) && endsSolid(html[index - 1])) out.push(SPACER);
    out.push(part);
  });
  if (endsSolid(out[out.length - 1] ?? "")) out.push(SPACER);
  return out.join("");
}

/** 블록 하나를 편집 문서 조각으로. 장 본문과 "항목 | 주요 의견" 표의 칸 안이 같은 규칙을 쓴다. */
export function blockHtml(block: ReportBlock): string {
  if (isAtomBlock(block)) return `<div data-report-atom="${block.id}"></div>`;
  if (block.kind === "table") return tableHtml(block);
  if (block.kind === "heading") return questionHeadingHtml(block);
  if (block.kind === "row-group") return rowGroupHtml(block);
  const html = (block as { html: string }).html;
  // 블록 번호로 감싼다 — 근거 패널이 "지금 읽는 블록"을 찾고 오른쪽 수정 탭이 그 블록을 연다.
  return `<div data-report-block-id="${block.id}">${liftQuoteGroupMarkers(cleanHtml(block.kind === "rich-static" ? flattenBoxes(html) : html))}</div>`;
}

/** "항목 | 주요 의견" 표: 왼쪽은 항목명, 오른쪽 칸에 원래 블록들(차트는 그림, 글·표는 편집 가능)을 그대로 담는다. */
function rowGroupHtml(block: Extract<ReportBlock, { kind: "row-group" }>): string {
  const palette = tablePalette(0);
  const border = `border:${DATA_TABLE.borderWidth}pt solid ${palette.border}`;
  const head = block.headers
    ? `<tr><th style="${border};background-color:${palette.title};padding:6pt;text-align:center;font-weight:700;width:18%">${escapeHtml(block.headers[0])}</th><th style="${border};background-color:${palette.title};padding:6pt;text-align:center;font-weight:700">${escapeHtml(block.headers[1])}</th></tr>`
    : "";
  const rows = block.rows.map((row) => {
    const inside = row.blocks.map(blockHtml).join("") || "<p></p>";
    return `<tr><td style="${border};background-color:${palette.header};padding:6pt;text-align:center;vertical-align:middle;font-weight:700;width:18%"><p>${escapeHtml(row.label)}</p></td><td style="${border};padding:8pt;vertical-align:top">${inside}</td></tr>`;
  }).join("");
  return `<table>${head}${rows}</table>`;
}

function sectionToEditorParts(section: ReportSectionContent): string[] {
  return [`<div data-report-atom="${BANNER_ATOM_ID}"></div>`, ...section.blocks.map(blockHtml)];
}
