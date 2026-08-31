/**
 * 문항 역할 분류 에이전트 — 범용화 파이프라인 2단계(PRD 2.2.2절).
 *
 * **이 파이프라인에서 AI가 판단하는 곳은 여기 하나뿐이다.** "이 문항이 무엇을 묻는가"(역할)만
 * 정하고, 목차·레이아웃·수치는 전부 뒤의 결정론 단계가 정한다. 그래서 보고서가 틀렸을 때
 * 의심할 곳이 하나로 좁혀진다.
 *
 * 입력은 1단계 프로파일(`lib/agent/profile.ts`)뿐이다 — **응답 원문(개인정보)은 보내지 않는다.**
 * 호출은 **보고서당 1회**다. 문항마다 부르면 문항 *간* 관계(같은 행렬 그룹인지, 순위 문항의
 * 항목이 만족도 문항과 같은지)를 판단할 수 없다.
 *
 * 판정 근거표는 `docs/QUESTION_SECTION_LAYOUT_MAP.md` §2(R1~R13), 출력 계약은 같은 문서 §4.
 */
import { Output } from "ai";
import { z } from "zod";
import { anthropic } from "@/lib/anthropic";
import { streamStructured, withClaudeGuard } from "@/lib/pipeline/claudeGuard";
import { ageBracketDistribution } from "@/lib/quant/basic";
import type { ColumnProfile, ColumnType } from "./profile";
import type { PlannedQuestion, QuestionRole, SectionPlanInput } from "./sectionPlan";

const MODEL = process.env.ANTHROPIC_CLASSIFY_MODEL ?? "claude-sonnet-5";

/**
 * `journey`(시점별 경험)를 뒷받침하는 **시간 표현**. 이게 없으면 시점 문항이 아니다.
 *
 * `첫 화면`처럼 시점이 아닌 "첫"은 걸리지 않게 좁게 잡았다 — 정리습관 `홈페이지 첫 화면에서…`가
 * journey로 판정돼 원본에 없는 "고객 여정" 장이 생긴 실측(2026-08-27) 때문이다.
 * 케어클의 실제 시점 문항 5개(첫인상 · 처음 열어 · 처음 사용 · 일주일 · 2주간)는 전부 걸린다.
 * `주기`·`사용 시간`은 체험 기간의 사용 실태 문항(케어클 Q18·Q19)을 살리려고 나중에 넣었다 —
 * 원본이 이 둘을 고객 여정 장에 싣는다(2026-08-27 케어클 원본 대조).
 */
export const TIME_MARKER =
  /첫인상|최초|개봉|처음\s*\S{0,3}(받|열|사용|이용|접|써|봤|보셨)|일주일|한\s*달|\d+\s*(주|일|개월|달|주차)|사용\s*(한\s*)?(후|뒤)|이후|초기|주기|사용\s*시간/;

/**
 * 고객사가 따로 부탁해 끼워 넣은 문항. WALLA는 섹션 제목을 헤더 접두로 붙이므로
 * (`기업 요청 질문 - Q23. …`) 이 접두가 유일하고 분명한 신호다.
 *
 * **모델에게 맡기면 못 잡는다.** 문항 자체가 `~에 대한 만족도를 평가해주세요`라 기능 만족도와
 * 똑같이 생겨서, 투블럭 6컬럼을 확신 0.8~0.85로 `feature`라 답했다(2026-08-27 실측). 확신이
 * 높으니 확인 카드에도 안 떠서 사람도 못 잡는다 — 그래서 프롬프트가 아니라 코드가 덮어쓴다.
 * `단계매핑` 시트는 이 문항들을 마지막 장(S9 개선 아이디어 및 추가 질문)에 모은다.
 */
const ENTERPRISE_HEADER = /^\s*기업\s*요청\s*질문\s*[-–—]/;

/** 이 값 미만이면 확인 카드로 보여준다. **작업을 막지는 않는다**(7장 — 검토는 게이트가 아니다). */
export const REVIEW_CONFIDENCE = 0.7;
/** 판정 못 한 문항이 이 비율을 넘으면 파일을 거부한다(근거 없는 보고서를 만들지 않는다). */
const REJECT_UNASSIGNED_RATE = 0.2;

const ROLES = [
  "demographic",
  "context",
  "prior_service",
  "feature",
  "task_flow",
  "journey",
  "purchase_factor",
  "value",
  "ux_quality",
  "overall",
  "intent",
  "improvement",
  "meta",
  "unassigned",
] as const;

