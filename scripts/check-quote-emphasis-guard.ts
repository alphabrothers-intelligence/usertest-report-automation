/**
 * 인용문 싣기 직전 보정(`prepareQuote`) 회귀 검사. API·DB 불필요.
 * 사례는 전부 2026-09-30 케어클 report b852d373에서 실제로 강조 없이·통째로 실린 인용문이다.
 */
import { prepareQuote } from "../lib/report/quoteEmphasis";

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures += 1;
}
const marked = (display: string) => display.match(/\*\*__([\s\S]+?)__\*\*/)?.[1] ?? null;

const guide = "팩이 가이드역할을 해주고, 피부에 닿아야지만 작동하고, 특히 진동으로 알림이와서 다음으로 넘어갈 타이밍을 알 수 있는것이 편리하고";
const r1 = prepareQuote(guide, guide, "부위별 구분 및 마스크팩 가이드 편의성 마스크팩 구간 표시가 초보 사용자의 사용 편의성을 높이는 핵심 요소로 확인됨");
check("강조 없는 짧은 인용문 — 인사이트와 겹치는 절을 강조", marked(r1.display)?.includes("가이드") === true, r1.display);
check("짧은 인용문은 자르지 않음", r1.quote === guide, r1.quote);

const glow = "‘shot 기능’ 후 마무리 단계에서 활용할 수 있다는 점이 좋았습니다.\n피부에 남은 젤을 흡수시켜주는 용도로 자연스럽게 이어져서 사용하니까 훨씬 부담이 덜했습니다.\n‘피부결 개선용 기능’이라고 따로 생각하면 조금 귀찮아서 손이 안 갈 수도 있는데, 이렇게 이전 단계와 연결되어 자연스럽게 마무리 관리로 이어지는 순서가 좋았습니다. 에스테틱에서 시술 후 마무리 케어를 받는 느낌으로 사용하니 만족도가 높았습니다";
const r2 = prepareQuote(glow, glow, "타 기능과 연계한 사용 만족 타 모드 이후 마무리 단계로 연계 시 부담 없이 사용되는 흐름 형성");
check("229자 인용문 — 130자 이하로 좁힘", r2.quote.length <= 130, `${r2.quote.length}자`);
check("좁힌 인용문도 원문의 연속 구간", glow.includes(r2.quote), r2.quote);
check("좁힌 인용문에 강조가 있음", marked(r2.display) !== null, r2.display);

const kept = "모든 LED색상이 순환된다고 되어있는데, 사용 중에 모든 LED 색상이 나올 때까지 기기를 한 자리에 **__고정해야 하는지__** 명확하지 않아";
const plain = kept.replace(/\*\*__|__\*\*/g, "");
const r3 = prepareQuote(plain, kept, "아무 상관 없는 문맥");
check("모델이 준 강조는 살리되 평가어까지 이어짐", marked(r3.display) === "고정해야 하는지 명확하지 않아", r3.display);

const led = "설명이 다소 애매하게 느껴졌습니다.\n설명서의 그림을 보면 ‘shot’이라는 단어 아래 여러 색상의 LED가 한 번에 묶여 설명되어 있었는데, 실제로 기기에는 shot, eye, body처럼 모드가 각각 따로 표시되어 있습니다. 그래서 처음에는 shot 모드에서 여러 색상이 순서대로 나온다는 의미인지,\n아니면 모드별로 각기 다른 색상이 출력된다는 의미인지 헷갈렸습니다";
const r5 = prepareQuote(led, led, "모드-컬러 매핑 설명 부족으로 인한 혼란 EMS 등 복합 모드에서 LED 색상 순환의 의미와 사용법 안내가 불충분해 사용자 혼란 유발");
check("줄바꿈으로 갈린 문장을 반쪽으로 자르지 않음", !/[,，]$/.test(r5.quote) && r5.quote.length <= 130, r5.quote);

