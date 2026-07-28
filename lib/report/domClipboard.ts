/**
 * 실제 렌더된 DOM(Tailwind 클래스로 스타일이 적용된 화면)을 그대로 클립보드 HTML로
 * 직렬화한다.
 *
 * **왜 innerHTML을 그대로 복사하면 안 되는가**: 화면 서식은 CSS 클래스(`font-bold`,
 * `text-[#315c9c]` 등)로 걸려 있는데, 한글/Word는 붙여넣기 시 외부 스타일시트의 클래스를
 * 전혀 읽지 않고 **인라인 style 속성**과 `<b>/<u>/<i>` 같은 의미 태그만 해석한다. 그래서
 * `element.innerHTML`을 그대로 클립보드에 넣으면 굵게·배경·정렬이 전부 사라지고, `<div>`
 * 중첩 구조가 한글 쪽 붙여넣기 정규화 과정에서 문단 구분 없이 한 줄로 뭉개진다(실측 확인,
 * 2026-07-25).
 *
 * 해결: `getComputedStyle`로 브라우저가 실제로 계산한 값을 읽어 각 블록에 인라인 style로
 * 굳히고, 텍스트만 담긴 최하위 블록("leaf block")마다 진짜 `<p>` 태그를 새로 만든다. 레이아웃
 * 전용 컨테이너(자식에 다른 블록을 담고 있는 div)는 태그 없이 건너뛰어 불필요한 중첩을 없앤다.
 */
import { escapeHtml } from "./richText";

export const CLIPBOARD_ROOT_FONT =
  "'맑은 고딕', 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

const SKIP_TAGS = new Set(["BUTTON", "SVG", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "INPUT", "TEXTAREA"]);
const BLOCK_DISPLAYS = new Set([
  "block", "flex", "grid", "list-item", "flow-root",
  "table", "table-row", "table-cell", "table-row-group", "table-header-group", "table-footer-group",
]);

function pxToPt(pxValue: string): number {
  const px = parseFloat(pxValue);
  if (!Number.isFinite(px)) return 0;
  return Math.round(px * 0.75 * 100) / 100;
}

function isTransparent(color: string): boolean {
  return !color || /rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(color) || color === "transparent";
}

let normalizeCanvasCtx: CanvasRenderingContext2D | null | undefined;

/**
 * 최신 Chromium은 `getComputedStyle().color` 등을 `rgb()`가 아니라 `lab()`/`oklch()`/
 * `color(...)` 같은 CSS Color 4 함수로 돌려주는 경우가 있다(실측 확인, 2026-07-25 — Tailwind
 * zinc 팔레트 색상에서 재현됨). 한글·Word의 HTML 붙여넣기 파서는 이런 최신 색상 함수를 모른다.
 *
 * **실측으로 확정한 올바른 정규화 방법**: `ctx.fillStyle = value` 후 그 값을 다시 읽는
 * 방식은 이 색을 그대로 돌려줄 뿐 rgb()로 정규화하지 않는다는 게 실측으로 확인됐다(캔버스가
 * 색 영역 밖 값을 보존하는 것으로 보임). 대신 **실제로 1×1 픽셀을 그려서 `getImageData`로
 * 읽으면** 래스터화 단계에서 반드시 구체적인 sRGB 값이 나온다(레스터 파이프라인은 모호성을
 * 남길 수 없다) — `lab(35.1166 1.78212 -6.1173)` → `rgb(82, 82, 92)`로 정확히 변환됨을
 * 확인했다(Tailwind zinc-600 `#52525b`=rgb(82,82,91)와 반올림 오차 1 이내로 일치).
 * **주의**: `canvas.width/height`를 바꾸면 캔버스 컨텍스트 상태(fillStyle 포함)가 초기화되므로
 * 반드시 크기를 먼저 고정한 뒤 fillStyle을 설정해야 한다 — 순서를 반대로 하면 검게 나온다
 * (실측으로 이 순서 버그도 확인·수정함).
 */
