/**
 * 사용성 테스트 설문 구성 기획안(HWPX) — 설계한 설문과 사전요청서 정보를 알파브라더스 기획안 양식에 채운다.
 *
 * 양식(`templates/survey-plan-template.hwpx`, 케어클 기획안 원본)을 새로 그리지 않고 **원본의 행·문단을 복제해
 * 글자만 바꾼다.** 글꼴·테두리·칸 색은 원본 header.xml의 charPr/paraPr/borderFill을 그대로 가리키므로 양식이 깨질
 * 여지가 없다 — 옛 보고서 HWPX(`lib/hwpx/ReportHwpx.ts`)는 서식을 새로 정의해서 양식이 깨졌다.
 * 문서는 세 구역이다: section0 표지, section1 목차~본문, section2 뒷표지.
 *
 * 템플릿에 케어클 문항이 들어 있어 `public/`에 두지 않는다(배포 사이트에서 누구나 받게 된다). 서버에서만 만든다.
 */
import JSZip from "jszip";
import { isChoice, kstDate, numberQuestions, rankOf, scaleAnchors, splitByProduct, SURVEY_STAGES, type PlanInfo, type SurveyDraft, type SurveyQuestion } from "./types";

// ── XML 조각 ─────────────────────────────────────────────────────────────

type Span = { start: number; end: number };

/** 같은 태그의 중첩을 세어 최상위 `<hp:tag>…</hp:tag>` 구간만 돌려준다(표 안의 표는 바깥 칸에 포함된다). */
export function blocks(xml: string, tag: string): Span[] {
  const re = new RegExp(`<(/?)hp:${tag}(?=[\\s>/])[^>]*?(/?)>`, "g");
  const out: Span[] = [];
  let depth = 0;
  let start = 0;
  for (const m of xml.matchAll(re)) {
    if (m[2]) {
      if (depth === 0) out.push({ start: m.index!, end: m.index! + m[0].length });
    } else if (!m[1]) {
      if (depth++ === 0) start = m.index!;
    } else if (--depth === 0) out.push({ start, end: m.index! + m[0].length });
  }
  return out;
}
const parts = (xml: string, tag: string) => blocks(xml, tag).map((s) => xml.slice(s.start, s.end));
const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textOf = (xml: string) => [...xml.matchAll(/<hp:t>([^<]*)/g)].map((m) => m[1]).join("");

/** 문단에서 글자가 가장 많은 런의 글자 모양 — 첫 런은 "(객관식)" 같은 회색 머리말일 수 있다. */
function mainCharPr(p: string): string {
  const runs = parts(p, "run").map((r) => ({ c: r.match(/charPrIDRef="(\d+)"/)![1], n: textOf(r).trim().length }));
  return runs.sort((a, b) => b.n - a.n)[0]?.c ?? "0";
}

function para(proto: string, runs: [string, string][], pageBreak?: boolean): string {
  let open = proto.match(/^<hp:p\b[^>]*>/)![0];
  if (pageBreak !== undefined) open = open.replace(/pageBreak="\d"/, `pageBreak="${pageBreak ? 1 : 0}"`);
  return open + runs.map(([c, t]) => `<hp:run charPrIDRef="${c}"><hp:t>${esc(t)}</hp:t></hp:run>`).join("") + "</hp:p>";
}

/** 칸의 글을 줄마다 문단 하나로 바꾼다. 문단 모양·글자 모양은 칸의 원래 문단을 따른다. */
function setCell(tc: string, lines: string[], charPr?: string): string {
  const sub = blocks(tc, "subList")[0];
  const inner = tc.slice(sub.start, sub.end);
  const ps = parts(inner, "p");
  const proto = ps.find((p) => textOf(p).trim()) ?? ps[0];
  const c = charPr ?? mainCharPr(proto);
  const body = (lines.length ? lines : [""]).map((l) => para(proto, [[c, l]])).join("");
  return tc.slice(0, sub.start) + inner.match(/^<hp:subList\b[^>]*>/)![0] + body + "</hp:subList>" + tc.slice(sub.end);
}

