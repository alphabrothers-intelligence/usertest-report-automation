/**
 * 이어진 편집기의 **표 쪽 넘김** 검사 — 실제 브라우저, 과금 없음(2026-10-06 담당자 지적).
 * 필요: 로컬 dev 서버, 저장된 리바랩스 보고서, 시스템 Chrome.
 *  1. 쪽 경계가 병합 셀(설문 항목 표의 "단계" 칸) 한가운데 떨어져도 칸이 밀리지 않는다 —
 *     문항 번호(Q..)는 모든 행에서 같은 열에 있다.
 *  2. 표 속성 "이 표 앞에서 쪽 나누기"를 켜면 표가 새 쪽 맨 위에서 시작한다.
 *  3. "다음 쪽으로 이어지게 허용"을 끄면 표 안에 쪽 간격이 하나도 없다(통째로 둔다).
 * 쪽 배치 값은 패널과 같은 경로(편집기 트랜잭션)로 넣는다.
 */
import { openChrome } from "./chromeSession";

const REPORT = process.env.CHECK_REPORT ?? "83e75d8d-a48f-471b-94b6-aa53f2e9b014";
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
const PAGE_OFFSET = `(()=>{const host=document.querySelector('[data-chapter="I"]').getBoundingClientRect().top;const y=${TABLE}.getBoundingClientRect().top-host-18*${MM};return Math.round(y-Math.floor((y+2)/${STRIDE})*${STRIDE})})()`;

(async () => {
  const s = await openChrome();
  try {
    await s.open(`http://localhost:3000/viewer?report=${REPORT}`);
    await wait(3000);

    await s.evaluate(setFlags({}));
    await wait(1500);
    const lefts = await s.evaluate<number[]>(Q_LEFTS);
    const gaps = await s.evaluate<number>(GAP_ROWS);
    check("자동 배치: 표가 쪽을 넘긴다(검사 전제)", gaps > 0, `간격 행 ${gaps}`);
    check("자동 배치: 문항 번호가 모든 행에서 같은 열", lefts.length === 1, `열 위치 ${lefts.join(", ")}`);

    await s.evaluate(setFlags({ pageBreakBefore: [BLOCK] }));
    await wait(1500);
    const offset = await s.evaluate<number>(PAGE_OFFSET);
    check("앞에서 쪽 나누기: 표가 새 쪽 맨 위에서 시작", Math.abs(offset) < 4, `쪽 위에서 ${offset}px`);

    await s.evaluate(setFlags({ keepTogether: [BLOCK] }));
    await wait(1500);
    check("이어지게 허용 끔: 표 안에 쪽 간격이 없다", (await s.evaluate<number>(GAP_ROWS)) === 0);
  } finally {
    s.close();
  }
  console.log(failures ? `\n${failures}건 실패` : "\n전부 통과");
  process.exit(failures ? 1 : 0);
})();
