/**
 * 웹뷰(이어진 편집기)에 **지금 보이는 문서**를 HWPX 노드(`publishedReport.ts`)로 옮긴다.
 *
 * 블록 데이터가 아니라 화면 DOM에서 읽는 이유: 담당자가 편집기에서 고친 글(`editorHtml`)·표 색·
 * 차트 조정이 전부 화면에 반영돼 있고, 제품마다 장·절 구성이 달라도 화면은 항상 그 보고서 그대로다.
 * 색·굵기·밑줄·정렬은 `getComputedStyle`로 읽는다(한글 서식 복사 `domClipboard.ts`와 같은 원리).
 *
 * - 장 배너 원자 → 발행본 장 배너, 번호 소제목 → 절 배너, 문항 제목(h3) → 문항 머리(원형 복제)
 * - `<table>` → 한글 표(병합·칸 색·테두리 유지, 편집 가능)
 * - 가로로 나란한 칸(flex/grid 행) → 한 줄짜리 표, 테두리·배경이 있는 상자 → 1×1 표(길면 자식마다 한 행)
 * - SVG·canvas·img(그래프) → PNG 그림
 * - 화면 전용(`data-copy-ignore`, 버튼, 쪽 사이 띄움)은 뺀다 — PDF 인쇄에서 빠지는 것과 같다.
 */
import { BANNER_ATOM_ID } from "@/lib/editor/toEditorHtml";
import { normalizeColor } from "@/lib/report/domClipboard";
import type { ReportSectionContent } from "@/lib/report/sections";
import type { HwpAlign, HwpBorder, HwpCell, HwpNode, HwpRun } from "./publishedReport";

const SKIP = new Set(["BUTTON", "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "INPUT", "TEXTAREA", "SELECT", "LABEL"]);
const MEDIA = new Set(["svg", "CANVAS", "IMG"]);
const BLOCKISH = new Set(["block", "flex", "grid", "table", "list-item", "flow-root", "table-row", "table-cell", "table-row-group", "table-header-group"]);

const isTransparent = (c: string) => !c || c === "transparent" || /rgba?\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(c);
function hex(c: string): string | undefined {
  if (isTransparent(c)) return undefined;
  const m = normalizeColor(c).match(/(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/);
  return m ? "#" + m.slice(1, 4).map((v) => Math.round(+v).toString(16).padStart(2, "0")).join("") : undefined;
}
const isWhite = (c?: string) => !c || c === "#ffffff";

function skip(el: Element): boolean {
  if (SKIP.has(el.tagName)) return true;
  if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true" && !MEDIA.has(el.tagName)) return true;
  if (el.hasAttribute("data-copy-ignore") && !el.hasAttribute("data-print-keep")) return true;
  if (el.classList.contains("ProseMirror-widget") || el.hasAttribute("data-page-gap") || el.classList.contains("ProseMirror-gapcursor")) return true;
  const cs = getComputedStyle(el);
  return cs.display === "none" || cs.visibility === "hidden";
}

const border = (cs: CSSStyleDeclaration, side: "Left" | "Right" | "Top" | "Bottom"): HwpBorder => {
  const w = parseFloat(cs[`border${side}Width`]);
  const style = cs[`border${side}Style`];
  const color = hex(cs[`border${side}Color`]);
  return w > 0 && style !== "none" && color ? { width: (w * 25.4) / 96, color } : null;
};
const borders = (cs: CSSStyleDeclaration): HwpCell["borders"] => [border(cs, "Left"), border(cs, "Right"), border(cs, "Top"), border(cs, "Bottom")];
const align = (cs: CSSStyleDeclaration): HwpAlign =>
  ({ center: "CENTER", right: "RIGHT", end: "RIGHT", justify: "JUSTIFY" } as Record<string, HwpAlign>)[cs.textAlign] ?? "LEFT";
const pad = (cs: CSSStyleDeclaration): [number, number, number, number] =>
  [parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight), parseFloat(cs.paddingTop), parseFloat(cs.paddingBottom)];

/** 미디어(그래프)가 있거나 블록 자식이 있으면 글 문단이 아니다. */
function hasBlockContent(el: Element): boolean {
  for (const child of el.children) {
    if (skip(child)) continue;
    if (MEDIA.has(child.tagName) && isChart(child)) return true;
    if (child.tagName === "TABLE" || child.tagName === "BR") { if (child.tagName === "TABLE") return true; continue; }
    if (BLOCKISH.has(getComputedStyle(child).display) || hasBlockContent(child)) return true;
  }
  return false;
}
/** 아이콘(작은 svg)은 그래프가 아니다. */
const isChart = (el: Element) => { const r = el.getBoundingClientRect(); return r.width >= 40 && r.height >= 24; };

/** 글 문단 하나의 런. `<br>`이면 문단을 나눈다. */
function runsOf(el: Element | Node[]): HwpRun[][] {
  const lines: HwpRun[][] = [[]];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\s+/g, " ");
      if (!text) return;
      const cs = getComputedStyle(node.parentElement!);
      const run: HwpRun = {
        text,
        bold: parseInt(cs.fontWeight, 10) >= 600 || undefined,
        underline: cs.textDecorationLine.includes("underline") || undefined,
        color: hex(cs.color),
        sizePt: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2,
      };
      const line = lines[lines.length - 1];
      const prev = line[line.length - 1];
      if (prev && prev.bold === run.bold && prev.underline === run.underline && prev.color === run.color && prev.sizePt === run.sizePt) prev.text += text;
      else line.push(run);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    // 편집기가 빈 줄 끝에 붙이는 자리표시 <br>은 줄이 아니다(남기면 상자 안 빈 줄이 두 배가 된다).
    if (el.tagName === "BR") { if (!el.classList.contains("ProseMirror-trailingBreak")) lines.push([]); return; }
    if (skip(el) || (MEDIA.has(el.tagName) && isChart(el))) return;
    el.childNodes.forEach(walk);
  };
  (Array.isArray(el) ? el : Array.from(el.childNodes)).forEach(walk);
  return lines.map((line) => {
    if (line.length) { line[0].text = line[0].text.replace(/^ /, ""); line[line.length - 1].text = line[line.length - 1].text.replace(/ $/, ""); }
    return line.filter((r) => r.text);
  });
}

