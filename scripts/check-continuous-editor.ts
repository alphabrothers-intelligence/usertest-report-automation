/**
 * A안 시제품(이어진 편집기) 동작 검사 — 실제 브라우저에서 키를 눌러 본다. 과금 없음.
 * 필요: 로컬 dev 서버, 저장된 리바랩스 보고서, 시스템 Chrome.
 *  1. 쪽 끝에 제목·배너만 남은 쪽이 없다.
 *  2. Enter를 치면 아래 내용이 밀려 다음 쪽으로 넘어간다.
 *  3. 그만큼 Backspace를 치면 원래 쪽으로 돌아온다(다음 쪽 내용이 당겨 올라온다).
 *  4. Ctrl(⌘)+Enter는 그 자리에서 쪽을 나눈다.
 *  5. 배너 맨 앞 Enter는 색 띠를 하나 더 만들지 않고 배너를 아래로 민다.
 *  6. 그림 바로 뒤 배너 맨 앞 Backspace는 그림을 지우지 않는다.
 *  7. 원본에 없는 "기능별 만족도" 소제목이 없다 / 점수 표와 분포도 사이에 버튼·안내가 끼지 않는다.
 *  9. 사분면과 "영역별 참고 지표"가 같은 쪽에 있다 / 번호 제목 상자의 글자가 상자 가운데에 있다.
 * 10. 사분면은 원본처럼 본문 폭의 80% 이상 / 참고 지표의 판정 문구는 볼드.
 * 11. 문항 제목(Q6.) 맨 앞에 커서를 두고 Enter를 치면 제목이 아래로 밀린다.
 * 12. 그림·표 바로 앞에는 항상 문단이 있다(가로 막대 커서 대신 Word 같은 세로 커서) / 막대 차트에 테두리.
 *  8. **어떤 글줄도 여백 밖(아래 여백·바닥글·쪽 사이)에 놓이지 않는다** — 종합 해석 상자가 쪽을
 *     뚫고 넘친 사고(2026-10-01)를 고정한다. 그림이 든 블록(차트)은 글줄이 아니라 제외.
 */
import { openChrome } from "./chromeSession";

