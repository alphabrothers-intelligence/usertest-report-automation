/**
 * `/viewer` 상단 툴바가 이어진 편집기에 실제로 먹는지 — 글을 선택하고 버튼을 눌러 결과 서식을 본다.
 * 저장은 하지 않는다(새로고침하면 원래대로). 과금 없음. 필요: dev 서버, 저장된 리바랩스 보고서, Chrome.
 */
import { openChrome } from "./chromeSession";

const REPORT = process.env.CHECK_REPORT ?? "83e75d8d-a48f-471b-94b6-aa53f2e9b014";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`); if (!ok) failures += 1; };

(async () => {
  const s = await openChrome();
  const ev = async <T>(expression: string): Promise<T> => ((await s.send("Runtime.evaluate", { returnByValue: true, expression })) as { result: { value: T } }).result.value;
  // 문단 하나를 골라 window.__p로 잡고 첫 글자 몇 개를 선택한다.
  const select = `(()=>{const p=[...document.querySelectorAll('[data-chapter="III"] .ProseMirror p:not([data-atom-id] p):not(td p):not(th p)')].find(p=>p.textContent.trim().length>20&&!p.querySelector('strong'));window.__p=p;window.__pt=p.textContent.slice(0,15);p.closest('.ProseMirror').focus();const t=document.createTreeWalker(p,NodeFilter.SHOW_TEXT).nextNode();const r=document.createRange();r.setStart(t,1);r.setEnd(t,6);getSelection().removeAllRanges();getSelection().addRange(r);return p.textContent.slice(0,20)})()`;
  const press = (title: string) => `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.title===${JSON.stringify(title)});b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));b.click();return !!b})()`;
  try {
    // 화면 없는 크롬은 창 포커스가 없어 편집기가 커서 위치를 못 받는다 — 포커스를 흉내 낸다.
    await s.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await s.send("Page.navigate", { url: `http://localhost:3000/viewer?report=${REPORT}` });
    await wait(25000);
    await ev(select); await wait(200);
    await ev(press("굵게")); await wait(300);
    check("굵게", await ev<boolean>(`!!window.__p.querySelector('strong')`));
    await ev(press("되돌리기")); await wait(300);
    check("되돌리기(편집기 기록)", await ev<boolean>(`!window.__p.querySelector('strong')`));
    await ev(press("다시 실행")); await wait(300);
    check("다시 실행", await ev<boolean>(`!!window.__p.querySelector('strong')`));
    await ev(select); await wait(200);
    await ev(press("밑줄")); await wait(300);
    check("밑줄", await ev<boolean>(`!!window.__p.querySelector('u')`));
    await ev(press("가운데 정렬")); await wait(300);
    // 정렬을 바꾸면 편집기가 문단 요소를 새로 만든다 — 같은 글로 다시 찾는다.
    const align = `getComputedStyle([...document.querySelectorAll('[data-chapter="III"] .ProseMirror p:not([data-atom-id] p):not(td p):not(th p)')].find(p=>p.textContent.startsWith(window.__pt))).textAlign`;
    check("가운데 정렬", await ev<string>(align) === "center", await ev<string>(align));
    await ev(select); await wait(200);
    await ev(press("글자 크게")); await wait(300);
    check("글자 크게", await ev<boolean>(`!!window.__p.querySelector('span[style*="font-size"]')`));
    const before = await ev<number>(`document.querySelectorAll('[data-chapter="III"] .ProseMirror p:not([data-atom-id] p):not(td p):not(th p)').length`);
    await ev(press("제언 화살표 문단 추가")); await wait(300);
    check("화살표 문단 추가", (await ev<number>(`document.querySelectorAll('[data-chapter="III"] .ProseMirror p:not([data-atom-id] p):not(td p):not(th p)').length`)) === before + 1);
  } finally {
    s.close();
  }
  console.log(failures === 0 ? "\n전부 PASS" : `\n${failures}건 FAIL`);
  process.exit(failures === 0 ? 0 : 1);
})();
