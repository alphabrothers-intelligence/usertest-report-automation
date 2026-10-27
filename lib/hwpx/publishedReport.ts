/**
 * 결과보고서 HWPX — **실제 발행본(리바랩스 0904) 양식**에 웹뷰의 문서 내용을 그대로 옮긴다.
 *
 * 양식 파일(`public/hwpx/report-template.hwpx`, scripts/build-report-hwpx-template.ts가 만든다)에서
 * 쪽 설정·글꼴·표지·뒷표지·장/절 배너·문항 머리·목차를 원형째 복제하고, 그 사이 본문은 웹뷰에 보이는
 * 그대로(표는 표로, 그래프는 그림으로) 채운다. 제품마다 장·절·블록 구성이 달라서 고정 칸을 채우는
 * 방식이 아니라 **문서에 있는 순서대로** 쌓는다(2026-10-26 담당자 결정, 옛 `ReportHwpx.ts`는 서식을
 * 새로 정의해 깨졌다).
 *
 * 브라우저에서 돈다(그림 PNG가 수십 장이라 Vercel 요청 4.5MB 제한에 걸린다) — node 전용 API를 쓰지 말 것.
 * 웹뷰 DOM → `HwpNode` 변환은 `domToHwp.ts`.
 */
import JSZip from "jszip";

export type HwpRun = { text: string; bold?: boolean; underline?: boolean; color?: string; sizePt?: number };
export type HwpAlign = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFY";
export type HwpBorder = { width: number; color: string } | null; // width: mm
export type HwpCell = {
  nodes: HwpNode[];
  colSpan: number;
  rowSpan: number;
  /** 화면에서 잰 칸 폭(px). 열 폭 계산에 쓴다. */
  widthPx: number;
  bg?: string;
  borders: [HwpBorder, HwpBorder, HwpBorder, HwpBorder]; // 왼·오른·위·아래
  valign?: "TOP" | "CENTER" | "BOTTOM";
  padPx?: [number, number, number, number]; // 왼·오른·위·아래
  /** 머리 칸(`<th>`). 머리 행은 첫 본문 행과 같은 쪽에 붙어 다닌다. */
  header?: boolean;
};
export type HwpNode =
  | { kind: "chapter"; numeral: string; title: string }
  | { kind: "sub"; number: string; text: string }
  | { kind: "question"; text: string; note?: string }
  /** `sizePt`: 빈 줄의 높이(글자 크기). 편집기는 빈 문단을 낮게 그린다. */
  | { kind: "p"; runs: HwpRun[]; align?: HwpAlign; sizePt?: number }
  /** `rowHeightsPx`: 화면에서 잰 행 높이 — 표를 통째로 둘지, 어디서 나눌지 정하는 데 쓴다. */
  | { kind: "table"; widthPx: number; rows: HwpCell[][]; rowHeightsPx?: number[] }
  | { kind: "img"; png: Uint8Array; widthPx: number; heightPx: number };

export type HwpDoc = {
  company: string;
  service: string;
  date: Date;
  /** 화면 px → HWPUNIT. 웹뷰 본문 폭이 발행본 본문 폭(51026)에 대응한다. */
  pxToHwp: number;
  nodes: HwpNode[];
};

// ── 양식 원형(build-report-hwpx-template.ts와 같은 순서) ───────────────────────
const PROTO = { page: 0, toc: 1, chapter: 2, sub: 3, question: 5, questionNote: 6 } as const;
const BODY_WIDTH = 51026; // A4 59528 − 좌우 여백 4251×2
const BASE_CHAR = "89"; // 발행본 본문 글자(나눔스퀘어OTF_ac 10pt)
const BASE_PARA = "47"; // 발행본 본문 문단(양쪽 맞춤, 줄 간격 160%)
const BODY_HEIGHT = 74266; // A4 84186 − 머리말 2835 − 꼬리말 4251 − 아래 여백 2834(section1 secPr)

