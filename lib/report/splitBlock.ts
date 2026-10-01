/**
 * **한 쪽보다 큰 블록을 쪽 크기 조각으로 자른다.**
 *
 * 왜 필요한가: 웹뷰는 블록을 A4 카드(`[data-section-page]`)에 담아 보여주고, 인쇄는 카드마다
 * 한 장을 쓴다. 카드가 한 장을 넘으면 **브라우저가 카드를 제멋대로 쪼개는데, 둘째 조각부터는
 * 카드의 안쪽 여백(18/18/26mm)도 푸터도 그려지지 않는다**(Chrome은 `box-decoration-break:
 * clone`을 블록 분할에 적용하지 않는다 — 실제로 인쇄해 확인, 2026-09-11). 그래서 PDF가 웹뷰와
 * 달라진다. 담당자 요구는 "PDF가 웹뷰와 절대적으로 같아야 한다"이므로, **카드가 한 장을 넘지
 * 않는 것**이 유일한 해법이고, 그러려면 블록 하나가 한 쪽보다 크면 안 된다.
 *
 * 만드는 쪽에서 미리 쪼개는 것(극성별·대분류별 등)이 1차 방어이고, 이 모듈은 그래도 남는
 * 것(표·AI 해석 등 길이를 예측할 수 없는 내용)을 **실제 렌더 높이를 재서** 자르는 2차 방어다.
 *
 * **판단은 브라우저, 계산은 코드** — 높이는 DOM에서 재고(`getBoundingClientRect`), 어디서
 * 자를지는 `chunkByHeight`가 정한다. 글자 수나 블록 종류로 어림하지 않는다.
 */
import type { ReportBlock, ReportRowGroupBlock, ReportSectionContent } from "@/lib/report/sections";

/**
 * 잰 높이 목록을 합이 `capacity` 이하인 묶음들로 자른다.
 * 혼자서도 용량을 넘는 항목(예: 한 쪽보다 큰 표의 행 하나)은 혼자 한 묶음이 된다 — 더 자를
 * 방법이 없으므로 그 항목만 넘치게 두고 나머지는 지킨다.
 *
 * **묶음 수는 그리디로 정하고, 그 수만큼 고르게 나눈다.** 앞에서부터 꽉 채우면 마지막 묶음에
 * 부스러기만 남아 **쪽 하나가 거의 빈 채로 낭비된다**(2026-09-14 리바랩스 실측: 설문 항목 표
 * 마지막 조각이 "총 31문항" 한 줄뿐인 95px짜리 쪽). 게다가 첫 조각이 용량을 꽉 채우면 바로 앞
 * 제목이 같은 쪽에 못 들어가 **제목만 있는 쪽**까지 생긴다(정리습관 Ⅶ장). 고르게 나누면 묶음
 * 수는 그대로인 채 두 가지가 같이 없어진다.
 */
export function chunkByHeight(heights: number[], capacity: number, firstCapacity?: number): number[][] {
  // **첫 묶음만 용량이 다른 경우**(쪽에 남은 공간을 채우고 나머지를 다음 쪽으로 넘길 때)는
  // 고르게 나누지 않는다 — 첫 조각은 "남은 공간에 최대한", 나머지는 온전한 쪽 용량으로 채운다.
  if (firstCapacity !== undefined) {
    const chunks: number[][] = [];
    let current: number[] = [];
    let used = 0;
    heights.forEach((height, index) => {
      const limit = chunks.length === 0 ? firstCapacity : capacity;
      if (current.length > 0 && used + height > limit) {
        chunks.push(current);
        current = [];
        used = 0;
      }
      current.push(index);
      used += height;
    });
    if (current.length > 0) chunks.push(current);
    return chunks;
  }
  const pack = (limit: (used: number, remainingChunks: number, remainingTotal: number) => boolean): number[][] => {
    const chunks: number[][] = [];
    let current: number[] = [];
    let used = 0;
    let remainingTotal = heights.reduce((sum, height) => sum + height, 0);
    heights.forEach((height, index) => {
      if (current.length > 0 && (used + height > capacity || limit(used, chunks.length, remainingTotal))) {
        chunks.push(current);
        remainingTotal -= used;
        current = [];
        used = 0;
      }
      current.push(index);
      used += height;
    });
    if (current.length > 0) chunks.push(current);
    return chunks;
  };

  const count = pack(() => false).length;
  if (count < 2) return pack(() => false);
  // 마지막 묶음은 고르게 닫지 않는다 — 앞 묶음들이 각자 몫 이상을 가져가므로 남는 양은 저절로
  // 몫 이하가 되고, 묶음 수가 그리디보다 늘어나지 않는다.
  return pack((used, done, remainingTotal) => done < count - 1 && used >= remainingTotal / (count - done));
}

function elementChildren(node: HTMLElement): HTMLElement[] {
  return [...node.children].filter((child): child is HTMLElement => child instanceof HTMLElement);
}

function height(node: HTMLElement): number {
  return node.getBoundingClientRect().height;
}

/**
 * 요소가 **실제로 담고 있는** 내용의 높이. 표의 칸은 행 높이만큼 늘어나므로 박스 높이로는
 * 라벨 칸과 내용 칸을 구별할 수 없다 — 자식들의 높이를 더해서 본다.
 */
function contentHeight(node: HTMLElement): number {
  const children = elementChildren(node);
  if (children.length > 0) return children.reduce((sum, child) => sum + height(child), 0);
  // 글자만 든 칸은 **글자가 차지한 높이**를 잰다. 박스 높이를 쓰면 늘어난 칸(라벨 열, 이미 비워둔
  // 이어짐 칸)이 내용 칸보다 높아 보여서 엉뚱한 칸을 쪼개려 하다 통째로 포기했다(2026-09-13 실측:
  // 빈 칸의 contentHeight가 1,275px로 나와 `conclusion-strategy-table`이 끝까지 안 쪼개졌다).
  if (!node.textContent?.trim()) return 0;
  const range = node.ownerDocument.createRange();
  range.selectNodeContents(node);
  return range.getBoundingClientRect().height;
}

/** 같은 태그·속성의 빈 껍데기. 조각마다 테두리·배경·폭이 유지되게 한다. */
function shell(node: HTMLElement): HTMLElement {
  return node.cloneNode(false) as HTMLElement;
}

/** 요소 안의 글자 노드를 순서대로 모은다(줄 단위 분할의 좌표계). */
function textNodes(node: HTMLElement): Text[] {
  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const out: Text[] = [];
  for (let current = walker.nextNode(); current; current = walker.nextNode()) out.push(current as Text);
  return out;
}

