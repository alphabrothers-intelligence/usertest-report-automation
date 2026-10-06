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
type Gap = { pos: number; height: number; kind: "block" | "row" | "line"; columns?: number };

/** 줄 단위로 나눌 때 앞 쪽·다음 쪽에 최소로 남길 줄 수(Word의 "외톨이 줄 방지"). */
const MIN_LINES = 2;

export const paginationKey = new PluginKey<{ gaps: Gap[]; decorations: DecorationSet }>("pagination");

/** 쪽을 넘기는 단위(문서 위치)와, 그 단위가 표의 행인지(첫 행이 아닌 행만 — 첫 행 앞은 표 앞과 같다). */
type Unit = {
  pos: number;
  node: PMNode;
  inTable: boolean;
  columns?: number;
  /** 표의 행이면 그 행(첫 행은 `node`가 표 자체라 따로 둔다) — 한 쪽보다 큰 행을 칸 안 내용으로 펼칠 때 쓴다. */
  row?: { pos: number; node: PMNode };
};
function units(doc: PMNode): Unit[] {
  const out: Unit[] = [];
  walkUnits(doc, 0, out);
  return out;
}

/** 감싸기 요소(reportDiv: 인용 묶음·블록 번호)는 안으로 들어가 그 안 문단·표를 단위로 삼는다. */
function walkUnits(parent: PMNode, base: number, out: Unit[]) {
  parent.forEach((node, offset) => {
    const pos = base + offset;
    if (node.type.name === "reportDiv") {
      walkUnits(node, pos + 1, out);
      return;
    }
    if (node.type.name !== "table") {
      out.push({ pos, node, inTable: false });
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
      out.push(first ? { pos, node, inTable: false, row: rowRef } : { pos: rowPos, node: row, inTable: true, columns, row: rowRef });
      first = false;
      rowPos += row.nodeSize;
    });
  });
}

/**
 * **한 쪽보다 큰 행은 칸 안의 내용 단위로 펼친다** — 행 하나에 차트·표·글이 다 든 "항목 | 주요 의견" 표
 * (Ⅸ장)는 행 단위로만 넘기면 바닥글을 뚫고 넘쳤다(2026-10-01). 내용이 가장 많은 칸의 자식들을 단위로
 * 삼고, 간격은 그 칸 안에 끼운다(왼쪽 항목 칸은 행 높이만큼 늘어나 병합 칸처럼 이어진다).
 */
function rowChildren(row: { pos: number; node: PMNode }): Unit[] {
  let best: { pos: number; node: PMNode } | null = null;
  let cellPos = row.pos + 1;
  row.node.forEach((cell) => {
    if (!best || cell.childCount > best.node.childCount) best = { pos: cellPos, node: cell };
    cellPos += cell.nodeSize;
  });
  if (!best) return [];
  const chosen = best as { pos: number; node: PMNode };
  const out: Unit[] = [];
  walkUnits(chosen.node, chosen.pos + 1, out);
  return out;
}

/**
 * 쪽 끝에 혼자 남으면 안 되는 단위(Word의 "다음 문단과 함께"): 극성 배너(배경색 문단),
 * 카테고리 라벨(`[...]` 굵은 한 줄), 제목·문항 그림. 쪽이 갈리면 다음 단위와 함께 넘어간다.
 */
function keepsWithNext(node: PMNode): boolean {
  // 사분면은 바로 아래 "영역별 참고 지표"와 한 쪽에 둔다(원본 배치).
  if (node.type.name === "reportAtom") return /heading|__section-banner__|quadrant/.test(String(node.attrs.blockId));
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
  return DecorationSet.create(doc, gaps.map((gap) => Decoration.widget(gap.pos, () => gapWidget(gap), {
    side: -1,
    key: `gap-${gap.pos}-${Math.round(gap.height)}`,
    ignoreSelection: true,
  })));
}

/**
 * 문단의 줄들(화면 위치 → 장식을 뺀 원래 위치)과 각 줄이 시작하는 문서 위치.
 * 글자 노드만 재므로 줄 사이에 끼워 둔 간격 상자는 줄로 세지 않는다.
 */
