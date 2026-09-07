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

// --- 카테고리(묶음) 단위 확인 표시 ---
// 보고서가 실제로 쓰는 fast 경로(lib/pipeline/fastReportAnalysis.ts)는 절을 반환하지 않아
// 위 scoreConfidence를 걸 자리가 없다. 같은 6.4절 휴리스틱을 카테고리 텍스트에 그대로 적용해
// **부정↔중립 경계에 걸린 묶음만** 표시한다. 흔들림 자체를 없애지는 못하지만(실측:
// check:qualitative-fidelity의 부정 vs 중립 71.4%), 매번 다른 판정이 조용히 지나가지는 않는다.
// **승인 게이트가 아니라 표시다**(memory: review-flag-not-gate).
const CATEGORY_SENTIMENT_WORDS = [...SENTIMENT_WORDS, "별로", "그냥", "무난", "부족", "애매", "실망"];
// "구체적 손해 서술" — 무엇이 어떻게 안 됐는지가 적힌 신호. 하나라도 있으면 경계 사례가 아니다.
const CONCRETE_HARM_WORDS = ["못", "안되", "안돼", "안 돼", "안됨", "되지 않", "되지않", "오류", "실패", "느리", "끊", "버벅", "복잡", "어렵", "헷갈", "모르겠", "안보", "안 보"];
// ponytail: 길이는 "구체적인가"의 대용치다. 낱말 목록만으로는 상세한 불만("연출이 부족하여 보는
// 재미가 심각하게 떨어졌다")까지 걸려 표시가 노이즈가 된다 — 실측(리바랩스 report, 부정·중립
// 121개)에서 낱말만 쓰면 24건이 걸리고 대부분 이미 구체적인 서술이었다. 길이 조건을 더하면
// 11건으로 줄고 남는 것이 실제로 애매한 묶음이었다. 더 정확히 하려면 LLM 재판정이 필요한데
// 그건 6.4절이 규칙 기반으로 못 박은 자리라 여기서는 하지 않는다.
const SHORT_QUOTE_CHARS = 40;

export interface CategoryPolarityReview {
  /** 담당자에게 보여줄 확인 사유. */
  reason: string;
  /** 이 판정을 흔들리게 만든 표현들 — 패널에서 인용문의 해당 부분을 강조하는 데 쓴다. */
  signals: string[];
}

/** 부정·중립 카테고리 중 "감정어만 있고 구체적 손해 서술이 없는" 묶음이면 확인 사유를, 아니면 null. */
export function categoryPolarityNeedsReview(category: {
  polarity: Polarity | null;
  quotes: string[];
}): CategoryPolarityReview | null {
  if (category.polarity !== "negative" && category.polarity !== "neutral") return null;
  // 라벨은 Stage2가 쓴 요약이라 "~부족", "~불편"처럼 감정어가 거의 항상 들어간다. 판정은
  // 응답 원문(quotes)으로만 한다 — 라벨까지 넣으면 구체적인 묶음이 전부 딸려 온다(실측).
  const text = category.quotes.join(" ");
  if (!text) return null;
  const signals = CATEGORY_SENTIMENT_WORDS.filter((word) => text.includes(word));
  if (signals.length === 0) return null;
  if (CONCRETE_HARM_WORDS.some((word) => text.includes(word))) return null;
  if (!category.quotes.every((quote) => quote.length < SHORT_QUOTE_CHARS)) return null;
  return {
    reason: "이 묶음의 응답에는 감정 표현만 있고, 무엇이 어떻게 불편했는지가 없습니다. 부정으로 둬도 중립으로 옮겨도 말이 되는 자리라 AI 판정이 실행할 때마다 달라질 수 있습니다.",
    signals,
  };
}