/** 글자 수로 센 위치를 (글자 노드, 그 안 위치)로 바꾼다. */
function pointAt(nodes: Text[], offset: number): [Text, number] {
  let remaining = offset;
  for (const node of nodes) {
    if (remaining <= node.length) return [node, remaining];
    remaining -= node.length;
  }
  const last = nodes[nodes.length - 1];
  return [last, last.length];
}

/** `y`보다 아래에서 시작하는 첫 글자의 위치. 위에서 아래로만 흐르므로 이분 탐색이 된다. */
function offsetAtY(nodes: Text[], total: number, y: number, range: Range): number {
  let low = 0;
  let high = total;
  while (low < high) {
    const middle = (low + high) >> 1;
    const [node, offset] = pointAt(nodes, middle);
    range.setStart(node, offset);
    range.setEnd(node, Math.min(offset + 1, node.length));
    const rect = range.getBoundingClientRect();
    if (rect.height > 0 && rect.top >= y - 1) high = middle;
    else low = middle + 1;
  }
  return low;
}

/**
 * **문단 하나를 줄 단위로 자른다 — 더 쪼갤 요소가 없을 때의 마지막 수단.**
 *
 * 요소·표 행·칸까지 내려가도 못 자르는 덩어리(긴 문단 하나, 글만 든 큰 칸)가 남으면 그 카드가
 * 쪽을 넘긴다. `Range.getClientRects()`는 **줄마다 좌표를 하나씩** 주므로, 쪽 경계를 넘는 줄을
 * 추측이 아니라 **재서** 찾아 그 자리에서 자를 수 있다(2026-09-14 담당자 승인 범위 B안 1번).
 *
 * 자르는 방법은 "원문의 연속 구간 고르기"뿐이다 — `Range.cloneContents()`가 걸쳐 있는 인라인
 * 요소(굵게·밑줄·인용 표시)를 조각마다 제 모양으로 복원해주므로 서식이 깨지지 않는다.
 */
function splitByLines(node: HTMLElement, capacity: number): HTMLElement[] | null {
  const nodes = textNodes(node);
  const total = nodes.reduce((sum, text) => sum + text.length, 0);
  if (total === 0) return null;

  const document_ = node.ownerDocument;
  const range = document_.createRange();
  range.selectNodeContents(node);
  // 한 줄이 인라인 요소로 여러 조각이 나면 y가 겹치므로 하나로 합친다.
  const lines: { top: number; bottom: number }[] = [];
  for (const rect of range.getClientRects()) {
    if (rect.height <= 0) continue;
    const last = lines[lines.length - 1];
    if (last && rect.top < last.bottom - 1) { last.bottom = Math.max(last.bottom, rect.bottom); continue; }
    lines.push({ top: rect.top, bottom: rect.bottom });
  }
  if (lines.length < 2) return null;

  // 글이 차지한 높이 밖의 것(안쪽 여백·테두리)은 조각마다 다시 붙으므로 미리 뺀다.
  const own = Math.max(0, height(node) - (lines[lines.length - 1].bottom - lines[0].top));
  const limit = Math.max(capacity - own, capacity * 0.5);

  // 줄 높이는 **줄 사이 간격까지 포함**해야 한다(앞 줄 아래끝부터 이 줄 아래끝까지) — 글자
  // 높이만 더하면 줄 간격만큼 매번 적게 세어 조각이 쪽을 넘는다.
  const lineHeights = lines.map((line, index) => line.bottom - (index > 0 ? lines[index - 1].bottom : line.top));
  const chunks = chunkByHeight(lineHeights, limit);
  if (chunks.length < 2) return null;

  const bounds = [0, ...chunks.slice(1).map((chunk) => offsetAtY(nodes, total, lines[chunk[0]].top, range)), total];
  const pieces: HTMLElement[] = [];
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    if (bounds[index + 1] <= bounds[index]) continue;
    const [startNode, startOffset] = pointAt(nodes, bounds[index]);
    const [endNode, endOffset] = pointAt(nodes, bounds[index + 1]);
    const slice = document_.createRange();
    slice.setStart(startNode, startOffset);
    slice.setEnd(endNode, endOffset);
    const piece = shell(node);
    piece.append(slice.cloneContents());
    pieces.push(piece);
  }
  return pieces.length > 1 ? pieces : null;
}

/** 자기 바로 아래에 글이 있는가. 요소 자식만 묶으면 이 글이 조각에서 사라진다. */
function hasDirectText(node: HTMLElement): boolean {
  return [...node.childNodes].some((child) => child.nodeType === 3 && (child.textContent ?? "").trim().length > 0);
}

/**
 * 셀 하나가 한 쪽보다 큰 행(`<tr>`)을 **여러 행으로 이어 붙인다.**
 *
 * 행의 칸들은 가로로 나란하므로 칸 단위로 자르면 안 된다(라벨과 내용이 다른 행으로 흩어진다).
 * 가장 높은 칸만 세로로 자르고, **나머지 칸(라벨 열)은 첫 행에만 글을 넣고 이어지는 행에는
 * 빈 칸으로 남긴다** — CLAUDE.md의 "병합 셀처럼 보이게" 규칙과 같은 방식이다.
 */
function splitRow(row: HTMLElement, capacity: number, firstCapacity?: number): HTMLElement[] | null {
  const pieces = markContinuations(splitRowRaw(row, capacity, firstCapacity));
  // 이어지는 행의 칸도 앞 행의 같은 칸이 이어진 것이다.
  pieces?.slice(1).forEach((piece) => elementChildren(piece).forEach((cell) => cell.setAttribute("data-split-cont", "")));
  return pieces;
}

function splitRowRaw(row: HTMLElement, capacity: number, firstCapacity?: number): HTMLElement[] | null {
  const cells = elementChildren(row);
  if (cells.length === 0) return null;

  // **내용이 있는 칸이 둘 이상이면 두 칸을 나란히 흘린다**(4대 가치 긍정·부정 의견 표).
  // 예전에는 "가장 높은 칸만" 잘라서, 조각마다 **한쪽 칸이 통째로 비어** 긍정만 또는 부정만
  // 있는 표가 줄줄이 나왔다(2026-09-17 담당자 지적: "제일 심각합니다"). 원본은 두 칸이 같은
  // 표 안에서 함께 이어진다.
  const flowed = splitParallelCells(row, cells, capacity, firstCapacity);
  if (flowed) return flowed;

  // **칸의 박스 높이로 고르면 안 된다** — 표의 칸은 행 높이만큼 늘어나서 라벨 칸도 내용 칸과
  // 높이가 같다(2026-09-13 실측: 그래서 라벨 칸을 "가장 높은 칸"으로 골라 쪼개려 했고, 쪼갤 것이
  // 없어 통째로 포기했다). 실제로 든 내용의 높이로 고른다.
  const tallest = cells.reduce((best, cell) => (contentHeight(cell) > contentHeight(best) ? cell : best), cells[0]);
  const otherHeight = cells.filter((cell) => cell !== tallest).reduce((max, cell) => Math.max(max, contentHeight(cell)), 0);
  // 라벨 칸이 혼자서도 한 쪽을 넘으면 어느 조각에도 안 들어간다 — 건드리지 않는다.
  if (otherHeight > capacity) return null;
  const pieces = splitElement(
    tallest,
    Math.max(capacity - otherHeight, capacity * 0.6),
    firstCapacity === undefined ? undefined : Math.max(firstCapacity - otherHeight, 0),
  );
  if (!pieces || pieces.length < 2) return null;
  return pieces.map((piece, index) => {
    const rowClone = shell(row);
    for (const cell of cells) {
      if (cell === tallest) rowClone.append(piece);
      else if (index === 0) rowClone.append(cell.cloneNode(true));
      else rowClone.append(shell(cell)); // 이어지는 행의 라벨 칸은 배경·테두리만 남긴다
    }
    return rowClone;
  });
}

