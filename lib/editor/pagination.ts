import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/**
 * **Word식 쪽 넘김** — 문서는 하나로 이어져 있고, 쪽 경계에 걸린 단위 앞에만 "간격" 장식을 끼워
 * 다음 쪽 맨 위로 보낸다. 장식은 문서 내용이 아니라서 Enter를 치면 아래 내용이 그대로 밀리고,
 * Backspace로 지우면 다음 쪽 내용이 앞 쪽 빈자리로 당겨 올라온다(담당자 요구, 2026-10-01).
 *
 * 쪽을 넘기는 최소 단위: 최상위 블록 하나, **표는 행 하나**(행을 가운데서 자르지 않는다 —
 * Word 표 속성 "행 자동 나누기" 끔과 같다). 한 단위가 한 쪽보다 크면 넘쳐서 그린다(알려진 한계).
 *
 * 간격 높이에는 화면의 쪽 사이 띄움(PAGE.gap)이 한 번 들어 있다. 인쇄에서는 그 띄움이 없으므로
 * `--page-gap-cut`(ChapterEditor 인쇄 서식)만큼 빼서 그린다 — 화면의 쪽 하나가 PDF 한 쪽에 정확히 겹친다.
 *
 * 높이는 **장식을 뺀 원래 위치**로 계산한다 — 장식이 들어간 화면 위치로 다시 재면 장식 때문에
 * 위치가 바뀌고, 그 결과로 장식을 또 바꾸는 고리에 빠진다(블록 모델에서 실제로 겪었다).
 */
export type PageGeometry = {
  /** 쪽 하나의 본문 높이(px). */
  contentHeight: number;
  /** 한 쪽 본문 시작에서 다음 쪽 본문 시작까지(px) = 종이 높이 + 쪽 사이 간격. */
  pageStride: number;
};

/** 간격 종류: 블록 앞(`block`), 표의 행 앞(`row`), 긴 문단 안의 줄 앞(`line`, Word의 줄 단위 넘김). */
type Gap = {
  pos: number; height: number; kind: "block" | "row" | "line"; columns?: number;
  /** 칸 안 간격이면 그 칸과 행의 문서 위치 — 칸 안 간격은 그 칸만 밀고, 행은 가장 긴 칸만큼만 늘어난다. */
  cell?: number; row?: number;
};

/** 줄 단위로 나눌 때 앞 쪽·다음 쪽에 최소로 남길 줄 수(Word의 "외톨이 줄 방지"). */
const MIN_LINES = 2;
/** 쪽 끝 남은 자리가 이보다 작으면 큰 행을 거기서 나누지 않고 행째 다음 쪽으로 넘긴다(행 머리만 남지 않게). */
const MIN_ROW_ROOM = 120;

type PaginationState = { gaps: Gap[]; decorations: DecorationSet; flags: LayoutFlags };
export const paginationKey = new PluginKey<PaginationState>("pagination");
/** 쪽 배치 값을 바꿀 때 트랜잭션에 싣는 키 — `tr.setMeta(layoutFlagsKey, flags)`. */
export const layoutFlagsKey = "paginationLayoutFlags";

/** 쪽을 넘기는 단위(문서 위치)와, 그 단위가 표의 행인지(첫 행이 아닌 행만 — 첫 행 앞은 표 앞과 같다). */
type Unit = {
  pos: number;
  node: PMNode;
  inTable: boolean;
  columns?: number;
  /** 표의 행이면 그 행(첫 행은 `node`가 표 자체라 따로 둔다) — 한 쪽보다 큰 행을 칸 안 내용으로 펼칠 때 쓴다. */
  row?: { pos: number; node: PMNode };
  /** 이 단위가 속한 최상위 블록 id(오른쪽 패널의 쪽 배치 값이 걸리는 단위). */
  blockId?: string;
  /** 그 블록의 첫/마지막 단위인지. */
  first?: boolean;
  last?: boolean;
  /** 쪼개지 않는 단위(표 속성 "다음 쪽으로 이어지게 허용" 끔) — 행이 아니라 통째로 잰다. */
  whole?: boolean;
};

/**
 * 오른쪽 패널(표 속성·단락 속성)에서 담당자가 지정한 쪽 배치. 값은 장에 **최상위 블록 id**로 모여 있다
 * (ReportWebDocument의 toggleLayoutFlag). 편집기가 이 값을 안 읽어서 패널이 아무 일도 안 했다(2026-10-06).
 */
export type LayoutFlags = { pageBreakBefore: string[]; keepTogether: string[]; keepWithNext: string[]; rowBreak: string[] };
const NO_FLAGS: LayoutFlags = { pageBreakBefore: [], keepTogether: [], keepWithNext: [], rowBreak: [] };

function units(doc: PMNode, flags: LayoutFlags): Unit[] {
  const out: Unit[] = [];
  walkUnits(doc, 0, out, undefined, flags);
  out.forEach((unit, index) => {
    if (!unit.blockId) return;
    unit.first = out[index - 1]?.blockId !== unit.blockId;
    unit.last = out[index + 1]?.blockId !== unit.blockId;
  });
  return out;
}

const ownBlockId = (node: PMNode): string | undefined => {
  if (node.type.name === "reportAtom") return node.attrs.blockId ?? undefined;
  if (node.type.name === "reportDiv") return (node.attrs.attrs as Record<string, string>)["data-report-block-id"] || undefined;
  return undefined;
};

/**
 * 감싸기 요소(reportDiv: 인용 묶음·블록 번호)는 안으로 들어가 그 안 문단·표를 단위로 삼는다.
 * `allowWhole`이 거짓이면 "다음 쪽으로 이어지게 허용" 끔을 무시한다 — 한 쪽보다 큰 블록을 다시 펼칠 때 쓴다.
 */
