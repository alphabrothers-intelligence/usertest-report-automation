/**
 * **글을 고치면 쪽이 다시 나뉘는지** 실제 브라우저로 본다 — `npm run check:edit-reflow`.
 * LLM·과금 없음. 로컬 dev 서버(:3000)·저장된 보고서 1건·시스템 Chrome이 필요하다.
 *
 * 재는 것은 둘이다.
 * 1. **넘치는 카드가 없다** — 문단 하나에 글을 잔뜩 넣어도 줄 단위 분할이 A4 안으로 되돌린다.
 *    이 경로는 `check:page-fit`(데모 raw data)이 못 짚는다. 데모에는 편집 가능한 본문 블록이
 *    없어 긴 문단이 안 생기기 때문이다(2026-09-14 실측: 6,000자를 넣으니 카드가 938mm였고
 *    그때는 카드 수가 그대로였다 — 문단을 못 잘라 재나눔이 무의미했다).
 * 2. **글자가 하나도 안 없어지고 안 겹친다** — 조각내기는 "원문의 연속 구간 고르기"여야 한다.
 *    조용히 한 조각이 사라지는 것이 이 작업에서 제일 무서운 실패다.
 */
import { openChrome, OVERSIZED_CARDS_EXPRESSION } from "./chromeSession";

const BASE = process.env.CHECK_BASE_URL ?? "http://localhost:3000";
/** 넣을 문구와 반복 횟수 — 한 문단이 여러 쪽 분량이 되게 넉넉히 잡는다. */
const PHRASE = "가나다라마바사아자차카타파하";
const REPEAT = 400;

async function main() {
  const reports = await (await fetch(`${BASE}/api/reports`)).json() as { ok: boolean; reports?: { id: string }[] };
  const reportId = reports.reports?.[0]?.id;
  if (!reportId) {
    console.error("FAIL — 저장된 보고서가 없습니다. 보고서를 하나 만든 뒤 다시 돌리세요.");
    process.exit(1);
  }

  const session = await openChrome();
  let failures = 0;
  try {
    await session.open(`${BASE}/viewer?report=${reportId}`);
    const cardsBefore = await session.evaluate<number>(`document.querySelectorAll('[data-section-page]').length`);

    // 사람이 타이핑한 것과 같은 경로(input 이벤트)로 넣는다 — onChange가 sections를 갱신하고
    // 그 변화가 재측정을 부른다. DOM만 바꾸면 제품이 실제로 도는 길을 안 재게 된다.
    const blockId = await session.evaluate<string>(`(() => {
      const editor = [...document.querySelectorAll('[data-report-block-id] .report-rich-editor')].find((node) => (node.textContent || '').length > 40);
      if (!editor) return '';
      const target = editor.querySelector('p, div') ?? editor;
      target.textContent = (target.textContent || '') + ' ${PHRASE} '.repeat(${REPEAT});
      editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return editor.closest('[data-report-block-id]').dataset.reportBlockId;
    })()`);
    if (!blockId) {
      console.error("FAIL — 편집 가능한 본문 블록을 찾지 못했습니다(정성 분석이 끝난 보고서가 필요합니다).");
      process.exit(1);
    }
    // 재측정은 분할 → 재렌더 → 재측정을 몇 차례 돈다. 카드가 안정될 때까지 기다린다.
    const cardsAfter = await session.settle();
    const oversized = JSON.parse(await session.evaluate<string>(OVERSIZED_CARDS_EXPRESSION)) as { index: number; mm: number; first?: string }[];
    // 조각 id는 원래 id로 시작한다(`X--p2`) — 접두로 모으면 쪼개진 조각을 다 모을 수 있다.
    const repeats = await session.evaluate<number>(
      `([...document.querySelectorAll('[data-report-block-id^="${blockId}"]')].map((node) => node.innerText).join('').match(/${PHRASE}/g) || []).length`,
    );

    if (oversized.length > 0) {
      failures += 1;
      console.error(`FAIL — 글을 넣은 뒤 A4를 넘긴 카드 ${oversized.length}개: ${oversized.map((card) => `#${card.index} ${card.mm}mm(${card.first ?? "?"})`).join(", ")}`);
    } else {
      console.log(`PASS 넘치는 카드 없음 — 카드 ${cardsBefore}장에서 ${cardsAfter}장으로 다시 나뉘었다`);
    }

    if (repeats !== REPEAT) {
      failures += 1;
      console.error(`FAIL — 넣은 문구가 ${REPEAT}번인데 조각들에는 ${repeats}번 남았습니다(글이 사라지거나 겹쳤다는 뜻).`);
    } else {
      console.log(`PASS 글자 보존 — 넣은 문구 ${REPEAT}번이 조각 전체에 정확히 ${repeats}번 남았다`);
    }
  } finally {
    session.close();
  }

  if (failures > 0) {
    console.error("\n편집 후 쪽 재나눔이 제대로 동작하지 않습니다");
    process.exit(1);
  }
  console.log("\n글을 고쳐도 쪽이 A4 안에서 다시 나뉜다");
}

void main();