/** 같은 태그의 중첩을 세어 최상위 `<hp:tag>…</hp:tag>`만 돌려준다(plan.ts와 같은 방식, 브라우저에서도 돈다). */
function topLevel(xml: string, tag: string): string[] {
  const re = new RegExp(`<(/?)hp:${tag}(?=[\\s>/])[^>]*?(/?)>`, "g");
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (const m of xml.matchAll(re)) {
    if (m[2]) {
      if (depth === 0) out.push(xml.slice(m.index!, m.index! + m[0].length));
    } else if (!m[1]) {
      if (depth++ === 0) start = m.index!;
    } else if (--depth === 0) out.push(xml.slice(start, m.index! + m[0].length));
  }
  return out;
}
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 원형의 n번째 글자 칸(`<hp:t>`)에 글을 넣는다. */
const setText = (xml: string, n: number, text: string) => {
  let i = -1;
  return xml.replace(/<hp:t>[^<]*<\/hp:t>/g, (m) => (++i === n ? `<hp:t>${esc(text)}</hp:t>` : m));
};

// ── header.xml에 서식 추가(글자·문단·테두리) ───────────────────────────────
class Styles {
  private chars = new Map<string, string>();
  private paras = new Map<string, string>();
  private fills = new Map<string, string>();
  private added = { charPr: [] as string[], paraPr: [] as string[], borderFill: [] as string[] };
  private next: Record<"charPr" | "paraPr" | "borderFill", number>;
  constructor(private header: string) {
    const count = (list: string) => +header.match(new RegExp(`<hh:${list} itemCnt="(\\d+)"`))![1];
    // borderFill id는 1부터 시작한다.
    this.next = { charPr: count("charProperties"), paraPr: count("paraProperties"), borderFill: count("borderFills") + 1 };
  }
  private proto(tag: string, id: string) {
    return this.header.match(new RegExp(`<hh:${tag} id="${id}"[\\s\\S]*?</hh:${tag}>`))![0];
  }
  char(run: Omit<HwpRun, "text">): string {
    const height = Math.round((run.sizePt ?? 10) * 100);
    const color = (run.color ?? "#000000").toUpperCase();
    const key = `${height}|${color}|${run.bold ? 1 : 0}|${run.underline ? 1 : 0}`;
    if (!this.chars.has(key)) {
      const id = String(this.next.charPr++);
      let xml = this.proto("charPr", BASE_CHAR)
        .replace(/id="\d+"/, `id="${id}"`)
        .replace(/height="\d+"/, `height="${height}"`)
        .replace(/textColor="[^"]*"/, `textColor="${color}"`)
        .replace(/<hh:bold\/>/, "");
      if (run.bold) xml = xml.replace(/(<hh:offset [^>]*\/>)/, "$1<hh:bold/>");
      if (run.underline) xml = xml.replace(/<hh:underline type="\w+"/, '<hh:underline type="BOTTOM"');
      this.added.charPr.push(xml);
      this.chars.set(key, id);
    }
    return this.chars.get(key)!;
  }
  para(align: HwpAlign = "JUSTIFY", lineSpacing = 160, keep = false): string {
    const key = `${align}|${lineSpacing}|${keep}`;
    if (!this.paras.has(key)) {
      const id = String(this.next.paraPr++);
      this.added.paraPr.push(this.proto("paraPr", BASE_PARA)
        .replace(/id="\d+"/, `id="${id}"`)
        .replace(/<hh:align horizontal="\w+"/, `<hh:align horizontal="${align}"`)
        .replace(/(<hh:lineSpacing type="PERCENT" value=")\d+/g, `$1${lineSpacing}`)
        .replace(/keepWithNext="\d"/, `keepWithNext="${keep ? 1 : 0}"`));
      this.paras.set(key, id);
    }
    return this.paras.get(key)!;
  }
  /** 원형 문단 모양에 "다음 문단과 함께"만 켠 사본. */
  keep(paraId: string): string {
    const key = `keep:${paraId}`;
    if (!this.paras.has(key)) {
      const id = String(this.next.paraPr++);
      this.added.paraPr.push(this.proto("paraPr", paraId).replace(/id="\d+"/, `id="${id}"`).replace(/keepWithNext="\d"/, 'keepWithNext="1"'));
      this.paras.set(key, id);
    }
    return this.paras.get(key)!;
  }
  fill(borders: HwpCell["borders"], bg?: string): string {
    const key = JSON.stringify([borders, bg ?? ""]);
    if (!this.fills.has(key)) {
      const id = String(this.next.borderFill++);
      const side = (name: string, b: HwpBorder) =>
        b ? `<hh:${name} type="SOLID" width="${mm(b.width)} mm" color="${b.color.toUpperCase()}"/>` : `<hh:${name} type="NONE" width="0.1 mm" color="#000000"/>`;
      const fill = bg ? `<hc:fillBrush><hc:winBrush faceColor="${bg.toUpperCase()}" hatchColor="#999999" alpha="0"/></hc:fillBrush>` : "";
      this.added.borderFill.push(
        `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
          side("leftBorder", borders[0]) + side("rightBorder", borders[1]) + side("topBorder", borders[2]) + side("bottomBorder", borders[3]) +
          `<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/>${fill}</hh:borderFill>`,
      );
      this.fills.set(key, id);
    }
    return this.fills.get(key)!;
  }
  /** 추가한 서식을 목록 끝에 붙이고 개수를 고친다. */
  build(): string {
    let h = this.header;
    for (const [list, tag] of [["charProperties", "charPr"], ["paraProperties", "paraPr"], ["borderFills", "borderFill"]] as const) {
      const items = this.added[tag];
      if (!items.length) continue;
      h = h.replace(new RegExp(`<hh:${list} itemCnt="(\\d+)">`), (_, n) => `<hh:${list} itemCnt="${+n + items.length}">`)
        .replace(`</hh:${list}>`, items.join("") + `</hh:${list}>`);
    }
    return h;
  }
}
/** 한글이 받는 선 굵기 값(0.1·0.12·0.15·0.2·0.25·0.3·0.4·0.5·0.6·0.7·1.0…mm) 중 가장 가까운 것. */
const WIDTHS = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0];
const mm = (w: number) => String(WIDTHS.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a)));

// ── 본문 쌓기 ────────────────────────────────────────────────────────────
type TableNode = Extract<HwpNode, { kind: "table" }>;
class Writer {
  private seq = 1_950_000_000;
  bookmarks: { label: string; level: 1 | 2; name: string }[] = [];
  images: { id: string; png: Uint8Array }[] = [];
  constructor(private s: Styles, private proto: string[], private scale: number) {}

  private id = () => String(this.seq++);
  private hwp = (px: number) => Math.max(1, Math.round(px * this.scale));

  paragraph(runs: HwpRun[], align: HwpAlign = "JUSTIFY", lineSpacing = 160, keep = false, sizePt?: number): string {
    const body = runs.filter((r) => r.text).map((r) => `<hp:run charPrIDRef="${this.s.char(r)}"><hp:t>${esc(r.text)}</hp:t></hp:run>`).join("")
      || `<hp:run charPrIDRef="${this.s.char({ sizePt })}"/>`;
    return `<hp:p id="0" paraPrIDRef="${this.s.para(align, lineSpacing, keep)}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${body}</hp:p>`;
  }
  /** 표·그림 하나만 든 문단. */
  private holder(obj: string, align: HwpAlign = "LEFT", keep = false, lineSpacing = 160): string {
    return `<hp:p id="0" paraPrIDRef="${this.s.para(align, lineSpacing, keep)}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${this.s.char({})}">${obj}<hp:t/></hp:run></hp:p>`;
  }
  /** 원형 문단의 문단 모양을 "다음 문단과 함께" 사본으로 바꾼다. */
  private keepProto(xml: string): string {
    return xml.replace(/^(<hp:p [^>]*?paraPrIDRef=")(\d+)/, (_, head, id) => head + this.s.keep(id));
  }

  /** 장 배너는 원형대로 새 쪽에서 시작한다(목차 다음 첫 장도). */
  chapter(numeral: string, title: string): string {
    const name = `${this.bookmarks.length + 1}. ${title}`;
    this.bookmarks.push({ label: `${numeral}. ${title}`, level: 1, name });
    return setText(setText(this.proto[PROTO.chapter], 0, numeral), 1, title)
      .replace(/(type="BOOKMARK" name=")[^"]*/, `$1${esc(name)}`);
  }
  sub(number: string, text: string): string {
    const name = `${this.bookmarks.length + 1}-${number}. ${text}`;
    this.bookmarks.push({ label: `${number}. ${text}`, level: 2, name });
    return setText(setText(this.proto[PROTO.sub], 0, number), 1, text).replace(/(type="BOOKMARK" name=")[^"]*/, `$1${esc(name)}`);
  }
  question(text: string, note?: string): string {
    if (!note) return setText(this.proto[PROTO.question], 0, text);
    const [, head = "", rest = text] = text.match(/^(Q\d+\.\s*)?([\s\S]*)$/) ?? [];
    return setText(setText(setText(this.proto[PROTO.questionNote], 0, head), 1, rest), 2, note);
  }

  image(png: Uint8Array, widthPx: number, heightPx: number, maxWidth: number, inline: boolean, keep = false): string {
    const id = `image${this.images.length + 100}`;
    this.images.push({ id, png });
    let w = this.hwp(widthPx);
    let h = this.hwp(heightPx);
    if (w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
    const pic = `<hp:pic id="${this.id()}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${this.id()}" reverse="0">` +
      `<hp:offset x="0" y="0"/><hp:orgSz width="${w}" height="${h}"/><hp:curSz width="${w}" height="${h}"/><hp:flip horizontal="0" vertical="0"/>` +
      `<hp:rotationInfo angle="0" centerX="${w >> 1}" centerY="${h >> 1}" rotateimage="1"/><hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>` +
      `<hc:img binaryItemIDRef="${id}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
      `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${w}" y="0"/><hc:pt2 x="${w}" y="${h}"/><hc:pt3 x="0" y="${h}"/></hp:imgRect>` +
      `<hp:imgClip left="0" right="${w}" top="0" bottom="${h}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/><hp:imgDim dimwidth="${w}" dimheight="${h}"/><hp:effects/>` +
      `<hp:sz width="${w}" widthRelTo="ABSOLUTE" height="${h}" heightRelTo="ABSOLUTE" protect="0"/>` +
      `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
      `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment>그림입니다.</hp:shapeComment></hp:pic>`;
    return inline ? pic : this.holder(pic, "CENTER", keep);
  }

  /**
   * 화면 표를 한글 표로. HTML의 colspan/rowspan을 칸 격자에 놓고, 열 폭은 한 칸짜리 칸의 화면 폭에서 잰다.
   * 높이는 최소값만 준다 — 내용이 길면 한글이 행을 늘린다. `colSpan: 0`은 "표 전체 폭"(제목 행).
   */
  private grid(node: TableNode, maxWidth: number) {
    const rowCnt = node.rows.length;
    const colCnt = Math.max(1, ...node.rows.map((row) => row.reduce((sum, cell) => sum + (cell.colSpan || 0), 0)));
    const rows = node.rows.map((row) => row.map((cell) => (cell.colSpan ? cell : { ...cell, colSpan: colCnt })));
    const grid: boolean[][] = [];
    const placed: { cell: HwpCell; r: number; c: number }[] = [];
    rows.forEach((row, r) => {
      grid[r] ??= [];
      let c = 0;
      for (const cell of row) {
        while (grid[r][c]) c++;
        for (let dr = 0; dr < cell.rowSpan; dr++) for (let dc = 0; dc < cell.colSpan; dc++) (grid[r + dr] ??= [])[c + dc] = true;
        placed.push({ cell, r, c });
        c += cell.colSpan;
      }
    });
    const cnt = Math.max(colCnt, ...placed.map((p) => p.c + p.cell.colSpan));
    // 화면 표는 칸이 빠진 행·표 밖으로 넘친 rowspan도 그대로 그리지만, 한글은 격자가 꽉 차야 연다.
    // 넘친 병합은 표 끝에서 자르고, 빈 자리는 왼쪽 칸을 늘려 덮는다(왼쪽이 없으면 빈 칸).
    for (const p of placed) p.cell = { ...p.cell, rowSpan: Math.min(p.cell.rowSpan, rowCnt - p.r) };
    const filled = Array.from({ length: rowCnt }, () => new Array<boolean>(cnt).fill(false));
    for (const p of placed) for (let dr = 0; dr < p.cell.rowSpan; dr++) for (let dc = 0; dc < p.cell.colSpan; dc++) filled[p.r + dr][p.c + dc] = true;
    for (let r = 0; r < rowCnt; r++) {
      for (let c = 0; c < cnt; c++) {
        if (filled[r][c]) continue;
        const left = placed.find((p) => p.r === r && p.cell.rowSpan === 1 && p.c + p.cell.colSpan === c);
        if (left) left.cell = { ...left.cell, colSpan: left.cell.colSpan + 1 };
        else placed.push({ r, c, cell: { nodes: [], colSpan: 1, rowSpan: 1, widthPx: 0, borders: [null, null, null, null] } });
        filled[r][c] = true;
      }
    }
    // 열 폭: 한 칸짜리 칸의 폭을 우선 쓰고, 여러 칸에 걸친 칸만 있는 열은 남는 폭을 나눠 갖는다.
    const cols = new Array<number>(cnt).fill(0);
    for (const { cell, c } of placed) if (cell.colSpan === 1) cols[c] = Math.max(cols[c], cell.widthPx);
    for (const { cell, c } of placed) {
      if (cell.colSpan === 1) continue;
      const span = cols.slice(c, c + cell.colSpan);
      const missing = span.filter((w) => !w).length;
      const rest = cell.widthPx - span.reduce((a, b) => a + b, 0);
      if (missing && rest > 0) span.forEach((w, i) => { if (!w) cols[c + i] = rest / missing; });
    }
    const known = cols.filter(Boolean);
    const fallback = known.length ? known.reduce((a, b) => a + b, 0) / known.length : node.widthPx / cnt;
    let widths = cols.map((w) => this.hwp(w || fallback));
    const total = widths.reduce((a, b) => a + b, 0);
    if (total > maxWidth) widths = widths.map((w) => Math.floor((w * maxWidth) / total));
    placed.sort((a, b) => a.r - b.r || a.c - b.c);
    return { placed, widths, rowCnt };
  }

  /** 격자의 [from, to) 행을 표 하나로. */
  private renderRows(g: ReturnType<Writer["grid"]>, from: number, to: number, opts: { inline: boolean; pageBreak: "CELL" | "TABLE"; top: number; bottom: number }): string {
    const { widths } = g;
    const rows: string[][] = Array.from({ length: to - from }, () => []);
    for (const { cell: whole, r: start, c } of g.placed) {
      // 병합 칸이 조각 경계에 걸치면 둘로 나눈다 — 뒤 조각에는 글 없이 같은 색 칸으로 이어 그린다(웹뷰와 같다).
      const end = start + whole.rowSpan;
      if (end <= from || start >= to) continue;
      const r = Math.max(start, from);
      const [l, rt, t, b] = whole.borders;
      const cell: HwpCell = {
        ...whole,
        nodes: start < from ? [] : whole.nodes,
        rowSpan: Math.min(end, to) - r,
        borders: [l, rt, start < from ? null : t, end > to ? null : b],
      };
      const width = widths.slice(c, c + cell.colSpan).reduce((a, b) => a + b, 0);
      const [pl, pr, pt, pb] = (cell.padPx ?? [6, 6, 3, 3]).map((v) => Math.min(1400, this.hwp(v)));
      const inner = this.nodes(cell.nodes, Math.max(1000, width - pl - pr), true) || this.paragraph([]);
      rows[r - from].push(
        `<hp:tc name="" header="0" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${this.s.fill(cell.borders, cell.bg)}">` +
          `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${cell.valign ?? "CENTER"}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${inner}</hp:subList>` +
          `<hp:cellAddr colAddr="${c}" rowAddr="${r - from}"/><hp:cellSpan colSpan="${cell.colSpan}" rowSpan="${cell.rowSpan}"/><hp:cellSz width="${width}" height="1000"/>` +
          `<hp:cellMargin left="${pl}" right="${pr}" top="${pt}" bottom="${pb}"/></hp:tc>`,
      );
    }
    const inline = opts.inline;
    return `<hp:tbl id="${this.id()}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="${opts.pageBreak}" repeatHeader="0" rowCnt="${to - from}" colCnt="${widths.length}" cellSpacing="0" borderFillIDRef="${this.s.fill([null, null, null, null])}" noAdjust="0">` +
      `<hp:sz width="${widths.reduce((a, b) => a + b, 0)}" widthRelTo="ABSOLUTE" height="${(to - from) * 1000}" heightRelTo="ABSOLUTE" protect="0"/>` +
      `<hp:pos treatAsChar="${inline ? 1 : 0}" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="${inline ? "PARA" : "COLUMN"}" vertAlign="TOP" horzAlign="${inline ? "LEFT" : "CENTER"}" vertOffset="0" horzOffset="0"/>` +
      `<hp:outMargin left="0" right="0" top="${opts.top}" bottom="${opts.bottom}"/><hp:inMargin left="510" right="510" top="141" bottom="141"/>` +
      rows.map((cells) => `<hp:tr>${cells.join("")}</hp:tr>`).join("") + `</hp:tbl>`;
  }

  /**
   * 표의 쪽 넘김 — **어떤 raw data로 만든 보고서든** 같은 규칙으로 정한다(웹뷰 쪽 묶기와 같은 원칙).
   * - 쪽의 30% 이하인 표는 통째로 둔다(글자처럼 취급 → 남은 자리가 모자라면 다음 쪽으로 같이 간다).
   * - 그보다 큰 표는 **머리 행 + 첫 본문 행(쪽의 25% 이내)** 을 통째 조각으로 떼고, 나머지를
   *   쪽 경계에서 나뉘는 표로 바로 잇는다 — 제목·머리 행만 쪽 끝에 홀로 남는 일이 구조적으로 없다.
   *   병합 칸이 걸친 자리면 그 칸을 둘로 나눠 뒤 조각에 빈 칸으로 잇는다(renderRows).
   * - 한 행짜리 표(그래프 틀 등)는 통째로 둔다.
   * - 나뉘는 표는 행 단위로 넘긴다(셀 단위 나눔). 한 행이 쪽의 45%를 넘을 때만 행 안에서도 나눈다
   *   (웹뷰의 "반 쪽보다 큰 행은 흘린다"와 같다) — 안 그러면 그 행이 통째로 밀려 큰 빈자리가 생긴다.
   * 칸 안의 표는 한글이 쪽 경계에서 나누지 못하므로 늘 통째로 둔다.
   */
  table(node: TableNode, maxWidth: number, nested: boolean, keep = false): string {
    const g = this.grid(node, maxWidth);
    const n = g.rowCnt;
    if (nested) return this.holder(this.renderRows(g, 0, n, { inline: true, pageBreak: "CELL", top: 141, bottom: 141 }), "CENTER");
    const heights = node.rows.map((_, i) => this.hwp(node.rowHeightsPx?.[i] ?? 30));
    const sum = (a: number, b: number) => heights.slice(a, b).reduce((x, y) => x + y, 0);
    const atomic = (from: number, to: number, bottom: number) =>
      this.renderRows(g, from, to, { inline: true, pageBreak: "CELL", top: 141, bottom });
    if (sum(0, n) <= BODY_HEIGHT * 0.3) return this.holder(atomic(0, n, 141), "CENTER", keep);

    const isHead = (r: number) => g.placed.filter((p) => p.r === r).every((p) => p.cell.header || p.cell.colSpan === g.widths.length);
    let k = 0;
    while (k < n && isHead(k)) k++;
    const body = k;
    if (k < n && sum(0, k + 1) <= BODY_HEIGHT * 0.25) k++;
    const pageBreak = heights.some((h) => h > BODY_HEIGHT * 0.45) ? "TABLE" : "CELL";
    const flowing = (from: number, top: number) => this.renderRows(g, from, n, { inline: false, pageBreak, top, bottom: 141 });
    if (k === body || k >= n) {
      // 한 행짜리 표(그래프 틀 등)는 어차피 나눌 자리가 없으니 통째로 둔다 — 앞 제목과도 붙어 다닌다.
      if (n === 1 && pageBreak === "CELL") return this.holder(atomic(0, n, 141), "CENTER", keep);
      return this.holder(flowing(0, 141), "CENTER", keep);
    }
    // 두 조각 사이가 벌어지지 않게 머리 조각 문단은 줄 간격 100%·아래 여백 0으로 둔다.
    return this.holder(atomic(0, k, 0), "CENTER", true, 100) + this.holder(flowing(k, 0), "CENTER");
  }

  /** 다음 것과 같은 쪽에 붙어 있어야 하는가 — 제목 구실을 하는 것들. */
  private static isTitle(n: HwpNode): boolean {
    if (n.kind === "chapter" || n.kind === "sub" || n.kind === "question") return true;
    if (n.kind === "p") {
      const text = n.runs.map((r) => r.text).join("").trim();
      return !!text && text.length <= 60 && n.runs.every((r) => r.bold || !r.text.trim());
    }
    return n.kind === "table" && Writer.titleCell(n) !== null;
  }
  /** 글 한 줄짜리 상자(`[ 응답 결과 ]` 같은 표 제목 띠)면 그 칸. */
  private static titleCell(n: TableNode): HwpCell | null {
    if (n.rows.length !== 1 || n.rows[0].length !== 1) return null;
    const cell = n.rows[0][0];
    const text = cell.nodes.map((c) => (c.kind === "p" ? c.runs.map((r) => r.text).join("") : "\u0000")).join("").trim();
    return text && !text.includes("\u0000") && text.length <= 60 && cell.nodes.length <= 2 ? cell : null;
  }

  /** 위 상자의 아래 테두리나 아래 상자의 위 테두리가 비어 있으면 화면에서 한 상자로 이어 그린 것이다. */
  private static stacks(a: TableNode, b: TableNode): boolean {
    const single = (t: TableNode) => t.rows.every((r) => r.length === 1 && (r[0].colSpan || 1) === 1);
    if (!single(a) || !single(b) || Math.abs(a.widthPx - b.widthPx) > 2) return false;
    return !a.rows[a.rows.length - 1][0].borders[3] || !b.rows[0][0].borders[2];
  }

  nodes(list: HwpNode[], width: number, inCell = false): string {
    const out: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      const next = list[i + 1];
      // 같은 폭의 한 열짜리 상자가 이어지면(화면에서 문단마다 테두리를 그린 상자 — 4대 가치 종합 해석 등)
      // 한 표로 쌓는다. 따로 두면 상자 사이가 벌어지고 쪽 경계에서 문단 단위로 흩어진다.
      if (n.kind === "table" && next?.kind === "table" && Writer.stacks(n, next)) {
        const head = Writer.titleCell(n) ? [{ ...n.rows[0][0], header: true }] : null;
        list = [...list.slice(0, i + 1), {
          ...next,
          rows: [...(head ? [head] : n.rows), ...next.rows],
          rowHeightsPx: [...(n.rowHeightsPx ?? n.rows.map(() => 30)), ...(next.rowHeightsPx ?? next.rows.map(() => 30))],
        }, ...list.slice(i + 2)];
        continue;
      }
      // 표 제목 띠 바로 뒤에 표가 오면 제목을 그 표의 첫 행으로 합친다 — 따로 두면 쪽 끝에 제목만 남는다.
      if (n.kind === "table" && next?.kind === "table" && Writer.titleCell(n) && !Writer.titleCell(next) && next.widthPx >= n.widthPx * 0.8) {
        const title = { ...Writer.titleCell(n)!, colSpan: 0, header: true };
        list = [...list.slice(0, i + 1), { ...next, rows: [[title], ...next.rows], rowHeightsPx: [n.rowHeightsPx?.[0] ?? 30, ...(next.rowHeightsPx ?? next.rows.map(() => 30))] }, ...list.slice(i + 2)];
        continue;
      }
      const keep = !inCell && !!next && Writer.isTitle(n);
      switch (n.kind) {
        case "chapter": out.push(this.keepProto(this.chapter(n.numeral, n.title))); break;
        case "sub": out.push(this.keepProto(this.sub(n.number, n.text))); break;
        case "question": out.push(this.keepProto(this.question(n.text, n.note))); break;
        case "p": out.push(this.paragraph(n.runs, n.align, inCell ? 130 : 160, keep, n.sizePt)); break;
        case "img": out.push(this.image(n.png, n.widthPx, n.heightPx, width, false, keep)); break;
        case "table": out.push(this.table(n, width, inCell, keep)); break;
      }
    }
    return out.join("");
  }
}

/** 목차 표: 원형의 장 줄·절 줄을 복제해 글만 바꾼다. 쪽 번호는 배너 책갈피를 가리키는 상호 참조라 한글이 계산한다. */
function tocTable(proto: string, entries: Writer["bookmarks"]): string {
  const sub = topLevel(proto, "subList")[0];
  const lines = topLevel(sub, "p");
  const chapterLine = lines.find((p) => /paraPrIDRef="125"/.test(p)) ?? lines[0];
  const subLine = lines.find((p) => /paraPrIDRef="130"/.test(p)) ?? lines[1] ?? chapterLine;
  const body = entries.map((e) => {
    const line = (e.level === 1 ? chapterLine : subLine)
      .replace(/(<hp:stringParam name="(?:Command|RefPath)">\?)[^;]*/g, `$1${esc(e.name)}`)
      .replace(/(type="CROSSREF"[^>]*?)dirty="0"/, '$1dirty="1"');
    return setText(line, 0, e.level === 1 ? e.label : ` ${e.label} `);
  }).join("");
  const open = sub.match(/^<hp:subList\b[^>]*>/)![0];
  return proto.replace(sub, open + body + "</hp:subList>");
}

export async function buildPublishedReportHwpx(template: ArrayBuffer | Uint8Array, doc: HwpDoc): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(template);
  const read = (p: string) => zip.file(p)!.async("string");
  const styles = new Styles(await read("Contents/header.xml"));
  const section1 = await read("Contents/section1.xml");
  const proto = topLevel(section1, "p");
  const w = new Writer(styles, proto, doc.pxToHwp);
  const body = w.nodes(doc.nodes, BODY_WIDTH - 600);
  const head = section1.slice(0, section1.indexOf(proto[PROTO.page]));
  zip.file("Contents/section1.xml", head + proto[PROTO.page] + tocTable(proto[PROTO.toc], w.bookmarks) + body + "</hs:sec>");
  zip.file("Contents/header.xml", styles.build());

  const y = String(doc.date.getFullYear());
  const mmdd = `${String(doc.date.getMonth() + 1).padStart(2, "0")}.${String(doc.date.getDate()).padStart(2, "0")}`;
  const fill = (xml: string) => xml.replaceAll("{{YEAR}}", y).replaceAll("{{MMDD}}", mmdd)
    .replaceAll("{{COMPANY}}", esc(doc.company || "기업명")).replaceAll("{{SERVICE}}", esc(doc.service || doc.company || "서비스명"));
  for (const p of ["Contents/section0.xml", "Contents/section2.xml"]) zip.file(p, fill(await read(p)));

  let hpf = await read("Contents/content.hpf");
  const items = w.images.map((i) => `<opf:item id="${i.id}" href="BinData/${i.id}.png" media-type="image/png" isEmbeded="1"/>`).join("");
  hpf = hpf.replace("</opf:manifest>", items + "</opf:manifest>");
  zip.file("Contents/content.hpf", hpf);
  for (const i of w.images) zip.file(`BinData/${i.id}.png`, i.png);

  // mimetype은 압축하지 않은 첫 항목이어야 한글이 연다(plan.ts와 같다).
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/hwp+zip" });
}
