/**
 * 기획안 HWPX 검사 `npm run check:survey-plan [출력.hwpx]`. API·DB 불필요.
 * 한글에서 양식이 깨지는 원인 — 표의 행 수·병합 칸이 격자와 안 맞는 것 — 을 모든 표(중첩 포함)에서 본다.
 * 제품이 둘인 설문(분기·순위·복수 선택·척도 라벨 포함)으로 만들고, 템플릿(케어클) 글이 남지 않았는지도 본다.
 */
import assert from "node:assert";
import { readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { normalizeSurvey, type RawSurvey } from "../lib/survey/generate";
import { blocks, buildSurveyPlanHwpx } from "../lib/survey/plan";
import { keepFoundSources, splitByProduct, type SurveyQuestion } from "../lib/survey/types";

const q = (id: string, stage: string, patch: Partial<SurveyQuestion> = {}): SurveyQuestion => ({
  id, stage, text: `${id} 문항이에요?`, type: "주관식", options: [], required: true,
  followUp: false, branchOn: "", branchValue: "", note: "", caution: "", ...patch,
});
const S = {
  p: "인적 사항 및 특성·경험 조사", f: "기능별 고객 경험 평가 - 자사 제품 평가", c: "기능별 고객 경험 평가 - 타사 제품 평가", k: "핵심구매요인 파악",
  v: "가치 만족도 평가", r: "구매/추천 의향 조사", t: "종합 만족도", i: "개선 아이디어", e: "기타 기업 요청사항",
};
const perProduct = (p: string, tag: string): SurveyQuestion[] => {
  const b = { branchOn: "track", branchValue: p };
  return [
    q(`${tag}used`, S.c, { ...b, type: "객관식-단일", options: ["네, 있어요", "아니요, 없어요", "기억나지 않아요"], text: "써 보신 적이 있나요?" }),
    q(`${tag}name`, S.c, { branchOn: `${tag}used`, branchValue: "네, 있어요", followUp: true }),
    q(`${tag}f1`, S.f, { ...b, type: "척도(0-10)", text: "'기능 A' 기능에 대해 얼마나 만족하시나요?", note: `[${p}] '기능 A'는 아주 긴 설명이 붙은 기능입니다. `.repeat(3) }),
    q(`${tag}f2`, S.f, { ...b, type: "척도(0-10)", text: "'기능 B' 기능에 대해 얼마나 만족하시나요?" }),
    q(`${tag}k`, S.k, { ...b, type: "객관식-단일", options: ["가격", "편의성", "기타(직접 입력)"], text: "가장 크게 영향을 미치는 요인은 무엇인가요?" }),
    q(`${tag}v`, S.v, { ...b, type: "척도(0-10)", text: "가격에 대해 얼마나 만족하시나요?", note: "0=매우 비싸다, 10=매우 싸다" }),
    q(`${tag}rec`, S.r, { ...b, type: "척도(0-10)", text: "추천할 의향이 얼마나 있나요?" }),
    q(`${tag}tot`, S.t, { ...b, type: "척도(0-10)" }),
    q(`${tag}idea`, S.i, { ...b, required: false }),
    q(`${tag}worry`, S.e, { ...b, type: "객관식-복수", options: ["비용", "해당 없어요"], text: "우려되는 점은 무엇인가요?" }),
  ];
};
const draft = normalizeSurvey({
  companyName: "테스트기업", productName: "앱 A / 서비스 B", excludedFeatures: [], reviewNotes: [],
  questions: [
    q("age", S.p, { text: "나이를 입력해 주세요.", note: "숫자만 입력" }),
    q("sex", S.p, { type: "객관식-단일", options: ["남성", "여성"] }),
    q("track", S.p, { type: "객관식-단일", options: ["앱 A", "서비스 B"], text: "어떤 서비스를 체험하셨나요?" }),
    ...perProduct("앱 A", "a"), ...perProduct("서비스 B", "b"),
  ],
} as unknown as RawSurvey);

/** 표 하나의 칸이 행×열 격자를 겹침 없이 정확히 채우는지. */
function checkGrid(tbl: string, where: string) {
  const rowCnt = +tbl.match(/rowCnt="(\d+)"/)![1];
  const colCnt = +tbl.match(/colCnt="(\d+)"/)![1];
  const trs = blocks(tbl, "tr").map((s) => tbl.slice(s.start, s.end));
  assert.strictEqual(trs.length, rowCnt, `${where}: rowCnt ${rowCnt} ≠ 행 ${trs.length}`);
  const grid = Array.from({ length: rowCnt }, () => Array<number>(colCnt).fill(0));
  trs.forEach((tr, r) => {
    for (const s of blocks(tr, "tc")) {
      const tc = tr.slice(s.start, s.end);
      const tail = tc.slice(tc.lastIndexOf("</hp:subList>"));
      const [, col, row] = tail.match(/colAddr="(\d+)" rowAddr="(\d+)"/)!.map(Number);
      const [, cs, rs] = tail.match(/colSpan="(\d+)" rowSpan="(\d+)"/)!.map(Number);
      assert.strictEqual(row, r, `${where}: ${r}행 칸의 rowAddr=${row}`);
      for (let y = row; y < row + rs; y++) for (let x = col; x < col + cs; x++) {
        assert.ok(y < rowCnt && x < colCnt, `${where}: 칸 (${x},${y})이 격자 밖`);
        grid[y][x] += 1;
      }
    }
  });
  grid.forEach((line, y) => line.forEach((n, x) => assert.strictEqual(n, 1, `${where}: 칸 (${x},${y})이 ${n}번 채워짐`)));
}

async function inspect(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  assert.strictEqual(Object.keys(zip.files)[0], "mimetype", "mimetype이 첫 항목이어야 한글이 연다");
  assert.ok(!zip.file("Preview/PrvImage.png"), "템플릿 표지 썸네일이 남음");
  let tables = 0;
  for (const name of ["Contents/section0.xml", "Contents/section1.xml", "Contents/section2.xml"]) {
    const xml = await zip.file(name)!.async("string");
    assert.ok(!/케어클|테크핏|SHOT\(FACE|피부 타입/.test(xml), `${name}에 템플릿(케어클) 글이 남음`);
    assert.ok(!xml.includes("<hp:linesegarray>"), `${name}에 줄 배치 캐시가 남음`);
    const ids = [...xml.matchAll(/<hp:tbl id="(\d+)"/g)].map((m) => m[1]);
    assert.strictEqual(new Set(ids).size, ids.length, `${name}: 표 id 중복`);
    for (const m of xml.matchAll(/<hp:tbl\b/g)) {
      const s = blocks(xml.slice(m.index!), "tbl")[0];
      checkGrid(xml.slice(m.index!, m.index! + s.end), `${name} 표 #${++tables}`);
    }
  }
  return { zip, tables };
}

async function main() {
  // `--inspect 파일.hwpx`: 이미 만든 기획안의 표 격자·템플릿 잔재만 검사한다(실제 설문으로 만든 결과 확인용).
  if (process.argv[2] === "--inspect") {
    const { tables } = await inspect(readFileSync(process.argv[3]));
    console.log(`PASS ${process.argv[3]} — 표 ${tables}개 격자 정상, 템플릿 글 없음`);
    return;
  }
  const template = readFileSync("templates/survey-plan-template.hwpx");
  const out = await buildSurveyPlanHwpx(template, draft, { businessArea: "B2C", testers: "", schedule: "2026년 10월 20일 ~ 2026년 11월 3일", managers: "" }, new Date(2026, 9, 13));
  const { zip, tables } = await inspect(out);
  const cover = await zip.file("Contents/section0.xml")!.async("string");
  assert.ok(cover.includes("<hp:t>발주처 l (입력 필요)</hp:t>"), "발주처를 비웠는데 표지에 원본 발주처가 남음");
  const withClient = await JSZip.loadAsync(await buildSurveyPlanHwpx(template, draft, { businessArea: "", testers: "", schedule: "", managers: "", client: "테스트진흥원" }));
  assert.ok((await withClient.file("Contents/section0.xml")!.async("string")).includes("<hp:t>발주처 l 테스트진흥원</hp:t>"), "발주처가 표지에 안 들어감");
  const body = await zip.file("Contents/section1.xml")!.async("string");
  const text = [...body.matchAll(/<hp:t>([^<]*)/g)].map((m) => m[1]).join("\n");
  for (const want of ["테스트기업", "(입력 필요)", "2026년 10월 20일", "■ 앱 A", "■ 서비스 B", "1. 앱 A 설문", "2. 서비스 B 설문", "의 기능 중 가장 중요하다고 생각하는 기능은 무엇인가요? (1~2순위)",
    "매우 비싸다", "매우 불만족", "복수 선택", "2026 by Alphabrothers", "4대 가치별 만족도 평가", "1-2) 기능별 고객경험 평가 _ 자사 제품 평가", "2-3) 기능별 고객경험 평가 _ 타사 제품 평가"]) {
    assert.ok(text.includes(want), `본문에 '${want}' 없음`);
  }
  assert.match(text, /\(Q\d+ '네, 있어요' 응답 시\)/, "분기 문항에 조건 표기 없음");
  // 제품이 둘이면 진행 프로세스 표도 둘 — 각 표의 총 문항 수는 그 제품 응답자가 받는 문항(공통 포함) 수다.
  const totals = [...text.matchAll(/총 (\d+) 문항/g)].map((m) => +m[1]);
  assert.deepStrictEqual(totals, splitByProduct(draft)!.map((d) => d.questions.length), `제품별 총 문항 수 ${totals}`);
  // 한 제품의 장 안에서 문항 번호가 Q1부터 다시 시작한다.
  const second = text.slice(text.lastIndexOf("2. 서비스 B 설문"));
  assert.match(second, /^[\s\S]*?\nQ1\n/, "두 번째 제품 설문이 Q1부터 시작하지 않음");
  const leak = second.split("\n").find((l) => l.includes("앱 A") && l !== draft.productName); assert.ok(!leak, `두 번째 제품 장에 첫 제품 내용이 섞임: ${leak}`);
  assert.ok(!/1위|2위/.test(text), "옛 순위 문구(1위)가 남음");
  assert.ok(!text.includes("고객 여정 기반"), "없는 단계가 목차·본문에 남음");
  // 본문 표(대상·진행 프로세스·설문 구성)는 쪽 경계에서 나뉘고 글자처럼 취급하지 않는다 — 안 그러면 긴 표가 쪽 밑으로 잘린다.
  const bodyTables = blocks(body, "p").slice(1).flatMap((b) => blocks(body.slice(b.start, b.end), "tbl").slice(0, 1).map((t) => body.slice(b.start, b.end).slice(t.start, t.end)));
  const head = (t: string) => t.slice(0, t.indexOf("<hp:tr>"));
  const stuck = bodyTables.filter((t) => /(?:대상|단계|Q\d)/.test(t) && !(head(t).includes('pageBreak="TABLE"') && /treatAsChar="0"/.test(head(t))));
  assert.strictEqual(stuck.length, 0, `쪽 경계에서 나뉘지 않는 본문 표 ${stuck.length}개`);
  // 기획안 칸 근거 문장: 원문에 있는 것만 남는다(띄어쓰기 무시), 지어낸 문장과 너무 짧은 조각은 빠진다.
  const kept = keepFoundSources({ businessArea: "B2C", testers: "", schedule: "", managers: "",
    sources: { businessArea: "주요 고객: 일반 소비자(B2C)", testers: "응답자는 100명 정도 희망합니다", schedule: "B2" } }, "■ 주요 고객 : 일반  소비자 (B2C)\n타겟 …");
  assert.deepStrictEqual(kept?.sources, { businessArea: "주요 고객: 일반 소비자(B2C)" }, `근거 문장 대조 ${JSON.stringify(kept?.sources)}`);
  if (process.argv[2]) writeFileSync(process.argv[2], out);
  console.log(`PASS 기획안 HWPX — 표 ${tables}개 격자 정상, 템플릿 글 없음`);
}
main().catch((e) => { console.error(e); process.exit(1); });
