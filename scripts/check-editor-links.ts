/**
 * `/viewer` 이어진 편집기와 주변 기능의 연결 검사(과금 없음, 저장 안 함):
 *  1. 근거 패널 — 인용 묶음까지 스크롤하면 왼쪽에 인용문 원문이 뜬다.
 *  2. 인용문 교정 — 교정 경로(replaceQuotesInEditors)가 편집기 문서의 글과 원문 속성을 바꾼다.
 *  3. 목차 — 소제목 쪽 번호가 장 시작 쪽과 다르게(실제 놓인 쪽으로) 나온다.
 */
import { openChrome } from "./chromeSession";

const REPORT = process.env.CHECK_REPORT ?? "83e75d8d-a48f-471b-94b6-aa53f2e9b014";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`); if (!ok) failures += 1; };

(async () => {
  const s = await openChrome();
  const ev = async <T>(expression: string): Promise<T> => ((await s.send("Runtime.evaluate", { returnByValue: true, expression })) as { result: { value: T } }).result.value;
  try {
    await s.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await s.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
    await s.send("Page.navigate", { url: `http://localhost:3000/viewer?report=${REPORT}` });
    await wait(25000);

    await ev(`(()=>{const g=document.querySelector('[data-chapter="III"] .ProseMirror [data-quote-group]');window.scrollTo(0,g.getBoundingClientRect().top+scrollY-window.innerHeight*0.32+40)})()`);
    await wait(5000);
    const panel = await ev<string>(`[...document.querySelectorAll('aside')].find(a=>a.innerText.includes('분석 근거'))?.innerText ?? ''`);
    check("근거 패널이 읽는 위치의 인용문 원문을 보여준다", panel.includes("인용") && !panel.includes("표·그래프 구간"), panel.slice(0, 120));

    const quote = await ev<string>(`decodeURIComponent(document.querySelector('[data-chapter="III"] .ProseMirror [data-report-quote][data-quote-text]').dataset.quoteText)`);
    const replaced = await ev<number>(`window.__editorTools.replaceQuotesInEditors([[encodeURIComponent(${JSON.stringify(quote)}), "교정검사 문장입니다"]])`);
    await wait(500);
    const after = await ev<{ text: string; attr: string }>(`(()=>{const q=[...document.querySelectorAll('.ProseMirror [data-report-quote]')].find(q=>q.textContent.includes('교정검사 문장입니다'));return q?{text:q.textContent,attr:decodeURIComponent(q.dataset.quoteText)}:{text:'',attr:''}})()`);
    check("인용문 교정이 편집기 문서에 들어간다", replaced >= 1 && after.attr === "교정검사 문장입니다", JSON.stringify({ replaced, after }));

    // 목차 쪽의 오른쪽 쪽 번호 칸들(장·소제목)을 그대로 모은다.
    const numbers = await ev<number[]>(`[...document.querySelectorAll('[data-front-page]')].flatMap(p=>[...p.querySelectorAll('span[contenteditable]')]).map(e=>Number(e.textContent.trim())).filter(n=>n>0)`);
    check("목차 쪽 번호가 장 안에서도 서로 다르게 나온다(소제목이 실제 쪽)", new Set(numbers).size > 12, numbers.join(","));
  } finally {
    s.close();
  }
  console.log(failures === 0 ? "\n전부 PASS" : `\n${failures}건 FAIL`);
  process.exit(failures === 0 ? 0 : 1);
})();
