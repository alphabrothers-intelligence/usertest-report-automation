"use client";

import { useEffect, useRef, type ClipboardEvent } from "react";
import { htmlToPlainText, richTextToHtml, CLIPBOARD_FONT_FAMILY } from "@/lib/report/richText";
import { htmlToRtf } from "@/lib/report/rtfClipboard";

type RichReportEditorProps = {
  label: string;
  value: string;
  onChange: (html: string, plainText: string) => void;
};

const allowedTags = new Set(["P", "DIV", "H1", "H2", "H3", "STRONG", "B", "U", "EM", "I", "UL", "OL", "LI", "BR", "SPAN"]);

/**
 * 보고서 본문에서만 쓰는 안전한 인라인 서식 목록.
 *
 * 정성 분석 결과의 극성 배너·인용문·제언은 색상, 여백, 강조가 의미를 가진다. 예전에는
 * 편집기에 넣기 전에 style 속성을 전부 지워서 "보이기는 하지만 수정할 수 없는" 상태였다.
 * 아래 목록만 보존하면 배너와 문단 형태는 유지하면서 url()/expression() 같은 임의 CSS는
 * 클립보드/편집 경로로 들어오지 않는다.
 */
const allowedStyleProperties = new Set([
  "background-color", "color", "font-weight", "font-style", "font-size",
  "text-decoration", "text-align", "line-height", "margin", "margin-top",
  "margin-right", "margin-bottom", "margin-left", "padding", "padding-top",
  "padding-right", "padding-bottom", "padding-left", "text-indent",
  // 원본 보고서형 분석 박스의 제목띠·테두리는 편집 가능한 본문 안에서도 유지되어야 한다.
  "border", "border-top", "border-right", "border-bottom", "border-left",
  "border-collapse", "width", "table-layout", "vertical-align",
]);

function sanitizeStyle(value: string): string {
  return value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(Boolean)
    .map((declaration) => {
      const colon = declaration.indexOf(":");
      if (colon <= 0) return null;
      const property = declaration.slice(0, colon).trim().toLowerCase();
      const styleValue = declaration.slice(colon + 1).trim();
      if (!allowedStyleProperties.has(property) || !styleValue) return null;
      if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(styleValue)) return null;
      return `${property}:${styleValue}`;
    })
    .filter((declaration): declaration is string => declaration !== null)
    .join(";");
}

/**
 * 과거에 저장된 보고서 블록은 `<p style="font-weight:700">`처럼 CSS만 가진다.
 * Chrome 화면에서는 굵게지만 한글의 HTML 붙여넣기는 이 CSS를 무시할 수 있으므로, 실제
 * 의미 태그를 같이 심는다. 새 생성 결과는 처음부터 `<strong>` 등을 쓰지만, 이 보정으로
 * 기존 DB/브라우저 저장본도 다시 생성하지 않고 동일하게 복사할 수 있다.
 */
function addSemanticFormatting(element: Element, doc: Document) {
  const style = element.getAttribute("style") ?? "";
  const needsBold = /(?:^|;)\s*font-weight\s*:\s*(?:[6-9]00|bold)\b/i.test(style);
  const needsItalic = /(?:^|;)\s*font-style\s*:\s*italic\b/i.test(style);
  const needsUnderline = /(?:^|;)\s*text-decoration\s*:\s*[^;]*underline/i.test(style);
  const tag = element.tagName;

  // 이 요소가 이미 해당 의미 태그이거나, 새 생성기처럼 자식 전체가 의미 태그 하나로
  // 감싸져 있으면 중첩하지 않는다.
  const singleChild = element.children.length === 1 ? element.firstElementChild : null;
  const hasWholeChildTag = (names: string[]) => Boolean(singleChild && names.includes(singleChild.tagName));
  const wrap = (names: string[], targetTag: "strong" | "em" | "u") => {
    if (names.includes(tag) || hasWholeChildTag(names)) return;
    const wrapper = doc.createElement(targetTag);
    while (element.firstChild) wrapper.appendChild(element.firstChild);
    element.appendChild(wrapper);
  };
  if (needsBold) wrap(["STRONG", "B"], "strong");
  if (needsItalic) wrap(["EM", "I"], "em");
  if (needsUnderline) wrap(["U"], "u");
}

/** 외부 HTML을 신뢰하지 않고 보고서 편집에 필요한 최소 태그만 남긴다. */
function sanitizeReportHtml(value: string): string {
  if (typeof window === "undefined") return value;
  const doc = new DOMParser().parseFromString(value, "text/html");
  for (const element of Array.from(doc.body.querySelectorAll("*"))) {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name === "data-report-kind") continue;
      if (attribute.name === "style") {
        const style = sanitizeStyle(attribute.value);
        if (style) element.setAttribute("style", style);
        else element.removeAttribute("style");
        continue;
      }
      element.removeAttribute(attribute.name);
    }
    addSemanticFormatting(element, doc);
  }
  return doc.body.innerHTML || "<p></p>";
}