function normalizeColor(value: string): string {
  if (!value || !/^(lab|lch|oklab|oklch|color)\(/i.test(value)) return value;
  try {
    if (normalizeCanvasCtx === undefined) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      normalizeCanvasCtx = canvas.getContext("2d", { willReadFrequently: true });
    }
    if (!normalizeCanvasCtx) return value;
    normalizeCanvasCtx.fillStyle = value;
    normalizeCanvasCtx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = normalizeCanvasCtx.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  } catch {
    return value;
  }
}

function shouldSkip(el: Element): boolean {
  // el.tagName만으로 비교하면 안 된다 — HTML 네임스페이스 요소(BUTTON/SCRIPT 등)는 항상
  // 대문자로 정규화되지만, SVG 네임스페이스 요소(svg/path/text)는 작성한 그대로 소문자를
  // 유지한다(실측 확인, 2026-07-27 — `document.querySelector("svg").tagName === "svg"`).
  // `SKIP_TAGS`에 대문자 "SVG"만 있어 실제 도넛 차트 SVG가 한 번도 걸러지지 않고, 안의
  // `<text>` 내용(퍼센트 숫자)이 "이 섹션 서식 유지 복사"/"한글 서식 파일" 결과에 그대로
  // 텍스트로 새어나오는 버그가 있었다 — toUpperCase()로 네임스페이스 대소문자 차이를 없앤다.
  return SKIP_TAGS.has(el.tagName.toUpperCase()) || el.hasAttribute("data-copy-ignore");
}

function isBlockDisplay(el: Element): boolean {
  return BLOCK_DISPLAYS.has(getComputedStyle(el).display);
}

function hasBlockChild(el: Element): boolean {
  return Array.from(el.children).some((child) => !shouldSkip(child) && isBlockDisplay(child));
}

/** 서식 유지에 필요한 계산된 스타일만 인라인 선언 목록으로 뽑는다. */
function extractStyleDeclarations(el: Element, options: { includeFontSize?: boolean } = {}): string[] {
  const computed = getComputedStyle(el);
  const declarations: string[] = [];
  const weight = parseInt(computed.fontWeight, 10);
  if (Number.isFinite(weight) && weight >= 600) declarations.push("font-weight:700");
  if (computed.fontStyle === "italic") declarations.push("font-style:italic");
  if (computed.textDecorationLine && computed.textDecorationLine !== "none") declarations.push("text-decoration:underline");
  if (computed.color) declarations.push(`color:${normalizeColor(computed.color)}`);
  if (!isTransparent(computed.backgroundColor)) declarations.push(`background-color:${normalizeColor(computed.backgroundColor)}`);
  if (computed.textAlign && computed.textAlign !== "start" && computed.textAlign !== "left") {
    declarations.push(`text-align:${computed.textAlign}`);
  }
  if (options.includeFontSize !== false) declarations.push(`font-size:${pxToPt(computed.fontSize)}pt`);
  const borderWidth = parseFloat(computed.borderTopWidth);
  if (borderWidth > 0 && computed.borderTopStyle !== "none") {
    declarations.push(`border:${Math.max(0.5, pxToPt(computed.borderTopWidth))}pt solid ${normalizeColor(computed.borderTopColor)}`);
  }
  const paddingTop = parseFloat(computed.paddingTop);
  const paddingLeft = parseFloat(computed.paddingLeft);
  if (paddingTop > 2 || paddingLeft > 2) {
    declarations.push(
      `padding:${pxToPt(computed.paddingTop)}pt ${pxToPt(computed.paddingRight)}pt ${pxToPt(computed.paddingBottom)}pt ${pxToPt(computed.paddingLeft)}pt`,
    );
  }
  return declarations;
}

