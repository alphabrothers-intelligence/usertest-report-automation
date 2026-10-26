/**
 * 결과보고서 HWPX(lib/hwpx/publishedReport.ts) 구조 검사 — API·DB·브라우저 불필요.
 *
 * 장·절·문항 머리·글·병합 칸이 있는 표·표 안의 표·그림을 넣어 만들고 본다:
 * 표 격자가 빈틈·겹침 없이 맞는지, 서식 번호(charPr/paraPr/borderFill)와 그림이 전부 실제로 있는지,
 * 목차가 장·절 수만큼 생기는지. `--out <경로>`로 파일을 남기면 한컴오피스로 열어 볼 수 있다.
 * `--file <경로>`면 이미 만든 파일(웹뷰의 HWPX 저장 결과)을 같은 기준으로 검사한다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { createCanvas } from "@napi-rs/canvas";
import { buildPublishedReportHwpx, type HwpCell, type HwpNode } from "@/lib/hwpx/publishedReport";
import { blocks } from "@/lib/survey/plan";

const line = { width: 0.12, color: "#c7d2e3" };
const cell = (text: string, extra: Partial<HwpCell> = {}): HwpCell => ({
  nodes: [{ kind: "p", runs: [{ text }], align: "CENTER" }], colSpan: 1, rowSpan: 1, widthPx: 120, borders: [line, line, line, line], ...extra,
});
const canvas = createCanvas(600, 300);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#5c73aa";
ctx.fillRect(40, 60, 120, 200);
const png = new Uint8Array(canvas.toBuffer("image/png"));

const nodes: HwpNode[] = [
  { kind: "chapter", numeral: "Ⅰ", title: "개요" },
  { kind: "sub", number: "1", text: "제품 소개" },
  { kind: "p", runs: [{ text: "보통 글 " }, { text: "굵게", bold: true }, { text: " 밑줄", underline: true, color: "#c2410c" }] },
  { kind: "table", widthPx: 680, rows: [
    [cell("단계", { rowSpan: 2, bg: "#dfeaf5", widthPx: 100 }), cell("Q1", { widthPx: 60 }), cell("나이를 입력해주세요", { widthPx: 520 })],
    [cell("Q2", { widthPx: 60 }), cell("성별을 선택해주세요", { widthPx: 520 })],
    [cell("병합된 마지막 줄", { colSpan: 3, widthPx: 680 })],
  ] },
  // 화면 표에서 실제로 나온 모양: 칸이 빠진 행, 표 밖으로 넘친 rowspan(케어클 보고서 실측)
  { kind: "table", widthPx: 680, rows: [[cell("가", { rowSpan: 3 }), cell("나"), cell("다")], [cell("라")]] },
  { kind: "chapter", numeral: "Ⅱ", title: "인적 사항" },
  { kind: "question", text: "Q1. 나이를 입력해주세요" },
  { kind: "question", text: "Q18. 조작은 [불편하다 / 편하다]", note: "* 불편하다: 0점 / 편하다:10점" },
  { kind: "img", png, widthPx: 600, heightPx: 300 },
  { kind: "table", widthPx: 680, rows: [[
    { ...cell(""), widthPx: 680, nodes: [{ kind: "p", runs: [{ text: "[ 응답 결과 ]", bold: true }], align: "CENTER" }, { kind: "img", png, widthPx: 600, heightPx: 300 }] },
  ], [
    { ...cell(""), widthPx: 680, nodes: [{ kind: "table", widthPx: 600, rows: [[cell("안쪽 표"), cell("값")]] }] },
  ]] },
];

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);

async function main() {
  const out = arg("--out");
  const file = arg("--file");
  const bytes = file ? readFileSync(file) : await buildPublishedReportHwpx(readFileSync("public/hwpx/report-template.hwpx"), {
    company: "테스트기업", service: "테스트앱", date: new Date(2026, 9, 26), pxToHwp: 75, nodes,
  });
  if (out && !file) writeFileSync(out, bytes);
  const zip = await JSZip.loadAsync(bytes);
  const s1 = await zip.file("Contents/section1.xml")!.async("string");
  const header = await zip.file("Contents/header.xml")!.async("string");
  const hpf = await zip.file("Contents/content.hpf")!.async("string");
  const s0 = await zip.file("Contents/section0.xml")!.async("string");
  const fails: string[] = [];
  const ok = (cond: boolean, msg: string) => { if (!cond) fails.push(msg); };

  ok(Object.keys(zip.files)[0] === "mimetype", "mimetype이 첫 항목이 아니다");
  ok(!/\{\{/.test(s0), "표지에 자리표시({{…}})가 남았다");
  if (!file) ok(s0.includes("테스트기업") && s0.includes("‘테스트앱’"), "표지에 기업명·서비스명이 없다");

  // 서식 번호가 header에 다 있는가
  for (const [attr, tag] of [["charPrIDRef", "charPr"], ["paraPrIDRef", "paraPr"], ["borderFillIDRef", "borderFill"]] as const) {
    const ids = new Set([...header.matchAll(new RegExp(`<hh:${tag} id="(\\d+)"`, "g"))].map((m) => m[1]));
    for (const m of s1.matchAll(new RegExp(`${attr}="(\\d+)"`, "g"))) ok(ids.has(m[1]), `${tag} ${m[1]}이 header에 없다`);
    const list = { charPr: "charProperties", paraPr: "paraProperties", borderFill: "borderFills" }[tag];
    ok(+header.match(new RegExp(`<hh:${list} itemCnt="(\\d+)"`))![1] === ids.size, `${list} itemCnt가 실제 개수와 다르다`);
  }
  // 그림이 다 실려 있는가
  for (const m of s1.matchAll(/binaryItemIDRef="(\w+)"/g)) {
    ok(hpf.includes(`id="${m[1]}"`) && Object.keys(zip.files).some((f) => f.startsWith(`BinData/${m[1]}.`)), `그림 ${m[1]}이 없다`);
  }
  // 표 격자: 모든 칸이 빈틈·겹침 없이 rowCnt×colCnt를 채우는가
  let tables = 0;
  const checkTables = (xml: string) => {
    for (const span of blocks(xml, "tbl")) {
      const tbl = xml.slice(span.start, span.end);
      tables++;
      const rowCnt = +tbl.match(/rowCnt="(\d+)"/)![1];
      const colCnt = +tbl.match(/colCnt="(\d+)"/)![1];
      const grid = Array.from({ length: rowCnt }, () => new Array<number>(colCnt).fill(0));
      const body = tbl.slice(tbl.indexOf(">") + 1);
      for (const tcSpan of blocks(body, "tc")) {
        const tc = body.slice(tcSpan.start, tcSpan.end);
        const tail = tc.slice(tc.lastIndexOf("</hp:subList>"));
        const [c, r] = tail.match(/colAddr="(\d+)" rowAddr="(\d+)"/)!.slice(1).map(Number);
        const [cs, rs] = tail.match(/colSpan="(\d+)" rowSpan="(\d+)"/)!.slice(1).map(Number);
        for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) grid[r + dr][c + dc]++;
        const sub = blocks(tc, "subList")[0];
        checkTables(tc.slice(sub.start, sub.end).replace(/^<hp:subList[^>]*>/, ""));
      }
      ok(grid.every((row) => row.every((v) => v === 1)), `표 격자 불일치 ${JSON.stringify(grid)}`);
    }
  };
  for (const p of blocks(s1, "p")) checkTables(s1.slice(p.start, p.end).replace(/^<hp:p[^>]*>/, ""));
  const toc = s1.match(/<hp:stringParam name="Command">\?([^;]*)/g) ?? [];
  if (!file) {
    ok(tables >= 8, `표가 너무 적다(${tables})`);
    ok(toc.length === 3, `목차 줄이 3개가 아니다(${toc.length})`); // 장 2 + 절 1
  }

  console.log(fails.length ? `FAIL\n- ${fails.join("\n- ")}` : `PASS — 표 ${tables}개 격자 일치, 그림 ${new Set(s1.match(/binaryItemIDRef="\w+"/g)).size}개·목차 ${toc.length}줄, 서식 참조 정상${out ? `, ${out}` : ""}`);
  process.exit(fails.length ? 1 : 0);
}
void main();
