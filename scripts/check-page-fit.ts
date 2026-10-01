/**
 * **PDF가 웹뷰와 같은 쪽 구성으로 나오는지** 실제로 인쇄해서 본다 — `npm run check:page-fit`.
 * LLM·과금 없음. 로컬 dev 서버(:3000)·`data/` 원본·시스템 Chrome이 필요하다.
 *
 * 재는 것은 하나다: **웹뷰의 A4 카드 한 장 = PDF 한 장.** 카드가 한 장을 넘으면 브라우저가
 * 카드를 제멋대로 쪼개고 그 조각에는 여백도 푸터도 없다(lib/report/splitBlock.ts 머리말) —
 * 그때 PDF 쪽수가 카드 수보다 많아지므로 숫자 하나로 잡힌다. 내용이 거의 없는 쪽(빈 장,
 * 푸터만 있는 장)도 같이 센다.
 *
 * **화면 스크린샷으로는 이 버그가 안 보인다.** 실제로 뽑아봐야 한다 — 2026-09-11에 케어클
 * 78쪽 중 50쪽이 완전한 빈 장이었는데 화면은 멀쩡했다.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { openChrome, OVERSIZED_CARDS_EXPRESSION } from "./chromeSession";

const DATASETS = (process.env.CHECK_DATASETS ?? "rivalabs,carecl,ezenauto,cleanhabit,twoblock").split(",");
const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
/** 앞뒤 고정 쪽: 표지 · 목차 · 뒷표지. */
const FRONT_MATTER_PAGES = 3;

/**
 * 글자가 거의 없는 쪽(완전한 빈 장, 푸터만 있는 장)의 번호.
 * **표지·목차·뒷표지는 세지 않는다** — 표지는 원래 이미지와 제목뿐이라 글자가 적다.
 */
function nearEmptyPages(pdfPath: string, pages: number): number[] {
  const out: number[] = [];
  for (let page = 3; page < pages; page += 1) {
    const text = execFileSync("pdftotext", ["-f", String(page), "-l", String(page), pdfPath, "-"], { encoding: "utf8" });
    if (text.replace(/\s/g, "").length < 60) out.push(page);
  }
  return out;
}

async function main() {
  const session = await openChrome();
  let failures = 0;
  try {
    for (const dataset of DATASETS) {
      // `CHECK_DATASETS`에 `report=<uuid>`처럼 `=`가 든 값을 주면 그대로 쿼리로 쓴다 —
      // 데모 raw data뿐 아니라 **저장된 실제 보고서**로도 같은 검사를 돌리기 위해서다.
      const query = dataset.includes("=") ? dataset : `dataset=${dataset}`;
      await session.open(`${BASE}/viewer?${query}`);
      const cards = await session.evaluate<number>(`document.querySelectorAll('[data-section-page]').length`);
      if (cards === 0) {
        console.error(`FAIL ${dataset} — 카드가 하나도 렌더되지 않았습니다(서버·데이터 확인).`);
        failures += 1;
        continue;
      }

      const printed = await session.send("Page.printToPDF", { printBackground: true, preferCSSPageSize: true }) as { data?: string };
      const pdfPath = path.join(session.profile, `${dataset}.pdf`);
      writeFileSync(pdfPath, Buffer.from(printed.data ?? "", "base64"));
      const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
      const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1] ?? 0);
      const expected = cards + FRONT_MATTER_PAGES;
      const empty = nearEmptyPages(pdfPath, pages);

      if (pages === expected && empty.length === 0) {
        console.log(`PASS ${dataset} — 카드 ${cards}장 + 앞뒤 ${FRONT_MATTER_PAGES}장 = PDF ${pages}쪽 / 빈 쪽 없음`);
        continue;
      }
      failures += 1;
      if (pages !== expected) {
        console.error(`FAIL ${dataset} — PDF ${pages}쪽인데 웹뷰는 ${expected}쪽(카드 ${cards}장). 한 장을 넘는 카드가 쪼개졌다는 뜻이다.`);
        // 어느 카드가 넘쳤는지까지 알려준다 — 숫자만 주면 찾는 데 또 한나절이 든다.
        const over = await session.evaluate<string>(OVERSIZED_CARDS_EXPRESSION);
        for (const card of JSON.parse(over) as { index: number; numeral: string; mm: number; first?: string }[]) {
          console.error(`   넘친 카드 #${card.index} (${card.numeral}장) ${card.mm}mm — 첫 블록 ${card.first ?? "?"}`);
        }
      }
      if (empty.length > 0) {
        console.error(`FAIL ${dataset} — 내용이 거의 없는 쪽 ${empty.length}개: ${empty.slice(0, 10).join(", ")}`);
      }
    }
  } finally {
    session.close();
  }
  if (failures > 0) {
    console.error(`\n${failures}개 raw data에서 PDF가 웹뷰와 다르게 나옵니다`);
    process.exit(1);
  }
  console.log("\n모든 raw data에서 PDF 쪽 구성이 웹뷰와 같다");
}

void main();