/**
 * 한글/Word 서식 유지 복사. 넘어온 HTML을 **맑은 고딕 인라인 폰트 컨테이너**로 감싸서
 * 클립보드에 넣는다 — 붙여넣을 때 워드프로세서가 인라인 font-family를 읽어 맑은 고딕을 쓰고,
 * <b>/<u>/<i> 의미 태그로 굵게·밑줄·기울임이 유지된다(CSS 클래스는 붙여넣기에서 버려지므로
 * 화면 클래스 HTML을 그대로 쓰지 않는다). CSS 클래스가 섞인 화면 HTML을 넣더라도 최소한
 * 폰트와 의미 태그는 살아남는다. 가능하면 richText의 인라인 변환기를 통과시켜 넘길 것.
 */
export function tryOfficeCompatibleCopy(html: string): boolean {
  const rtf = htmlToRtf(html);
  // HWP는 ClipboardItem으로 직접 작성한 text/html보다, 브라우저가 선택 영역을 복사하면서
  // 생성하는 Office 호환 HTML을 더 안정적으로 해석한다. 특히 <b>/<u>/<i>, 문단과 표의
  // 경계가 이 경로에서 유지된다. 화면을 보이지 않는 위치에 잠시 두되 display:none은 선택을
  // 무시하므로 쓰지 않는다. 실패한 브라우저만 아래 Clipboard API 경로로 이어진다.
    const selection = window.getSelection();
    const previousRanges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
    const staging = document.createElement("div");
    staging.contentEditable = "true";
    staging.setAttribute("aria-hidden", "true");
    staging.style.cssText = "position:fixed;left:-10000px;top:0;width:794px;opacity:0;pointer-events:none;";
    staging.innerHTML = html;
    document.body.appendChild(staging);
    // 한글은 버전/설정에 따라 HTML 대신 RTF를 우선해 붙여넣는다. 브라우저가 만드는
    // 네이티브 CF_HTML은 그대로 남기고, copy 이벤트에 RTF만 추가해 두 형식을 동시에
    // 제공한다. `preventDefault()`를 호출하면 CF_HTML이 사라지므로 절대 호출하지 않는다.
    const includeRtf = (event: globalThis.ClipboardEvent) => {
      try {
        event.clipboardData?.setData("text/rtf", rtf);
      } catch {
        // 일부 Chromium/운영체제는 웹에서 RTF MIME 쓰기를 막는다. 이 경우에도 아래
        // 기본 HTML 복사는 정상적으로 계속된다.
      }
    };
    document.addEventListener("copy", includeRtf, { capture: true, once: true });
    try {
      const range = document.createRange();
      range.selectNodeContents(staging);
      selection?.removeAllRanges();
      selection?.addRange(range);
      // ReportWebDocument의 부분 선택 복사 리스너가 이 내부 복사를 다시 가로채지 않게 표시.
      // 이 순간에는 브라우저가 staging의 의미 태그·인라인 스타일을 Office 호환 포맷으로
      // 직렬화하도록 그대로 통과시켜야 한다.
      document.documentElement.setAttribute("data-report-office-copy", "true");
      // 중요: 여기서 clipboardData.setData()/preventDefault()로 직접 HTML을 넣으면 Chromium이
      // 만드는 Windows/macOS 네이티브 CF_HTML(fragment 시작·끝 오프셋 포함)을 잃는다. 한글은
      // 이 네이티브 조각을 일반 `text/html`보다 안정적으로 해석하므로, 선택 영역을 복사한
      // 뒤에는 기본 브라우저 복사 경로를 그대로 통과시킨다. ReportWebDocument의 copy 리스너는
      // 위 data attribute를 보고 이 순간만 건드리지 않는다.
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      document.removeEventListener("copy", includeRtf, true);
      document.documentElement.removeAttribute("data-report-office-copy");
      selection?.removeAllRanges();
      previousRanges.forEach((range) => selection?.addRange(range));
      staging.remove();
    }
}

// 한글은 붙여넣기 시 바깥 div의 글꼴 상속을 버리고 기본 글꼴(함초롱바탕)으로 대체하는
// 경우가 있다. 따라서 복사 전용 HTML에는 CSS뿐 아니라 구형 Office/HWP 파서가 직접 읽는
// `<font face>`를 실제 본문 전체에 붙인다. 이 함수는 버튼 복사와 ClipboardItem 폴백이
// 같은 HTML을 사용하도록 단일 진입점에 둔다.
function ensureHwpFontHtml(html: string): string {
  const fontStyle = "font-family:'맑은 고딕','Malgun Gothic',sans-serif;mso-fareast-font-family:'맑은 고딕';";
  return `<div style="${fontStyle}font-size:11pt;color:#000000;line-height:1.6"><font face="맑은 고딕" style="${fontStyle}">${html}</font></div>`;
}