function walkUnits(parent: PMNode, base: number, out: Unit[], owner: string | undefined, flags: LayoutFlags, allowWhole = true) {
  parent.forEach((node, offset) => {
    const pos = base + offset;
    // 가장 바깥 블록이 주인이다("항목 | 주요 의견" 표 칸 안의 블록은 그 표의 쪽 배치를 따른다).
    const blockId = owner ?? ownBlockId(node);
    if (node.type.name === "reportDiv") {
      if (allowWhole && !owner && blockId && flags.keepTogether.includes(blockId)) {
        out.push({ pos, node, inTable: false, blockId, whole: true });
        return;
      }
      walkUnits(node, pos + 1, out, blockId, flags, allowWhole);
      return;
    }
    if (node.type.name !== "table") {
      out.push({ pos, node, inTable: false, blockId });
      return;
    }
    if (allowWhole && blockId && flags.keepTogether.includes(blockId)) {
      out.push({ pos, node, inTable: false, blockId, whole: true });
      return;
    }
    // 간격 행은 **표의 실제 칸 수만큼** 걸쳐야 한다. 칸 수를 크게(99) 잡았더니 고정 칸 너비 표가 첫 행
    // 기준으로 99칸이 되어 실제 칸이 7px로 쪼그라들었다(2026-10-01 Ⅸ장 표 하나가 68,000px로 늘어남).
    let columns = 1;
    node.forEach((row) => {
      let count = 0;
      row.forEach((cell) => { count += Number(cell.attrs.colspan ?? 1); });
      columns = Math.max(columns, count);
    });
    // 표 안쪽: table(1) 다음부터 행. 첫 행은 표 자체(블록 단위)로 다룬다.
    let rowPos = pos + 1;
    let first = true;
    node.forEach((row) => {
      const rowRef = { pos: rowPos, node: row };
      out.push(first ? { pos, node, inTable: false, row: rowRef, blockId } : { pos: rowPos, node: row, inTable: true, columns, row: rowRef, blockId });
      first = false;
      rowPos += row.nodeSize;
    });
  });
}

/**
 * 쪽 끝에 혼자 남으면 안 되는 단위(Word의 "다음 문단과 함께"): 극성 배너(배경색 문단),
 * 카테고리 라벨(`[...]` 굵은 한 줄), 제목·문항 그림. 쪽이 갈리면 다음 단위와 함께 넘어간다.
 */
function keepsWithNext(node: PMNode): boolean {
  // 표의 제목·머리글 행은 첫 데이터 행과 함께 — 제목 줄만 쪽 끝에 남았다(2026-10-06 "유사 서비스 경험 조사").
  // 표 단위(첫 행)는 그 첫 행으로 본다.
  const row = node.type.name === "table" ? node.firstChild : node.type.name === "tableRow" ? node : null;
  if (row) {
    let headers = row.childCount > 0;
    row.forEach((cell) => { if (cell.type.name !== "tableHeader") headers = false; });
    if (headers) return true;
    if (node.type.name === "tableRow") return false;
  }
  // 사분면은 바로 아래 "영역별 참고 지표"와 한 쪽에 둔다(원본 배치).
  // 절 소제목 그림은 id가 `overview-h3`처럼 `-h숫자`로 끝난다 — "heading"만 보다가 제목이 홀로 남았다(2026-10-19).
  if (node.type.name === "reportAtom") return /heading|-h\d+$|__section-banner__|quadrant/.test(String(node.attrs.blockId));
  if (node.type.name === "heading") return true;
  if (node.type.name !== "paragraph") return false;
  if (/background-color/.test(String(node.attrs.style ?? ""))) return true;
  // 문항 척도 주석(오른쪽 정렬 + 밑줄) — 문항 제목과 한 덩어리.
  if (/text-align:\s*right/.test(String(node.attrs.style ?? "")) && /border-bottom/.test(String(node.attrs.style ?? ""))) return true;
  const text = node.textContent.trim();
  return /^\[.*\]$/.test(text) && text.length < 80;
}

function gapWidget(gap: Gap): HTMLElement {
  if (gap.kind === "line") {
    // 문단 안 줄 앞: 줄을 끊고 그만큼 내려 보내는 빈 상자.
    const span = document.createElement("span");
    span.setAttribute("data-page-gap", "");
    span.contentEditable = "false";
    span.style.cssText = `display:block;height:calc(${gap.height}px - var(--page-gap-cut, 0px));pointer-events:none`;
    return span;
  }
  if (gap.kind === "row") {
    // 표 안에는 <tr>만 들어갈 수 있다 — 테두리·배경 없는 빈 행으로 간격을 낸다.
    const row = document.createElement("tr");
    row.setAttribute("data-page-gap", "");
    row.contentEditable = "false";
    const cell = document.createElement("td");
    cell.colSpan = gap.columns ?? 1;
    cell.style.cssText = `height:calc(${gap.height}px - var(--page-gap-cut, 0px));padding:0;border:none;background:transparent`;
    row.append(cell);
    return row;
  }
  const div = document.createElement("div");
  div.setAttribute("data-page-gap", "");
  div.contentEditable = "false";
  div.style.cssText = `height:calc(${gap.height}px - var(--page-gap-cut, 0px));pointer-events:none`;
  return div;
}