/** 인라인 레벨(문단 안쪽) 노드를 재귀 처리 — 텍스트와 강조 span만 남긴다. */
function walkInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  if (shouldSkip(el)) return "";
  if (el.tagName === "BR") return "<br/>";
  const inner = Array.from(el.childNodes).map(walkInline).join("");
  if (!inner) return "";
  const declarations = extractStyleDeclarations(el, { includeFontSize: false });
  // 한글(HWP)은 CSS `font-weight`만 든 span을 일반 텍스트로 취급하는 경우가 있다.
  // 화면 편집기/AI 결과에 이미 있는 의미 태그를 보존하고, 계산된 스타일과 **함께** 내보내야
  // 굵게·밑줄·기울임이 HWP/Word 양쪽에서 안정적으로 살아난다.
  const tag = el.tagName === "STRONG" || el.tagName === "B" ? "b"
    : el.tagName === "U" ? "u"
    : el.tagName === "EM" || el.tagName === "I" ? "i"
    : null;
  const content = tag ? `<${tag}>${inner}</${tag}>` : inner;
  return declarations.length ? `<span style="${declarations.join(";")}">${content}</span>` : content;
}

function walkTableCell(cell: Element): string {
  const inner = Array.from(cell.childNodes).map(walkInline).join("").trim();
  const computed = getComputedStyle(cell);
  const borderWidth = Math.max(0.75, pxToPt(computed.borderTopWidth || "1px"));
  const declarations = [
    `border:${borderWidth}pt solid ${isTransparent(computed.borderTopColor) ? "#d4d4d8" : normalizeColor(computed.borderTopColor)}`,
    `padding:${pxToPt(computed.paddingTop || "6px")}pt ${pxToPt(computed.paddingRight || "10px")}pt`,
    "vertical-align:top",
    `font-size:${pxToPt(computed.fontSize)}pt`,
    // 한글(HWP)에 붙여넣으면 좁은 열에서 "기업명"처럼 짧은 한글 단어가 글자 사이에 강제
    // 줄바꿈되고, 그 짧은 줄을 HWP가 자동으로 균등폭 정렬(justify)해 "기 업 명"처럼 글자
    // 사이가 벌어져 보이는 게 실측 확인됐다(2026-07-26). 셀 안 텍스트를 줄바꿈되지 않게
    // 고정해서 애초에 이 상황(좁은 열 + 줄바꿈 + 균등폭 정렬)이 발생하지 않게 막는다.
    "white-space:nowrap",
  ];
  const weight = parseInt(computed.fontWeight, 10);
  if (Number.isFinite(weight) && weight >= 600) declarations.push("font-weight:700");
  if (!isTransparent(computed.backgroundColor)) declarations.push(`background-color:${normalizeColor(computed.backgroundColor)}`);
  if (computed.textAlign && computed.textAlign !== "start" && computed.textAlign !== "left") {
    declarations.push(`text-align:${computed.textAlign}`);
  }
  const tag = cell.tagName === "TH" ? "th" : "td";
  return `<${tag} style="${declarations.join(";")}">${inner || "&nbsp;"}</${tag}>`;
}

function walkTable(table: Element): string {
  const rows = Array.from(table.querySelectorAll("tr"));
  const body = rows
    .map((row) => {
      const cells = Array.from(row.children).filter((cell) => cell.tagName === "TD" || cell.tagName === "TH");
      return `<tr>${cells.map(walkTableCell).join("")}</tr>`;
    })
    .join("");
  return `<table style="border-collapse:collapse;width:100%;margin:6pt 0 10pt">${body}</table>`;
}