const ClassificationSchema = z.object({
  questions: z.array(
    z.object({
      columnIndex: z.number().int(),
      role: z.enum(ROLES),
      /** 기능명·가치축 이름. 없으면 null. */
      itemName: z.string().nullable(),
      /** 같은 척도 묶음 이름(`실용성`·`즐거움`). ux_quality 필수, 그 외 null. */
      groupKey: z.string().nullable(),
      /** journey·task_flow의 진행 순서(1부터). 그 외 null. */
      orderKey: z.number().int().nullable(),
      /** 0~1. `unassigned`이거나 애매하면 낮춘다. */
      confidence: z.number(),
      /** `unassigned`·저신뢰일 때 확인 카드에 보여줄 한 줄 사유. */
      reason: z.string().nullable(),
    }),
  ),
});

type RawClassification = z.infer<typeof ClassificationSchema>;

const SYSTEM_PROMPT = `당신은 사용성 테스트 설문의 컬럼 목록을 읽고 **각 문항이 무엇을 묻는지(역할)**만 판정한다.
그래프·표·목차는 다른 단계가 정하므로 절대 제안하지 않는다.

## 역할 목록과 판정 신호

- demographic: 응답자 속성. 설문 앞부분(첫 척도 문항 이전)의 나이·성별·직업·경력·기기 등.
- context: 제품을 쓰기 전의 습관·빈도·태도. 인적사항 직후의 범주형("하루 평균 걷는 시간", "정리가 어렵다고 느낀 적").
- prior_service: 경쟁·유사 서비스 경험. 게이팅 문항("~경험이 있으십니까?")과 **그 뒤에 딸린 종속 컬럼 전부**(서비스명·장점·단점·만족도·이유). 종속 컬럼은 결측률이 높다.
- feature: 개별 기능 만족도 척도. "'{기능명}' 기능의 만족도" 형태가 연속 반복된다.
- task_flow: 이용 **단계**별 만족도 척도. "~을 선택/입력/확인하는 과정이 얼마나 만족스러웠나요"가 연속 반복.
- journey: **시점**별 경험 척도. 같은 대상을 시간 표현(첫인상·개봉·1주 후 등)과 함께 반복해 묻는다.
- purchase_factor: 구매·이용 결정 요인. 단일선택("가장 영향을 미칠 수 있는 핵심 요인") 또는 순위(헤더가 1위…N위, 값이 항목명).
- value: 가치·품질 평가축. "{축 이름} 가치 영역 만족도" 형태가 3개 이상 연속. 축 이름과 개수는 데이터에서 나온다(4개 고정 아님).
- ux_quality: 의미분별 척도(SD scale). "{그룹명}{번호}) {대상}이 [{부정어} / {긍정어}]" 형식. groupKey는 그룹명(실용성·즐거움).
- overall: 전반적/종합 만족도.
- intent: 사용·추천 의향. 헤더가 NPS이거나, 문장형이면 "추천"+"의향" 동시 포함 + 0~10 척도.
- improvement: 개선 아이디어 자유서술.
- meta: 보고서에 안 쓰는 컬럼. 응답시간·동의 문항·개인정보(이름/연락처/차량번호)·업로드 첨부·운영 항목.
- unassigned: 위 어디에도 확신이 없을 때. **지어내지 말고 이걸 쓰고 reason에 이유를 적는다.**

## 규칙

1. 모든 컬럼을 빠짐없이 한 번씩 판정한다. columnIndex는 입력에 있는 값을 그대로 쓴다.
2. **이유 컬럼(reasonFor가 있는 자유서술)은 앞 문항과 같은 역할**을 준다. 그 문항의 근거 서술이기 때문이다.
3. itemName: 기능명·가치축 이름처럼 **도표 항목으로 쓸 짧은 이름**을 헤더에서 뽑는다(따옴표 안 이름, 접두 뒤 이름). 없으면 null.
4. groupKey는 ux_quality에만, orderKey는 journey·task_flow에만 준다. orderKey는 설문에 나온 순서(1부터), 중복 금지.
5. confidence는 판정 근거의 확실함이다. 신호가 그대로 맞으면 0.9 이상, 형태로만 추정했으면 0.6 이하로 낮춘다.
6. 유형(single/multi/rank/scale/text/meta)은 이미 값에서 규칙으로 판정돼 입력에 들어 있다. **이를 뒤집지 말고 역할 판정의 근거로 쓴다.**

## 경계 규칙 (실측으로 갈렸던 곳)

- **journey vs task_flow**: \`~을 선택/입력/확인하는 과정이 만족스러웠나요\`처럼 행위 과정을 묻는 척도는 **task_flow가 우선**이다. 시간 표현(첫인상·개봉·처음·1주 후·2주간 등)이 헤더에 없으면 journey가 아니다.
- **overall vs task_flow**: overall은 **제품·서비스 전반**의 만족도(보통 1문항)다. \`전체 신청 단계의 흐름이 이해하기 쉬웠나요\`, \`각 단계의 목적이 명확했나요\`처럼 특정 흐름·화면의 이해도를 묻는 문항은 "전체"라는 말이 있어도 overall이 아니라 task_flow다.
- **value vs purchase_factor**: purchase_factor 문항의 **선택지와 같은 항목**을 하나씩 만족도로 묻는 척도(예: 요인이 \`가격/신뢰도/편의성/시간\`이고 뒤에 \`가격 만족\`, \`신뢰도 만족\`…이 이어짐)는 value가 아니라 **purchase_factor**다. 그 요인에 대한 만족도이기 때문이다. value는 \`{축 이름} 가치 (영역) 만족도\`처럼 **가치**를 명시한 축일 때만 쓴다.
- **ux_quality**: 헤더에 계열 접두(\`실용성1)\`·\`즐거움2)\`)가 있는 의미분별 척도에만 쓴다. 접두가 없으면 화면·단계 평가라도 ux_quality가 아니다.
- **context vs journey**: context는 제품을 쓰기 **전**의 습관이다. \`제품을 어느 정도 주기로 사용하셨나요\`, \`한 번 사용할 때 사용 시간은\`처럼 **체험 기간 중**의 사용 실태를 묻는 문항은 습관이 아니라 시점 흐름의 일부이므로 journey다.`;