function decorationsFor(doc: PMNode, gaps: Gap[]): DecorationSet {
  const decorations = gaps.map((gap) => Decoration.widget(gap.pos, () => gapWidget(gap), {
    side: -1,
    key: `gap-${gap.pos}-${Math.round(gap.height)}`,
    ignoreSelection: true,
  }));
  return DecorationSet.create(doc, [...decorations, ...rowspanDecorations(doc, gaps)]);
}

/**
 * **쪽 경계가 병합 셀(rowspan) 한가운데 떨어지면 그 셀을 쪽마다 나눠 그린다.** 간격 행을 병합 구간 안에
 * 그냥 끼우면 병합 셀이 간격 행까지 세어 한 행 일찍 끝나고, 그 아래 행 칸이 한 칸씩 밀렸다
 * (2026-10-06 설문 항목 표: "Q28"이 단계 칸에, 문항이 번호 칸에 한 자씩 쌓임). 그래서
 * 원래 셀은 경계 앞 행까지만 걸치게 줄이고, 경계 뒤에는 같은 배경의 **빈** 셀을 남은 행만큼 얹는다
 * (옛 블록 화면 splitBlock의 restoreRowspanCells와 같은 규칙 — 새 쪽에 라벨을 또 적지 않는다).
 */
function rowspanDecorations(doc: PMNode, gaps: Gap[]): Decoration[] {
  const breaksByTable = new Map<number, Set<number>>();
  for (const gap of gaps) {
    if (gap.kind !== "row") continue;
    const $pos = doc.resolve(gap.pos);
    if ($pos.parent.type.name !== "table") continue;
    const tablePos = $pos.before();
    if (!breaksByTable.has(tablePos)) breaksByTable.set(tablePos, new Set());
    breaksByTable.get(tablePos)!.add($pos.index());
  }
  const out: Decoration[] = [];
  for (const [tablePos, breaks] of breaksByTable) {
    const table = doc.nodeAt(tablePos);
    if (!table) continue;
    // 행마다 칸의 시작 열과 문서 위치(병합 셀이 차지한 열을 건너뛰며 센다).
    const grid: { pos: number; col: number; node: PMNode }[][] = [];
    const taken: number[] = []; // 열 → 그 열이 비는 행 번호
    let rowPos = tablePos + 1;
    table.forEach((row, _offset, r) => {
      const cells: { pos: number; col: number; node: PMNode }[] = [];
      let col = 0;
      let cellPos = rowPos + 1;
      row.forEach((cell) => {
        while ((taken[col] ?? 0) > r) col += 1;
        cells.push({ pos: cellPos, col, node: cell });
        const span = Number(cell.attrs.colspan ?? 1);
        for (let k = 0; k < span; k += 1) taken[col + k] = r + Number(cell.attrs.rowspan ?? 1);
        col += span;
        cellPos += cell.nodeSize;
      });
      grid.push(cells);
      rowPos += row.nodeSize;
    });
    grid.forEach((cells, r) => cells.forEach((cell) => {
      const rowspan = Number(cell.node.attrs.rowspan ?? 1);
      const cuts = [...breaks].filter((b) => b > r && b < r + rowspan).sort((a, b) => a - b);
      if (cuts.length === 0) return;
      out.push(Decoration.node(cell.pos, cell.pos + cell.node.nodeSize, { rowspan: String(cuts[0] - r) }));
      cuts.forEach((start, index) => {
        const end = cuts[index + 1] ?? r + rowspan;
        const before = grid[start].find((other) => other.col > cell.col);
        const at = before ? before.pos : grid[start].length ? grid[start][grid[start].length - 1].pos + grid[start][grid[start].length - 1].node.nodeSize : null;
        if (at === null) return;
        out.push(Decoration.widget(at, () => {
          const td = document.createElement("td");
          td.setAttribute("data-page-gap", "");
          td.contentEditable = "false";
          td.rowSpan = end - start;
          td.colSpan = Number(cell.node.attrs.colspan ?? 1);
          if (cell.node.attrs.style) td.setAttribute("style", String(cell.node.attrs.style));
          return td;
        }, { side: -1, key: `span-${cell.pos}-${start}-${end}`, ignoreSelection: true }));
      });
    }));
  }
  return out;
}

/**
 * 문단의 줄들(화면 위치 → 장식을 뺀 원래 위치)과 각 줄이 시작하는 문서 위치.
 * 글자 노드만 재므로 줄 사이에 끼워 둔 간격 상자는 줄로 세지 않는다.
 */
function lineBoxes(view: EditorView, dom: HTMLElement, origin: number, beforeOf: (pos: number) => number): { pos: number; top: number; bottom: number }[] {
  // 줄 시작 위치는 posAtCoords로 찾지 않는다 — 화면(뷰포트) 밖 좌표는 못 찾아서 그 줄이 통째로 빠졌고,
  // 스크롤 위치에 따라 쪽 나눔이 달라졌다(2026-10-12 실측: 같은 문서에서 간격 둘이 연달아 생겨 빈 쪽).
  // 글자 하나씩의 사각형을 이분 탐색해 그 줄의 첫 글자를 찾는다(화면 밖에서도 된다).
  const lines: { pos: number; top: number; bottom: number }[] = [];
  const probe = document.createRange();
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (!node.length) continue;
    probe.selectNodeContents(node);
    for (const rect of [...probe.getClientRects()]) {
      if (rect.width === 0 || rect.height === 0) continue;
      const same = lines.find((line) => Math.abs(line.top - rect.top) < 3);
      if (same) { same.bottom = Math.max(same.bottom, rect.bottom); continue; }
      let lo = 0;
      let hi = node.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        probe.setStart(node, mid);
        probe.setEnd(node, mid + 1);
        if (probe.getBoundingClientRect().bottom <= rect.top + 2) lo = mid + 1;
        else hi = mid;
      }
      let pos: number;
      try { pos = view.posAtDOM(node, lo); } catch { continue; }
      lines.push({ pos, top: rect.top, bottom: rect.bottom });
    }
  }
  lines.sort((x, y) => x.top - y.top);
  return lines.map((line) => {
    const before = beforeOf(line.pos);
    return { pos: line.pos, top: line.top - origin - before, bottom: line.bottom - origin - before };
  });
}