const REPORT = process.env.CHECK_REPORT ?? "83e75d8d-a48f-471b-94b6-aa53f2e9b014";
const MM = 96 / 25.4;
const STRIDE = 297 * MM + 40;
const CONTENT = (297 - 18 - 26) * MM;
// 여백 밖으로 나간 글줄(쪽 번호, 글 앞부분). 편집기 본문은 종이 묶음 위에서 위 여백(18mm)만큼 내려와 있다.
const OUTSIDE_MARGIN = `JSON.stringify((()=>{const host=document.querySelector('[data-chapter="III"] .ProseMirror').closest('.relative').getBoundingClientRect();const out=[];const w=document.createTreeWalker(document.querySelector('[data-chapter="III"] .ProseMirror'),NodeFilter.SHOW_TEXT);for(let n=w.nextNode();n;n=w.nextNode()){if(n.parentElement.closest('[data-atom-id]'))continue;const r=document.createRange();r.selectNodeContents(n);for(const b of r.getClientRects()){if(!b.height)continue;const y=b.top-host.top-18*${MM};const page=Math.floor((y+2)/${STRIDE});const inPage=y-page*${STRIDE};if(inPage<-2||inPage+b.height>${CONTENT}+2)out.push((page+1)+'쪽: '+n.textContent.trim().slice(0,20))}}return [...new Set(out)].slice(0,8)})())`;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures += 1;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const s = await openChrome();
  const ev = async <T>(expression: string): Promise<T> => {
    const r = (await s.send("Runtime.evaluate", { returnByValue: true, expression })) as { result: { value: T }; exceptionDetails?: { text: string } };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " :: " + expression.slice(0, 80));
    return r.result.value;
  };
  const key = async (k: string, code: string, keyCode: number, modifiers = 0) => {
    await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: keyCode, modifiers });
    await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: keyCode, modifiers });
  };
  // 문단의 "몇 번째 쪽"(0부터) — 종이 묶음 기준 세로 위치로 계산한다.
  const pageOf = (index: number) => `(()=>{const host=document.querySelector('[data-chapter="III"] .ProseMirror').closest('.relative');const p=document.querySelectorAll('[data-chapter="III"] .ProseMirror p:not([data-atom-id] p):not(td p):not(th p)')[${index}];return Math.floor((p.getBoundingClientRect().top-host.getBoundingClientRect().top)/${STRIDE})})()`;
  try {
    // 기본은 실제 `/viewer`(본 기능). CHECK_PAGE=editor면 시제품 `/editor`.
    const url = process.env.CHECK_PAGE === "editor"
      ? `http://localhost:3000/editor?report=${REPORT}&section=III`
      : `http://localhost:3000/viewer?report=${REPORT}`;
    // 화면 없는 크롬은 창 포커스가 없어 편집기가 커서 위치를 못 받는다 — 포커스를 흉내 낸다.
    await s.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await s.send("Page.navigate", { url });
    await wait(process.env.CHECK_PAGE === "editor" ? 15000 : 25000);

    const lonely = await ev<string[]>(`(()=>{const host=document.querySelector('[data-chapter="III"] .ProseMirror').closest('.relative');const kids=[...document.querySelector('[data-chapter="III"] .ProseMirror').children].filter(e=>!e.hasAttribute('data-page-gap'));const out=[];kids.forEach((e,i)=>{const n=kids[i+1];if(!n)return;const a=Math.floor((e.getBoundingClientRect().top-host.getBoundingClientRect().top)/${STRIDE}),b=Math.floor((n.getBoundingClientRect().top-host.getBoundingClientRect().top)/${STRIDE});const keep=/background-color/.test(e.getAttribute('style')||'')||(/^\\[.*\\]$/.test(e.textContent.trim())&&e.tagName==='P');if(keep&&a!==b)out.push(e.textContent.trim().slice(0,30))});return out})()`);
    check("쪽 끝에 제목·배너만 남은 쪽이 없다", lonely.length === 0, lonely.join(" / "));

    // 2쪽 이후에서 **쪽 맨 아래 문단**을 찾고, 그 바로 앞 문단 끝에서 Enter를 친다 — 몇 번만 쳐도 다음 쪽으로 넘어간다.
    const target = await ev<number>(`(()=>{const ps=[...document.querySelectorAll('[data-chapter="III"] .ProseMirror p:not([data-atom-id] p):not(td p):not(th p)')];const host=document.querySelector('[data-chapter="III"] .ProseMirror').closest('.relative');const pg=(p)=>Math.floor((p.getBoundingClientRect().top-host.getBoundingClientRect().top)/${STRIDE});for(let i=1;i<ps.length-1;i++){if(pg(ps[i])>=2&&pg(ps[i+1])===pg(ps[i])+1&&pg(ps[i-1])===pg(ps[i])&&ps[i].textContent.trim().length>0&&!ps[i].hasAttribute('data-box'))return i-1}return -1})()`);
    const watch = target + 1;
    const before = await ev<number>(pageOf(watch));
    await ev(`(()=>{const p=document.querySelectorAll('[data-chapter="III"] .ProseMirror p:not([data-atom-id] p):not(td p):not(th p)')[${target}];const r=document.createRange();r.selectNodeContents(p);r.collapse(false);const sel=getSelection();sel.removeAllRanges();sel.addRange(r);p.closest('.ProseMirror').focus()})()`);
    await wait(300);
    let pushes = 0;
    while (pushes < 80 && (await ev<number>(pageOf(watch + pushes))) === before) {
      await key("Enter", "Enter", 13);
      pushes += 1;
      await wait(120);
    }
    const after = await ev<number>(pageOf(watch + pushes));
    check("Enter로 아래 내용이 다음 쪽으로 밀린다", after === before + 1, `before ${before} after ${after} (Enter ${pushes}번)`);

    for (let i = 0; i < pushes; i += 1) { await key("Backspace", "Backspace", 8); await wait(80); }
    await wait(800);
    const back = await ev<number>(pageOf(watch));
    check("같은 수만큼 Backspace를 치면 원래 쪽으로 당겨진다", back === before, `before ${before} back ${back}`);

    const outside = await ev<string>(OUTSIDE_MARGIN);
    check("여백 밖으로 나간 글줄이 없다", outside === "[]", outside);
    check("'기능별 만족도' 소제목이 없다", !(await ev<boolean>(`[...document.querySelectorAll('[data-chapter="III"] .ProseMirror h2,.ProseMirror h3,.ProseMirror h4')].some(h=>h.textContent.trim()==='기능별 만족도')`)));
    check("점수 표와 분포도 사이에 버튼·안내가 보이지 않는다", await ev<boolean>(`(()=>{const a=document.querySelector('[data-atom-id$="q1-scorebox"]');return !!a && [...a.querySelectorAll('[data-copy-ignore]')].every(e=>getComputedStyle(e).display==='none'||getComputedStyle(e).position==='absolute')})()`));
    const pageOfAtom = (id: string) => `(()=>{const host=document.querySelector('[data-chapter="III"] .ProseMirror').closest('.relative');const e=document.querySelector('[data-atom-id="${id}"]');return e?Math.floor((e.getBoundingClientRect().top-host.getBoundingClientRect().top)/${STRIDE})+'/'+Math.floor((e.getBoundingClientRect().bottom-host.getBoundingClientRect().top)/${STRIDE}):'none'})()`;
    const quadrant = await ev<string>(pageOfAtom("feature-importance-satisfaction-quadrant"));
    const reference = await ev<string>(pageOfAtom("feature-priority-reference"));
    check("사분면과 영역별 참고 지표가 같은 쪽에 있다", quadrant.split("/")[0] === reference.split("/")[1] && quadrant.split("/")[0] === quadrant.split("/")[1], `사분면 ${quadrant} · 참고 지표 ${reference}`);
    const quadrantWidth = await ev<number>(`(()=>{const q=document.querySelector('[data-atom-id="feature-importance-satisfaction-quadrant"] [data-report-export]');return q.getBoundingClientRect().width/document.querySelector('[data-chapter="III"] .ProseMirror').getBoundingClientRect().width})()`);
    check("사분면이 본문 폭의 80% 이상(원본처럼 크게)", quadrantWidth >= 0.8, `${Math.round(quadrantWidth * 100)}%`);
    const bolds = await ev<string[]>(`[...document.querySelectorAll('[data-atom-id="feature-priority-reference"] strong')].map(e=>e.textContent)`);
    check("참고 지표의 판정 문구가 볼드", ["긴급 개선 필요", "중요 개선 필요", "개선 필요성 낮음", "추후 고도화"].every((phrase) => bolds.includes(phrase)), bolds.join(","));

    const noParagraphBefore = await ev<number>(`[...document.querySelectorAll('[data-chapter="III"] .ProseMirror > .tableWrapper, .ProseMirror > table, .ProseMirror > [data-node-view-wrapper], .ProseMirror > .react-renderer')].filter((e,i)=>{const p=e.previousElementSibling;const endsInText=p&&p.matches('div[data-report-block-id]')&&p.lastElementChild&&!p.lastElementChild.matches('.tableWrapper,table,[data-page-gap]');return p && !/^(P|H[1-6])$/.test(p.tagName) && !endsInText && !p.hasAttribute('data-page-gap')}).length`);
    check("그림·표 사이에 커서 놓을 문단이 있다", noParagraphBefore === 0, `문단 없이 붙은 곳 ${noParagraphBefore}곳`);
    check("가로 막대 커서가 없다", (await ev<number>(`document.querySelectorAll('.ProseMirror-gapcursor').length`)) === 0);
    check("막대 차트에 테두리가 있다", await ev<boolean>(`(()=>{const e=document.querySelector('[data-atom-id="feature-satisfaction"] [data-report-export]');return !!e && parseFloat(getComputedStyle(e).borderTopWidth)>0})()`));

    // 문항 제목(Q6) 맨 앞에서 Enter
    const qTop = `(()=>{const h=[...document.querySelectorAll('[data-chapter="III"] .ProseMirror > h3')].find(h=>h.textContent.startsWith('Q6.'));return h?Math.round(h.getBoundingClientRect().top+scrollY):-1})()`;
    const before6 = await ev<number>(qTop);
    await ev(`(()=>{const h=[...document.querySelectorAll('[data-chapter="III"] .ProseMirror > h3')].find(h=>h.textContent.startsWith('Q6.'));const r=document.createRange();r.setStart(h.firstChild,0);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);document.querySelector('[data-chapter="III"] .ProseMirror').focus()})()`);
    await wait(200);
    await key("Enter", "Enter", 13);
    await wait(500);
    const after6 = await ev<number>(qTop);
    check("Q6 맨 앞 Enter로 제목이 아래로 밀린다", before6 > 0 && after6 > before6, `${before6} → ${after6}`);
    await key("Backspace", "Backspace", 8);
    await wait(500);
    check("Backspace로 제자리에 돌아온다", (await ev<number>(qTop)) === before6, `${before6} → ${await ev<number>(qTop)}`);

    const headingOffset = await ev<number>(`(()=>{const h=document.querySelector('[data-atom-id="feature-result-heading"] h2');const box=h.parentElement.getBoundingClientRect();const t=h.getBoundingClientRect();return Math.round(Math.abs((t.top+t.bottom)/2-(box.top+box.bottom)/2))})()`);
    check("번호 제목 글자가 상자 가운데에 있다", headingOffset <= 3, `중심에서 ${headingOffset}px 어긋남`);

    // 그림 바로 뒤의 첫 배너
    const placeAtBanner = `(()=>{const ps=[...document.querySelectorAll('[data-chapter="III"] .ProseMirror p:not([data-atom-id] p):not(td p):not(th p)')];const b=ps.find(p=>/background-color/.test(p.getAttribute('style')||'')&&p.previousElementSibling&&p.previousElementSibling.matches('[data-node-view-wrapper],.react-renderer'));window.__b=b;const r=document.createRange();r.setStart(b.firstChild,0);r.collapse(true);getSelection().removeAllRanges();getSelection().addRange(r);document.querySelector('[data-chapter="III"] .ProseMirror').focus();return !!b})()`;
    const banners = `document.querySelectorAll('[data-chapter="III"] .ProseMirror p[style*="background-color"]:not([data-atom-id] p)').length`;
    const atoms = `document.querySelectorAll('[data-chapter="III"] .ProseMirror [data-atom-id]').length`;
    check("그림 바로 뒤 배너를 찾았다", await ev<boolean>(placeAtBanner));
    const bannersBefore = await ev<number>(banners);
    await key("Enter", "Enter", 13);
    await wait(400);
    check("배너 맨 앞 Enter가 색 띠를 더 만들지 않는다", (await ev<number>(banners)) === bannersBefore, `${bannersBefore} → ${await ev<number>(banners)}`);
    await key("Backspace", "Backspace", 8); // 방금 넣은 빈 문단을 지운다
    await wait(400);
    const atomsBefore = await ev<number>(atoms);
    await ev(placeAtBanner);
    await key("Backspace", "Backspace", 8);
    await wait(400);
    check("그림 뒤 배너 맨 앞 Backspace가 그림을 지우지 않는다", (await ev<number>(atoms)) === atomsBefore, `${atomsBefore} → ${await ev<number>(atoms)}`);

    const pagesBefore = await ev<number>(`document.querySelectorAll('[data-page-gap]').length`);
    await key("Enter", "Enter", 13, 4 /* meta */);
    await wait(800);
    const breaks = await ev<number>(`document.querySelectorAll('[data-chapter="III"] .ProseMirror [data-page-break]').length`);
    const pagesAfter = await ev<number>(`document.querySelectorAll('[data-page-gap]').length`);
    check("⌘+Enter로 쪽 나누기가 들어간다", breaks === 1 && pagesAfter >= pagesBefore, `나누기 ${breaks}개, 간격 ${pagesBefore}→${pagesAfter}`);
    await wait(800);
    const outsideAfter = await ev<string>(OUTSIDE_MARGIN);
    check("편집 뒤에도 여백 밖으로 나간 글줄이 없다", outsideAfter === "[]", outsideAfter);
  } finally {
    s.close();
  }
  console.log(failures === 0 ? "\n전부 PASS" : `\n${failures}건 FAIL`);
  process.exit(failures === 0 ? 0 : 1);
})();
