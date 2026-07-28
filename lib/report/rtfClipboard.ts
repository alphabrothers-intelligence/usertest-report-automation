/**
 * 한글(HWP) 호환 클립보드용 최소 RTF 변환기.
 * 일부 한글 버전은 브라우저의 text/html을 평문으로 붙이지만 text/rtf의 \b, \ul, \i,
 * \par는 안정적으로 해석한다. 보고서 복사에는 이 RTF와 HTML을 함께 제공한다.
 */

function rtfText(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 92 || code === 123 || code === 125) output += `\\${value[index]}`;
    else if (code <= 0x7f) output += value[index];
    else output += `\\u${code > 0x7fff ? code - 0x10000 : code}?`;
  }
  return output;
}

function hasStyle(element: Element, property: "font-weight" | "font-style" | "text-decoration", expected: string): boolean {
  const style = element.getAttribute("style") ?? "";
  return new RegExp(`${property}\\s*:\\s*[^;]*${expected}`, "i").test(style);
}

type Rgb = { r: number; g: number; b: number };

/** 한글 RTF 엔진이 읽을 수 있는 대표적인 CSS 색상 표기만 RTF 색상표로 바꾼다. */
function parseCssColor(value: string | null): Rgb | null {
  if (!value) return null;
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const source = hex[1].length === 3
      ? hex[1].split("").map((part) => part + part).join("")
      : hex[1];
    return {
      r: Number.parseInt(source.slice(0, 2), 16),
      g: Number.parseInt(source.slice(2, 4), 16),
      b: Number.parseInt(source.slice(4, 6), 16),
    };
  }
  const rgb = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  if (!rgb) return null;
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
}

function inlineColor(element: Element): Rgb | null {
  const color = element.getAttribute("style")?.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1] ?? null;
  return parseCssColor(color);
}

function inlineBackgroundColor(element: Element): Rgb | null {
  const color = element.getAttribute("style")?.match(/(?:^|;)\s*background-color\s*:\s*([^;]+)/i)?.[1] ?? null;
  return parseCssColor(color);
}