/** 표의 행 안 칸들(문서 위치와 노드). */
function cellsOf(row: { pos: number; node: PMNode }): { pos: number; node: PMNode }[] {
  const out: { pos: number; node: PMNode }[] = [];
  let pos = row.pos + 1;
  row.node.forEach((cell) => { out.push({ pos, node: cell }); pos += cell.nodeSize; });
  return out;
}

/** 칸 안 내용의 화면상 아래 끝(간격 장식은 빼고 마지막 요소). */
function cellContentBottom(view: EditorView, cellPos: number): number | null {
  const td = view.nodeDOM(cellPos);
  if (!(td instanceof HTMLElement)) return null;
  const last = [...td.children].filter((element) => !element.hasAttribute("data-page-gap")).pop();
  return last ? last.getBoundingClientRect().bottom : null;
}

/** 단위를 잴 요소. 표는 첫 행만 잰다(나머지 행은 각자 단위다). 쪼개지 않는 표는 통째로 잰다. */
function unitDom(view: EditorView, unit: Unit): HTMLElement | null {
  const nodeDom = view.nodeDOM(unit.pos);
  if (!(nodeDom instanceof HTMLElement)) return null;
  if (unit.node.type.name !== "table" || unit.whole) return nodeDom;
  return (nodeDom.querySelector("tr:not([data-page-gap])") as HTMLElement | null) ?? nodeDom;
}
const unitEnd = (unit: Unit) => (unit.node.type.name === "table" && !unit.whole
  ? (unit.row ? unit.row.pos + unit.row.node.nodeSize : unit.pos + 2)
  : unit.pos + unit.node.nodeSize);

/** 쪽 경계에서 잘린 표의 가장자리 — 잘린 자리에 가로선을 그어 마감한다(Word가 쪽마다 표를 닫는 것과 같다). */
export type CutLine = { page: number; y: number; left: number; width: number; color: string; size: number };

/**
 * 쪽 경계를 가로지르는 표마다 **앞 쪽 끝**과 **다음 쪽 첫머리**에 가로선을 둔다. 쪽 사이 여백은 편집기
 * 본문 가림막(ChapterEditor)이 가리므로, 선이 없으면 표의 세로선만 허공에서 끊겨 보였다(2026-10-12 담당자 지적).
 * 행이 통째로 넘어간 표(간격 행)는 그 간격 행 위에서, 행이 칸 안에서 갈린 표는 본문 끝에서 닫는다.
 */
function cutLines(view: EditorView, geometry: PageGeometry, pages: number): CutLine[] {
  const box = view.dom.getBoundingClientRect();
  const out: CutLine[] = [];
  view.dom.querySelectorAll<HTMLTableElement>("table").forEach((table) => {
    const rect = table.getBoundingClientRect();
    const top = rect.top - box.top;
    const bottom = rect.bottom - box.top;
    const cell = table.querySelector<HTMLElement>("td:not([data-page-gap] td), th");
    const style = cell ? getComputedStyle(cell) : null;
    const size = style ? parseFloat(style.borderLeftWidth) || 1 : 1;
    if (!style || style.borderLeftStyle === "none") return;
    for (let page = 0; page < pages - 1; page += 1) {
      const pageTop = page * geometry.pageStride;
      const bodyBottom = pageTop + geometry.contentHeight;
      const nextTop = (page + 1) * geometry.pageStride;
      if (top >= bodyBottom - 1 || bottom <= nextTop + 1) continue;
      const gapRow = [...table.rows].find((row) => {
        if (!row.hasAttribute("data-page-gap")) return false;
        const y = row.getBoundingClientRect().top - box.top;
        return y > pageTop && y <= bodyBottom + 1;
      });
      // 행이 통째로 넘어간 자리는 그 행들의 테두리가 이미 표를 닫고 연다 — 선을 또 그으면 겹친다. 인쇄에서
      // 몇 px만 어긋나도 이중선·글자 위 가로줄이 됐다(2026-10-19 담당자 PDF). 칸 안에서 갈린 행만 선을 긋는다.
      if (gapRow) continue;
      const end = bodyBottom;
      const line = { left: rect.left - box.left, width: rect.width, color: style.borderLeftColor, size };
      out.push({ ...line, page, y: end - pageTop - size }, { ...line, page: page + 1, y: 0 });
    }
  });
  return out;
}

