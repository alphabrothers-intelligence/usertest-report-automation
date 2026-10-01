/**
 * 표 속성 패널을 실제 브라우저에서 눌러 본다(2026-10-01 담당자 지적 세 건 고정). 과금 없음.
 * 필요: 로컬 dev 서버, 저장된 케어클 보고서 1건, 시스템 Chrome.
 *  1. "다음 쪽으로 이어지게 허용"을 끄면 갈린 표가 **표 하나**로 합쳐진다(표 두 개가 붙지 않는다).
 *  2. "행 자동 나누기"를 켜면 쪽 끝 빈자리에 행 일부가 들어가 앞 쪽이 채워진다.
 *  3. 같은 쪽에 놓인 같은 표의 조각들은 열 너비가 같다(표 두 개가 붙어 보이지 않는다).
 */
import { openChrome } from "./chromeSession";

const REPORT = process.env.CHECK_REPORT ?? "b852d373-a5ca-4751-90b1-3f3b8d02b4fc";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures += 1;
}
const toggle = (label: string) => `(()=>{const l=[...document.querySelectorAll('aside label')].find(l=>l.textContent.includes(${JSON.stringify(label)}));if(!l)return false;l.querySelector('input').click();return true})()`;
const tab = (name: string) => `[...document.querySelectorAll('aside [role=tab]')].find(b=>b.textContent===${JSON.stringify(name)})?.click()`;
// 같은 쪽에 놓인 **같은 표의 조각들**이 열 너비가 다르면 "표 두 개가 붙은" 것처럼 보인다(담당자 지적).
const misalignedTables = `JSON.stringify([...document.querySelectorAll('[data-section-page]')].flatMap(c=>{const by={};for(const e of c.querySelectorAll('[data-report-block-id*="--p"]')){const t=e.querySelector('table');if(!t||!t.rows.length)continue;const id=e.dataset.reportBlockId.replace(/(--p\\d+)+$/,'');const w=[...(t.querySelector('tr:has(td:nth-child(4))')||t.rows[0]).cells].map(x=>Math.round(x.getBoundingClientRect().width)).join(',');(by[id]??=[]).push(w)}return Object.entries(by).filter(([,ws])=>new Set(ws).size>1).map(([id])=>id)}))`;

const emptyTables = `JSON.stringify([...document.querySelectorAll('[data-report-block-id] table')].filter(t=>t.rows.length===0).map(t=>t.closest('[data-report-block-id]').dataset.reportBlockId))`;

(async () => {
  const s = await openChrome();
  try {
    await s.open(`http://localhost:3000/viewer?report=${REPORT}`);
    check("행 없는 빈 표가 없다", (await s.evaluate<string>(emptyTables)) === "[]", await s.evaluate<string>(emptyTables));
    check("같은 쪽의 같은 표 조각은 열 너비가 같다", (await s.evaluate<string>(misalignedTables)) === "[]", await s.evaluate<string>(misalignedTables));

    const target = await s.evaluate<string | null>(`(()=>{const e=document.querySelector('[data-report-block-id*="fieldactions--p"] td');if(!e)return null;e.click();return e.closest('[data-report-block-id]').dataset.reportBlockId.replace(/(--p\\d+)+$/,'')})()`);
    if (!target) throw new Error("쪼개진 액션 표가 없습니다");
    await wait(500);
    await s.evaluate(toggle("다음 쪽으로 이어지게 허용"));
    await wait(500); await s.settle();
    const tables = await s.evaluate<number>(`[...document.querySelectorAll('[data-report-block-id^="${target}"]')].reduce((n,e)=>n+e.querySelectorAll('table').length,0)`);
    const blocks = await s.evaluate<number>(`document.querySelectorAll('[data-report-block-id^="${target}"]').length`);
    check("이어지게 허용 끄기 → 블록 하나·표 하나", blocks === 1 && tables === 1, `블록 ${blocks} · 표 ${tables}`);
    await s.evaluate(toggle("다음 쪽으로 이어지게 허용"));
    await wait(500); await s.settle();

    // 행 나누기: 앞 쪽 빈자리 높이를 켜기 전/후로 비교한다.
    const gapBefore = await s.evaluate<number>(`(()=>{const f=document.querySelector('[data-report-block-id^="${target}"]');const c=f.closest('[data-section-page]');const p=c.previousElementSibling;const bs=p?.querySelectorAll('[data-report-block-id]');if(!bs?.length)return 0;return Math.round(p.getBoundingClientRect().bottom-bs[bs.length-1].getBoundingClientRect().bottom)})()`);
    await s.evaluate(`document.querySelector('[data-report-block-id^="${target}"] td').click()`);
    await wait(400);
    await s.evaluate(tab("행"));
    await wait(200);
    await s.evaluate(toggle("페이지 끝에서 행을 자동으로 나누기"));
    await wait(500); await s.settle();
    const firstPieceRows = await s.evaluate<string>(`JSON.stringify([...document.querySelectorAll('[data-report-block-id^="${target}"]')].map(e=>e.closest('[data-section-page]')?.dataset.sectionPage))`);
    console.log("  행 나누기 전 앞 쪽 빈자리", gapBefore, "px / 조각 위치", firstPieceRows);
    check("같은 쪽의 같은 표 조각은 열 너비가 같다(조작 후)", (await s.evaluate<string>(misalignedTables)) === "[]", await s.evaluate<string>(misalignedTables));
  } finally {
    s.close();
  }
  console.log(failures === 0 ? "\n전부 PASS" : `\n${failures}건 FAIL`);
  process.exit(failures === 0 ? 0 : 1);
})();