/**
 * **여러 칸을 동시에 흘려 행을 쪼갠다.** 각 칸의 자식(의견 묶음)을 순서대로 담되, 조각 높이는
 * `max(각 칸의 담긴 높이)`이므로 그 값이 용량을 넘기 직전까지 채운다. 칸마다 내용 길이가 달라도
 * 각자 자기 순서대로 이어지므로, 이어지는 조각에 **한쪽이 빈 칸으로 남지 않는다**.
 *
 * 내용이 있는 칸이 하나뿐이거나(= 라벨+내용 구조), 어느 칸도 자식 단위로 나눌 수 없으면 `null`을
 * 돌려주고 기존 "가장 높은 칸만 자르기"로 넘긴다.
 */
function splitParallelCells(row: HTMLElement, cells: HTMLElement[], rawCapacity: number, rawFirstCapacity?: number): HTMLElement[] | null {
  // **잰 높이보다 조금 작게 묶는다.** 조각이 용량에 딱 붙으면 렌더될 때 칸 여백·테두리가 더해져
  // 다시 넘치고, 그 조각이 한 번 더 쪼개지면서 **한쪽만 든 조각**이 만들어진다(2026-09-17 실측:
  // `box-4--p3--p1`처럼 두 번 쪼개진 조각이 전부 한쪽만 찼다).
  const fullCapacity = Math.floor(rawCapacity * 0.9);
  // 첫 조각만 쪽 끝 남은 자리(rawFirstCapacity)에 맞춘다.
  const firstCapacity = rawFirstCapacity === undefined ? fullCapacity : Math.floor(rawFirstCapacity * 0.9);
  const filled = cells.filter((cell) => elementChildren(cell).length > 0 && contentHeight(cell) > 0);
  if (filled.length < 2) return null;

  // 칸마다 자식과 그 높이. 자식이 하나뿐인 칸은 나눌 수 없으므로 통째로 한 덩어리다.
  const columns = cells.map((cell) => {
    const children = elementChildren(cell);
    const own = Math.max(0, height(cell) - contentHeight(cell));
    return { cell, children, heights: children.map(height), own, index: 0 };
  });
  if (columns.every((column) => column.children.length <= 1)) return null;

  // 칸마다 "지금까지 몇 %를 실었는가"로 다음에 채울 칸을 고른다. 조각 안에서만 견주면
  // **왼쪽 칸이 매번 먼저 뽑혀 통째로 먼저 소진되고**(실측: p2~p4 긍정만, p5~p6 부정만),
  // 결국 한쪽만 있는 조각이 줄줄이 생긴다. 누적 비율로 고르면 두 칸이 나란히 내려간다.
  const totals = columns.map((column) => column.heights.reduce((sum, value) => sum + value, 0) || 1);
  const consumed = columns.map(() => 0);

  const pieces: HTMLElement[] = [];
  let guard = 0;
  while (columns.some((column) => column.index < column.children.length) && guard < 40) {
    guard += 1;
    const capacity = pieces.length === 0 ? firstCapacity : fullCapacity;
    const taken = columns.map(() => [] as HTMLElement[]);
    const used = columns.map(() => 0);
    let pieceHeight = 0;
    let progressed = false;
    for (;;) {
      const next = columns
        .map((column, i) => ({ column, i }))
        .filter(({ column }) => column.index < column.children.length)
        .sort((a, b) => consumed[a.i] / totals[a.i] - consumed[b.i] / totals[b.i])[0];
      if (!next) break;
      const { column, i } = next;
      let childHeight = column.heights[column.index];
      let after = Math.max(pieceHeight, used[i] + childHeight + column.own);
      // **묶음 하나가 조각 하나를 통째로 먹으면 그 묶음을 더 잘게 나눈다.** 안 그러면 그 조각은
      // 한쪽 칸만 차고 반대쪽은 빈 채로 남는다(2026-09-17 실측: 경제적 가치 p2~p6이 한쪽만).
      if (after > capacity) {
        const room = Math.max(capacity - Math.max(used[i], pieceHeight) - column.own, fullCapacity * 0.4);
        const parts = splitElement(column.children[column.index], room);
        if (parts && parts.length > 1) {
          column.children.splice(column.index, 1, ...parts);
          column.heights.splice(column.index, 1, ...parts.map(height));
          childHeight = column.heights[column.index];
          after = Math.max(pieceHeight, used[i] + childHeight + column.own);
        }
      }
      // 조각이 비어 있으면 넘치더라도 하나는 담는다(아니면 영원히 못 나눈다).
      if (after > capacity && progressed) break;
      taken[i].push(column.children[column.index]);
      used[i] += childHeight;
      consumed[i] += childHeight;
      column.index += 1;
      pieceHeight = after;
      progressed = true;
    }
    if (!progressed) return null;
    const rowClone = shell(row);
    columns.forEach((column, i) => {
      const cellClone = shell(column.cell);
      for (const child of taken[i]) cellClone.append(child.cloneNode(true));
      rowClone.append(cellClone);
    });
    pieces.push(rowClone);
  }
  return pieces.length > 1 ? pieces : null;
}

/**
 * 위 행에서 내려오는 **병합 셀(rowspan)** 을 행마다 기록한다.
 *
 * 쪽 경계가 병합 셀 한가운데 떨어지면 이어지는 조각의 첫 행에는 그 셀이 없어서 **칸이 통째로
 * 한 칸씩 밀린다**(2026-09-15 케어클 실측: 단계 칸에 문항 번호가 들어가고, 60px짜리 문항 칸에
 * 긴 문항이 들어가 글자가 한 자씩 세로로 쌓였다). 조각마다 남은 만큼을 다시 얹어야 한다.
 */