async function rasterize(el: Element): Promise<HwpNode | null> {
  const r = el.getBoundingClientRect();
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(r.width * scale);
  canvas.height = Math.ceil(r.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (el.tagName === "CANVAS") ctx.drawImage(el as HTMLCanvasElement, 0, 0, canvas.width, canvas.height);
  else {
    let src: string;
    let revoke = false;
    if (el.tagName === "IMG") src = (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src;
    else {
      // 화면에 그려진 크기 그대로, 글꼴은 화면 계산값을 박아 둔다(따로 떼면 기본 글꼴로 바뀐다).
      const copy = el.cloneNode(true) as SVGSVGElement;
      copy.setAttribute("width", String(r.width));
      copy.setAttribute("height", String(r.height));
      copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      const cs = getComputedStyle(el);
      copy.style.fontFamily = cs.fontFamily;
      if (!copy.getAttribute("color")) copy.setAttribute("color", cs.color);
      src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" }));
      revoke = true;
    }
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = src; });
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    } catch {
      return null; // 못 그리는 그림은 빼고 나머지 문서를 살린다
    } finally {
      if (revoke) URL.revokeObjectURL(src);
    }
  }
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  if (!blob) return null;
  return { kind: "img", png: new Uint8Array(await blob.arrayBuffer()), widthPx: r.width, heightPx: r.height };
}

async function table(el: HTMLTableElement): Promise<HwpNode> {
  const rows: HwpCell[][] = [];
  const rowHeightsPx: number[] = [];
  for (const tr of Array.from(el.rows)) {
    if (skip(tr)) continue;
    const trBg = hex(getComputedStyle(tr).backgroundColor);
    const cells: HwpCell[] = [];
    for (const td of Array.from(tr.cells)) {
      if (skip(td)) continue;
      const cs = getComputedStyle(td);
      cells.push({
        nodes: await inner(td),
        colSpan: td.colSpan || 1,
        rowSpan: td.rowSpan || 1,
        widthPx: td.getBoundingClientRect().width,
        bg: hex(cs.backgroundColor) ?? trBg,
        borders: borders(cs),
        valign: cs.verticalAlign === "top" ? "TOP" : cs.verticalAlign === "bottom" ? "BOTTOM" : "CENTER",
        padPx: pad(cs),
        header: td.tagName === "TH",
      });
    }
    if (cells.length) { rows.push(cells); rowHeightsPx.push(tr.getBoundingClientRect().height); }
  }
  return { kind: "table", widthPx: el.getBoundingClientRect().width, rows, rowHeightsPx };
}

/** 상자 요소의 테두리·배경·여백을 칸 하나로. */
function boxCell(el: Element, nodes: HwpNode[]): HwpCell {
  const cs = getComputedStyle(el);
  const bg = hex(cs.backgroundColor);
  return { nodes, colSpan: 1, rowSpan: 1, widthPx: el.getBoundingClientRect().width, bg: isWhite(bg) ? undefined : bg, borders: borders(cs), padPx: pad(cs), valign: "CENTER" };
}
const isBox = (el: Element) => {
  const cs = getComputedStyle(el);
  const bg = hex(cs.backgroundColor);
  return (!isWhite(bg)) || borders(cs).some(Boolean);
};

