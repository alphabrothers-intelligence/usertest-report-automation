/**
 * 설문 문항 작성 가이드(매뉴얼) 위반 검사 — 문자열로 잡히는 것만 본다. API 호출 없음.
 * 단일성·중립성처럼 뜻을 읽어야 하는 원칙은 낱말로 의심만 표시한다(`level: "확인"`) — 사람이 판단한다.
 */
import { EXCEPTION_OPTION } from "./generate";
import { isChoice, numberQuestions, type SurveyDraft } from "./types";

export interface LintIssue {
  id: string;
  number: string;
  principle: string;
  level: "위반" | "확인";
  message: string;
}

/** "1~2회", "3회 이상 5회 미만" 같은 보기에서 [하한, 상한, 상한 포함 여부]를 읽는다. */
function range(option: string): [number, number, boolean] | null {
  const tilde = option.match(/(\d+)[^\d~\-]{0,3}[~\-]\s*(\d+)/);
  if (tilde) return [+tilde[1], +tilde[2], true];
  const between = option.match(/(\d+)\D*이상\s*(\d+)\D*미만/);
  if (between) return [+between[1], +between[2], false];
  return null;
}

export function lintSurvey(draft: SurveyDraft): LintIssue[] {
  const numbers = numberQuestions(draft.questions);
  const issues: LintIssue[] = [];
  for (const q of draft.questions) {
    const add = (principle: string, level: LintIssue["level"], message: string) =>
      issues.push({ id: q.id, number: numbers.get(q.id) ?? "", principle, level, message });
    const text = q.text;
    const all = [text, ...q.options].join(" ");

    if (/습니까|십니까|입니까/.test(text)) add("통일성", "위반", "'~습니까' 대신 '~요?'");
    if (/있으신|으신가요|우셨나요|하실 의향/.test(text)) add("통일성", "위반", "과도한 높임");
    const jargon = all.match(/\bUI\b|\bUX\b|인터페이스|직관성|어플리케이션/);
    if (jargon) add("명확성", "위반", `전문 용어 '${jargon[0]}'`);
    const vague = text.match(/자주|많이|가끔/);
    if (vague && !/얼마나 자주/.test(text)) add("구체성", "확인", `'${vague[0]}' 대신 기간·횟수 기준`);
    if (/(이나|거나|또는) /.test(text) && !q.followUp) add("단일성", "확인", "두 대상·판단을 한 문항에 묶었는지");
    if (q.followUp && q.type === "주관식" && (text.match(/\?/g) ?? []).length > 1) add("단일성", "위반", "이유 문항에 질문이 둘");

    if (q.type === "척도(0-10)" && !/0\s*[=:]/.test(q.note)) add("만족도 형식", "위반", "척도 양 끝 라벨 없음");
    if (q.type === "객관식-복수" && !/모두|중복/.test(text)) add("이유 파악 형식", "위반", "복수 선택 표기 없음");
    // "'○○' 기능을 사용해 보셨나요?"(테스트 중 써 봤는지)는 기억의 문제가 아니라 '사용하지 못했어요'가 예외 보기다.
    if (isChoice(q.type) && /적이 있나요|보셨나요/.test(text) && !q.options.some((o) => /기억나지|모르겠|못했어요/.test(o)))
      add("예외포용성", "확인", "경험 문항에 '기억나지 않아요' 없음");
    if (q.type === "객관식-복수" && !q.options.some((o) => EXCEPTION_OPTION.test(o) || /기타/.test(o)))
      add("예외포용성", "위반", "복수 선택에 '해당 없어요'·'기타' 없음");

    const ranges = q.options.map(range);
    for (let i = 0; i + 1 < ranges.length; i++) {
      const [a, b] = [ranges[i], ranges[i + 1]];
      if (a && b && (a[2] ? a[1] >= b[0] : a[1] > b[0])) add("배타성", "위반", `보기 '${q.options[i]}'와 '${q.options[i + 1]}' 경계가 겹침`);
    }
  }
  return issues;
}