/** 프로파일을 프롬프트용 한 줄로 줄인다. 응답 원문은 넣지 않는다. */
function promptLine(profile: ColumnProfile): string {
  const parts = [
    `#${profile.index}`,
    profile.type,
    profile.scaleMax ? `상한${profile.scaleMax}` : null,
    `유니크${profile.uniqueCount}`,
    profile.blankRate >= 0.05 ? `결측${Math.round(profile.blankRate * 100)}%` : null,
    `평균길이${profile.avgLength}`,
    profile.groupPrefix ? `그룹접두:${profile.groupPrefix}` : null,
    profile.quotedName ? `따옴표명:${profile.quotedName}` : null,
    profile.reasonFor !== undefined ? `#${profile.reasonFor}의이유` : null,
    profile.options?.length ? `선택지:${profile.options.join(" / ")}` : null,
  ].filter(Boolean);
  return `${parts.join(" | ")} :: ${profile.header.replace(/\s+/g, " ")}`;
}

export type ClassifiedQuestion = PlannedQuestion & {
  header: string;
  type: ColumnType;
  confidence: number;
  /** 이 문항의 근거 서술 컬럼(정성 분석 대상 도출에 쓴다). */
  reasonColumn?: number;
  /** 저신뢰·규칙 위반 사유. 확인 카드에 그대로 보여준다. */
  note?: string;
};

export type RoleClassification = {
  questions: ClassifiedQuestion[];
  unassigned: { columnIndex: number; header: string; reason: string }[];
  /** 거부 사유. null 이면 통과. */
  rejected: string | null;
};

/** 역할↔형태 정합성. 어긋나면 오판일 가능성이 높다(PRD 2.2.2절 2단계). */
const ALLOWED_TYPES: Record<QuestionRole, ColumnType[]> = {
  demographic: ["single", "multi", "scale"],
  context: ["single", "multi", "scale", "rank", "text"],
  prior_service: ["single", "multi", "scale", "rank", "text"],
  feature: ["scale", "text"],
  task_flow: ["scale", "text"],
  journey: ["scale", "text"],
  purchase_factor: ["single", "multi", "rank", "scale", "text"],
  value: ["scale", "text"],
  ux_quality: ["scale", "text"],
  overall: ["scale", "text"],
  intent: ["scale", "text"],
  improvement: ["text", "scale"],
  meta: ["single", "multi", "rank", "scale", "text", "meta"],
};