function lineBoxes(view: EditorView, dom: HTMLElement, origin: number, placed: Gap[]): { pos: number; top: number; bottom: number }[] {
  const rects: DOMRect[] = [];
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(node);
    rects.push(...[...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0));
  }
  rects.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: { pos: number; top: number; bottom: number }[] = [];
  for (const rect of rects) {
    const last = lines[lines.length - 1];
    const screenTop = rect.top;
    if (last && Math.abs(last.top - screenTop) < 3) { last.bottom = Math.max(last.bottom, rect.bottom); continue; }
    const pos = view.posAtCoords({ left: rect.left + 1, top: rect.top + rect.height / 2 })?.pos;
    if (pos === undefined) continue;
    lines.push({ pos, top: screenTop, bottom: rect.bottom });
  }
  return lines.map((line) => {
    const before = placed.reduce((sum, gap) => (gap.pos <= line.pos ? sum + gap.height : sum), 0);
    return { pos: line.pos, top: line.top - origin - before, bottom: line.bottom - origin - before };
  });
}

/** 지금 화면에서 잰 위치로 쪽 간격을 다시 계산한다. 결과가 같으면 아무것도 안 바꾼다. */
function measure(view: EditorView, geometry: PageGeometry, onPages: (count: number) => void) {
  const state = paginationKey.getState(view.state);
  if (!state) return;
  const origin = view.dom.getBoundingClientRect().top;
  const placed = state.gaps;

  const next: Gap[] = [];
  let shift = 0;
  let page = 0;
  let firstOnPage = true;
  let forceBreak = false;
  // 지금 쪽에 놓인 단위들(뒤에서부터 "함께 넘길" 제목을 찾으려고 둔다).
  let onPage: { pos: number; top: number; kind: Gap["kind"]; keep: boolean; columns?: number }[] = [];
  let lastBreak: { gapIndex: number; units: typeof onPage; shiftBefore: number; page: number } | null = null;
  let lastBottom = 0;
  const queue = units(view.state.doc);
  for (let index = 0; index < queue.length; index += 1) {
    const unit = queue[index];
    // 한 쪽보다 큰 행 → 칸 안 내용으로 펼쳐 그것들을 단위로 넘긴다(행 자체는 자리만 잡는다).
    if (unit.row) {
      const rowDom = view.nodeDOM(unit.row.pos);
      const rowEnd = unit.row.pos + unit.row.node.nodeSize;
      const insideGaps = placed.reduce((sum, gap) => (gap.pos > unit.row!.pos && gap.pos < rowEnd ? sum + gap.height : sum), 0);
      if (rowDom instanceof HTMLElement && rowDom.getBoundingClientRect().height - insideGaps > geometry.contentHeight) {
        const children = rowChildren(unit.row);
        if (children.length > 1) {
          // 행(또는 표) 앞 간격은 첫 자식 앞 간격으로 대신한다 — 표 머리·왼쪽 칸은 행과 함께 시작한다.
          queue.splice(index + 1, 0, ...children);
          continue;
        }
      }
    }
    const nodeDom = view.nodeDOM(unit.pos);
    if (!(nodeDom instanceof HTMLElement)) continue;
    // 표는 첫 행만 잰다(나머지 행은 각자 단위다).
    const dom = unit.node.type.name === "table" ? (nodeDom.querySelector("tr:not([data-page-gap])") as HTMLElement | null) ?? nodeDom : nodeDom;
    const rect = dom.getBoundingClientRect();
    if (rect.height === 0 && unit.node.type.name !== "pageBreak") continue;
    // 장식을 뺀 원래 위치: 위쪽은 이 단위 앞의 간격만, 아래쪽은 이 단위 **안쪽** 간격(줄 넘김)까지 뺀다.
    const before = placed.reduce((sum, gap) => (gap.pos <= unit.pos ? sum + gap.height : sum), 0);
    const end = unit.node.type.name === "table" ? unit.pos + 2 : unit.pos + unit.node.nodeSize;
    const inside = placed.reduce((sum, gap) => (gap.pos > unit.pos && gap.pos < end ? sum + gap.height : sum), 0);
    const top = rect.top - origin - before;
    const bottom = rect.bottom - origin - before - inside;

    if (unit.node.type.name === "pageBreak") {
      forceBreak = true;
      continue;
    }
    const pageTop = page * geometry.pageStride;
    const overflows = bottom + shift > pageTop + geometry.contentHeight;

    // **긴 문단은 줄 단위로 넘긴다**(Word). 통째로 넘기면 앞 쪽에 큰 빈자리가 남았다. 상자 문단·제목류는
    // 통째로 넘긴다 — 상자 문단 안을 끊으면 테두리가 쪽 사이 여백을 가로지른다.
    if (!forceBreak && overflows && !unit.inTable && unit.node.type.name === "paragraph" && !unit.node.attrs.box && !keepsWithNext(unit.node)) {
      const lines = lineBoxes(view, dom, origin, placed);
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
      // 쪽 끝의 제목·배너는 이 단위와 함께 다음 쪽으로 — 단, 그 쪽에 제목만 남는 경우만(쪽 전체가 제목이면 그대로).
      let lead: { pos: number; top: number; kind: Gap["kind"]; columns?: number } = { pos: unit.pos, top, kind: unit.inTable ? "row" : "block", columns: unit.columns };
      let cut = onPage.length;
      while (!forceBreak && cut > 1 && onPage[cut - 1].keep && onPage[cut - 1].kind === "block") cut -= 1;
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
    }
    forceBreak = false;
    firstOnPage = false;
    onPage.push({ pos: unit.pos, top, kind: unit.inTable ? "row" : "block", keep: keepsWithNext(unit.node), columns: unit.columns });
    // 한 쪽보다 큰 단위는 다음 쪽까지 넘친다 — 그 아래 내용은 넘친 끝에서 이어진다.
    while (bottom + shift > page * geometry.pageStride + geometry.contentHeight) { page += 1; onPage = []; lastBreak = null; }
    lastBottom = bottom;
  }

  // **장의 마지막 쪽이 1/3도 안 차면 앞 쪽에서 당겨온다**(옛 웹뷰 paginate.ts의 balanceTail과 같은 규칙).
  // 끝에 한 줄만 남은 쪽이 생겼다(2026-10-02 케어클 Ⅲ장). 쪽 수는 그대로인 채 마지막 쪽이 덜 빈다.
  // 앞 쪽에는 단위를 최소 하나 남기고, 당겨온 뒤 마지막 쪽이 넘치지 않을 때만 옮긴다.
  if (lastBreak && lastBreak.page === page && lastBreak.units.length > 1) {
    const used = lastBottom + shift - page * geometry.pageStride;
    if (used < geometry.contentHeight / 3) {
      const pageStart = next[lastBreak.gapIndex].pos;
      const oldTop = lastBreak.units.concat(onPage).find((item) => item.pos === pageStart)?.top;
      for (let j = lastBreak.units.length - 1; j >= 1 && oldTop !== undefined; j -= 1) {
        const candidate = lastBreak.units[j];
        const grown = used + (oldTop - candidate.top);
        if (grown > geometry.contentHeight) break;
        if (candidate.keep && j < lastBreak.units.length - 1) continue;
        if (grown >= geometry.contentHeight / 3 || j === 1) {
          // 제목·배너를 앞 쪽 끝에 홀로 남기지 않는다 — 함께 데려간다. 앞 쪽에 제목만 남으면 포기한다.
          let k = j;
          while (k > 0 && lastBreak.units[k - 1].keep) k -= 1;
          if (k === 0) break;
          const candidate = lastBreak.units[k];
          if (used + (oldTop - candidate.top) > geometry.contentHeight) break;
          next[lastBreak.gapIndex] = { pos: candidate.pos, height: page * geometry.pageStride - (candidate.top + lastBreak.shiftBefore), kind: candidate.kind, columns: candidate.columns };
          break;
        }
      }
    }
  }
  onPages(page + 1);

  next.sort((a, b) => a.pos - b.pos);
  const same = next.length === placed.length
    && next.every((gap, index) => gap.pos === placed[index].pos && gap.kind === placed[index].kind && Math.abs(gap.height - placed[index].height) < 1);
  if (same) return;
  view.dispatch(view.state.tr.setMeta(paginationKey, next).setMeta("addToHistory", false));
}