/** 지금 화면에서 잰 위치로 쪽 간격을 다시 계산한다. 결과가 같으면 아무것도 안 바꾼다. */
function measure(view: EditorView, geometry: PageGeometry, onPages: (count: number) => void, onLines: (lines: CutLine[]) => void) {
  const state = paginationKey.getState(view.state);
  if (!state) return;
  const { flags } = state;
  const origin = view.dom.getBoundingClientRect().top;
  const placed = state.gaps;

  // 칸 안 간격(`cell`)은 그 칸만 밀어 내린다 — 행 뒤 내용은 **가장 많이 늘어난 칸만큼**만 밀린다.
  // 그래서 원래 위치를 구할 때 칸 안 간격은 합하지 않고, 행마다 늘어난 높이(growth)를 따로 뺀다.
  const growth: { pos: number; end: number; height: number }[] = [];
  const sumsByRow = new Map<number, Map<number, number>>();
  for (const gap of placed) {
    if (gap.cell === undefined || gap.row === undefined) continue;
    const sums = sumsByRow.get(gap.row) ?? new Map<number, number>();
    sums.set(gap.cell, (sums.get(gap.cell) ?? 0) + gap.height);
    sumsByRow.set(gap.row, sums);
  }
  for (const [rowPos, sums] of sumsByRow) {
    const rowNode = view.state.doc.nodeAt(rowPos);
    const rowDom = view.nodeDOM(rowPos);
    if (rowNode?.type.name !== "tableRow" || !(rowDom instanceof HTMLElement)) continue;
    const top = rowDom.getBoundingClientRect().top;
    let shown = 0;
    let original = 0;
    for (const cell of cellsOf({ pos: rowPos, node: rowNode })) {
      const bottom = cellContentBottom(view, cell.pos);
      if (bottom === null) continue;
      shown = Math.max(shown, bottom - top);
      original = Math.max(original, bottom - top - (sums.get(cell.pos) ?? 0));
    }
    growth.push({ pos: rowPos, end: rowPos + rowNode.nodeSize, height: Math.max(0, shown - original) });
  }
  const before = (pos: number) => placed.reduce((sum, gap) => (gap.cell === undefined && gap.pos <= pos ? sum + gap.height : sum), 0)
    + growth.reduce((sum, row) => (row.end <= pos ? sum + row.height : sum), 0);
  const insideOf = (from: number, to: number) => placed.reduce((sum, gap) => (gap.cell === undefined && gap.pos > from && gap.pos < to ? sum + gap.height : sum), 0)
    + growth.reduce((sum, row) => (row.pos >= from && row.end <= to ? sum + row.height : sum), 0);

  const next: Gap[] = [];
  let shift = 0;
  let page = 0;
  let firstOnPage = true;
  let forceBreak = false;
  // 지금 쪽에 놓인 단위들(뒤에서부터 "함께 넘길" 제목을 찾으려고 둔다).
  let onPage: { pos: number; top: number; kind: Gap["kind"]; keep: boolean; columns?: number }[] = [];
  let lastBreak: { gapIndex: number; units: typeof onPage; shiftBefore: number; page: number } | null = null;
  let lastBottom = 0;

  /** 이 단위 앞에서 쪽을 넘긴다. 쪽 끝의 제목·배너는 함께 데려간다 — 단, 그 쪽에 제목만 남는 경우는 빼고. */
  const breakBefore = (pos: number, top: number, kind: Gap["kind"], columns?: number) => {
    let lead: { pos: number; top: number; kind: Gap["kind"]; columns?: number } = { pos, top, kind, columns };
    let cut = onPage.length;
    if (forceBreak) {
      // 담당자가 건 "앞에서 쪽 나누기"도 바로 앞 제목은 데려간다 — 표만 넘기면 "3 사용성 테스트 설문 항목"
      // 제목만 앞 쪽에 홀로 남았다(2026-10-19 담당자 지적). 이 쪽에 제목뿐이면 이미 새 쪽 첫머리라 나누지 않는다.
      // 제목과 표 사이의 빈 문단도 함께 넘긴다(소제목 아래 자리 문단).
      const blank = (at: number) => { const node = view.state.doc.nodeAt(at); return node?.type.name === "paragraph" && node.content.size === 0; };
      while (cut > 0 && (onPage[cut - 1].keep || blank(onPage[cut - 1].pos))) cut -= 1;
      if (cut === 0) return;
    }
    while (!forceBreak && cut > 1 && onPage[cut - 1].keep) cut -= 1;
    if (cut < onPage.length) lead = onPage[cut];
    page += 1;
    const height = page * geometry.pageStride - (lead.top + shift);
    if (height > 0) {
      // 장 끝 쪽 고르게 나누기(아래)를 위해, 이 쪽 나눔 직전의 쪽 내용과 shift를 기억한다.
      lastBreak = forceBreak ? null : { gapIndex: next.length, units: onPage.slice(0, cut), shiftBefore: shift, page };
      next.push({ pos: lead.pos, height, kind: lead.kind, columns: lead.columns });
      shift += height;
    }
    onPage = onPage.slice(cut);
  };

  /**
   * **쪽 경계에 걸린 큰 행은 칸마다 따로 나눈다**(Word의 "행 자동 나누기"). 칸 하나만 나누던 때는
   * 나머지 칸이 쪽 사이 여백·바닥글을 뚫고 이어졌고(Ⅸ장 "기능별 고객 경험 평가"), 4대 가치 의견 상자는
   * 칸을 쌍으로 맞춘 행이라 한쪽 칸에 큰 빈칸이 생겼다(2026-10-12 담당자 지적). 칸마다 자기 내용을
   * 같은 쪽 경계에서 나누면 두 칸이 각자 이어지고, 행은 가장 긴 칸만큼 늘어난다.
   * 반 쪽보다 작은 행은 나누지 않는다(통째로 다음 쪽으로) — 표 속성 "행 자동 나누기"를 켜면 나눈다.
   */
  const splitRow = (unit: Unit): boolean => {
    if (!unit.row || unit.whole) return false;
    const rowDom = view.nodeDOM(unit.row.pos);
    if (!(rowDom instanceof HTMLElement)) return false;
    const rowRect = rowDom.getBoundingClientRect();
    const rowEnd = unit.row.pos + unit.row.node.nodeSize;
    const rowTop = rowRect.top - origin - before(unit.row.pos);
    const rowHeight = rowRect.height - insideOf(unit.row.pos, rowEnd);
    // 칸 안에 담당자가 넣은 쪽 나누기가 있으면 크기와 무관하게 칸마다 나눈다.
    let forcedInside = false;
    unit.row.node.descendants((node) => {
      if (node.type.name === "pageBreak" || (node.type.name === "tableRow" && node.attrs.breakBefore)) forcedInside = true;
      return !forcedInside;
    });
    const splittable = forcedInside || rowHeight > geometry.contentHeight / 2 || (!!unit.blockId && flags.rowBreak.includes(unit.blockId));
    if (!splittable) return false;
    const kind: Gap["kind"] = unit.inTable ? "row" : "block";
    if (forceBreak || (unit.first && flags.pageBreakBefore.includes(unit.blockId!))) {
      forceBreak = true;
      if (!firstOnPage) breakBefore(unit.pos, rowTop, kind, unit.columns);
    } else if (!forcedInside && rowTop + rowHeight + shift <= page * geometry.pageStride + geometry.contentHeight) {
      return false;
    } else if (!firstOnPage && rowTop + shift + MIN_ROW_ROOM > page * geometry.pageStride + geometry.contentHeight) {
      // 쪽 끝에 몇 줄 자리도 없으면 행 머리(테두리·여백)만 남지 않게 행째 넘기고 그 쪽부터 나눈다.
      breakBefore(unit.pos, rowTop, kind, unit.columns);
    }
    forceBreak = false;
    if (!forcedInside && rowTop + rowHeight + shift <= page * geometry.pageStride + geometry.contentHeight) return false;

    const startShift = shift;
    let endPage = page;
    // 칸 내용의 아래 끝: 원래(간격 없이) / 이번 간격을 넣은 뒤. 행은 가장 긴 칸만큼 늘어난다.
    let oldBottom = -Infinity;
    let newBottom = -Infinity;
    for (const cell of cellsOf(unit.row)) {
      const list: Unit[] = [];
      walkUnits(cell.node, cell.pos + 1, list, unit.blockId, flags);
      const cellGaps = (from: number, to: number) => placed.reduce((sum, gap) => (gap.cell === cell.pos && gap.pos > from && gap.pos <= to ? sum + gap.height : sum), 0);
      let cellShift = startShift;
      let cellPage = page;
      let held: typeof onPage = [];
      let forceCell = false;
      for (const child of list) {
        if (child.node.type.name === "pageBreak") { forceCell = true; continue; }
        if (child.inTable && child.node.attrs.breakBefore) forceCell = true;
        const dom = unitDom(view, child);
        if (!dom) continue;
        const rect = dom.getBoundingClientRect();
        if (rect.height === 0) continue;
        const top = rowTop + rect.top - rowRect.top - cellGaps(-1, child.pos);
        const bottom = top + rect.height - cellGaps(child.pos, unitEnd(child) - 1);
        const childKind: Gap["kind"] = child.inTable ? "row" : "block";
        // 긴 문단은 칸 안에서도 줄 단위로 넘긴다 — 글 한 덩어리뿐인 칸("[ … 조사 결과 ]" 총평)은
        // 통째로 못 넘기고, 넘친 줄이 쪽 사이 가림막 밑에 숨어 글이 사라져 보였다.
        if (bottom + cellShift > cellPage * geometry.pageStride + geometry.contentHeight && !child.inTable
          && child.node.type.name === "paragraph" && !child.node.attrs.box && !keepsWithNext(child.node)) {
          const lines = lineBoxes(view, dom, origin, (pos) => rowRect.top - origin - rowTop + cellGaps(-1, pos));
          let first = 0;
          let split = false;
          for (;;) {
            const limit = cellPage * geometry.pageStride + geometry.contentHeight - cellShift;
            let k = lines.findIndex((line, index) => index >= first && line.bottom > limit);
            if (k < 0) break;
            if (lines.length - k < MIN_LINES) k = Math.max(first, lines.length - MIN_LINES);
            // 앞 쪽에 두 줄도 못 남기면 문단째 넘긴다(첫 줄 앞 간격) — 안 넘기면 가림막 밑에 숨는다.
            if (k - first < MIN_LINES) {
              if (first !== 0 || split) break;
              k = 0;
            }
            cellPage += 1;
            const height = cellPage * geometry.pageStride - (lines[k].top + cellShift);
            next.push({ pos: lines[k].pos, height, kind: "line", cell: cell.pos, row: unit.row.pos });
            cellShift += height;
            first = k;
            split = true;
          }
          if (split) {
            held = [];
            oldBottom = Math.max(oldBottom, bottom);
            newBottom = Math.max(newBottom, bottom + cellShift);
            endPage = Math.max(endPage, cellPage);
            continue;
          }
        }
        if ((forceCell && held.length > 0) || (list.length > 1 && bottom + cellShift > cellPage * geometry.pageStride + geometry.contentHeight
          && (held.length > 0 || bottom - top <= geometry.contentHeight))) {
          let lead: { pos: number; top: number; kind: Gap["kind"]; columns?: number } = { pos: child.pos, top, kind: childKind, columns: child.columns };
          let cut = held.length;
          while (cut > 1 && held[cut - 1].keep) cut -= 1;
          if (cut < held.length) lead = held[cut];
          cellPage += 1;
          const height = cellPage * geometry.pageStride - (lead.top + cellShift);
          if (height > 0) {
            next.push({ pos: lead.pos, height, kind: lead.kind, columns: lead.columns, cell: cell.pos, row: unit.row.pos });
            cellShift += height;
          }
          held = held.slice(cut);
        }
        forceCell = false;
        held.push({ pos: child.pos, top, kind: childKind, keep: keepsWithNext(child.node), columns: child.columns });
        while (bottom + cellShift > cellPage * geometry.pageStride + geometry.contentHeight) { cellPage += 1; held = []; }
        oldBottom = Math.max(oldBottom, bottom);
        newBottom = Math.max(newBottom, bottom + cellShift);
        endPage = Math.max(endPage, cellPage);
      }
    }
    if (Number.isFinite(oldBottom)) shift = Math.max(startShift, newBottom - oldBottom);
    page = endPage;
    onPage = [{ pos: unit.pos, top: rowTop, kind, keep: false, columns: unit.columns }];
    firstOnPage = false;
    lastBreak = null;
    lastBottom = rowTop + rowHeight;
    return true;
  };

  const queue = units(view.state.doc, flags);
  for (let index = 0; index < queue.length; index += 1) {
    const unit = queue[index];
    // 표 안에서 넣은 쪽 나누기(행 속성) — 그 행부터 새 쪽.
    if (unit.inTable && unit.node.attrs.breakBefore) forceBreak = true;
    if (splitRow(unit)) continue;
    const dom = unitDom(view, unit);
    if (!dom) continue;
    const rect = dom.getBoundingClientRect();
    if (rect.height === 0 && unit.node.type.name !== "pageBreak") continue;
    // 장식을 뺀 원래 위치: 위쪽은 이 단위 앞의 간격만, 아래쪽은 이 단위 **안쪽** 간격(줄 넘김)까지 뺀다.
    const top = rect.top - origin - before(unit.pos);
    const bottom = rect.bottom - origin - before(unit.pos) - insideOf(unit.pos, unitEnd(unit));

    // **"이어지게 허용" 끔은 한 쪽에 들어갈 때만 지킨다**(Word와 같다). 한 쪽보다 긴 표를 통째로 두면
    // 쪽 끝을 넘친 행이 쪽 사이 가림막 밑으로 사라졌다(2026-10-19 담당자: 설문 항목 표 Q27~Q31이 안 보임).
    // 넘치는 표·묶음은 행·문단 단위로 다시 펼쳐 평소처럼 나눈다. 앞에서 쪽 나누기·행 나누기는 그대로 따른다.
    if (unit.whole && bottom - top > geometry.contentHeight) {
      const expanded: Unit[] = [];
      if (unit.node.type.name === "reportDiv") walkUnits(unit.node, unit.pos + 1, expanded, unit.blockId, flags, false);
      else walkUnits(view.state.doc.resolve(unit.pos).parent, view.state.doc.resolve(unit.pos).start(), expanded, unit.blockId, flags, false);
      const own = expanded.filter((child) => child.pos >= unit.pos && child.pos < unit.pos + unit.node.nodeSize);
      if (own.length > 0) {
        own.forEach((child, k) => { child.first = k === 0 ? unit.first : false; child.last = k === own.length - 1 ? unit.last : false; });
        queue.splice(index, 1, ...own);
        index -= 1;
        continue;
      }
    }

    if (unit.node.type.name === "pageBreak") {
      forceBreak = true;
      continue;
    }
    // 단락·표 속성 "앞에서 쪽 나누기".
    if (unit.first && flags.pageBreakBefore.includes(unit.blockId!)) forceBreak = true;
    // 통째로 두는 표는 제목 행 규칙(keepsWithNext)을 따르지 않는다 — 표 전체가 다음 단위를 끌고 가면 안 된다.
    const keep = (!unit.whole && keepsWithNext(unit.node)) || (!!unit.last && flags.keepWithNext.includes(unit.blockId!));
    const pageTop = page * geometry.pageStride;
    const overflows = bottom + shift > pageTop + geometry.contentHeight;

    // **긴 문단은 줄 단위로 넘긴다**(Word). 통째로 넘기면 앞 쪽에 큰 빈자리가 남았다. 상자 문단·제목류는
    // 통째로 넘긴다 — 상자 문단 안을 끊으면 테두리가 쪽 사이 여백을 가로지른다.
    if (!forceBreak && overflows && !unit.inTable && unit.node.type.name === "paragraph" && !unit.node.attrs.box && !keepsWithNext(unit.node)) {
      const lines = lineBoxes(view, dom, origin, before);
      let first = 0;
      let split = false;
      for (;;) {
        const limit = page * geometry.pageStride + geometry.contentHeight - shift;
        let k = lines.findIndex((line, index) => index >= first && line.bottom > limit);
        if (k < 0) break;
        if (lines.length - k < MIN_LINES) k = lines.length - MIN_LINES;
        if (k - first < MIN_LINES) break;
        page += 1;
        const height = page * geometry.pageStride - (lines[k].top + shift);
        next.push({ pos: lines[k].pos, height, kind: "line" });
        shift += height;
        first = k;
        split = true;
      }
      if (split) {
        forceBreak = false;
        firstOnPage = false;
        onPage = [{ pos: unit.pos, top, kind: "block", keep: false }];
        continue;
      }
    }

    // 한 쪽보다 큰 단위(쪼갤 수 없는 그림)는 새 쪽을 열지 않는다 — 열면 앞 쪽에 제목만 남는다.
    const oversized = bottom - top > geometry.contentHeight;
    // **빈 문단은 쪽을 새로 열지 않는다** — 장 끝의 자리 문단 하나가 넘쳐 빈 쪽이 생기고, 그 쪽을 채우려는
    // 끝 쪽 고르기가 앞 쪽 내용을 통째로 끌고 가 제목만 남은 쪽을 만들었다(2026-10-02 데모 리바랩스 Q29).
    if (overflows && !forceBreak && unit.node.type.name === "paragraph" && unit.node.content.size === 0) continue;
    if ((forceBreak || (overflows && !oversized)) && !firstOnPage) {
      breakBefore(unit.pos, top, unit.inTable ? "row" : "block", unit.columns);
    }
    forceBreak = false;
    firstOnPage = false;
    onPage.push({ pos: unit.pos, top, kind: unit.inTable ? "row" : "block", keep, columns: unit.columns });
    // 한 쪽보다 큰 단위는 다음 쪽까지 넘친다 — 그 아래 내용은 넘친 끝에서 이어진다.
    while (bottom + shift > page * geometry.pageStride + geometry.contentHeight) { page += 1; onPage = []; lastBreak = null; }
    lastBottom = bottom;
  }

  // **장의 마지막 쪽이 1/3도 안 차면 앞 쪽에서 당겨온다**(옛 웹뷰 paginate.ts의 balanceTail과 같은 규칙).
  // 끝에 한 줄만 남은 쪽이 생겼다(2026-10-02 케어클 Ⅲ장). 쪽 수는 그대로인 채 마지막 쪽이 덜 빈다.
  // 앞 쪽에는 단위를 최소 하나 남기고, 당겨온 뒤 마지막 쪽이 넘치지 않을 때만 옮긴다.
  // 닫힌 함수(breakBefore·splitRow) 안에서 바꾼 값이라 타입 좁히기가 못 따라온다.
  const tail = lastBreak as typeof lastBreak | { gapIndex: number; units: typeof onPage; shiftBefore: number; page: number } | null;
  if (tail && tail.page === page && tail.units.length > 1) {
    const used = lastBottom + shift - page * geometry.pageStride;
    if (used < geometry.contentHeight / 3) {
      const pageStart = next[tail.gapIndex].pos;
      const oldTop = tail.units.concat(onPage).find((item) => item.pos === pageStart)?.top;
      for (let j = tail.units.length - 1; j >= 1 && oldTop !== undefined; j -= 1) {
        const candidate = tail.units[j];
        const grown = used + (oldTop - candidate.top);
        if (grown > geometry.contentHeight) break;
        if (candidate.keep && j < tail.units.length - 1) continue;
        if (grown >= geometry.contentHeight / 3 || j === 1) {
          // 제목·배너를 앞 쪽 끝에 홀로 남기지 않는다 — 함께 데려간다. 앞 쪽에 제목만 남으면 포기한다.
          let k = j;
          while (k > 0 && tail.units[k - 1].keep) k -= 1;
          if (k === 0) break;
          const candidate = tail.units[k];
          if (used + (oldTop - candidate.top) > geometry.contentHeight) break;
          next[tail.gapIndex] = { pos: candidate.pos, height: page * geometry.pageStride - (candidate.top + tail.shiftBefore), kind: candidate.kind, columns: candidate.columns };
          break;
        }
      }
    }
  }
  onPages(page + 1);

  next.sort((a, b) => a.pos - b.pos);
  const same = next.length === placed.length
    && next.every((gap, index) => gap.pos === placed[index].pos && gap.kind === placed[index].kind && Math.abs(gap.height - placed[index].height) < 1);
  if (same) {
    onLines(cutLines(view, geometry, page + 1));
    return;
  }
  view.dispatch(view.state.tr.setMeta(paginationKey, next).setMeta("addToHistory", false));
}

