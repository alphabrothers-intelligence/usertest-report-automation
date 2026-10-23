/**
 * 경쟁재 장단점 표의 누락 브랜드 보충 검사 `npx tsx scripts/check-competitor-brands.ts`. API·DB 불필요.
 * 모델이 응답에 나온 브랜드를 표에서 빠뜨려도(케어클 '셀리턴' 실측) '기타' 제품명 칸에 붙는지 본다.
 */
import assert from "node:assert";
import { withMissingBrands } from "../lib/pipeline/sectionAnalysis";
const q = "어떤 뷰티 디바이스를 사용해 보셨나요?";
const responses = [
  { answers: [{ question: q, text: "메디큐브" }] },
  { answers: [{ question: q, text: "셀리턴 LED 마스크, 메디큐브 에이지알 부스터 프로 미니" }] },
  { answers: [{ question: "위와 같이 평가한 이유는 무엇인가요?", text: "가격이 비쌈" }] },
];
const rows = [{ service: "메디큐브", product: "에이지알 부스터 프로 미니", pros: ["가벼움"], cons: [] }];
const out = withMissingBrands(rows, responses);
assert.deepStrictEqual(out.map((r) => [r.service, r.product]), [["메디큐브", "에이지알 부스터 프로 미니"], ["기타", "셀리턴 LED 마스크"]]);
assert.strictEqual(withMissingBrands(out, responses).length, 2, "이미 있으면 다시 붙이지 않는다");
assert.strictEqual(rows.length, 1, "입력 행을 바꾸지 않는다");
// 표기 흔들림과 문장 답은 붙이지 않는다(케어클 실측: 엘지프라엘·듀얼소딕·"주 1회 마사지샵에서 정기적으로 받음").
const noisy = withMissingBrands([{ service: "LG프라엘", product: "", pros: [], cons: [] }, { service: "듀얼소닉", product: "", pros: [], cons: [] }], [
  { answers: [{ question: q, text: "엘지프라엘, 듀얼소딕" }] },
  { answers: [{ question: q, text: "주 1회 마사지샵에서 정기적으로 받음" }] },
  { answers: [{ question: q, text: "메디큐브. 아주 예전꺼 써본 경험 있어요" }] },
]);
assert.deepStrictEqual(noisy.map((r) => r.service), ["LG프라엘", "듀얼소닉"], "흔들린 표기·문장 답은 기타에 붙지 않는다");
console.log("PASS 경쟁재 표 누락 브랜드 보충");
