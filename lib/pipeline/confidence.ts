// 극성 판정 신뢰도 스코어링 (PRD 6.4절). Stage1 출력에 규칙 기반으로만 플래그를 붙인다
// (LLM 재호출 없음) — 체크포인트 A(7.1절)가 이 플래그로 검수 대상을 추려낸다.
import type { Polarity } from "./stage1";

export type ConfidenceLevel = "high" | "medium" | "low";

// 6.4절 실증 사례("불편"이 포함된 문장이 negative/neutral로 갈렸던 사례)에서 착안한 1차 휴리스틱.
const SENTIMENT_WORDS = ["불편", "아쉽"];

export function scoreConfidence(clause: { polarity: Polarity; rationale: string }): ConfidenceLevel {
  if (clause.polarity === "positive") return "high";

  const hasSentimentWord = SENTIMENT_WORDS.some((w) => clause.rationale.includes(w));
  return hasSentimentWord ? "low" : "medium";
}