/** 칸 자신의 주소·병합·크기(중첩 표가 아니라 subList 뒤에 오는 것)를 고친다. */
function cellTail(tc: string, patch: { row?: number; rowSpan?: number; width?: number; height?: number }): string {
  const cut = tc.lastIndexOf("</hp:subList>");
  let tail = tc.slice(cut);
  if (patch.row !== undefined) tail = tail.replace(/rowAddr="\d+"/, `rowAddr="${patch.row}"`);
  if (patch.rowSpan !== undefined) tail = tail.replace(/rowSpan="\d+"/, `rowSpan="${patch.rowSpan}"`);
  if (patch.width !== undefined) tail = tail.replace(/(<hp:cellSz width=")\d+/, `$1${patch.width}`);
  if (patch.height !== undefined) tail = tail.replace(/(<hp:cellSz width="\d+" height=")\d+/, `$1${patch.height}`);
  return tc.slice(0, cut) + tail;
}
const cellHeight = (tc: string) => +tc.slice(tc.lastIndexOf("</hp:subList>")).match(/<hp:cellSz width="\d+" height="(\d+)"/)![1];
const cellWidth = (tc: string) => +tc.slice(tc.lastIndexOf("</hp:subList>")).match(/<hp:cellSz width="(\d+)"/)![1];
const rowSpanOf = (tc: string) => +tc.slice(tc.lastIndexOf("</hp:subList>")).match(/rowSpan="(\d+)"/)![1];

/** 한 줄에 다 안 들어가는 글은 한글이 행을 늘린다. 쪽 번호를 셀 때 그만큼 잡는다(한글 한 자 ≈ 글자 높이 폭). */
function grownHeight(base: number, lines: string[], width: number, charH = 1000): number {
  const perLine = Math.max(8, Math.floor((width - 1400) / charH));
  const n = lines.reduce((sum, l) => sum + Math.max(1, Math.ceil([...l].length / perLine)), 0);
  return Math.max(base, Math.round(900 + n * charH * 1.6));
}

interface Row { cells: string[]; height: number }

/** 행 원형을 복제해 칸 글을 바꾼다. `texts[i]`가 undefined인 칸은 그대로 둔다(척도 칸의 0~10 표 등). */
function row(proto: string[], texts: (string[] | undefined)[], opts: { width?: number } = {}): Row {
  let height = 0;
  const cells = proto.map((tc, i) => {
    let out = texts[i] ? setCell(tc, texts[i]!) : tc;
    if (opts.width && proto.length === 1) out = cellTail(out, { width: opts.width });
    if (rowSpanOf(tc) === 1) height = Math.max(height, texts[i] ? grownHeight(cellHeight(tc), texts[i]!, cellWidth(out)) : cellHeight(tc));
    return out;
  });
  return { cells: cells.map((c) => (rowSpanOf(c) === 1 ? cellTail(c, { height }) : c)), height };
}

/**
 * 표가 든 문단(원형)의 행을 갈아 끼운다. 표 높이·행 수·행 주소를 맞춘다.
 * 본문 표는 한 쪽보다 길어지므로(문항 수만큼 행이 는다) 한글의 `쪽 경계에서 나눔`(pageBreak=TABLE)으로,
 * `글자처럼 취급`은 끈다(treatAsChar=0, 본문과의 배치 = 자리 차지). 원본 양식은 셀 단위로 나눔 + 글자처럼
 * 취급이라 긴 표가 쪽 밑으로 잘려 사라졌다(2026-10-21 담당자). 칸 안에 든 중첩 표는 건드리지 않는다.
 */
function table(container: string, rows: Row[]): { xml: string; height: number } {
  const t = blocks(container, "tbl")[0];
  const tbl = container.slice(t.start, t.end);
  const height = rows.reduce((s, r) => s + r.height, 0);
  const head = tbl.slice(0, tbl.indexOf("<hp:tr>"))
    .replace(/rowCnt="\d+"/, `rowCnt="${rows.length}"`)
    .replace(/pageBreak="\w+"/, 'pageBreak="TABLE"')
    .replace(/textWrap="\w+"/, 'textWrap="TOP_AND_BOTTOM"')
    .replace(/(<hp:pos [^>]*?)treatAsChar="1"/, '$1treatAsChar="0"')
    .replace(/(<hp:sz width="\d+" widthRelTo="\w+" height=")\d+/, `$1${height}`);
  const trs = rows.map((r, i) => `<hp:tr>${r.cells.map((c) => cellTail(c, { row: i })).join("")}</hp:tr>`).join("");
  return { xml: container.slice(0, t.start) + head + trs + "</hp:tbl>" + container.slice(t.end), height: height + 600 };
}

// ── 문항 → 기획안 ─────────────────────────────────────────────────────────

const STAGE_TITLE: Record<string, { toc: string; heading: string; process: string[] }> = {
  "인적 사항 및 특성·경험 조사": { toc: "인적 사항 및 특성 · 경험 조사", heading: "인적 사항 및 특성 · 경험 조사", process: ["인적 사항 및", "특성 · 경험 조사"] },
  "기능별 고객 경험 평가 - 자사 제품 평가": { toc: "기능별 고객경험 평가", heading: "기능별 고객경험 평가 _ 자사 제품 평가", process: ["기능별 고객 경험 평가", "자사 제품 평가"] },
  "기능별 고객 경험 평가 - 타사 제품 평가": { toc: "기능별 고객경험 평가", heading: "기능별 고객경험 평가 _ 타사 제품 평가", process: ["기능별 고객 경험 평가", "타사 제품 평가"] },
  "고객 여정 기반 경험 평가": { toc: "고객 여정 기반 경험 평가", heading: "고객 여정 기반 경험 평가", process: ["고객 여정 기반", "경험 평가"] },
  "핵심구매요인 파악": { toc: "핵심구매요인(KBF) 파악", heading: "핵심구매요인(KBF) 파악", process: ["핵심구매요인 파악"] },
  "가치 만족도 평가": { toc: "4대 가치별 만족도 평가", heading: "4대 가치별 만족도 평가", process: ["가치 만족도 평가"] },
  "구매/추천 의향 조사": { toc: "구매/추천 의향 조사", heading: "구매/추천 의향 조사", process: ["구매/추천 의향 조사"] },
  "종합 만족도": { toc: "종합적 만족도 조사", heading: "종합 만족도 (전반적 만족도)", process: ["종합 만족도"] },
  "개선 아이디어": { toc: "개선아이디어 조사", heading: "개선 아이디어 제안", process: ["개선 아이디어"] },
  "기타 기업 요청사항": { toc: "기타 기업 요청사항", heading: "기타 기업 요청사항", process: ["기타 기업 요청사항"] },
};
/** 원본처럼 새 쪽에서 시작하는 단계. 나머지는 앞 단계에 이어 붙는다. */
const PAGE_BREAK_STAGES = new Set(["기능별 고객 경험 평가 - 자사 제품 평가", "기능별 고객 경험 평가 - 타사 제품 평가", "핵심구매요인 파악", "가치 만족도 평가", "구매/추천 의향 조사"]);

const BODY_HEIGHT = 74166; // A4 84188 − 머리말·꼬리말·위아래 여백(section1 secPr)
const PARA_HEIGHT = 2600;
const isRank = (q: SurveyQuestion) => rankOf(q) !== null;
const PLACEHOLDER = "(입력 필요)";

/** note에서 척도 양 끝 라벨·제품 태그를 뺀 나머지 — 응답자에게 보이는 기능 설명 등. */
const plainNote = (q: SurveyQuestion) =>
  q.note.replace(/0\s*[=:][^,，]+[,，]\s*10\s*[=:][^.\n]+\.?/, "").replace(/^\[[^\]]+\]\s*/, "").trim();

/** 척도 칸의 "나쁨 <----   ---> 좋음" 줄. 라벨이 길어진 만큼 가운데 공백을 줄여 한 줄을 유지한다. */
function anchorLine(low: string, high: string): string {
  const gap = Math.max(4, 28 - Math.max(0, [...low].length + [...high].length - 4) * 2);
  return `${low}   <----------------${" ".repeat(gap)}--------------->   ${high}`;
}

interface Template {
  sections: string[];
  body: string[]; // section1 최상위 문단
  find: (pred: (p: string) => boolean) => string;
  rowsOf: (p: string) => string[][];
}

function loadTemplate(sections: string[]): Template {
  const body = parts(sections[1], "p");
  const find = (pred: (p: string) => boolean) => {
    const p = body.find(pred);
    if (!p) throw new Error("기획안 템플릿에서 필요한 표를 찾지 못했습니다. 템플릿 파일이 바뀌었는지 확인하세요.");
    return p;
  };
  const rowsOf = (p: string) => {
    const t = blocks(p, "tbl")[0];
    return parts(p.slice(t.start, t.end), "tr").map((tr) => parts(tr, "tc"));
  };
  return { sections, body, find, rowsOf };
}

export async function buildSurveyPlanHwpx(templateBytes: ArrayBuffer | Uint8Array, draft: SurveyDraft, info: PlanInfo, today = new Date()): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(templateBytes);
  const names = ["Contents/section0.xml", "Contents/section1.xml", "Contents/section2.xml"];
  const sections = await Promise.all(names.map((n) => zip.file(n)!.async("string")));
  const tpl = loadTemplate(sections);
  const { find, rowsOf } = tpl;

  // 원형 — 표마다 고유한 글로 찾는다.
  const has = (s: string) => (p: string) => p.includes(s);
  const targetP = find(has("핵심 비즈니스 영역"));
  const processP = find(has("주요 평가 항목"));
  const totalRow = rowsOf(find((p) => /총 \d+ 문항/.test(p) && p.includes("<hp:tbl"))).at(-1)!;
  const personaP = find(has("사용자의 인적 사항 및 특성"));
  const featureP = find(has("제품의 사용단계별"));
  const journeyP = find((p) => p.includes("<hp:tbl") && p.includes("객관식") && p.includes("주기로"));
  const kbfP = find(has("고객의 우선순위 파악"));
  const ideaP = find(has("특별히 제안할"));
  const headingP = find((p) => !p.includes("<hp:tbl") && textOf(p).trim() === "3) 고객 여정 기반 경험 평가");
  const spacerP = tpl.body[3];
  const bannerIndex = tpl.body.findIndex((p) => textOf(p).includes("2. 사용성 테스트 설문 구성"));
  const scheduleP = find(has("일  시"));
  const managerP = find(has("담당자 :"));

  const journey = rowsOf(journeyP);
  const feature = rowsOf(featureP);
  const W = cellWidth(journey[0][0]); // 2열 표 폭
  const R = {
    head: journey[0], choice: journey[1], scale: journey[5], reason: journey[6],
    note: feature[2], banner: feature[0], answer: rowsOf(ideaP)[1],
  };

  // 문항 묶기. 응답자가 제품별로 갈리는 설문(피매치 일반인용·기관용)은 제품마다 그 응답자가 실제로 받는 설문으로
  // 나눠(`splitByProduct` — 공통 문항 포함, 번호는 제품마다 Q1부터) 진행 프로세스 표와 Ⅱ장을 제품마다 따로 싣는다.
  // 단계마다 두 제품을 번갈아 실었더니 한 제품의 설문을 끝까지 따라 읽을 수 없었다(2026-10-20 담당자).
  type Group = { stage: string; qs: SurveyQuestion[] };
  interface Unit { product: string; questions: SurveyQuestion[]; numbers: Map<string, string>; byId: Map<string, SurveyQuestion>; groups: Group[] }
  const toUnit = (product: string, questions: SurveyQuestion[]): Unit => {
    const groups: Group[] = SURVEY_STAGES.map((stage) => ({ stage: stage as string, qs: questions.filter((q) => q.stage === stage) })).filter((g) => g.qs.length);
    // 옛 저장본의 '타사 제품 평가' 단계 등 표준 밖 단계도 버리지 않는다.
    const known = new Set<string>(SURVEY_STAGES);
    const extra = questions.filter((q) => !known.has(q.stage));
    if (extra.length) groups.push({ stage: "기타 기업 요청사항", qs: extra });
    return { product, questions, numbers: numberQuestions(questions), byId: new Map(questions.map((q) => [q.id, q])), groups };
  };
  const split = splitByProduct(draft);
  const units = split ? split.map((d) => toUnit(d.productName, d.questions)) : [toUnit("", draft.questions)];
  const multi = units.length > 1;
  const branchNote = (u: Unit, q: SurveyQuestion) =>
    q.branchOn && u.byId.has(q.branchOn) ? ` (${u.numbers.get(q.branchOn)} '${q.branchValue}' 응답 시)` : "";
  /** 순위 묶음은 한 줄로 보인다 — 첫 질문 문장 + 순위 범위. 옛 저장본("1위")은 이름만 붙인다. */
  const rankText = (qs: SurveyQuestion[]) => {
    const n = qs.filter(isRank).length;
    const first = qs.find((q) => rankOf(q) === 1)?.text.trim() ?? "";
    return /\(1순위\)$/.test(first) ? first.replace(/\(1순위\)$/, `(1~${n}순위)`) : `기능 중요도 순위 (1위~${n}위)`;
  };
  const heading = (text: string, pb?: boolean) => para(headingP, [[mainCharPr(headingP), text]], pb);

  // ── 1) 대상 표, 2) 일정
  const targetRows = rowsOf(targetP);
  const value = (v: string) => v.trim() || PLACEHOLDER;
  const target = table(targetP, [
    [draft.companyName], [draft.productName], [value(info.businessArea)], [value(info.testers)],
  ].map((v, i) => row(targetRows[i], [undefined, v])));
  const blue = "118"; // 원본이 채울 자리(00일)를 표시한 파란 글자
  const labelChar = mainCharPr(scheduleP);
  const line = (proto: string, label: string, v: string) => para(proto, [[labelChar, label], [v.trim() ? labelChar : blue, value(v)]]);

  // ── 3) 진행 프로세스 표 — 제품마다 하나
  const process = rowsOf(processP);
  const processParts: { xml: string; height: number }[] = [];
  units.forEach((u, i) => {
    const rows: Row[] = [row(process[0], [undefined, undefined])];
    for (const g of u.groups) {
      const shown = g.qs.filter((q) => !isRank(q) || rankOf(q) === 1);
      const label = STAGE_TITLE[g.stage]?.process ?? [g.stage];
      const rs = shown.map((q, j) => {
        const text = isRank(q) ? rankText(g.qs) : q.text + branchNote(u, q);
        return j === 0
          ? row(process[1], [label, [u.numbers.get(q.id)!], [text]])
          : row(process[2], [[u.numbers.get(q.id)!], [text]]);
      });
      const span = rs.reduce((s, r) => s + r.height, 0);
      rs[0].cells[0] = cellTail(rs[0].cells[0], { rowSpan: rs.length, height: span });
      rows.push(...rs);
    }
    rows.push(row(totalRow, [[`총 ${u.questions.length} 문항`]]));
    if (multi) processParts.push(...(i ? [{ xml: spacerP, height: 1600 }] : []), { xml: heading(`■ ${u.product}`), height: PARA_HEIGHT });
    processParts.push(table(processP, rows));
  });

  // ── 2. 설문 구성 — 단계별 상세. 제품이 하나면 목차 한 칸 = 단계 장 하나(자사·타사 제품 평가는 원본처럼 한 장 안의
  // 2-1)·2-2)), 제품이 둘 이상이면 목차 한 칸 = 제품 하나("1. 일반인용 필톡 설문" 안에 1-1) 인적 사항 …).
  const out: { xml: string; height: number; pageBreak?: boolean; tocStage?: string }[] = [];
  const chapters: string[] = [];
  const pushGroup = (u: Unit, g: Group, label: string | null, tocStage?: string) => {
    if (label !== null) {
      const pb = PAGE_BREAK_STAGES.has(g.stage);
      out.push({ xml: heading(`${label} ${STAGE_TITLE[g.stage]?.heading ?? g.stage}`, pb), height: PARA_HEIGHT, pageBreak: pb, tocStage });
    } else out.push({ xml: spacerP, height: 1600 });
    const tables = g.stage === SURVEY_STAGES[0] ? personaTables(u, g) : g.stage === "핵심구매요인 파악" ? kbfTables(u, g) : [genericTable(u, g)];
    tables.forEach((t, i) => out.push(...(i ? [{ xml: spacerP, height: 1600 }] : []), t));
  };
  if (multi) {
    units.forEach((u, i) => {
      const chapter = `${u.product} 설문`;
      chapters.push(chapter);
      // 첫 제품은 "2. 사용성 테스트 설문 구성" 띠와 같은 쪽에서 시작한다(띠가 이미 새 쪽이다).
      out.push({ xml: heading(`${i + 1}. ${chapter}`, i > 0), height: PARA_HEIGHT, pageBreak: i > 0, tocStage: chapter });
      u.groups.forEach((g, k) => pushGroup(u, g, `${i + 1}-${k + 1})`));
    });
  } else {
    const [u] = units;
    const chapterOf = (stage: string) => STAGE_TITLE[stage]?.toc ?? stage;
    chapters.push(...new Set(u.groups.map((g) => chapterOf(g.stage))));
    const stagesIn = (chapter: string) => [...new Set(u.groups.filter((g) => chapterOf(g.stage) === chapter).map((g) => g.stage))];
    const headed = new Set<string>(); // 제목을 이미 단 장
    for (const g of u.groups) {
      const chapter = chapterOf(g.stage);
      const n = chapters.indexOf(chapter) + 1;
      const siblings = stagesIn(chapter);
      const first = !headed.has(chapter);
      headed.add(chapter);
      pushGroup(u, g, siblings.length > 1 ? `${n}-${siblings.indexOf(g.stage) + 1})` : `${n})`, first ? chapter : undefined);
    }
  }

  function personaTables(u: Unit, g: Group) {
    const P = rowsOf(personaP);
    const rows: Row[] = [row(P[0], [undefined])];
    for (const q of g.qs) {
      const no = [u.numbers.get(q.id)!];
      const text = q.text + branchNote(u, q);
      if (isChoice(q.type)) rows.push(row(P[3], [no, [`(객관식${q.type === "객관식-복수" ? "·복수" : ""}) ${text}`], undefined, q.options.map((o, i) => `${circled(i)} ${o}`)]));
      else if (q.type === "척도(0-10)") rows.push(row(P[1], [no, [`(척도 0~10) ${text}`, scaleAnchors(q.note).map((a, i) => `${i ? 10 : 0}=${a}`).join(", ")]]));
      else rows.push(row(P[1], [no, [`(주관식) ${text}`, ...(plainNote(q) ? [plainNote(q)] : [])]]));
    }
    return [table(personaP, rows)];
  }

  function kbfTables(u: Unit, g: Group) {
    const main = g.qs.find((q) => isChoice(q.type));
    if (!main) return [genericTable(u, g)];
    const K = rowsOf(kbfP);
    const items = main.options.map((o, i) => row(K[3], [[String(i + 1)], [o], undefined]));
    const header = row(K[2], [undefined, undefined, undefined, undefined]);
    header.cells[0] = cellTail(header.cells[0], { rowSpan: items.length + 1, height: header.height + items.reduce((s, r) => s + r.height, 0) });
    const kbf = table(kbfP, [
      row(K[0], [undefined]),
      row(K[1], [[`${u.numbers.get(main.id)}. ${main.text}${branchNote(u, main)}`]]),
      header, ...items,
    ]);
    const rest = g.qs.filter((q) => q !== main);
    return rest.length ? [kbf, genericTable(u, { ...g, qs: rest })] : [kbf];
  }

  function genericTable(u: Unit, g: Group) {
    const rows: Row[] = [];
    if (g.stage === "기능별 고객 경험 평가 - 자사 제품 평가") rows.push(row(R.banner, [undefined], { width: W }));
    for (const q of g.qs) {
      if (isRank(q) && rankOf(q) !== 1) continue;
      const no = u.numbers.get(q.id)!;
      const note = plainNote(q);
      if (q.followUp && q.type === "주관식" && !isRank(q)) {
        rows.push(row(R.reason, [["주관식"], [`${no}. ${q.text}${branchNote(u, q)}`, ...(note ? [note] : [])]]));
        continue;
      }
      rows.push(row(R.head, [[`${no}. ${isRank(q) ? rankText(g.qs) : q.text}${branchNote(u, q)}`]]));
      if (note) rows.push(row(R.note, [[note]], { width: W }));
      if (q.type === "척도(0-10)") {
        const [low, high] = scaleAnchors(q.note);
        const r = row(R.scale, [[/만족/.test(q.text) ? "만족도" : "척도"], undefined]);
        r.cells[1] = r.cells[1].replace(/(<hp:t>)[^<]*&lt;-{4,}[^<]*(<\/hp:t>)/, `$1${esc(anchorLine(low, high))}$2`);
        rows.push(r);
      } else if (isChoice(q.type)) {
        rows.push(row(R.choice, [[q.type === "객관식-복수" ? "복수 선택" : "객관식"], q.options.map((o, i) => `${circled(i)} ${o}`)]));
      } else {
        rows.push(row(R.answer, [["답변"], [q.type === "이미지업로드" ? "(이미지 업로드)" : q.type === "날짜" ? "(날짜 선택)" : ""]]));
      }
    }
    return table(journeyP, rows);
  }

  // ── 쪽 번호(목차) — 표 행 높이를 더해 어림한다. 한글이 실제로 그린 쪽과 다를 수 있다.
  let page = 3;
  let pos = 0;
  const advance = (h: number) => {
    pos += h;
    while (pos > BODY_HEIGHT) { page += 1; pos -= BODY_HEIGHT; }
  };
  [PARA_HEIGHT, target.height, 1600, PARA_HEIGHT, 1800, 1800, 1600, PARA_HEIGHT, ...processParts.map((p) => p.height)].forEach(advance);
  page += 1; pos = 0; advance(4000); // "2. 사용성 테스트 설문 구성" 띠는 새 쪽에서 시작한다
  const surveyPage = page;
  const tocPages = new Map<string, number>();
  for (const o of out) {
    if (o.pageBreak) { page += 1; pos = 0; } else if (o.tocStage && pos + o.height + 6000 > BODY_HEIGHT) { page += 1; pos = 0; }
    if (o.tocStage) tocPages.set(o.tocStage, page);
    advance(o.height);
  }

  // ── section1 다시 조립: 목차·개요(앞부분) + 새 진행 프로세스 + 설문 구성 띠 + 단계별 상세. 원본의 나머지(케어클 문항)는 버린다.
  const [first, ...intro] = tpl.body.slice(0, tpl.body.indexOf(processP));
  const newIntro = intro.map((p) => (p === targetP ? target.xml : p === scheduleP ? line(scheduleP, "일  시 : ", info.schedule) : p === managerP ? line(managerP, "담당자 : ", info.managers) : p));
  const toc = rewriteToc(first, chapters.map((c) => [c, tocPages.get(c) ?? surveyPage]), surveyPage);
  const sec1 = sections[1];
  const bodySpan = blocks(sec1, "p");
  const { year, month, day } = kstDate(today);
  let section1 = sec1.slice(0, bodySpan[0].start)
    + [toc, ...newIntro, ...processParts.map((p) => p.xml), tpl.body[bannerIndex], ...out.map((o) => o.xml)].join("")
    + sec1.slice(bodySpan.at(-1)!.end);
  section1 = section1.replace(/\d{4}( by Alphabrothers)/g, `${year}$1`);

  // 표지·뒷표지
  const date = `${year}.${month}.${day}`;
  const section0 = sections[0]
    .replace(/(<hp:t>발주처 l )[^<]*(<\/hp:t>)/, `$1${esc(value(info.client ?? ""))}$2`)
    .replace(/<hp:t>케어클<\/hp:t>/, `<hp:t>${esc(draft.companyName)}</hp:t>`)
    .replace(/(Usablity Test Report for ‘)[^’<]*(’)/, `$1${esc(draft.productName)}$2`)
    .replace(/<hp:t>\d{4}\.\d{2}\.\d{2}<\/hp:t>/, `<hp:t>${date}</hp:t>`);
  const section2 = sections[2].replace(/Copyright \d{4}/, `Copyright ${year}`);

  // 복제한 표의 id가 겹치지 않게 다시 매기고, 글이 바뀐 문단의 줄 배치 캐시는 지운다(한글이 열 때 다시 계산한다).
  let id = 1_900_000_000;
  const finish = (xml: string) => xml
    .replace(/(<hp:tbl id=")\d+/g, (_, a) => `${a}${id++}`)
    .replace(/<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g, "");
  zip.file(names[0], finish(section0));
  zip.file(names[1], finish(section1));
  zip.file(names[2], finish(section2));
  // 템플릿이 저장될 때의 커서(본문 중간)에서 열리지 않게 문서 처음으로 돌린다.
  const settings = await zip.file("settings.xml")!.async("string");
  zip.file("settings.xml", settings.replace(/<ha:CaretPosition [^>]*\/>/, '<ha:CaretPosition listIDRef="0" paraIDRef="0" pos="0"/>'));
  zip.file("Preview/PrvText.txt", `사용성 테스트 설문 구성 기획안 ${draft.companyName} ${draft.productName}`);
  zip.remove("Preview/PrvImage.png"); // 템플릿(케어클) 표지 썸네일이 남지 않게
  // mimetype은 압축하지 않은 첫 항목이어야 한글이 연다.
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/hwp+zip" });
}

const circled = (i: number) => "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"[i] ?? `(${i + 1})`;

/** 목차 Ⅱ 아래 항목을 이 설문에 있는 단계로 다시 쓴다. Ⅰ(개요)은 항상 3쪽이라 그대로 둔다. */
function rewriteToc(first: string, entries: [string, number][], surveyPage: number): string {
  const subIdx = blocks(first, "subList").find((s) => first.slice(s.start, s.end).includes("Ⅱ. 사용성 테스트 설문 구성"))!;
  const sub = first.slice(subIdx.start, subIdx.end);
  const ps = parts(sub, "p");
  const two = ps.findIndex((p) => textOf(p).includes("Ⅱ."));
  const items = ps.slice(two + 1);
  const proto = items.find((p) => /^\s*1\./.test(textOf(p)))!;
  const tab = proto.match(/<hp:tab [^>]*\/>/)![0];
  const [nameC, pageC] = parts(proto, "run").map((r) => r.match(/charPrIDRef="(\d+)"/)![1]);
  const open = proto.match(/^<hp:p\b[^>]*>/)![0];
  const lines = entries.map(([name, page], i) =>
    `${open}<hp:run charPrIDRef="${nameC}"><hp:t> ${i + 1}. ${esc(name)} </hp:t></hp:run><hp:run charPrIDRef="${pageC}"><hp:t>${tab}  ${page}</hp:t></hp:run></hp:p>`);
  const blank = items.find((p) => !textOf(p).trim()) ?? "";
  // 목차 칸의 줄 수를 원본과 맞춰 아래 장식 위치가 밀리지 않게 한다.
  const pad = Array.from({ length: Math.max(0, items.length - 1 - lines.length) }, () => blank);
  const twoPara = ps[two].replace(/(<hp:t>)\d+(<\/hp:t>)(?![\s\S]*<hp:t>\d)/, `$1${surveyPage}$2`);
  const newSub = sub.slice(0, sub.indexOf(ps[0])) + [...ps.slice(0, two), twoPara, blank, ...lines, ...pad].join("") + "</hp:subList>";
  return first.slice(0, subIdx.start) + newSub + first.slice(subIdx.end);
}