type RowspanCarry = { cell: HTMLElement; column: number; endsAt: number };

function rowspanCarries(rows: HTMLElement[]): RowspanCarry[][] {
  const perRow: RowspanCarry[][] = [];
  let active: RowspanCarry[] = [];
  rows.forEach((row, index) => {
    active = active.filter((carry) => carry.endsAt > index);
    perRow[index] = [...active];
    const taken = new Set(active.map((carry) => carry.column));
    let column = 0;
    for (const cell of elementChildren(row)) {
      while (taken.has(column)) column += 1;
      const span = Number(cell.getAttribute("rowspan") ?? "1");
      if (span > 1) active.push({ cell, column, endsAt: index + span });
      column += 1;
    }
  });
  return perRow;
}

/**
 * 조각의 첫 행에 빠진 병합 셀을 **원래 칸 자리에** 다시 넣는다. 남은 행 수만큼만 병합하고,
 * **글자는 넣지 않는다** — 같은 그룹이 이어지고 있다는 것은 배경색으로 보이고, 새 쪽에 라벨을
 * 또 적으면 새 그룹이 시작한 것처럼 읽힌다(CLAUDE.md "병합 셀처럼 보이게" 규칙).
 */
function restoreRowspanCells(rowClones: HTMLElement[], carries: RowspanCarry[], chunkLength: number, startIndex: number): void {
  if (carries.length === 0 || rowClones.length === 0) return;
  const first = rowClones[0];
  const placed: { column: number; cell: HTMLElement }[] = carries.map((carry) => {
    const cell = carry.cell.cloneNode(false) as HTMLElement;
    cell.setAttribute("data-split-carry", "");
    const span = Math.min(carry.endsAt, startIndex + chunkLength) - startIndex;
    if (span > 1) cell.setAttribute("rowspan", String(span));
    else cell.removeAttribute("rowspan");
    return { column: carry.column, cell };
  });
  const taken = new Set(carries.map((carry) => carry.column));
  let column = 0;
  for (const cell of elementChildren(first)) {
    while (taken.has(column)) column += 1;
    placed.push({ column, cell });
    column += 1;
  }
  placed.sort((left, right) => left.column - right.column);
  first.replaceChildren(...placed.map((entry) => entry.cell));
}

/**
 * 요소 하나를 용량 이하 조각들로 나눈다(자기 태그·속성은 조각마다 유지). 못 나누면 `null`.
 *
 * 자식이 하나뿐이면 그 안으로 내려가고, 여럿이면 잰 높이로 묶는다. 묶고도 혼자 넘치는 자식이
 * 있으면 그 자식을 다시 나눈다 — 그래서 `표 > tbody > 행 > 칸 > 문단`처럼 깊이 들어가 있는
 * 내용도 문단 사이에서 잘린다. `<thead>`는 자르지 않고 **첫 조각에만** 둔다 — 원본 발행 보고서에는
 * 다음 쪽에서 머리행을 반복한 표가 하나도 없다(2026-09-30 담당자 지시: "제일 쓸모 없는 기능").
 */
/**
 * 조각 표시: 둘째 조각부터는 **앞 조각의 같은 요소가 이어진 것**이다(`data-split-cont`). 다시 합칠 때
 * (`mergePartHtml`) 이 표시가 있는 요소만 앞 조각의 마지막 요소에 이어 붙인다 — 표시가 없으면 새 형제다.
 */
function markContinuations(pieces: HTMLElement[] | null): HTMLElement[] | null {
  pieces?.slice(1).forEach((piece) => piece.setAttribute("data-split-cont", ""));
  return pieces;
}

/** 표의 열 너비(%). 칸이 가장 많은 행 기준이고 병합(colspan) 칸이 있는 행은 쓰지 않는다. */
function measuredColumnWidths(table: HTMLElement): number[] | null {
  const rows = [...table.querySelectorAll<HTMLElement>(":scope > thead > tr, :scope > tbody > tr")]
    .filter((row) => [...row.children].every((cell) => Number(cell.getAttribute("colspan") ?? "1") === 1));
  const widest = rows.reduce<HTMLElement | null>((best, row) => (!best || row.children.length > best.children.length ? row : best), null);
  if (!widest || widest.children.length < 2) return null;
  const total = table.getBoundingClientRect().width || 1;
  // 병합 셀(rowspan)이 앞 열을 차지하는 행이면 칸 수가 모자라 너비가 틀린다 — 열 수가 맞는 행만 믿는다.
  const columns = Math.max(...rows.map((row) => row.children.length));
  if (widest.children.length !== columns) return null;
  return [...widest.children].map((cell) => Math.round((cell.getBoundingClientRect().width / total) * 1000) / 10);
}

function splitElement(node: HTMLElement, capacity: number, firstCapacity?: number): HTMLElement[] | null {
  return markContinuations(splitElementRaw(node, capacity, firstCapacity));
}