/**
 * 호출 후 규칙 검증(코드, **재호출 없음**).
 *
 * 어긋난 문항은 다시 묻지 않고 `confidence=0`으로 낮춰 확인 대상으로 보낸다 — 재호출은
 * 비용·지연만 늘고 같은 오판을 반복할 가능성이 높다(PRD 2.2.2절 2단계).
 */
function applyRules(raw: RawClassification, profiles: ColumnProfile[]): RoleClassification {
  const byIndex = new Map(profiles.map((profile) => [profile.index, profile]));
  const seen = new Set<number>();
  /** journey에서 task_flow로 내린 컬럼. 이들의 orderKey는 다른 번호 체계라 중복을 세면 안 된다. */
  const demoted = new Set<number>();
  const questions: ClassifiedQuestion[] = [];
  const unassigned: RoleClassification["unassigned"] = [];

  // 계열(`실용성`·`즐거움`)의 유일한 근거는 헤더 접두(`실용성1)`)이고 그건 프로파일러가 이미
  // 읽었다. 모델이 답한 groupKey를 쓰면 접두가 없는 문항에도 계열을 지어내, 레이더 장이
  // 실행마다 생겼다 사라졌다 한다(정리습관 실측). 이유 컬럼은 부모의 계열을 물려받는다.
  const groupKeyOf = (profile: ColumnProfile): string | undefined =>
    profile.groupPrefix ??
    (profile.reasonFor !== undefined ? byIndex.get(profile.reasonFor)?.groupPrefix : undefined);

  // 이유 컬럼의 헤더는 `위와 같이 평가한 이유는…`이라 시점을 알 수 없다 — 부모 헤더로 본다.
  const headerForTimeCheck = (profile: ColumnProfile): string =>
    profile.reasonFor !== undefined ? (byIndex.get(profile.reasonFor)?.header ?? profile.header) : profile.header;

  const flag = (question: ClassifiedQuestion, note: string) => {
    question.confidence = 0;
    question.note = question.note ? `${question.note} · ${note}` : note;
  };

  for (const item of raw.questions) {
    const profile = byIndex.get(item.columnIndex);
    // 없는 컬럼·중복 판정은 조용히 버린다(아래 "누락" 처리가 다시 잡는다).
    if (!profile || seen.has(item.columnIndex)) continue;
    seen.add(item.columnIndex);

    if (item.role === "unassigned") {
      unassigned.push({
        columnIndex: profile.index,
        header: profile.header,
        reason: item.reason ?? "사유 미기재",
      });
      continue;
    }

    const question: ClassifiedQuestion = {
      columnIndex: profile.index,
      role: item.role,
      header: profile.header,
      type: profile.type,
      confidence: item.confidence,
      // 척도 상한·계열·이유 컬럼은 **코드가 이미 아는 값**이다 — 모델 답을 쓰지 않는다.
      ...(profile.scaleMax !== undefined ? { scaleMax: profile.scaleMax } : {}),
      ...(item.itemName ? { itemName: item.itemName } : {}),
      ...(groupKeyOf(profile) ? { groupKey: groupKeyOf(profile) } : {}),
      ...(item.reason ? { note: item.reason } : {}),
    };

    const allowed = ALLOWED_TYPES[item.role];
    if (!allowed.includes(profile.type)) {
      flag(question, `역할 ${item.role}과 형태 ${profile.type}이 맞지 않음`);
    }
    if (item.role === "ux_quality" && !groupKeyOf(profile)) {
      flag(question, "헤더에 계열 접두(`실용성1)` 등)가 없어 의미분별 척도로 보기 어려움");
    }
    // journey의 유일한 근거는 헤더의 시간 표현이다. 없으면 시점이 아니라 **행위 과정**이므로
    // 프롬프트의 경계 규칙과 같은 기준으로 task_flow로 내린다. 지어내는 게 아니라 근거 없는
    // 판정을 되돌리는 것이고, 장이 통째로 생겼다 사라졌다 하는 걸 막는다(ux_quality 계열과 같은 패턴).
    // ponytail: 헤더 문구가 유일한 근거 — 시간 표현 없이 시점을 묻는 설문이 실제로 나오면
    // 응답 분포(같은 대상 반복 측정)까지 봐야 한다.
    // 기업 요청 문항은 문구가 기능 만족도와 똑같이 생겨 모델이 확신 있게 틀린다 — 헤더 접두는
    // 코드가 읽을 수 있는 값이므로 답을 덮어쓴다(계열·시점과 같은 원칙). 확신이 떨어지진
    // 않으므로 확인 카드로 보내지 않고 사유만 남긴다.
    if (ENTERPRISE_HEADER.test(profile.header) && question.role !== "improvement") {
      question.note = `${question.note ? `${question.note} · ` : ""}헤더가 '기업 요청 질문'으로 시작해 추가 질문(improvement)으로 봤음`;
      question.role = "improvement";
    }
    if (item.role === "journey" && !TIME_MARKER.test(headerForTimeCheck(profile))) {
      question.role = "task_flow";
      demoted.add(profile.index);
      // 이유 컬럼은 부모가 이미 확인 목록에 떠 있다 — 같은 사유로 한 번 더 띄우면 검수 피로만 는다.
      if (profile.reasonFor === undefined) {
        flag(question, "시점을 가리키는 시간 표현이 헤더에 없어 단계(task_flow)로 봤음");
      }
    }
    questions.push(question);
  }

  // 가치 축 문항 **사이에 끼어 있는** 문항은 그 가치 블록의 일부다. 원본 보고서가 그렇게
  // 배치하기 때문이다 — 이젠오토 `가장 인상 깊었던 기능`(35번)은 기능적 가치의 세 번째 하위
  // 문항(Q17-3)으로 4대 가치 장에 들어가는데, 컬럼 위치도 33·34와 36 사이에 끼어 있다.
  // 모델은 문항 문구만 보고 `feature`라 답한다. 위치는 코드가 아는 값이라 코드가 덮어쓴다.
  // ponytail: 앞뒤가 **둘 다** value일 때만 잡는다 — 블록 맨 앞·맨 뒤에 붙은 문항은 못 잡는다.
  //           그런 사례가 실제로 나오면 블록 범위(첫 value ~ 마지막 value)로 넓힐 것.
  const flowing = questions
    .filter((question) => byIndex.get(question.columnIndex)?.reasonFor === undefined)
    .sort((a, b) => a.columnIndex - b.columnIndex);
  for (let i = 1; i < flowing.length - 1; i += 1) {
    if (flowing[i].role === "value") continue;
    if (flowing[i - 1].role !== "value" || flowing[i + 1].role !== "value") continue;
    flowing[i].note = `${flowing[i].note ? `${flowing[i].note} · ` : ""}가치 축 문항 사이에 있어 가치(value) 블록으로 봤음`;
    flowing[i].role = "value";
  }

  // 이유 컬럼은 앞 문항에 붙인다. 모델 판정이 아니라 프로파일러가 정한 위치를 쓴다.
  const questionByIndex = new Map(questions.map((question) => [question.columnIndex, question]));
  for (const profile of profiles) {
    if (profile.reasonFor === undefined) continue;
    const target = questionByIndex.get(profile.reasonFor);
    if (target) target.reasonColumn = profile.index;
  }

  // orderKey 중복은 시점·단계 순서를 못 정한다는 뜻이라 양쪽 다 확인 대상으로 보낸다.
  const orderSeen = new Map<string, ClassifiedQuestion>();
  for (const item of raw.questions) {
    if (item.orderKey === null) continue;
    // 이유 컬럼은 앞 문항과 같은 순서를 받는 게 정상이다 — 중복으로 세지 않는다.
    if (byIndex.get(item.columnIndex)?.reasonFor !== undefined) continue;
    // 강등된 문항의 orderKey는 journey 번호 체계라, 원래 task_flow 번호와 겹치는 게 당연하다.
    if (demoted.has(item.columnIndex)) continue;
    const question = questionByIndex.get(item.columnIndex);
    if (!question || (question.role !== "journey" && question.role !== "task_flow")) continue;
    const key = `${question.role}:${item.orderKey}`;
    const previous = orderSeen.get(key);
    if (previous) {
      flag(previous, `순서(orderKey) ${item.orderKey} 중복`);
      flag(question, `순서(orderKey) ${item.orderKey} 중복`);
    } else {
      orderSeen.set(key, question);
    }
  }

  // 모델이 빠뜨린 컬럼은 없는 셈 치지 않는다 — 판정 못 한 것으로 세어 거부 판단에 넣는다.
  for (const profile of profiles) {
    if (seen.has(profile.index)) continue;
    unassigned.push({ columnIndex: profile.index, header: profile.header, reason: "에이전트 응답에서 누락" });
  }

  const rate = profiles.length === 0 ? 1 : unassigned.length / profiles.length;
  const rejected =
    rate > REJECT_UNASSIGNED_RATE
      ? `판정하지 못한 컬럼이 ${unassigned.length}/${profiles.length}개(${Math.round(rate * 100)}%)로 기준(${REJECT_UNASSIGNED_RATE * 100}%)을 넘습니다.`
      : null;

  return { questions, unassigned, rejected };
}