export const Pagination = Extension.create<{ geometry: PageGeometry; onPages: (count: number) => void }>({
  name: "pagination",
  addOptions() {
    return { geometry: { contentHeight: 956, pageStride: 1147 }, onPages: () => {} };
  },
  addProseMirrorPlugins() {
    const { geometry, onPages } = this.options;
    return [
      new Plugin({
        key: paginationKey,
        state: {
          init: (_, state): { gaps: Gap[]; decorations: DecorationSet } => ({ gaps: [], decorations: DecorationSet.create(state.doc, []) }),
          apply(tr, previous) {
            const gaps = tr.getMeta(paginationKey) as Gap[] | undefined;
            if (gaps) return { gaps, decorations: decorationsFor(tr.doc, gaps) };
            if (!tr.docChanged) return previous;
            // 내용이 바뀌면 간격 위치만 따라 옮기고, 다음 측정이 다시 계산한다.
            const moved = previous.gaps.map((gap) => ({ ...gap, pos: tr.mapping.map(gap.pos, -1) }));
            return { gaps: moved, decorations: decorationsFor(tr.doc, moved) };
          },
        },
        props: { decorations: (state) => paginationKey.getState(state)?.decorations },
        view: (view) => {
          let frame = 0;
          const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => measure(view, geometry, onPages));
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
