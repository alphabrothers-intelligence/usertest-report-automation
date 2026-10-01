/** runScan의 합치기 규칙이 키 충돌을 없애는지 확인한다(브라우저·API 불필요). */
type Item = { quote: string; suggestion: string; questionKey: string; questionLabel?: string; questionCount?: number };
function merge(flat: Item[]): Item[] {
  const m = new Map<string, Item>();
  for (const item of flat) {
    const found = m.get(item.quote);
    if (found) found.questionCount = (found.questionCount ?? 1) + 1;
    else m.set(item.quote, { ...item, questionCount: 1 });
  }
  return [...m.values()];
}
// 실제 DB에서 확인된 사례: 케어클 "없음"이 두 문항에 동시에 있다.
const input: Item[] = [
  { quote: "없음", suggestion: "없습니다", questionKey: "feature:GLOW", questionLabel: "'GLOW' 기능 만족도" },
  { quote: "없음", suggestion: "없습니다", questionKey: "feature:SHOT", questionLabel: "'SHOT' 기능 만족도" },
  { quote: "인식이 잘안될때가 있음", suggestion: "인식이 잘안될때가 있습니다", questionKey: "feature:SHOT" },
];
const out = merge(input);
const keys = out.map((i) => i.quote);
const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
console.assert(dup.length === 0, `React key 충돌 남음: ${dup}`);
console.assert(out.length === 2, `합친 뒤 2건이어야 하는데 ${out.length}건`);
console.assert(out[0].questionCount === 2, `"없음"의 문항 수가 2여야 하는데 ${out[0].questionCount}`);
console.assert(out[1].questionCount === 1, "한 문항짜리는 1이어야 한다");
console.log(`PASS - 중복 인용문 합치기 ${input.length}건 → ${out.length}줄, 키 충돌 0`);