/** 블록 레벨 노드를 재귀 처리 — 텍스트만 담은 최하위 블록마다 새 문단(`<p>`)을 만든다. */
function walkBlock(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent ?? "").trim();
    return text ? `<p style="margin:0 0 6pt;line-height:1.6">${escapeHtml(text)}</p>` : "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  if (shouldSkip(el)) return "";
  if (el.tagName === "TABLE") return walkTable(el);
  if (!isBlockDisplay(el)) {
    const inline = walkInline(el);
    return inline ? `<p style="margin:0 0 6pt;line-height:1.6">${inline}</p>` : "";
  }
  if (hasBlockChild(el)) {
    // 레이아웃 전용 컨테이너 — 자체 태그 없이 자식만 이어붙인다(불필요한 중첩 방지).
    return Array.from(el.childNodes).map(walkBlock).join("");
  }
  // 빈 줄용 문단(`<p>&nbsp;</p>` / `<p><br></p>`)은 문단 사이 간격을 한글까지 전달하는
  // 핵심이므로 절대 버리면 안 된다 — trim이 nbsp를 지워 "내용 없음"으로 판정하기 전에 먼저
  // 빈 문단으로 보존한다(2026-07-28).
  if ((el.tagName === "P" || el.tagName === "DIV") && (el.textContent ?? "").replace(/ /g, "").trim() === "") {
    return `<p style="margin:0;line-height:1.6">&nbsp;</p>`;
  }
  const inner = Array.from(el.childNodes).map(walkInline).join("").trim();
  if (!inner) return "";
  const declarations = extractStyleDeclarations(el);
  const isBullet = el.tagName === "LI";
  if (isBullet) declarations.push("padding-left:15pt", "text-indent:-15pt");
  return `<p style="margin:0 0 6pt;line-height:1.6;${declarations.join(";")}">${isBullet ? "• " : ""}${inner}</p>`;
}

function wrap(body: string): string {
  return `<div style="font-family:${CLIPBOARD_ROOT_FONT};font-size:11pt;color:#000000">${body}</div>`;
}

/**
 * 화면에 실제로 렌더된 요소를 서식 유지 클립보드 HTML로 직렬화한다("이 섹션 복사"용).
 * 버튼 등 조작용 요소는 자동으로 제외된다(SKIP_TAGS/`data-copy-ignore`).
 */
export function elementToClipboardHtml(root: HTMLElement): string {
  return wrap(Array.from(root.childNodes).map(walkBlock).join(""));
}

/**
 * 사용자가 마우스로 드래그해 선택한 범위만 복사할 때 쓴다(`Range.cloneContents()` 결과).
 *
 * **실측으로 확인한 치명적 버그(2026-07-27)**: `Range.cloneContents()`가 만드는 조각은 문서에
 * 아직 붙지 않은(detached) 노드다. `walkBlock`/`extractStyleDeclarations`가 여기에 바로
 * `getComputedStyle()`을 호출하면 헤드리스 브라우저로 직접 재현한 결과 `fontWeight`·`color`·
 * `backgroundColor`·`display`가 전부 빈 문자열로 나왔다(인라인 style로만 준 값도 예외 없음) —
 * 레이아웃이 없는 노드는 계산된 스타일 자체가 존재하지 않기 때문이다. 그 결과 컨텐츠에디터블
 * 바깥(표·차트 주변 등)을 드래그로 선택해 복사하면 굵게·색상·배경색이 전부 사라진 채였다.
 * 해결: 조각을 화면 밖(`position:fixed;left:-99999px`, `display:none`은 안 됨 — 그러면
 * 레이아웃 자체가 없어져 같은 문제가 재발한다)에 실제로 붙여 렌더링시킨 뒤 직렬화하고, 끝나면
 * 제거한다(components/RichReportEditor.tsx의 `tryOfficeCompatibleCopy` staging과 같은 패턴).
 */
export function fragmentToClipboardHtml(fragment: DocumentFragment): string {
  const staging = document.createElement("div");
  staging.setAttribute("aria-hidden", "true");
  staging.style.cssText = "position:fixed;left:-99999px;top:0;width:794px;pointer-events:none;";
  staging.appendChild(fragment);
  document.body.appendChild(staging);
  try {
    return wrap(Array.from(staging.childNodes).map(walkBlock).join(""));
  } finally {
    staging.remove();
  }
}