function splitElementRaw(node: HTMLElement, capacity: number, firstCapacity?: number): HTMLElement[] | null {
  if (node.tagName === "TR") return splitRow(node, capacity);

  const children = elementChildren(node);
  // 조각마다 되풀이할 머리 요소: 표 머리행과, 인용 묶음의 **숨은 출처 마커**.
  // 마커(`data-quote-group-source`)는 그 묶음이 어느 문항에서 왔는지를 들고 있는데 첫 조각에만
  // 남으면 이어지는 조각에서 "원문 보기"가 사라지고 근거 패널이 출처를 못 찾는다(2026-09-15
  // 케어클 실측: 인용 묶음 55개 중 3개가 마커 없는 이어짐 조각이었다). 숨은 요소라 되풀이해도
  // 보이지 않는다.
  const head = children.find((child) => child.tagName === "THEAD" || child.hasAttribute("data-quote-group-source"));
  // 열 너비(colgroup)는 내용이 아니다 — 조각으로 갈라지면 행 없는 빈 표가 생겼다(2026-10-01 실측).
  const existingColgroup = children.find((child) => child.tagName === "COLGROUP") ?? null;
  const body = children.filter((child) => child !== head && child !== existingColgroup);

  // wrap은 조각 순서대로 불리므로 첫 호출이 첫 조각이다. 출처 마커는 계속 되풀이한다.
  let first = true;
  // **표 조각은 원래 표의 열 너비를 그대로 쓴다.** 조각마다 브라우저가 열 너비를 새로 정하면 같은 쪽에
  // 두 조각이 놓였을 때 열이 어긋나 "표 두 개가 붙은" 것처럼 보였다(2026-10-01 담당자 지적).
  const columnWidths = node.tagName === "TABLE" && !existingColgroup ? measuredColumnWidths(node) : null;
  const wrap = (pieces: HTMLElement[]): HTMLElement => {
    const clone = shell(node);
    if (existingColgroup) clone.append(existingColgroup.cloneNode(true));
    else if (columnWidths) {
      clone.style.tableLayout = "fixed";
      const colgroup = node.ownerDocument.createElement("colgroup");
      for (const width of columnWidths) {
        const col = node.ownerDocument.createElement("col");
        col.style.width = `${width}%`;
        colgroup.append(col);
      }
      clone.append(colgroup);
    }
    if (head && (first || head.tagName !== "THEAD")) clone.append(head.cloneNode(true));
    first = false;
    for (const piece of pieces) clone.append(piece);
    return clone;
  };

  // **조각마다 껍데기가 다시 붙는다** — 테두리 상자의 안쪽 여백·테두리, 표의 머리행이 조각 수만큼
  // 늘어난다. 그만큼 빼고 묶지 않으면 쪼갠 조각이 다시 한 쪽을 넘는다(2026-09-13 실측:
  // `conclusion-strategy-table--p2`가 1,308px로 남았다).
  // **자식이 하나일 때도 빼야 한다** — `표 > tbody`처럼 한 겹씩 내려가는 동안 머리행·테두리를
  // 안 빼면 묶을 때 쓴 용량보다 조각이 그만큼 커진 채로 렌더된다(2026-09-14 실측: 설문 항목 표
  // 조각을 851px로 묶었는데 899px로 나와 카드가 356mm가 됐다).
  const own = Math.max(0, height(node) - contentHeight(node)) + (head ? height(head) : 0);
  const inner = Math.max(capacity - own, capacity * 0.5);

  // 요소 자식이 없거나, 요소 사이에 자기 글이 섞여 있으면 줄 단위로 자른다 — 후자를 요소로만
  // 묶으면 그 글이 조각에서 통째로 빠진다.
  if (body.length === 0 || hasDirectText(node)) return splitByLines(node, capacity);

  if (body.length === 1) {
    const pieces = splitElement(body[0], inner, firstCapacity === undefined ? undefined : Math.max(firstCapacity - own, 0));
    return pieces ? pieces.map((piece) => wrap([piece])) : null;
  }

  const chunks = chunkByHeight(body.map(height), inner, firstCapacity === undefined ? undefined : Math.max(firstCapacity - own, 0));
  if (chunks.length < 2 && body.every((child) => height(child) <= inner)) return null;

  // 표의 행을 나누는 경우에만 병합 셀을 되살린다(`표 > tbody > tr`).
  const carries = body.every((child) => child.tagName === "TR") ? rowspanCarries(body) : null;

  // **남은 자리를 채울 때(firstCapacity) 첫 행이 그 자리에 안 들어가면 행을 가운데서 자르지 않는다**
  // — 그 행부터 다음 쪽으로 넘긴다(Word "행 자동 나누기" 끔, 2026-09-30 기본값). 표 속성에서
  // 켰을 때만(`data-row-break`) 행을 쪼개 앞 쪽을 채운다.
  const firstInner = firstCapacity === undefined ? undefined : Math.max(firstCapacity - own, 0);
  const firstRow = body[chunks[0][0]];
  const out: HTMLElement[] = [];
  let remaining = chunks;
  if (firstInner !== undefined && chunks[0].length === 1 && firstRow.tagName === "TR" && height(firstRow) > firstInner) {
    // 반 쪽보다 큰 행은 "행"이라기보다 내용 상자(4대 가치 긍정·부정 두 칸 의견)다 — 통째로 넘기면
    // 앞 쪽이 거의 비므로(2026-10-01 실측: 평균표만 남은 쪽) 행 나누기 설정과 무관하게 흘린다.
    if (!node.closest("[data-row-break]") && height(firstRow) <= inner * 0.5) return null;
    const head = splitRow(firstRow, inner, firstInner);
    if (!head) return null;
    for (const piece of head) out.push(wrap([piece]));
    remaining = chunks.slice(1);
  }

  // **남은 자리를 채울 때 첫 묶음 뒤의 자리도 쓴다.** 첫 묶음(예: 의견 상자의 머리행)만 담고 다음
  // 자식(내용 행)을 통째로 넘기면 첫 조각이 머리행뿐인 껍데기가 되어 다시 합쳐지고, 결국 앞 쪽은
  // 평균표만 남은 채 비었다(2026-10-01 리바랩스 62쪽·케어클 79쪽). 다음 자식을 남은 자리만큼 잘라 붙인다.
  if (firstInner !== undefined && out.length === 0 && remaining.length >= 2) {
    const [lead, following] = remaining;
    const room = firstInner - lead.reduce((sum, index) => sum + height(body[index]), 0);
    const next = body[following[0]];
    const mayCutRow = next.tagName !== "TR" || !!node.closest("[data-row-break]") || height(next) > inner * 0.5;
    if (room > 80 && height(next) > room && mayCutRow) {
      const deeper = splitElement(next, inner, room);
      if (deeper && deeper.length > 1) {
        const leadClones = lead.map((index) => body[index].cloneNode(true) as HTMLElement);
        if (carries) restoreRowspanCells(leadClones, carries[lead[0]], lead.length, lead[0]);
        out.push(wrap([...leadClones, deeper[0]]));
        for (const piece of deeper.slice(1)) out.push(wrap([piece]));
        remaining = [following.slice(1), ...remaining.slice(2)].filter((indexes) => indexes.length > 0);
      }
    }
  }

  for (const indexes of remaining) {
    const only = indexes.length === 1 ? body[indexes[0]] : null;
    if (only && height(only) > inner) {
      const deeper = splitElement(only, inner);
      if (deeper) {
        for (const piece of deeper) out.push(wrap([piece]));
        continue;
      }
    }
    const clones = indexes.map((index) => body[index].cloneNode(true) as HTMLElement);
    if (carries) restoreRowspanCells(clones, carries[indexes[0]], indexes.length, indexes[0]);
    out.push(wrap(clones));
  }
  return out.length > 1 ? out : null;
}

/**
 * 렌더된 블록 하나를 용량 이하 조각들의 HTML로 자른다. 자를 수 없으면 `null`.
 * 블록의 `html`은 content root의 **안쪽** HTML이므로, 뿌리 껍데기는 벗겨서 돌려준다.
 */