/** 자식들이 가로로 나란히 놓였는가(flex/grid 행). */
function sideBySide(el: Element): Element[] | null {
  const cs = getComputedStyle(el);
  const row = (cs.display.includes("flex") && !cs.flexDirection.startsWith("column")) || cs.display.includes("grid");
  if (!row) return null;
  const kids = Array.from(el.children).filter((c) => !skip(c) && c.getBoundingClientRect().width > 0);
  if (kids.length < 2) return null;
  const rects = kids.map((k) => k.getBoundingClientRect());
  const sameRow = rects.every((r) => r.top < rects[0].bottom - 2 && r.bottom > rects[0].top + 2);
  return sameRow ? kids : null;
}

/** A4 본문 높이(px, ChapterEditor의 PAGE: 297mm − 위 18mm − 아래 26mm). 상자를 펼칠지 정하는 기준. */
const PAGE_BODY_PX = (253 * 96) / 25.4;

/** 요소 자신의 상자(테두리·배경)는 빼고 안쪽만. 칸에 넣을 때 쓴다 — 칸이 이미 그 테두리를 그린다. */
async function inner(el: Element): Promise<HwpNode[]> {
  const row = sideBySide(el);
  if (row) {
    const cells = await Promise.all(row.map(async (k) => boxCell(k, await inner(k))));
    return [{ kind: "table", widthPx: el.getBoundingClientRect().width, rows: [cells], rowHeightsPx: [el.getBoundingClientRect().height] }];
  }
  return (await groups(el)).flatMap((g) => g.nodes);
}

async function convert(el: Element): Promise<HwpNode[]> {
  if (skip(el)) return [];
  if (MEDIA.has(el.tagName)) { if (!isChart(el)) return []; const img = await rasterize(el); return img ? [img] : []; }
  if (el.tagName === "TABLE") return [await table(el as HTMLTableElement)];
  if (el.tagName === "H3" && el.closest(".ProseMirror") && !el.closest("[data-atom-id]")) {
    // 문항 제목. 척도 주석은 바로 뒤 오른쪽 정렬 문단이다(toEditorHtml.questionHeadingHtml).
    const text = (el.textContent ?? "").trim();
    if (!text) return [];
    if (parseFloat(getComputedStyle(el).fontSize) >= 15.5 && /^Q\d+/.test(text)) return [{ kind: "question", text }];
  }
  if (!isBox(el)) return inner(el);

  const rect = el.getBoundingClientRect();
  // 긴 상자를 칸 하나로 만들면 한글이 쪽 경계에서 그 안을 못 나눈다(칸 안의 표·그림은 통째로 움직인다).
  // 그래서 쪽의 30%를 넘는 상자는 **자식마다 한 행**인 표로 펼친다 — 테두리는 바깥만 그려 한 상자로 보인다.
  if (rect.height > PAGE_BODY_PX * 0.3 && !sideBySide(el)) {
    const gs = (await groups(el)).filter((g) => g.nodes.length);
    if (gs.length > 1) {
      const base = boxCell(el, []);
      const [l, r, t, b] = base.borders;
      const [pl, pr, pt, pb] = base.padPx!;
      const last = gs.length - 1;
      return [{
        kind: "table",
        widthPx: rect.width,
        rows: gs.map((g, i) => [{ ...base, nodes: g.nodes, valign: "TOP", borders: [l, r, i === 0 ? t : null, i === last ? b : null], padPx: [pl, pr, i === 0 ? pt : 0, i === last ? pb : 0] }]),
        rowHeightsPx: gs.map((g) => g.heightPx),
      }];
    }
  }
  const nodes = await inner(el);
  return nodes.length ? [{ kind: "table", widthPx: rect.width, rows: [[boxCell(el, nodes)]], rowHeightsPx: [rect.height] }] : [];
}

type Group = { nodes: HwpNode[]; heightPx: number };