export async function writeRichClipboard(html: string) {
  // 이미 글꼴 div로 감싼 HTML이라도 `font face`까지 보장해야 HWP의 HTML 파서가 맑은
  // 고딕을 선택한다. 중첩 div는 HWP/Word 모두 정상적으로 처리하며, 서식 정보가 빠지는
  // 것보다 이중 보장이 안전하다.
  const wrapped = ensureHwpFontHtml(html);
  const plainText = htmlToPlainText(wrapped);
  const rtf = htmlToRtf(wrapped);
  if (tryOfficeCompatibleCopy(wrapped)) return;
  // **근본 원인(2026-07-25 실측 확인)**: 기존 조건이 `"write" in navigator`였는데, write()는
  // navigator가 아니라 navigator.clipboard의 메서드다 — 이 오타 때문에 조건이 항상 거짓이 되어
  // HTML은 한 번도 클립보드에 안 들어가고 매번 아래 writeText(plainText) 폴백(서식 전부 소실)
  // 으로만 빠지고 있었다. 이게 "볼드·문단 서식이 하나도 안 들어간다"는 사용자 실측 버그의
  // 진짜 원인이었다 — Playwright로 클립보드를 직접 읽어 재현·확정했다.
  if (navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
    // ClipboardItem이 `text/rtf`를 지원할 때만 3개 형식을 명시적으로 기록한다.
    // (웹 표준이 보장하는 형식은 HTML/평문뿐이므로 지원하지 않는 브라우저에서는 HTML
    // 경로로 즉시 재시도한다.)
    const supportsRtf = typeof ClipboardItem.supports === "function" && ClipboardItem.supports("text/rtf");
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([wrapped], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
          ...(supportsRtf ? { "text/rtf": new Blob([rtf], { type: "text/rtf" }) } : {}),
        }),
      ]);
    } catch {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([wrapped], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" }),
        }),
      ]);
    }
    return;
  }
  await navigator.clipboard.writeText(plainText);
}

export function RichReportEditor({ label, value, onChange }: RichReportEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || document.activeElement === editor) return;
    // value가 HTML(이미 편집된 것)이면 그대로, Markdown 원문(생성 직후)이면 HTML로 변환해
    // 표시한다 — 화면에 `**`·`__` 같은 제어문자가 노출되지 않게 한다(PRD 3.3.2).
    const looksLikeHtml = /<[a-z][\s\S]*>/i.test(value);
    editor.innerHTML = sanitizeReportHtml(looksLikeHtml ? value : richTextToHtml(value || ""));
  }, [value]);

  function emitChange() {
    const html = sanitizeReportHtml(editorRef.current?.innerHTML ?? "");
    onChange(html, htmlToPlainText(html));
  }

  /**
   * Claude/채팅 결과처럼 Markdown 원문을 편집기에 붙여넣어도 `**`, `__`, `***`를
   * 글자로 남기지 않는다. 붙여넣는 순간 실제 <strong>/<u>/<em>/<p> 요소로 바꾸므로
   * 이후 드래그 복사·RTF·HWPX 경로 모두 동일한 서식 모델을 사용한다.
   */
  function pasteMarkdownAsRichText(event: ClipboardEvent<HTMLDivElement>) {
    const plainText = event.clipboardData.getData("text/plain");
    const isMarkdownReportText = /\*\*\*|\*\*[^*]+\*\*|__[^_]+__|^\s*(?:\[[^\]]+\]|→|▶|[-•]\s+)/m.test(plainText);
    if (!isMarkdownReportText) return;
    event.preventDefault();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const template = document.createElement("template");
    template.innerHTML = sanitizeReportHtml(richTextToHtml(plainText));
    const fragment = template.content;
    const lastNode = fragment.lastChild;
    range.deleteContents();
    range.insertNode(fragment);
    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    emitChange();
  }

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={`${label} 편집`}
      title="본문을 바로 수정할 수 있습니다. 굵게·기울임·밑줄은 브라우저 단축키를 사용하세요."
      onInput={emitChange}
      onPaste={pasteMarkdownAsRichText}
      style={{ fontFamily: CLIPBOARD_FONT_FAMILY }}
      className="report-rich-editor min-h-7 rounded px-1 py-1 text-[15px] leading-8 text-[#202020] outline-none transition hover:bg-[#fafcff] focus:bg-[#fafcff] focus:ring-2 focus:ring-[#4fc8e8]/60"
    />
  );
}