export function splitRenderedHtml(root: HTMLElement, capacity: number, firstCapacity?: number): string[] | null {
  const first = splitAndMerge(root, capacity, firstCapacity);
  if (!first || !first.merged) return first?.parts ?? null;
  // **껍데기를 붙였으면 그 조각은 용량보다 껍데기만큼 커진다**(2026-10-01 리바랩스 Ⅵ장: 제목 띠
  // 50px + 본문 811px = 861px, 용량 851px → 인쇄에서 한 쪽 더). 조금 작은 용량으로 한 번 더 자른다.
  const retry = splitAndMerge(root, capacity * 0.85, firstCapacity === undefined ? undefined : firstCapacity * 0.85);
  return retry?.parts ?? first.parts;
}

function splitAndMerge(root: HTMLElement, capacity: number, firstCapacity?: number): { parts: string[]; merged: boolean } | null {
  const pieces = splitElement(root, capacity, firstCapacity);
  if (!pieces || pieces.length < 2) return null;
  const parts = pieces.map((piece) => piece.innerHTML);

  // **껍데기 조각은 버리지 말고 다음 조각에 합친다.** 배너("2. 부정 의견")나 표 제목 띠만 든
  // 조각이 앞 쪽에 남으면 "제목만 있는 쪽"이 생긴다. 예전에는 그럴 때 **쪼개기를 통째로 포기**
  // 했는데(2026-09-17), 그러면 한 쪽보다 큰 블록이 그대로 남아 **인쇄에서 브라우저가 제멋대로
  // 쪼갠다** — 저장된 케어클 보고서가 웹뷰 73쪽인데 PDF 91쪽으로 나온 원인이었다.
  const needsRow = /<table/i.test(root.innerHTML);
  const thin = (html: string) => (needsRow ? !/<tr[\s>]/i.test(html) : textLength(html) < 60);
  const merged: string[] = [];
  for (const part of parts) {
    if (merged.length > 0 && thin(merged[merged.length - 1])) merged[merged.length - 1] += part;
    else merged.push(part);
  }
  // 마지막 조각이 껍데기뿐이면 앞 조각에 붙인다(뒤에 합칠 것이 없다).
  if (merged.length > 1 && thin(merged[merged.length - 1])) {
    const tail = merged.pop() as string;
    merged[merged.length - 1] += tail;
  }
  return merged.length > 1 ? { parts: merged, merged: merged.length < parts.length } : null;
}

/** 블록의 "내용 뿌리" — 이 요소의 **안쪽** HTML이 곧 블록의 `html`이다. */
function contentRoot(element: HTMLElement): HTMLElement | null {
  return element.querySelector<HTMLElement>(".report-rich-static, .report-rich-editor");
}

/** 표 블록의 행 높이. 머리행(thead)은 첫 조각에만 붙으므로 세지 않는다. */
function rowHeights(element: HTMLElement): number[] {
  const table = element.querySelector("table");
  if (!table) return [];
  return [...table.querySelectorAll<HTMLElement>(":scope > tbody > tr")].map((row) => row.getBoundingClientRect().height);
}

/**
 * 조각 id. **첫 조각도 새 id를 받는다**(`X--p1`). 첫 조각이 원래 id를 그대로 쓰면, 다음
 * 측정에서 그 블록이 (아직 화면이 갱신되기 전이라) 또 커 보여 **같은 id의 조각이 계속 쌓였다**
 * (2026-09-13 실측: `conclusion-strategy-table--p3--p2`가 11개, React key 충돌). 원래 id가
 * 남지 않으면 `isPart`가 두 번째 분할을 막아 한 번에 끝난다.
 */
function partId(id: string, index: number): string {
  return `${id}--p${index + 1}`;
}

/**
 * 더 쪼개지 않을 조각인가.
 *
 * 쪼갤 때마다 조각이 담는 자식 수가 반드시 줄고, 더 못 나누면 `splitElement`가 `null`을 주므로
 * 재측정은 스스로 멈춘다. 이 상한은 그 위의 안전장치다 — 측정이 화면 갱신보다 앞서면 조각이
 * 끝없이 깊어질 수 있다(2026-09-13 실측: 같은 id 조각이 11개까지 쌓였다. 그때의 진짜 원인은
 * 첫 조각이 원래 id를 그대로 쓴 것이었고 `partId`에서 고쳤다).
 *
 * **두 번이면 부족하다**(2026-09-14 실측): 설문 문항 한 칸이 긴 raw data(투블럭)는 첫 측정에서
 * 행 높이가 작게 나와 두 조각으로만 갈렸고, 나중에 제 높이를 찾은 3,756px짜리 조각이 이 상한에
 * 걸려 영영 안 쪼개졌다. 여섯 번으로 올렸다.
 */
function isPart(id: string): boolean {
  return (id.match(/--p\d+/g)?.length ?? 0) >= 6;
}

/**
 * **row-group의 한 행이 혼자 한 쪽보다 크면 그 행을 여러 행으로 편다.**
 *
 * row-group은 행마다 자식 블록(차트·표·문단)을 품는데, 행 하나가 그것들을 다 안고 있으면
 * 행 단위로 묶는 것만으로는 한 쪽에 못 넣는다(2026-09-14 리바랩스 실측: Ⅸ장 "기능별 고객
 * 경험 평가" 행 하나가 963px). 자식 블록을 높이로 나눠 이어지는 행으로 펴면, 다음 측정에서
 * 행 단위 묶기가 정상적으로 동작한다.
 *
 * 라벨은 첫 조각에만 넣는다 — 이어지는 행은 배경·테두리만 남아 병합 셀처럼 보인다
 * (CLAUDE.md "병합 셀처럼 보이게" 규칙, `splitRow`와 같은 방식).
 */
function expandTallRows(element: HTMLElement, block: ReportRowGroupBlock, capacity: number): ReportRowGroupBlock["rows"] | null {
  const table = element.querySelector("table");
  const rowElements = table ? [...table.querySelectorAll<HTMLElement>(":scope > tbody > tr")] : [];
  if (rowElements.length !== block.rows.length) return null;

  let changed = false;
  const rows = block.rows.flatMap((row, index) => {
    const rowElement = rowElements[index];
    if (height(rowElement) <= capacity || row.blocks.length < 2) return [row];
    // <tr> = [라벨 칸, 내용 칸] 이고 내용 칸 안의 첫 요소가 자식 블록들을 담은 세로 스택이다.
    const holder = rowElement.lastElementChild?.firstElementChild;
    const children = holder instanceof HTMLElement ? elementChildren(holder) : [];
    if (children.length !== row.blocks.length) return [row];
    // 칸의 안쪽 여백(위아래)과 자식 사이 간격은 조각마다 다시 붙으므로 미리 빼고 묶는다.
    const own = holder instanceof HTMLElement ? Math.max(0, height(rowElement) - height(holder)) : 0;
    const gap = children.length > 1 ? parseFloat(getComputedStyle(children[1]).marginTop) || 0 : 0;
    const chunks = chunkByHeight(children.map((child) => height(child) + gap), Math.max(capacity - own, capacity * 0.5));
    if (chunks.length < 2) return [row];
    changed = true;
    return chunks.map((indexes, part) => ({
      id: part === 0 ? row.id : `${row.id}--p${part + 1}`,
      label: part === 0 ? row.label : "",
      blocks: indexes.map((childIndex) => row.blocks[childIndex]),
    }));
  });
  return changed ? rows : null;
}