export async function runRoleClassification({
  fileName,
  profiles,
}: {
  fileName: string;
  profiles: ColumnProfile[];
}): Promise<RoleClassification> {
  const traceLabel = `classify:${fileName}`;
  const { output } = await withClaudeGuard(traceLabel, () =>
    streamStructured<RawClassification>(
      {
        model: anthropic(MODEL),
        // 보고서당 1회지만 시스템 프롬프트는 모든 보고서에서 동일하다 — 캐시 규칙은 stage1.ts 주석 참고.
        instructions: {
          role: "system",
          content: SYSTEM_PROMPT,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } },
        },
        prompt: `파일명: ${fileName}\n컬럼 ${profiles.length}개입니다.\n\n${profiles.map(promptLine).join("\n")}`,
        output: Output.object({ schema: ClassificationSchema }),
        maxOutputTokens: 16000,
        // reasoning이 토큰 예산을 먼저 소비한다 — stage1.ts의 상세 주석 참고. 절대 지우지 말 것.
        reasoning: "none",
      },
      traceLabel,
    ),
  );

  return applyRules(output, profiles);
}

/** 나이는 구간으로 묶어야 비교 그룹이 된다. 그 외 수치 척도는 인적 그룹으로 쓰지 않는다. */
const AGE_HEADER = /나이|연령|age/i;

