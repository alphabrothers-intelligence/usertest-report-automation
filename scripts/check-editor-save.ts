/**
 * 이어진 편집기 저장 왕복 검사 — 본문에 글을 쓰고 "변경사항 저장" → 새로고침 → 글이 남아 있는지.
 * **검사 대상 보고서에 원래 초안이 없을 때만 돈다**(끝나면 초안을 지워 원상태로 되돌린다). 과금 없음.
 */
import { openChrome } from "./chromeSession";

const REPORT = process.env.CHECK_REPORT ?? "83e75d8d-a48f-471b-94b6-aa53f2e9b014";
const MARK = `저장검사-${Date.now()}`;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`); if (!ok) failures += 1; };

(async () => {
  const reports = await (await fetch("http://localhost:3000/api/reports")).json() as { reports: { id: string; fileUrl: string; workspaceDraftSavedAt: string | null }[] };
  const report = reports.reports.find((item) => item.id === REPORT);
  if (!report) throw new Error("보고서를 찾지 못했습니다");
  if (report.workspaceDraftSavedAt) { console.log("SKIP 이 보고서에는 이미 저장된 초안이 있어 덮어쓰지 않습니다."); return; }

  const s = await openChrome();
  const ev = async <T>(expression: string): Promise<T> => ((await s.send("Runtime.evaluate", { returnByValue: true, expression })) as { result: { value: T } }).result.value;
  try {
    // 화면 없는 크롬은 창 포커스가 없어 편집기가 커서 위치를 못 받는다 — 포커스를 흉내 낸다.
    await s.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await s.send("Page.navigate", { url: `http://localhost:3000/viewer?report=${REPORT}` });
    await wait(25000);
    await ev(`(()=>{const p=[...document.querySelectorAll('[data-chapter="III"] .ProseMirror p:not([data-atom-id] p):not(td p):not(th p)')].find(p=>p.textContent.trim().length>10);const r=document.createRange();r.selectNodeContents(p);r.collapse(false);getSelection().removeAllRanges();getSelection().addRange(r);p.closest('.ProseMirror').focus()})()`);
    await s.send("Input.insertText", { text: ` ${MARK}` });
    await wait(1200);
    await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='변경사항 저장').click()`);
    await wait(4000);
    await s.send("Page.reload", {});
    await wait(25000);
    const kept = await ev<boolean>(`document.querySelector('[data-chapter="III"] .ProseMirror').textContent.includes(${JSON.stringify(MARK)})`);
    check("본문에 쓴 글이 저장 후 새로고침해도 남아 있다", kept);
    const chartsAlive = await ev<number>(`document.querySelectorAll('[data-chapter="III"] [data-atom-id] svg').length`);
    check("저장본으로 연 뒤에도 차트가 그려진다", chartsAlive > 3, `${chartsAlive}개`);
  } finally {
    s.close();
    await fetch("http://localhost:3000/api/report-workspace/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileUrl: report.fileUrl, sections: null }) });
  }
  console.log(failures === 0 ? "\n전부 PASS (시험 초안은 지웠습니다)" : `\n${failures}건 FAIL`);
  process.exit(failures === 0 ? 0 : 1);
})();
