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
  // 쪽 넘김 규칙: 표 제목 띠 + 긴 표(머리 행 + 본문 40행, 행마다 30px) → 제목은 표 첫 행으로 합쳐지고,
  // 머리 2행 + 첫 본문 행이 통째 조각(글자처럼 취급), 나머지가 쪽 경계에서 나뉘는 표가 된다.
  { kind: "table", widthPx: 680, rows: [[{ ...cell("[ 기능별 만족도 순위 종합 ]"), widthPx: 680 }]], rowHeightsPx: [30] },
  { kind: "table", widthPx: 680, rowHeightsPx: new Array(41).fill(30), rows: [
    [cell("순위", { header: true }), cell("기능", { header: true })],
    ...Array.from({ length: 40 }, (_, i) => [cell(String(i + 1)), cell(`기능 ${i + 1}`)]),
  ] },
  // 병합 칸이 머리 조각 경계에 걸친 표(인사이트 종합 표 모양) → 그 칸을 둘로 나눠도 격자가 맞아야 한다
  { kind: "table", widthPx: 680, rowHeightsPx: new Array(31).fill(30), rows: [
    [cell("구분", { header: true }), cell("액션", { header: true })],
    [cell("긍정 의견", { rowSpan: 30 }), cell("액션 1")],
    ...Array.from({ length: 29 }, (_, i) => [cell(`액션 ${i + 2}`)]),
  ] },
  // 문단마다 따로 그린 상자(위 상자는 아래 테두리 없음) → 한 표로 쌓여야 한다
  { kind: "table", widthPx: 680, rows: [[{ ...cell("상자 문단 1"), widthPx: 680, borders: [line, line, line, null] }]], rowHeightsPx: [40] },
  { kind: "table", widthPx: 680, rows: [[{ ...cell("상자 문단 2"), widthPx: 680, borders: [line, line, null, line] }]], rowHeightsPx: [40] },
  // 한 행이 쪽의 절반보다 큰 표 → 행 안에서도 나눈다(TABLE)
  { kind: "table", widthPx: 680, rowHeightsPx: [30, 700], rows: [[cell("긍정", { header: true }), cell("부정", { header: true })], [cell("긴 의견"), cell("긴 의견")]] },
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
    // 표 제목이 다음 표의 첫 행으로 들어갔는가(따로 남은 제목 띠 표가 없어야 한다)
    const titleIdx = s1.indexOf("[ 기능별 만족도 순위 종합 ]");
    const titleTbl = s1.lastIndexOf("<hp:tbl ", titleIdx);
    ok(/rowCnt="3"/.test(s1.slice(titleTbl, titleTbl + 400)), "표 제목 띠가 표의 첫 행으로 합쳐지지 않았다(머리 조각 = 제목 + 머리 + 첫 본문 행 = 3행이어야 한다)");
    ok(/treatAsChar="1"/.test(s1.slice(titleTbl, s1.indexOf("</hp:pos>", titleTbl) + 10)) || /<hp:pos treatAsChar="1"/.test(s1.slice(titleTbl, titleTbl + 1200)), "머리 조각이 통째(글자처럼 취급)가 아니다");
    const rest = s1.indexOf("<hp:tbl ", s1.indexOf("</hp:tbl>", titleIdx));
    ok(/pageBreak="CELL" repeatHeader="0" rowCnt="39"/.test(s1.slice(rest, rest + 300)) && /<hp:pos treatAsChar="0"/.test(s1.slice(rest, rest + 800)), "나머지 행이 셀 단위로 나뉘는 표(39행)가 아니다");
    ok(/pageBreak="TABLE"/.test(s1.slice(s1.lastIndexOf("<hp:tbl ", s1.lastIndexOf("긴 의견")), s1.lastIndexOf("긴 의견"))), "반 쪽보다 큰 행이 있는 표가 행 안 나눔(TABLE)이 아니다");
    const posIdx = s1.indexOf("긍정 의견");
    const posTbl = s1.slice(s1.lastIndexOf("<hp:tbl ", posIdx), posIdx);
    ok(/rowCnt="2"/.test(posTbl) && /treatAsChar="1"/.test(posTbl), "병합 칸이 걸친 표의 머리 조각(머리 + 첫 행)이 떨어지지 않았다");
    const stackIdx = s1.indexOf("상자 문단 2");
    ok(s1.slice(s1.lastIndexOf("<hp:tbl ", stackIdx), stackIdx).includes("상자 문단 1"), "이어 그린 한 열 상자들이 한 표로 쌓이지 않았다");
    // 제목 구실(장·절·문항 머리)은 다음 문단과 함께
    const keepIds = new Set([...header.matchAll(/<hh:paraPr id="(\d+)"(?:(?!<\/hh:paraPr>).)*keepWithNext="1"/g)].map((m) => m[1]));
    const qPara = blocks(s1, "p").map((b) => s1.slice(b.start, b.end)).find((p) => p.includes("Q1. 나이를")) ?? "";
    ok(keepIds.has(qPara.match(/^<hp:p [^>]*paraPrIDRef="(\d+)"/)?.[1] ?? ""), "문항 머리 문단에 '다음 문단과 함께'가 없다");
    ok(toc.length === 3, `목차 줄이 3개가 아니다(${toc.length})`); // 장 2 + 절 1
  }

  console.log(fails.length ? `FAIL\n- ${fails.join("\n- ")}` : `PASS — 표 ${tables}개 격자 일치, 그림 ${new Set(s1.match(/binaryItemIDRef="\w+"/g)).size}개·목차 ${toc.length}줄, 서식 참조 정상${out ? `, ${out}` : ""}`);
  process.exit(fails.length ? 1 : 0);
}
void main();