export const Pagination = Extension.create<{ geometry: PageGeometry; onPages: (count: number) => void; onLines: (lines: CutLine[]) => void }>({
  name: "pagination",
  addOptions() {
    return { geometry: { contentHeight: 956, pageStride: 1147 }, onPages: () => {}, onLines: () => {} };
  },
  addProseMirrorPlugins() {
    const { geometry, onPages, onLines } = this.options;
    return [
      new Plugin({
        key: paginationKey,
        state: {
          init: (_, state): PaginationState => ({ gaps: [], decorations: DecorationSet.create(state.doc, []), flags: NO_FLAGS }),
          apply(tr, previous) {
            const flags = (tr.getMeta(layoutFlagsKey) as LayoutFlags | undefined) ?? previous.flags;
            const gaps = tr.getMeta(paginationKey) as Gap[] | undefined;
            if (gaps) return { gaps, decorations: decorationsFor(tr.doc, gaps), flags };
            if (!tr.docChanged) return flags === previous.flags ? previous : { ...previous, flags };
            // 내용이 바뀌면 간격 위치만 따라 옮기고, 다음 측정이 다시 계산한다.
            const moved = previous.gaps.map((gap) => ({
              ...gap,
              pos: tr.mapping.map(gap.pos, -1),
              cell: gap.cell === undefined ? undefined : tr.mapping.map(gap.cell),
              row: gap.row === undefined ? undefined : tr.mapping.map(gap.row),
            }));
            return { gaps: moved, decorations: decorationsFor(tr.doc, moved), flags };
          },
        },
        props: { decorations: (state) => paginationKey.getState(state)?.decorations },
        view: (view) => {
          let frame = 0;
          const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => measure(view, geometry, onPages, onLines));
          };
          // 그림(차트·이미지)이 늦게 그려져 높이가 바뀌는 경우도 다시 잰다.
          const observer = new ResizeObserver(schedule);
          observer.observe(view.dom);
          schedule();
          return {
            update: schedule,
            destroy: () => { cancelAnimationFrame(frame); observer.disconnect(); },
          };
        },
      }),
    ];
  },
});