/** 조각 id에서 원래 블록 id를 되돌린다(근거 패널처럼 id로 조회하는 곳이 쓴다). */
export function originalBlockId(id: string): string {
  return id.replace(/(--p\d+)+$/, "");
}

/**
 * **"이 블록은 쪼개지 않기"로 지정한 블록의 이미 쪼개진 조각을 다시 붙인다.**
 *
 * 지정만 받고 붙이지 않으면, 지정하기 전에 이미 쪼개진 표는 갈린 채 그대로 남아 **설정이
 * 아무것도 안 한 것처럼 보인다** — 담당자가 이 설정을 켜는 순간은 대개 "지금 갈려 있는 이 표"를
 * 보고 있을 때다. 붙인 블록은 원래 id를 되찾고, 그 뒤로는 `splitOversizedBlocks`가 건너뛴다.
 *
 * 바꿀 것이 없으면 `null`(그때만 재측정이 멈춘다).
 */
/** 표의 행 목록에서, 마지막 행까지 내려오는 병합 셀(rowspan)을 열 번호로 찾는다. */
function openRowspans(rows: Element[]): Map<number, Element> {
  const active: { cell: Element; column: number; endsAt: number }[] = [];
  rows.forEach((row, index) => {
    const live = active.filter((carry) => carry.endsAt > index);
    const taken = new Set(live.map((carry) => carry.column));
    let column = 0;
    for (const cell of Array.from(row.children)) {
      while (taken.has(column)) column += 1;
      const span = Number(cell.getAttribute("rowspan") ?? "1");
      if (span > 1) active.push({ cell, column, endsAt: index + span });
      column += 1;
    }
  });
  return new Map(active.filter((carry) => carry.endsAt >= rows.length).map((carry) => [carry.column, carry.cell]));
}

/** `b`를 `a` 뒤에 이어 붙인다. `data-split-cont`인 첫 요소는 `a`의 마지막 요소 안으로 들어간다. */
function mergeInto(a: Element, b: Element): void {
  const children = Array.from(b.childNodes);
  const firstElement = children.find((node): node is Element => node.nodeType === 1) ?? null;
  // 인용 묶음의 숨은 출처 마커는 조각마다 되풀이돼 있다 — 하나만 남긴다.
  if (firstElement?.hasAttribute("data-quote-group-source") && a.querySelector(":scope > [data-quote-group-source]")) {
    children.splice(children.indexOf(firstElement), 1);
  }
  // 표 조각마다 붙인 열 너비(colgroup)도 하나만 남긴다.
  const colgroup = children.find((node): node is Element => node.nodeType === 1 && (node as Element).tagName === "COLGROUP");
  if (colgroup && a.querySelector(":scope > colgroup")) children.splice(children.indexOf(colgroup), 1);
  const lead = children.find((node): node is Element => node.nodeType === 1) ?? null;
  const last = a.lastElementChild;
  if (lead && last && lead.hasAttribute("data-split-cont") && last.tagName === lead.tagName) {
    children.splice(children.indexOf(lead), 1);
    if (lead.tagName === "TR") {
      Array.from(lead.children).forEach((cell, index) => { if (last.children[index]) mergeInto(last.children[index], cell); });
    } else {
      mergeInto(last, lead);
    }
  }
  // 이어지는 조각 첫 행에 되살려 둔 병합 셀은 버리고, 앞 조각의 병합 셀을 그만큼 늘린다.
  const firstRow = children.find((node): node is Element => node.nodeType === 1 && (node as Element).tagName === "TR");
  if (firstRow) {
    const open = openRowspans(Array.from(a.children).filter((node) => node.tagName === "TR"));
    Array.from(firstRow.children).forEach((cell, column) => {
      if (!cell.hasAttribute("data-split-carry")) return;
      const owner = open.get(column);
      if (owner) owner.setAttribute("rowspan", String(Number(owner.getAttribute("rowspan") ?? "1") + Number(cell.getAttribute("rowspan") ?? "1")));
      cell.remove();
    });
  }
  a.append(...children);
}

/** 쪼갠 조각들의 HTML을 **원래 한 덩어리로** 되돌린다. 문자열을 이어 붙이면 표가 두 개로 남는다. */
export function mergePartHtml(parts: string[]): string {
  const root = document.createElement("div");
  root.innerHTML = parts[0];
  for (const part of parts.slice(1)) {
    const next = document.createElement("div");
    next.innerHTML = part;
    mergeInto(root, next);
  }
  root.querySelectorAll("[data-split-cont]").forEach((node) => node.removeAttribute("data-split-cont"));
  return root.innerHTML;
}

/** 같은 블록의 조각 두 개를 하나로. 종류가 다르면 null. */
function mergeTwo(previous: ReportBlock, block: ReportBlock, id: string): ReportBlock | null {
  if ((previous.kind === "table" || previous.kind === "row-group") && block.kind === previous.kind) {
    return { ...previous, id, rows: [...previous.rows, ...block.rows] } as ReportBlock;
  }
  if ((previous.kind === "text" || previous.kind === "rich-static") && block.kind === previous.kind) {
    return { ...previous, id, html: mergePartHtml([previous.html, block.html]) };
  }
  return null;
}

export function mergeSplitParts(sections: ReportSectionContent[]): ReportSectionContent[] | null {
  let anyChange = false;
  const next = sections.map((section) => {
    const keep = new Set(section.keepTogether ?? []);
    if (keep.size === 0) return section;
    let changed = false;
    const blocks: ReportBlock[] = [];
    for (const block of section.blocks) {
      const id = originalBlockId(block.id);
      if (!keep.has(id) || block.id === id) { blocks.push(block); continue; }
      changed = true;
      const previous = blocks[blocks.length - 1];
      if (!previous || originalBlockId(previous.id) !== id) { blocks.push({ ...block, id }); continue; }
      const merged = mergeTwo(previous, block, id);
      if (merged) blocks[blocks.length - 1] = merged;
      else blocks.push({ ...block, id });
    }
    if (!changed) return section;
    anyChange = true;
    return { ...section, blocks };
  });
  return anyChange ? next : null;
}