/** HTML의 의미 태그와 안전한 인라인 style을 RTF run/문단으로 바꾼다. 브라우저에서만 호출한다. */
export function htmlToRtf(value: string): string {
  if (typeof window === "undefined") return `{\\rtf1\\ansi ${rtfText(value.replace(/<[^>]+>/g, " "))}}`;
  const root = document.createElement("div");
  root.innerHTML = value;
  // RTF에는 CSS가 없으므로, HTML의 텍스트 색을 색상표(`\\colortbl`)와 `\\cfN`으로
  // 변환해야 한다. HTML을 평문으로 붙이는 한글 버전도 RTF를 선택하면 색상까지 보존된다.
  const colorIndexes = new Map<string, number>();
  const colors: Rgb[] = [];
  const registerColor = (color: Rgb | null) => {
    if (!color) return;
    const key = `${color.r},${color.g},${color.b}`;
    if (!colorIndexes.has(key)) {
      colorIndexes.set(key, colors.length + 1);
      colors.push(color);
    }
  };
  // 글자색뿐 아니라 표 셀 배경색(긍정/부정/중립 헤더 등)도 같은 색상표에 등록해야
  // \clcbpat로 참조할 수 있다 — 아래 표 렌더링에서 재사용한다.
  for (const element of Array.from(root.querySelectorAll("*"))) {
    registerColor(inlineColor(element));
    registerColor(inlineBackgroundColor(element));
  }
  const colorTable = colors.map((color) => `\\red${color.r}\\green${color.g}\\blue${color.b};`).join("");
  // \sa120 = 문단마다 6pt "아래 간격"(space-after). 한글은 HTML의 CSS margin은 무시해도 RTF의
  // \sa는 문단 간격으로 반영하므로, 이걸 넣어야 붙여넣기 후 문단들이 다닥다닥 붙지 않는다
  // (2026-07-28 사용자 "문단 띄어쓰기가 한글에 적용 안 됨" 대응). \pard가 리셋하지만 walk는
  // 문단마다 \pard를 다시 내지 않으므로 문서 전체에 유지된다.
  // HTML의 CSS fallback은 한글이 해석하지 않는다. RTF 글꼴표에 맑은 고딕을 직접
  // 명시해야 HWP가 붙여넣은 본문에 해당 글꼴을 적용한다. 한글 이름은 유니코드 RTF로
  // 이스케이프해 인코딩에 따라 깨지지 않게 한다.
  const out: string[] = [`{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil\\fcharset129 ${rtfText("맑은 고딕")};}}`, `{\\colortbl ;${colorTable}}`, "\\viewkind4\\uc1\\pard\\sa120\\ql\\f0\\fs22 "];

  /**
   * **실측으로 확인한 버그(2026-07-28)**: 기존엔 TABLE/TR을 그냥 `\par`가 붙는 일반 block으로
   * 처리해서, 같은 행의 셀들(예: 긍정/부정/중립 헤더 3칸) 사이에 구분자가 전혀 없이
   * "긍정부정중립"처럼 붙어버렸다 — 실제 한글(HWP)에 열어서 확인했다. RTF는 진짜 표를 만들려면
   * `\trowd`(행 시작)+`\cellx`(각 셀의 누적 폭 경계)+`\cell`(셀 끝)+`\row`(행 끝) 제어어가
   * 필요하다 — 이 구조가 없으면 워드프로세서가 표로 인식하지 못한다. 셀 배경색은
   * `\clcbpat{색상표 인덱스}\clshdng10000`으로 표시한다(긍정/부정/중립 헤더 배경색 등).
   */
  function walkTableRtf(table: Element): void {
    const rows = Array.from(table.querySelectorAll(":scope > tbody > tr, :scope > tr"));
    if (rows.length === 0) return;
    const colCount = Math.max(1, ...rows.map((row) => row.children.length));
    const colWidthTwips = Math.floor(8640 / colCount); // 6인치 폭(1440twips/inch)을 균등 분배
    for (const row of rows) {
      const cells = Array.from(row.children).filter((cell) => cell.tagName === "TD" || cell.tagName === "TH");
      out.push("\\trowd\\trgaph108\\trleft0");
      let cumulative = 0;
      for (const cell of cells) {
        cumulative += colWidthTwips;
        const bg = inlineBackgroundColor(cell);
        const bgIndex = bg ? colorIndexes.get(`${bg.r},${bg.g},${bg.b}`) : undefined;
        if (bgIndex) out.push(`\\clcbpat${bgIndex}\\clshdng10000`);
        out.push(`\\cellx${cumulative}`);
      }
      for (const cell of cells) {
        const bold = cell.tagName === "TH" || hasStyle(cell, "font-weight", "[6-9]00|bold");
        if (bold) out.push("\\b ");
        Array.from(cell.childNodes).forEach(walk);
        if (bold) out.push("\\b0 ");
        out.push("\\cell ");
      }
      out.push("\\row ");
    }
  }

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(rtfText(node.textContent ?? ""));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tag = element.tagName;
    if (tag === "BR") { out.push("\\line "); return; }
    if (tag === "TABLE") { walkTableRtf(element); return; }
    const isBlock = /^(P|DIV|H1|H2|H3|H4|H5|H6|LI|UL|OL|SECTION|ARTICLE)$/.test(tag);
    const bold = tag === "B" || tag === "STRONG" || hasStyle(element, "font-weight", "[6-9]00|bold");
    const underline = tag === "U" || hasStyle(element, "text-decoration", "underline");
    const italic = tag === "I" || tag === "EM" || hasStyle(element, "font-style", "italic");
    const color = inlineColor(element);
    const colorIndex = color ? colorIndexes.get(`${color.r},${color.g},${color.b}`) : undefined;
    // 빈 문단은 HTML의 `&nbsp;` 하나만으로는 한글에서 종종 삭제된다. RTF의 두 번의
    // `\\par`는 빈 줄을 뜻하는 실제 문단 제어어이므로, 카테고리/인용문 묶음 사이 간격을
    // 한글 붙여넣기에서도 확실히 남긴다.
    const isEmptyParagraph = (tag === "P" || tag === "DIV")
      && (element.textContent ?? "").replace(/[\s\u00a0]/g, "") === ""
      && element.children.length === 0;
    if (isEmptyParagraph) {
      out.push("\\par\\par ");
      return;
    }
    if (isBlock) {
      if (tag === "LI") out.push("\\par\\fi-360\\li360 • ");
      else out.push("\\par ");
    }
    if (bold) out.push("\\b ");
    if (underline) out.push("\\ul ");
    if (italic) out.push("\\i ");
    if (colorIndex) out.push(`\\cf${colorIndex} `);
    Array.from(element.childNodes).forEach(walk);
    if (colorIndex) out.push("\\cf0 ");
    if (italic) out.push("\\i0 ");
    if (underline) out.push("\\ul0 ");
    if (bold) out.push("\\b0 ");
    if (isBlock && tag === "LI") out.push("\\li0\\fi0 ");
  }

  Array.from(root.childNodes).forEach(walk);
  out.push("\\par }");
  return out.join("");
}

/**
 * 브라우저 클립보드가 한글에 HTML/RTF 형식을 전달하지 못할 때의 확정 경로.
 *
 * 한글은 `.rtf` 파일을 직접 열 때 RTF run(굵게·밑줄·기울임·문단)을 해석하므로,
 * 운영체제별 클립보드 포맷 협상에 의존하지 않는다. 파일을 한글에서 연 뒤 필요한
 * 문단을 기존 HWPX 문서로 복사하면 한글 내부 복사로 서식이 유지된다.
 */
export function downloadRtf(html: string, filename = "보고서_서식본문.rtf"): void {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, "_").replace(/\.rtf$/i, "") || "보고서_서식본문";
  const blob = new Blob([htmlToRtf(html)], { type: "application/rtf;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeName}.rtf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