/** 자식 단위 묶음(블록 요소 하나 또는 그 사이에 낀 글 한 덩어리)과 화면 높이. */
async function groups(el: Element): Promise<Group[]> {
  const cs = getComputedStyle(el);
  const paragraphs = (nodes: Element | Node[]): HwpNode[] => runsOf(nodes).map((runs) => ({ kind: "p", runs, align: align(cs), sizePt: runs.length ? undefined : px2pt(cs.fontSize) }));
  if (!hasBlockContent(el)) return [{ nodes: paragraphs(el), heightPx: el.getBoundingClientRect().height }];
  const out: Group[] = [];
  let loose: Node[] = [];
  // 블록 사이에 낀 글(텍스트 노드·인라인 요소)은 한 문단으로 모은다.
  const flush = () => {
    if (loose.length && loose.some((n) => (n.textContent ?? "").trim())) {
      const range = document.createRange();
      range.setStartBefore(loose[0]);
      range.setEndAfter(loose[loose.length - 1]);
      out.push({ nodes: paragraphs(loose).filter((n) => n.kind !== "p" || n.runs.length), heightPx: range.getBoundingClientRect().height });
    }
    loose = [];
  };
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const child = node as Element;
      if (skip(child)) continue;
      if (!BLOCKISH.has(getComputedStyle(child).display) && !MEDIA.has(child.tagName) && child.tagName !== "TABLE" && !hasBlockContent(child)) { loose.push(child); continue; }
      flush();
      out.push({ nodes: await convert(child), heightPx: child.getBoundingClientRect().height });
    } else if (node.nodeType === Node.TEXT_NODE) loose.push(node);
  }
  flush();
  return out;
}
const px2pt = (px: string) => Math.round(parseFloat(px) * 0.75 * 2) / 2;

/** 장 하나(`[data-chapter]`)의 편집기 내용을 노드로. 원자 블록은 블록 데이터로 장·절 배너를 안다. */
async function chapterNodes(root: HTMLElement, section: ReportSectionContent): Promise<HwpNode[]> {
  const pm = root.querySelector(".ProseMirror");
  if (!pm) return [];
  const byId = new Map<string, ReportSectionContent["blocks"][number]>();
  const index = (list: ReportSectionContent["blocks"]) => list.forEach((b) => { byId.set(b.id, b); if (b.kind === "row-group") b.rows.forEach((r) => index(r.blocks)); });
  index(section.blocks);
  const out: HwpNode[] = [];
  for (const child of Array.from(pm.children)) {
    // 원자 블록: node-reportAtom > [data-node-view-wrapper]. 장 배너만 data-atom-id가 없다(extensions.tsx).
    const wrapper = child.classList.contains("node-reportAtom") ? child.querySelector("[data-node-view-wrapper]") : null;
    const atomId = wrapper ? wrapper.getAttribute("data-atom-id") ?? BANNER_ATOM_ID : null;
    if (atomId === BANNER_ATOM_ID) { out.push({ kind: "chapter", numeral: section.numeral, title: section.title }); continue; }
    const block = atomId ? byId.get(atomId) : undefined;
    if (block?.kind === "heading" && block.variant === "numbered") { out.push({ kind: "sub", number: block.number ?? "", text: block.text }); continue; }
    if (block?.kind === "heading" && block.variant === "question") {
      out.push({ kind: "question", text: `${block.number ? `${block.number}. ` : ""}${block.text}`, note: block.note });
      continue;
    }
    // 문항 제목(h3) 바로 뒤의 척도 주석은 문항 머리에 넣는다.
    const prev = out[out.length - 1];
    if (prev?.kind === "question" && !prev.note && child.tagName === "P" && getComputedStyle(child).textAlign === "right" && /^\*/.test(child.textContent?.trim() ?? "")) {
      prev.note = child.textContent!.trim();
      continue;
    }
    // 빈 문단은 Word식 문단 간격 — 화면 높이만큼의 빈 줄로 옮긴다(편집기는 빈 문단을 낮게 그린다).
    if (child.tagName === "P" && !(child.textContent ?? "").trim() && !child.querySelector("svg,canvas")) {
      const height = child.getBoundingClientRect().height;
      out.push({ kind: "p", runs: [], sizePt: Math.max(1, Math.min(10, Math.round((height * 0.75) / 1.6))) });
      continue;
    }
    out.push(...await convert(child));
  }
  return out;
}

/** 문서 전체. 표지·목차는 양식이 만든다 — 여기서는 장 본문만 모은다. */
export async function collectReportNodes(sections: ReportSectionContent[]): Promise<{ nodes: HwpNode[]; pxToHwp: number }> {
  const roots = Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]"));
  if (!roots.length) throw new Error("보고서 편집 화면을 찾지 못했습니다. 웹 문서가 열린 상태에서 저장해 주세요.");
  const body = roots[0].querySelector(".editor-body")?.getBoundingClientRect().width ?? 658;
  const nodes: HwpNode[] = [];
  for (const root of roots) {
    const section = sections.find((s) => s.numeral === root.getAttribute("data-chapter"));
    if (section) nodes.push(...await chapterNodes(root, section));
  }
  return { nodes, pxToHwp: 51026 / body };
}