/**
 * 한 쪽보다 큰 블록을 쪼갠 새 섹션 목록. 쪼갤 것이 없으면 `null`(그때만 재측정이 멈춘다).
 *
 * 조각 id는 `원래id--p2`처럼 **원래 id로 시작**한다 — 문항 블록을 접두로 찾는 곳
 * (극성 확인 후 교체, HWPX 미리보기)이 그대로 동작해야 하기 때문.
 */
export function splitOversizedBlocks(
  root: HTMLElement,
  sections: ReportSectionContent[],
  capacity: number,
): ReportSectionContent[] | null {
  let changed = false;

  const splitOne = (block: ReportBlock, keepTogether: Set<string>): ReportBlock[] => {
    // 담당자가 "이 블록은 쪼개지 않기"를 지정했으면 손대지 않는다. 한 쪽에 안 들어가면
    // `paginateBlocks`가 새 쪽에서 시작하게 한다.
    if (keepTogether.has(block.id) || isPart(block.id)) return [block];
    const element = root.querySelector<HTMLElement>(`[data-report-block-id="${CSS.escape(block.id)}"]`);
    if (!element || element.getBoundingClientRect().height <= capacity) return [block];

    if (block.kind === "row-group") {
      // 행 하나가 한 쪽보다 크면 먼저 그 행을 편다. 한 번에 한 가지만 바꾸고 다음 측정에
      // 넘긴다 — 편 결과의 행 높이는 다시 재봐야 알 수 있다.
      const expanded = expandTallRows(element, block, capacity);
      if (expanded) {
        changed = true;
        return [{ ...block, rows: expanded }];
      }
    }

    if (block.kind === "table" || block.kind === "row-group") {
      const heights = rowHeights(element);
      if (heights.length !== block.rows.length || heights.length < 2) return [block];
      const chunks = chunkByHeight(heights, capacity);
      if (chunks.length < 2) return [block];
      changed = true;
      return chunks.map((indexes, part) => ({
        ...block,
        id: partId(block.id, part),
        // 표 제목·머리행은 첫 조각에만 — 원본 보고서는 넘어간 쪽에서 머리행을 반복하지 않는다.
        ...(block.kind === "table" && part > 0 ? { title: undefined, headers: undefined } : {}),

        rows: indexes.map((index) => block.rows[index]),
      } as ReportBlock));
    }

    if (block.kind === "text" || block.kind === "rich-static") {
      const inner = contentRoot(element);
      if (!inner) return [block];
      const parts = splitRenderedHtml(inner, capacity);
      if (!parts) return [block];
      changed = true;
      return parts.map((html, part) => ({ ...block, id: partId(block.id, part), html }));
    }

    // 차트·제목은 쪼갤 수 있는 내부 구조가 없다. 인쇄에서 쪼개지도록 표시만 하고 그대로 둔다.
    return [block];
  };

  const next = sections.map((section) => {
    const keepTogether = new Set(section.keepTogether ?? []);
    return { ...section, blocks: section.blocks.flatMap((block) => splitOne(block, keepTogether)) };
  });
  return changed ? next : null;
}

/**
 * **쪽에 남은 공간을 채우도록 블록 하나를 자른다**(2026-09-17 담당자 요청: "표가 통째로 다음
 * 장으로 밀려 앞 장이 비는 게 아쉽다. 최대한의 표 내용은 들어갔으면 좋겠다").
 *
 * `splitOversizedBlocks`는 "한 쪽보다 큰 블록"만 다루므로, 한 쪽에는 들어가지만 **지금 쪽에
 * 남은 자리**에는 안 들어가는 블록은 통째로 다음 쪽으로 밀렸다. 여기서는 첫 조각을 그 남은
 * 자리(`firstCapacity`)에 맞추고 나머지는 온전한 쪽 용량으로 채운다.
 *
 * 한 번에 한 블록만 자르고 다음 측정에 넘긴다 — 자르고 나면 뒤쪽 쪽 묶음이 전부 달라지므로,
 * 여러 개를 한꺼번에 자르면 이미 옛 배치를 기준으로 자른 조각이 남는다.
 */
/** 태그를 뺀 글자 수. 조각이 "빈 껍데기"인지 판단할 때 쓴다. */
function textLength(html: string): number {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

/** 조각이 "빈 껍데기"가 아닌지 — 표 행이 하나라도 있거나 글이 80자 이상 있으면 내용으로 본다. */
function hasRealContent(html: string): boolean {
  if (/<tr[\s>]/.test(html)) return true;
  return textLength(html) >= 80;
}

export function splitBlockToFit(
  root: HTMLElement,
  sections: ReportSectionContent[],
  blockId: string,
  firstCapacity: number,
  capacity: number,
): ReportSectionContent[] | null {
  const element = root.querySelector<HTMLElement>(`[data-report-block-id="${CSS.escape(blockId)}"]`);
  if (!element) return null;

  const cut = (block: ReportBlock): ReportBlock[] | null => {
    if (block.kind === "table" || block.kind === "row-group") {
      const heights = rowHeights(element);
      if (heights.length !== block.rows.length || heights.length < 2) return null;
      const chunks = chunkByHeight(heights, capacity, firstCapacity);
      // 첫 행이 남은 자리보다 크면 채우지 않는다 — 이 경로는 행을 쪼갤 수 없어 그대로 넘친다.
      if (chunks.length < 2 || heights[chunks[0][0]] > firstCapacity) return null;
      return chunks.map((indexes, part) => ({
        ...block,
        id: partId(block.id, part),
        // 표 제목은 첫 조각에만 — 이어지는 쪽에 제목이 또 나오면 새 표처럼 읽힌다.
        ...(block.kind === "table" && part > 0 ? { title: undefined } : {}),
        rows: indexes.map((index) => block.rows[index]),
      } as ReportBlock));
    }
    if (block.kind === "text" || block.kind === "rich-static") {
      const inner = contentRoot(element);
      if (!inner) return null;
      const parts = splitRenderedHtml(inner, capacity, firstCapacity);
      if (!parts) return null;
      // **첫 조각에 실제 내용이 없으면 자르지 않는다.** 남은 자리가 작으면 표 제목 띠만 앞 쪽에
      // 남고 표는 통째로 다음 쪽으로 가, "제목만 있는 쪽"이 생긴다(2026-09-17 실측).
      if (!hasRealContent(parts[0])) return null;
      return parts.map((html, part) => ({ ...block, id: partId(block.id, part), html }));
    }
    return null;
  };

  let changed = false;
  const next = sections.map((section) => ({
    ...section,
    blocks: section.blocks.flatMap((block) => {
      if (changed || block.id !== blockId) return [block];
      const pieces = cut(block);
      if (!pieces) return [block];
      changed = true;
      return pieces;
    }),
  }));
  return changed ? next : null;
}
