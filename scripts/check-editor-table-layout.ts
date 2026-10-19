/**
 * 이어진 편집기의 **표 쪽 넘김** 검사 — 실제 브라우저, 과금 없음(2026-10-06 담당자 지적).
 * 필요: 로컬 dev 서버, 저장된 리바랩스 보고서, 시스템 Chrome.
 *  1. 쪽 경계가 병합 셀(설문 항목 표의 "단계" 칸) 한가운데 떨어져도 칸이 밀리지 않는다 —
 *     문항 번호(Q..)는 모든 행에서 같은 열에 있다.
 *  2. 표 속성 "이 표 앞에서 쪽 나누기"를 켜면 **바로 앞 소제목과 함께** 새 쪽 맨 위에서 시작한다
 *     (표만 넘기면 소제목이 앞 쪽에 홀로 남았다 — 2026-10-19 담당자 지적).
 *  3. "다음 쪽으로 이어지게 허용"을 꺼도 한 쪽보다 긴 표는 쪽 경계에서 나뉘고, 쪽 사이 여백에 숨는 행이 없다
 *     (Word와 같다. 통째로 두었더니 Q27~Q31이 가림막 밑으로 사라졌다 — 2026-10-19).
 * 쪽 배치 값은 패널과 같은 경로(편집기 트랜잭션)로 넣는다.
 */
import { openChrome } from "./chromeSession";

const REPORT = process.env.CHECK_REPORT ?? "83e75d8d-a48f-471b-94b6-aa53f2e9b014";
// 3000번에 다른 앱이 떠 있으면 검사가 그 앱에 붙어 영영 기다렸다(2026-10-19) — 주소를 바꿀 수 있게 한다.
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const MM = 96 / 25.4;
const STRIDE = 297 * MM + 40;
const BLOCK = "overview-survey";
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures += 1;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TABLE = `document.querySelector('[data-chapter="I"] [data-report-block-id="${BLOCK}"] table')`;
const setFlags = (flags: Record<string, string[]>) =>
  `(()=>{const ed=document.querySelector('[data-chapter="I"] .ProseMirror').editor;ed.view.dispatch(ed.state.tr.setMeta("paginationLayoutFlags",${JSON.stringify({ pageBreakBefore: [], keepTogether: [], keepWithNext: [], rowBreak: [], ...flags })}));return true})()`;
// 문항 번호 칸(Q숫자)의 왼쪽 위치 모음 — 칸이 밀리면 값이 두 개 이상이 된다.
const Q_LEFTS = `[...new Set([...${TABLE}.querySelectorAll('tr:not([data-page-gap])')].flatMap(tr=>[...tr.children].filter(td=>/^Q\\d+$/.test(td.textContent.trim())).map(td=>Math.round(td.getBoundingClientRect().left))))]`;
const GAP_ROWS = `${TABLE}.querySelectorAll('tr[data-page-gap]').length`;
const offsetOf = (el: string) => `(()=>{const host=document.querySelector('[data-chapter="I"]').getBoundingClientRect().top;const y=${el}.getBoundingClientRect().top-host-18*${MM};return Math.round(y-Math.floor((y+2)/${STRIDE})*${STRIDE})+0})()`; // +0: CDP는 -0을 값으로 못 넘겨 undefined가 된다
// 소제목 그림(reportAtom)은 블록 id 속성을 DOM에 싣지 않아 글로 찾는다.
const HEADING = `[...document.querySelectorAll('[data-chapter="I"] .ProseMirror > *')].find(e=>/사용성 테스트 설문 항목/.test(e.textContent)&&!e.querySelector('table'))`;
// 쪽 본문(297mm − 위 18mm − 아래 26mm) 밖으로 나간 표 행 수 — 쪽 사이 가림막 밑에 숨은 행.
const HIDDEN_ROWS = `(()=>{const host=document.querySelector('[data-chapter="I"]').getBoundingClientRect().top;const content=(297-18-26)*${MM};return [...${TABLE}.querySelectorAll('tr:not([data-page-gap])')].filter(tr=>{const r=tr.getBoundingClientRect();const y=r.top-host-18*${MM};const off=y-Math.floor((y+2)/${STRIDE})*${STRIDE};return off+r.height>content+2}).length})()`;

(async () => {
  const s = await openChrome();
  try {
    await s.open(`${BASE}/viewer?report=${REPORT}`);
    await wait(3000);

    await s.evaluate(setFlags({}));
    await wait(1500);
    const lefts = await s.evaluate<number[]>(Q_LEFTS);
    const gaps = await s.evaluate<number>(GAP_ROWS);
    check("자동 배치: 표가 쪽을 넘긴다(검사 전제)", gaps > 0, `간격 행 ${gaps}`);
    check("자동 배치: 문항 번호가 모든 행에서 같은 열", lefts.length === 1, `열 위치 ${lefts.join(", ")}`);

    await s.evaluate(setFlags({ pageBreakBefore: [BLOCK] }));
    await wait(1500);
    const offset = await s.evaluate<number>(offsetOf(HEADING));
    check("앞에서 쪽 나누기: 소제목과 표가 함께 새 쪽 맨 위에서 시작", Math.abs(offset) < 4, `소제목이 쪽 위에서 ${offset}px`);

    await s.evaluate(setFlags({ pageBreakBefore: [BLOCK], keepTogether: [BLOCK], rowBreak: [BLOCK] }));
    await wait(1500);
    check("이어지게 허용 끔 + 한 쪽보다 긴 표: 쪽 경계에서 나뉜다", (await s.evaluate<number>(GAP_ROWS)) > 0);
    const hidden = await s.evaluate<number>(HIDDEN_ROWS);
    check("이어지게 허용 끔: 쪽 사이 여백에 숨은 행이 없다", hidden === 0, `${hidden}행이 쪽 본문 밖`);
  } finally {
    s.close();
  }
  console.log(failures ? `\n${failures}건 실패` : "\n전부 통과");
  process.exit(failures ? 1 : 0);
})();