/**
 * 3단계(목차 조립기) 입력으로 옮긴다. **여기부터는 AI가 없다.**
 *
 * 교차 분석 성립 판정에 쓸 그룹 크기는 응답 행에서 직접 센다 — 프로파일은 선택지 목록만
 * 갖고 있어 "각 그룹 n >= 5"를 볼 수 없다.
 */
export function toSectionPlanInput(
  classification: RoleClassification,
  profiles: ColumnProfile[],
  dataRows: unknown[][],
): SectionPlanInput {
  const byIndex = new Map(profiles.map((profile) => [profile.index, profile]));
  const questions: PlannedQuestion[] = classification.questions
    // 이유 컬럼은 **문항이 아니라 앞 문항의 속성**이다(`reasonColumn`으로 이미 붙어 있다).
    // 여기서 안 거르면 가치 4개가 8개로 세어져 장 제목이 "8대 가치 만족도"가 된다(실측 2026-08-26).
    .filter((question) => question.role !== "meta" && byIndex.get(question.columnIndex)?.reasonFor === undefined)
    .map(({ columnIndex, role, itemName, groupKey, scaleMax }) => ({
      columnIndex,
      role,
      ...(itemName ? { itemName } : {}),
      ...(groupKey ? { groupKey } : {}),
      ...(scaleMax !== undefined ? { scaleMax } : {}),
    }));

  const rankItems = [
    ...new Set(
      classification.questions
        .filter((question) => byIndex.get(question.columnIndex)?.type === "rank")
        .flatMap((question) => byIndex.get(question.columnIndex)?.options ?? []),
    ),
  ];

  const cell = (row: unknown[], index: number) => String(row[index] ?? "").trim();
  const demographicGroupSizes = classification.questions
    .filter((question) => question.role === "demographic")
    .map((question) => {
      const profile = byIndex.get(question.columnIndex);
      if (!profile) return [];
      if (profile.type === "scale") {
        if (!AGE_HEADER.test(profile.header)) return [];
        const ages = dataRows.map((row) => {
          const value = Number(cell(row, profile.index));
          return Number.isFinite(value) && value > 0 ? value : null;
        });
        return ageBracketDistribution(ages).map((bracket) => bracket.count).filter((count) => count > 0);
      }
      const counts = new Map<string, number>();
      for (const row of dataRows) {
        const value = cell(row, profile.index);
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts.values()];
    })
    .filter((sizes) => sizes.length > 0);

  return { questions, rankItems, demographicGroupSizes };
}