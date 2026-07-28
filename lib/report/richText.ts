/**
 * 보고서 본문을 위한 최소 공통 서식 모델.
 *
 * Markdown은 입력 호환을 위한 해석 규칙일 뿐, 화면·클립보드·문서에 그대로 노출하지
 * 않는다. 같은 run 정보를 웹 HTML, HWPX, DOCX가 각자 서식으로 변환한다.
 */
export type RichTextRun = {
  text: string;
  bold?: boolean;
  underline?: boolean;
  italic?: boolean;
};

export type RichTextBlockKind = "heading" | "paragraph" | "bullet" | "arrow";

export type RichTextBlock = {
  kind: RichTextBlockKind;
  level?: 1 | 2 | 3;
  runs: RichTextRun[];
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * `**굵게**`, `__밑줄__`, `***굵은 기울임***`, 그리고 **중첩**(`**__굵게+밑줄__**`,
 * `__**밑줄+굵게**__`)을 서식 run으로 바꾼다. 재귀로 파싱해 마커가 겹쳐도 각 run이 굵게·밑줄·
 * 기울임 플래그를 모두 갖는다(원본 보고서의 "핵심 어구 굵게+밑줄" 강조를 그대로 유지하기 위함).
 */
export function parseRichRuns(value: string, base: Omit<RichTextRun, "text"> = {}): RichTextRun[] {
  const matcher = /(\*\*\*|\*\*|__)([\s\S]*?)\1/g;
  const runs: RichTextRun[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  const pushPlain = (text: string) => { if (text) runs.push({ text, ...base }); };
  while ((match = matcher.exec(value))) {
    if (match.index > cursor) pushPlain(value.slice(cursor, match.index));
    const marker = match[1];
    const next: Omit<RichTextRun, "text"> =
      marker === "***" ? { ...base, bold: true, italic: true }
      : marker === "**" ? { ...base, bold: true }
      : { ...base, underline: true };
    runs.push(...parseRichRuns(match[2], next)); // 안쪽도 재귀 파싱 → 마커 중첩 지원
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) pushPlain(value.slice(cursor));
  return runs.length ? runs : [{ text: value, ...base }];
}

export function parseRichText(value: string): RichTextBlock[] {
  return value
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((raw) => {
      const line = raw.trim();
      const tripleEmphasis = line.match(/^\*\*\*([\s\S]+)\*\*\*$/);
      const doubleEmphasis = tripleEmphasis ? null : line.match(/^\*\*([\s\S]+)\*\*$/);
      const underlineEmphasis = tripleEmphasis || doubleEmphasis ? null : line.match(/^__([\s\S]+)__$/);
      // Markdown으로 감싼 `[제목]`, `→ 제언`도 먼저 바깥 마커를 벗긴 뒤 구조를 판별한다.
      // 그렇지 않으면 `**[GPS 정확도]**`가 제목이 아니라 별표가 포함된 일반 문단으로 남아
      // 한글 복사 전에도 서식 모델에 들어오지 않는 문제가 생긴다.
      const contentLine = (tripleEmphasis?.[1] ?? doubleEmphasis?.[1] ?? underlineEmphasis?.[1] ?? line).trim();
      const forcedStyle: Omit<RichTextRun, "text"> = tripleEmphasis
        ? { bold: true, italic: true }
        : doubleEmphasis
          ? { bold: true }
          : underlineEmphasis
            ? { underline: true }
            : {};
      const runs = (content: string) => parseRichRuns(content, forcedStyle);
      if (/^#{1,3}\s+/.test(contentLine)) {
        const marker = contentLine.match(/^(#{1,3})\s+/)?.[1] ?? "#";
        return { kind: "heading" as const, level: marker.length as 1 | 2 | 3, runs: runs(contentLine.replace(/^#{1,3}\s+/, "")) };
      }
      if (/^\[[^\]]+\]$/.test(contentLine)) return { kind: "heading" as const, level: 2, runs: runs(contentLine.slice(1, -1)) };
      if (/^(→|▶)\s*/.test(contentLine)) return { kind: "arrow" as const, runs: runs(contentLine.replace(/^(→|▶)\s*/, "")) };
      if (/^[-•]\s+/.test(contentLine)) return { kind: "bullet" as const, runs: runs(contentLine.replace(/^[-•]\s+/, "")) };
      return { kind: "paragraph" as const, runs: runs(contentLine) };
    });
}

export function runsToPlainText(runs: RichTextRun[]): string {
  return runs.map((run) => run.text).join("");
}

export function richTextToHtml(value: string): string {
  return parseRichText(value).map((block) => {
    const content = block.runs.map((run) => {
      const text = escapeHtml(run.text);
      if (run.bold && run.underline && run.italic) return `<strong><u><em>${text}</em></u></strong>`;
      if (run.bold && run.underline) return `<strong><u>${text}</u></strong>`;
      if (run.bold && run.italic) return `<strong><em>${text}</em></strong>`;
      if (run.bold) return `<strong>${text}</strong>`;
      if (run.underline) return `<u>${text}</u>`;
      if (run.italic) return `<em>${text}</em>`;
      return text;
    }).join("");
    if (block.kind === "heading") return `<h${block.level ?? 2}>${content}</h${block.level ?? 2}>`;
    // 화살표 제언은 원본 보고서 관례대로 굵게+기울임. 편집기 sanitize가 인라인 style을 지우므로
    // 의미 태그(<strong><em>)로 강조해 화면 표시·복사·붙여넣기에서 모두 유지되게 한다.
    if (block.kind === "arrow") return `<p data-report-kind="arrow"><strong><em>→ ${content}</em></strong></p>`;
    if (block.kind === "bullet") return `<ul><li>${content}</li></ul>`;
    return `<p>${content}</p>`;
  }).join("");
}

// 한글(HWP)·Word 붙여넣기 서식 유지의 핵심: 클립보드 HTML은 CSS 클래스가 아니라 **인라인
// 스타일 + 의미 태그**로만 써야 한다. 붙여넣을 때 워드프로세서는 CSS 클래스를 버리고 인라인
// 스타일과 <b>/<u>/<i> 같은 태그만 해석하기 때문이다. 글꼴도 인라인 font-family로 지정해야
// 맑은 고딕이 유지된다(PRD 3.3.2).
export const CLIPBOARD_FONT_FAMILY = "'맑은 고딕', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

/** run(굵게/밑줄/기울임)을 인라인 스타일 + 의미 태그로 변환 — 붙여넣기 호환성을 위해 둘 다 쓴다. */
function runToInlineHtml(run: RichTextRun): string {
  let html = escapeHtml(run.text);
  const styles: string[] = [];
  if (run.bold) { styles.push("font-weight:700"); html = `<b>${html}</b>`; }
  if (run.underline) { styles.push("text-decoration:underline"); html = `<u>${html}</u>`; }
  if (run.italic) { styles.push("font-style:italic"); html = `<i>${html}</i>`; }
  return styles.length ? `<span style="${styles.join(";")}">${html}</span>` : html;
}

/**
 * 문단을 만들지 않고 한 줄 안의 Markdown 강조만 실제 HTML 의미 태그로 바꾼다.
 *
 * 정성 응답의 인용문·카테고리명은 이미 바깥에서 `<p>`로 감싸므로 `richTextToHtml()`을
 * 쓰면 문단이 중첩된다. 이 함수는 그 경우에 쓰는 인라인 전용 변환기다. 중요한 점은
 * 화면용 CSS만 내보내지 않고 `<b>`, `<u>`, `<i>`도 함께 출력한다는 것이다. 한글은
 * `font-weight` 등의 CSS를 무시할 수 있지만 이 의미 태그는 안정적으로 해석한다.
 */
export function richTextToInlineHtml(value: string): string {
  return parseRichRuns(value).map(runToInlineHtml).join("");
}

/**
 * 구조화 블록/Markdown 원문을 **한글·Word에 그대로 붙는 자체 완결 HTML**로 변환한다.
 * 모든 서식이 인라인 스타일이고 루트에 맑은 고딕 font-family가 걸려 있어, 클립보드에 넣고
 * 붙여넣으면 문단·굵게·밑줄·기울임·화살표 제언·글머리표가 유지된다. 웹·클립보드·문서 출력의
 * 단일 변환기로 쓴다(PRD 3.3.1).
 * - `[ ... ]` / `# ` 소제목 → 굵게
 * - `"..."` 인용 등 일반 문단 → 본문 + 인라인 강조 run
 * - `→`/`▶` 제언 → 굵게+기울임(원본 보고서 관례)
 * - `-`/`•` 글머리표 → 불릿
 */
export function richTextToClipboardHtml(value: string): string {
  const body = parseRichText(value)
    .map((block) => {
      const inner = block.runs.map(runToInlineHtml).join("");
      if (block.kind === "heading") {
        const size = block.level === 1 ? "16pt" : block.level === 2 ? "13pt" : "12pt";
        return `<p style="margin:12pt 0 6pt;font-weight:700;font-size:${size};line-height:1.4">${inner}</p>`;
      }
      if (block.kind === "arrow") {
        return `<p style="margin:0 0 5pt;font-weight:700;font-style:italic;line-height:1.5">→ ${inner}</p>`;
      }
      if (block.kind === "bullet") {
        return `<p style="margin:0 0 5pt;padding-left:15pt;text-indent:-15pt;line-height:1.5">• ${inner}</p>`;
      }
      return `<p style="margin:0 0 6pt;line-height:1.6">${inner}</p>`;
    })
    .join("");
  return `<div style="font-family:${CLIPBOARD_FONT_FAMILY};font-size:11pt;color:#000000">${body}</div>`;
}

const PLAIN_TEXT_BLOCK_TAGS = new Set([
  "P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TR", "TABLE", "UL", "OL", "SECTION", "ARTICLE",
]);

/**
 * HTML → 일반 텍스트. `.innerText`는 레이아웃(렌더 트리)에 의존하는데, 여기서 만드는 `<div>`는
 * `document.body`에 붙이지 않은 상태라(detached) 레이아웃이 없어 `.innerText`가 문단 경계에
 * 줄바꿈을 넣지 못하고 전부 한 줄로 이어 붙이는 문제가 실측 확인됐다(2026-07-25 — 클립보드
 * text/plain이 "1. 제품 소개→ 개선 필요…"처럼 뭉개짐). 레이아웃과 무관하게 항상 같은 결과가
 * 나오도록 블록 태그 경계에서 직접 줄바꿈을 넣는다.
 */
export function htmlToPlainText(value: string): string {
  if (typeof window === "undefined") return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const container = document.createElement("div");
  container.innerHTML = value;
  const lines: string[] = [];
  let current = "";
  function walk(node: ChildNode) {
    if (node.nodeType === Node.TEXT_NODE) {
      current += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    if (el.tagName === "BR") {
      lines.push(current);
      current = "";
      return;
    }
    const isBlock = PLAIN_TEXT_BLOCK_TAGS.has(el.tagName);
    if (isBlock && current.trim()) {
      lines.push(current);
      current = "";
    }
    Array.from(el.childNodes).forEach(walk);
    if (isBlock) {
      lines.push(current);
      current = "";
    }
  }
  Array.from(container.childNodes).forEach(walk);
  if (current.trim()) lines.push(current);
  return lines.map((line) => line.trim()).filter(Boolean).join("\n").trim();
}