const wide = "파트너 메뉴에 꾸미기 탭이 있기에 펫을 꾸미고 싶었는데 도대체 **__어디서 아이템들을 획득할 수 있는지 몰라 헤맸습니다. 상점은 보통 유료로 결제하는 경우가 많아 여기서 꾸미기 아이템을 구매하면 당연히 유료일 거라고 생각했습니다__**";
const r6 = prepareQuote(wide.replace(/\*\*__|__\*\*/g, ""), wide, "꾸미기 아이템 획득·안내 부족(튜토리얼·UI 미흡) 획득 경로·구매 안내 부족이 초기 사용 진입장벽으로 작용");
check("모델이 준 강조가 너무 길면 70자 안으로 좁힘", (marked(r6.display)?.length ?? 99) <= 70, r6.display);

const noOverlap = "너무 느려 제대로 테스트를 못 했을 정도다. 때문에 이런 상황이면 교배를 하려고 해도 상당한 부담이 있을 수 밖에 없다";
const r7 = prepareQuote(noOverlap, noOverlap, "전혀 관계없는 문맥");
check("겹치는 말이 없어도 강조를 비워두지 않음", marked(r7.display) !== null, r7.display);

const single = "딱히 성장하는 재미를 크게 주지 못한 점이 크다고 생각된다";
const r8 = prepareQuote(single, single, "관계없는 문맥");
check("한 절짜리 짧은 인용문도 강조가 남음", marked(r8.display) !== null, r8.display);

const growth = "그냥 반복적인 작업이라는 생각이 들었다. **__육성을 해도 모습이 바뀌지 않는점__**은 아쉬웠다.";
const r9 = prepareQuote(growth.replace(/\*\*__|__\*\*/g, ""), growth, "성장/변화의 시각적 피드백 부족");
check("강조가 평가어(아쉬웠다)까지 이어짐", marked(r9.display) === "육성을 해도 모습이 바뀌지 않는점은 아쉬웠다", r9.display);

const egg = "알이 등급별로 있는데 **__부화할때 이펙트가 딱히 없는게__** 아쉬움";
const r10 = prepareQuote(egg.replace(/\*\*__|__\*\*/g, ""), egg, "성장/변화의 시각적 피드백 부족");
check("인용문 끝의 평가어(아쉬움)까지 이어짐", marked(r10.display) === "부화할때 이펙트가 딱히 없는게 아쉬움", r10.display);

const cute = "펫에게 옷을 입히면 꾸민다는 느낌이 들어 마음에 들었습니다 일부 게임들은 옷을 입혀도 **__꾸미는 느낌이 들지 않아 부정적으로 바라보게 된 것들이 적지 않은데 해당 게임은 이러한 문제 없이 모두 잘 소화시키고 무엇보다 아오그냥입히면겁나귀여워__**";
const r11 = prepareQuote(cute.replace(/\*\*__|__\*\*/g, ""), cute, "펫 꾸미기 콘텐츠 자체의 귀여움과 만족감");
check("긴 강조는 앞을 덜어 이유 끝(귀여워)을 지킴", (marked(r11.display) ?? "").endsWith("귀여워") && (marked(r11.display)?.length ?? 99) <= 70, r11.display);

const preview = "구매 전 미리 아이템을 착용해볼 수가 있어 나만의 펫을 가꾸는데 있어 매우 편리하다고 느꼈다";
const r12 = prepareQuote(preview, preview, "미리보기·직관적 조작 편의성 구매 전 미리보기 기능이 사용 편의성과 구매 결정에 긍정적 영향");
check("한 문장 인용문은 이유절에서 끝냄(시작이 어색하지 않게)", (marked(r12.display) ?? "").startsWith("구매 전 미리"), r12.display);

const r4 = prepareQuote("좋아요", "좋아요", "보상 체계 매력도 개선 필요");
check("4자 미만 인용문은 강조하지 않음", marked(r4.display) === null, r4.display);

console.log(failures === 0 ? "\n전부 PASS" : `\n${failures}건 FAIL`);
process.exit(failures === 0 ? 0 : 1);
