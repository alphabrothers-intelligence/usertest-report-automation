/**
 * **이어진 편집기에서 보고서가 깨져 보이지 않는지** 데이터셋 전부로 본다 — 실제 브라우저, 과금 없음.
 * 2026-10-06 담당자가 실제로 본 깨짐 유형을 하나씩 고정한다:
 *  1. 표 칸 밀림 — 어떤 행이든 칸(병합 셀 포함)을 세면 표 폭과 같아야 한다(설문 항목 표 Q28 사고).
 *  2. 화면 전용 버튼 글자가 본문에 찍힘("AI 요약 생성" 등 — 편집 문서가 버튼을 글자로 바꿨다).
 *  3. 표 제목·머리글 행만 쪽 끝에 홀로 남음("유사 서비스 경험 조사" 제목 줄).
 *  4. "주관식 응답 감정 분석"이 2열 상자 밖에 따로 나옴(Ⅱ장 유사 서비스 감정 분석).
 * 필요: 로컬 dev 서버, `data/` 원본(데모), 시스템 Chrome. 저장된 보고서는
 * `CHECK_DATASETS="dataset=rivalabs report=<uuid>"`처럼 준다(check:page-fit과 같은 규칙).
 */
import { openChrome } from "./chromeSession";

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
const DATASETS = (process.env.CHECK_DATASETS ?? "rivalabs carecl ezenauto cleanhabit twoblock report=83e75d8d-a48f-471b-94b6-aa53f2e9b014").split(/\s+/).filter(Boolean);
const STRIDE = (297 * 96) / 25.4 + 40;

const PROBE = `(()=>{
  const out = { misaligned: [], leaked: [], orphanHeader: [], looseEmotion: [] };
  const pageOf = (el) => { const chapter = el.closest('[data-chapter]'); return Math.floor((el.getBoundingClientRect().top - chapter.getBoundingClientRect().top) / ${STRIDE}); };
  for (const table of document.querySelectorAll('[data-chapter] .ProseMirror table')) {
    if (table.closest('[data-atom-id]')) continue;
    const rows = [...table.rows];
    const carry = [];
    const widths = rows.map((row, r) => {
      let width = carry.filter((until) => until > r).length;
      for (const cell of row.cells) {
        width += cell.colSpan;
        for (let k = 0; k < cell.colSpan; k += 1) carry.push(r + cell.rowSpan);
      }
      return { gap: row.hasAttribute('data-page-gap'), width, text: row.textContent.trim().slice(0, 20) };
    });
    const full = Math.max(...widths.filter((w) => !w.gap).map((w) => w.width));
    const bad = widths.find((w) => !w.gap && w.width !== full);
    if (bad) out.misaligned.push(bad.text || '(빈 행)');
    const real = rows.filter((row) => !row.hasAttribute('data-page-gap'));
    real.forEach((row, i) => {
      const next = real[i + 1];
      const header = row.cells.length > 0 && [...row.cells].every((cell) => cell.tagName === 'TH');
      if (header && next && ![...next.cells].every((cell) => cell.tagName === 'TH') && pageOf(row) !== pageOf(next)) out.orphanHeader.push(row.textContent.trim().slice(0, 20));
    });
  }
  for (const el of document.querySelectorAll('[data-chapter] .ProseMirror p, [data-chapter] .ProseMirror td, [data-chapter] .ProseMirror h3')) {
    if (el.closest('[data-atom-id]')) continue;
    if (/^(AI 요약 생성|AI 분석 재생성|PNG 다운로드|차트 \\d+ PNG 다운로드)$/.test(el.textContent.trim())) out.leaked.push(el.textContent.trim());
    if (el.tagName === 'P' && el.textContent.trim() === '주관식 응답 감정 분석' && !el.closest('td')) out.looseEmotion.push(el.closest('[data-chapter]').dataset.chapter);
  }
  for (const el of document.querySelectorAll('[data-chapter] [data-atom-id] p')) {
    if (el.textContent.trim() === '주관식 응답 감정 분석' && !el.closest('td')) out.looseEmotion.push(el.closest('[data-chapter]').dataset.chapter);
  }
  return out;
})()`;

(async () => {
  const s = await openChrome();
  let failures = 0;
  try {
    for (const dataset of DATASETS) {
      const query = dataset.includes("=") ? dataset : `dataset=${dataset}`;
      await s.open(`${BASE}/viewer?${query}`);
      await new Promise((r) => setTimeout(r, 3000));
      const editors = await s.evaluate<number>(`document.querySelectorAll('[data-chapter] .ProseMirror').length`);
      const found = await s.evaluate<Record<string, string[]>>(PROBE);
      const problems = Object.entries(found).filter(([, list]) => list.length > 0);
      const label = { misaligned: "표 칸 밀림", leaked: "버튼 글자 노출", orphanHeader: "표 머리행만 쪽 끝에", looseEmotion: "감정 분석이 상자 밖" } as Record<string, string>;
      if (editors === 0) { console.log(`FAIL ${dataset} — 편집기가 하나도 안 열렸다`); failures += 1; continue; }
      if (problems.length === 0) console.log(`PASS ${dataset} (장 ${editors}개)`);
      else {
        failures += 1;
        console.log(`FAIL ${dataset} — ${problems.map(([key, list]) => `${label[key]}: ${[...new Set(list)].slice(0, 4).join(" / ")}`).join(" · ")}`);
      }
    }
  } finally {
    s.close();
  }
  console.log(failures ? `\n${failures}건 실패` : "\n전부 통과");
  process.exit(failures ? 1 : 0);
})();
