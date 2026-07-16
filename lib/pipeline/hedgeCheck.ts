// 헤지 워딩 1차 검사 (PRD 7.2절 대상②) — "금지 표현 목록에 대한 문자열 매칭"으로 규칙 기반
// 검사한다(LLM 재호출 없음). 위반 가능성이 있는 문장을 하이라이트하기 위한 용도이며, 문장이
// "사실 서술"인지 "해석"인지까지 구분하지는 않는다(6.5절 원문 그대로의 1차 검사 수준).

const FORBIDDEN_PATTERNS: { label: string; regex: RegExp }[] = [
  { label: "판단된다/판단됨", regex: /판단된다|판단됨/ },
  { label: "때문이다", regex: /때문이다/ },
  { label: "인 요소이다", regex: /인\s*요소이다/ },
];

const HEDGE_PHRASES = ["해석할 수 있", "볼 수 있", "일 가능성이 있", "로 보임", "보입니다"];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?다음])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface HedgeViolation {
  type: "forbidden_phrase" | "no_hedge_ending";
  detail: string;
}

export function checkHedgeWording(text: string): HedgeViolation[] {
  const violations: HedgeViolation[] = [];

  for (const { label, regex } of FORBIDDEN_PATTERNS) {
    if (regex.test(text)) {
      violations.push({ type: "forbidden_phrase", detail: `금지 표현 포함 가능성: "${label}"` });
    }
  }

  const hasHedgePhrase = HEDGE_PHRASES.some((p) => text.includes(p));
  const sentences = splitSentences(text);
  const lastSentence = sentences[sentences.length - 1] ?? "";
  const endsWithBareDeclarative = /(다|다\.)$/.test(lastSentence.trim()) && !hasHedgePhrase;

  if (!hasHedgePhrase || endsWithBareDeclarative) {
    violations.push({
      type: "no_hedge_ending",
      detail:
        "필수 헤지 표현(~로 해석할 수 있음/볼 수 있음/일 가능성이 있음/로 보임)이 안 보입니다.",
    });
  }

  return violations;
}
