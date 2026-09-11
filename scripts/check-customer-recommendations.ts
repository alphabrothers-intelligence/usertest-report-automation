/**
 * Ⅸ.3 "기능별 고객 제언 종합"이 **조용히 통째로 사라지지 않는지** 본다 —
 * `npm run check:customer-recommendations`. API·DB 불필요(스키마·정리 로직만 검사).
 *
 * 2026-09-10 사고: 주관식이 없어 부정 카테고리가 하나도 없는 기능에 모델이 `"actions": []`를
 * 냈는데, 스키마가 `min(2)`라 **응답 전체가 검증에 걸려** 잘 만든 9개 기능까지 버려졌다.
 * 실패는 `console.error` 한 줄로만 남아 담당자는 "왜 이 절이 안 나오지"만 알 수 있었다.
 */
import assert from "node:assert";
import { FeatureCustomerRecommendationSchema, dropEmptyFeatures } from "../lib/pipeline/customerRecommendations";

let passed = 0;
function check(name: string, run: () => void) {
  run();
  passed += 1;
  console.log(`PASS ${name}`);
}

check("빈 actions가 섞여도 응답 전체가 죽지 않는다", () => {
  const parsed = FeatureCustomerRecommendationSchema.safeParse({
    features: [
      { featureName: "예약", actions: ["가", "나"] },
      { featureName: "견적 신뢰도", actions: [] },
    ],
  });
  assert.ok(parsed.success, "빈 actions 하나 때문에 검증이 실패하면 안 된다");
});

check("actions는 6개까지", () => {
  const parsed = FeatureCustomerRecommendationSchema.safeParse({
    features: [{ featureName: "예약", actions: ["1", "2", "3", "4", "5", "6", "7"] }],
  });
  assert.ok(!parsed.success, "7개는 거부해야 한다");
});

check("빈 기능은 코드가 걸러낸다", () => {
  const out = dropEmptyFeatures({
    features: [
      { featureName: "예약", actions: ["가", "나"] },
      { featureName: "견적 신뢰도", actions: [] },
    ],
  });
  assert.deepStrictEqual(out.features.map((feature) => feature.featureName), ["예약"]);
});

console.log(`\n${passed}/${passed} PASS`);
