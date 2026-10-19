/**
 * 사전요청서 원문 → 사용성테스트 설문 문항.
 *
 * 근거 자료 세 가지를 프롬프트에 녹였다.
 * - 표준 구성(단계와 순서): 알파브라더스 기획안(케어클·투블럭에이아이). 결과보고서 파이프라인이
 *   이 구성(기능 만족도+이유 / 핵심구매요인 / 4대 가치 / 추천 / 종합 / 개선 아이디어)을 전제로
 *   장을 만드므로 단계를 임의로 바꾸면 보고서가 비는 장이 생긴다.
 * - 문장 규칙: `사용성테스트_설문문항_작성 가이드.pdf`의 7원칙과 유형별 문형. 옛 기획안은
 *   "~습니까?"를 썼지만 가이드가 "~요?" 통일을 정했으므로 가이드를 따른다.
 * - 회사별 내용: 사전요청서(기능 목록·핵심구매요인·고객에게 묻고 싶은 질문·타겟).
 *
 * 판단(무엇을 물을지, 문구)은 모델이, 번호 매기기·보기 합치기·파일 형식은 코드가 한다
 * (`types.ts`의 numberQuestions/toSheetRows).
 */
import { Output } from "ai";
import { z } from "zod";
import { anthropic } from "@/lib/anthropic";
import { streamStructured, withClaudeGuard } from "@/lib/pipeline/claudeGuard";
import { SURVEY_STAGES, SURVEY_TYPES, isChoice, productTrack, rankOf, type SurveyDraft, type SurveyQuestion } from "./types";

const MODEL = process.env.ANTHROPIC_CHAT_MODEL ?? "claude-sonnet-5";

const QuestionSchema = z.object({
  id: z.string().describe("문항을 가리키는 짧은 영문 id(예: age, f1_score, f1_reason). 분기조건에서 이 id로 가리킨다."),
  stage: z.enum(SURVEY_STAGES),
  text: z.string().describe("응답자에게 보이는 문항 문구"),
  type: z.enum(SURVEY_TYPES),
  options: z.array(z.string()).describe("객관식일 때만 보기. 척도·주관식은 빈 배열"),
  required: z.boolean(),
  followUp: z.boolean().describe("바로 앞 본문항에 딸린 문항(이유·불편한 점 묻기, 분기 후속 질문)이면 true"),
  branchOn: z.string().describe("이 문항이 특정 응답에서만 보일 때 그 앞 문항의 id. 없으면 빈 문자열"),
  branchValue: z.string().describe("branchOn 문항에서 이 문항을 보이게 하는 보기. 없으면 빈 문자열"),
  note: z.string().describe("응답자에게 보이는 안내 문구(기능 설명, 척도 양끝 의미). 없으면 빈 문자열"),
  caution: z.string().describe("이 문항에 대해 담당자가 확인할 점 한두 문장. 없으면 빈 문자열"),
});

const SurveySchema = z.object({
  companyName: z.string().describe("기업명(주식회사 등 법인 표기 제외)"),
  productName: z.string(),
  questions: z.array(QuestionSchema),
  excludedFeatures: z.array(z.object({ name: z.string(), reason: z.string() })),
  reviewNotes: z.array(z.string()).describe("특정 문항에 속하지 않는 설문 전체의 확인 사항. 최대 4개, 각 한 문장"),
  plan: z.object({
    businessArea: z.string().describe("기획안 '핵심 비즈니스 영역'. 사전요청서의 제품 유형·타겟으로 판단(예: 'B2C', 'B2C, B2B'). 판단할 근거가 없으면 빈 문자열"),
    testers: z.string().describe("기획안 '테스트 인원'. 사전요청서에 적힌 인원·응답자 비율·연령 조건만 옮긴다(예: '일반인용 : 기관용 = 약 7:3 희망, 일반인용 40대 이상 50% 이상'). 지어내지 말 것, 없으면 빈 문자열"),
    schedule: z.string().describe("기획안 '진행 일정'. 사전요청서에 테스트 기간이 적혀 있을 때만. 없으면 빈 문자열"),
    managers: z.string().describe("기획안 '담당자'(알파브라더스 담당자). 사전요청서에는 보통 없으므로 빈 문자열"),
  }).describe("기획안 첫 쪽 칸 — 사전요청서에서 확인되는 것만 채운다"),
});

const SYSTEM_PROMPT = `당신은 알파브라더스의 사용성 테스트 설문 설계자입니다. 기업이 작성한 '사용성 테스트 사전 요청서'를 읽고, 테스터에게 배포할 설문 문항 전체를 설계합니다. 이 설문의 응답(raw data)으로 나중에 결과보고서가 자동 생성되므로, 아래 표준 구성을 반드시 지키세요.

# 표준 구성 (이 순서대로, 단계명은 그대로)

1. 인적 사항 및 특성·경험 조사
   - 나이: 주관식 "나이를 입력해 주세요." (note: "숫자만 입력")
   - 성별: 객관식-단일 "성별을 선택해 주세요." 보기 [남성, 여성]
   - 그 외 2~4문항: 사전요청서의 제품 타겟·인터뷰 대상에서 응답자를 나눌 기준을 뽑아 만듭니다
     (예: 소속 기관, 담당 학년, 피부 타입, 유사 제품 사용 빈도, 운영체제). 응답자를 그룹으로 나눠
     비교할 수 있는 객관식으로 만드세요.
   - 타겟 조건이 "A 또는 B"로 적혀 있으면(예: "약 2종 이상 복용하거나, 가족의 약 복용을 챙기는 사람") A와 B를 각각
     문항으로 만듭니다. "본인 또는 가족이 복용하는 약이나 건강기능식품은 몇 종류인가요?"처럼 묶으면 응답자마다 다르게
     셉니다(실측: 피매치 재생성 두 번 모두 이렇게 묶었다).
2. 기능별 고객 경험 평가 - 자사 제품 평가
   - 사전요청서의 '제품 세부기능'마다 척도(0-10) 한 문항 "'{기능명}' 기능에 대해 얼마나 만족하시나요?" — note에 그 기능이
     무엇인지 응답자가 알 수 있는 한 문장 설명(사전요청서 상세 설명을 요약, 예: "'발행하기'는 작업한 첨삭을 PDF 리포트로 이메일 발송하는 기능입니다.").
     **이유 문항과 기능 중요도 순위 문항은 만들지 마세요** — 코드가 정해진 자리에 붙입니다(아래 '이유 문항' 참고).
   - **기업이 세부기능 표에 적은 기능은 기본적으로 전부 평가합니다.** 기업은 테스터에게 체험시킬 기능을 적은 것이고,
     계정·권한·테스트 데이터는 기업이 준비합니다. 뺄 수 있는 것은 사전요청서가 스스로 못 쓴다고 밝힌 것뿐입니다:
     결제·이용권 구매, 프로모션 코드 입력, "출시 예정"·"준비 중"인 기능. 뺀 것은 excludedFeatures에 이유와 함께 적으세요.
     excludedFeatures에는 **이 사전요청서의 세부기능 표에 실제로 있는 기능만** 적습니다. 표에 없는 기능(아래 예시의
     '코드 입력' 등)을 "없어서 제외"로 적지 마세요 — 빼지 않은 것이 없으면 빈 배열입니다.
   - 관리자 승인이 필요한 로그인, 관리자 웹 화면, 실데이터가 필요한 일괄 처리처럼 **테스트용 계정·데이터가 있어야** 쓸 수
     있는 기능도 그대로 평가합니다(기업이 준비한다). 대신 reviewNotes에 "[제품명] 테스터용 로그인 정보(계정)·샘플 데이터를
     기업에서 받아야 함"을 한 줄 남기세요. 사용 경험을 먼저 묻는 문항은 만들지 마세요(2026-10-19 담당자 확인: 체험 가능).
   - 문항을 쓰기 전에 사전요청서의 **세부기능 표끼리, 가격 칸과 기타 요청사항끼리** 대조하세요. 같은 기능·가격·출시
     여부가 서로 다르게 적혀 있으면(예: 한 표엔 "약봉투 출시 예정", 다른 제품 표엔 "약봉투 촬영"이 제공 기능으로 적힘,
     가격 칸엔 요금제 4개인데 기타 요청사항엔 3개만 적힘) 관련 문항 caution에 두 표기를 그대로 옮기고 기업 확인을 요청하세요.
   - 한 기능을 하위 동작으로 쪼개 일부만 빼지 마세요(예: '매니저·대상자 관리' 중 승인만 제외). 표의 한 행이 한 문항입니다.
   - 회원가입·로그인처럼 테스터가 실제로 거치는 진입 기능은 "자연스럽게 거치는 절차"라는 이유로 빼지 마세요 —
     첫 사용의 불편(본인인증 등)이 드러나는 곳입니다.
   - 한 제품을 쓰는 사람이 여럿이어도(예: 현장 실무자용 앱 + 관리자용 웹) 기업이 한 표로 적었으면 한 제품으로
     평가합니다. 응답자를 역할별로 더 나누지 마세요.
   - 평가 기능은 보통 5~10개입니다.
   - 기능 만족도 문항 뒤의 **기능 중요도 순위**(1순위~N순위) 문항도 코드가 만듭니다. 보고서의 상대중요도와 중요도-만족도
     사분면이 이 응답으로 그려집니다.
3. 기능별 고객 경험 평가 - 타사 제품 평가 (경쟁·대체 제품을 써봤을 법한 타겟일 때 포함)
   - 자사 제품 평가(순위 문항까지) **바로 뒤**에 둡니다 — 자사 기능을 다 써본 뒤라 비교가 구체적이고, 타사를 먼저
     떠올려 자사 점수가 끌려가는 것도 막습니다(2026-10-13 담당자 결정).
   - 객관식-단일 "{제품군}을(를) 사용해 보신 적이 있나요?" 보기 [네, 있어요, 아니요, 없어요, 기억나지 않아요].
     다음 문항들은 branchOn=그 문항 id, branchValue="네, 있어요", followUp=true:
     사용해 본 제품 이름(주관식) / 그 제품의 기억에 남는 장점(주관식) / 기억에 남는 단점(주관식) /
     그 제품 만족도(척도). 만족도의 이유는 묻지 않습니다(장점·단점과 겹친다). 장점·단점을 따로 받아야 보고서의 브랜드별 장단점 비교표를 만들 수 있습니다.
4. 고객 여정 기반 경험 평가 (실물 제품이거나 여러 날에 걸쳐 쓰는 테스트일 때만)
   - 사용 주기·1회 사용 시간(객관식-단일, 구간이 겹치지 않게) / 첫인상·첫 사용 과정 / 1주·2주 사용 후
     만족도(척도). 이유 문항은 만들지 마세요. 척도 양끝 의미가 만족도가 아니면 note에 적으세요(예: "0=어려움, 10=쉬움").
5. 핵심구매요인 파악 — 객관식-단일 한 문항, 문구는 이대로(2026-10-19 담당자 지정, '~요' 통일):
   "{제품명}을(를) 이용함에 있어서 가장 영향을 미칠 수 있는 핵심 요인은 무엇이라고 생각하나요?"
   보기는 사전요청서의 핵심구매요인 목록을 응답자가 이해할 짧은 말로 다듬어 쓰고 끝에 "기타(직접 입력)".
   목록이 없으면 제품 특성에 맞게 6~8개를 만드세요. **이유 문항은 만들지 않습니다** — 보고서가 쓰지 않는다
   (정성 분석은 점수 문항의 이유만 읽는다).
6. 가치 만족도 평가 — **4대 가치 네 문항만** 둡니다. 각 척도(0-10), 문구는 이대로(원본 기획안 문구를
   '~요'로 바꾼 것, 2026-10-13 담당자 지정):
     "{제품명}의 기능적 가치 영역에 대한 만족도는 몇 점인가요?"        (note: "앞서 평가한 기능 전반을 떠올려 주세요.")
     "{제품명}의 심미적 가치 영역에 대한 만족도는 몇 점인가요?"        (note: "디자인·색상·글꼴 등")
     "{제품명}의 경제적 가치 영역에 대한 만족도는 몇 점인가요?"        (note: 사전요청서의 가격. 없으면 caution에 확인 요청)
     "{제품명}의 사회적 가치 영역에 대한 만족도는 몇 점인가요?"        (note: "사회·공공적 이슈에 기여할 수 있는 가치")
   이유 문항은 코드가 붙입니다. 만들지 마세요.
   '디자인·UI는 얼마나 만족스러웠나요?' 같은 다른 문항을 이 단계에 넣지 마세요. 기업이 따로 요청한 것이면 기타 기업 요청사항에 둡니다.
7. 구매/추천 의향 조사 — 두 척도(0-10), 문구와 순서는 이대로(2026-10-19 담당자 지정, '~요' 통일):
     "본 제품을 체험해 보았을 때, {제품명}을(를) 사용할 의향이 있나요?"          (note "0=전혀 없음, 10=매우 있음")
     "본 제품을 체험해 보았을 때, {제품명}을(를) 지인에게 추천할 의향이 얼마나 있나요?" (note 같음)
   {제품명}의 조사 '을/를'은 받침에 맞춰 하나만 씁니다("필톡을", "케어로그를").
   기관·기업이 도입하는 제품(B2B·SaaS)이면 응답자는 실무자입니다. "사용할 의향" 대신 "소속 기관에 도입할 의향",
   "지인에게" 대신 "같은 일을 하는 동료나 다른 기관에"로 바꾸고 앞머리("본 제품을 체험해 보았을 때,")는 그대로 둡니다.
   이유 문항은 만들지 마세요(추천 의향의 이유는 코드가 붙입니다).
8. 종합 만족도 — 척도 "{제품명}의 전반적인 만족도(종합 점수)는 몇 점인가요?" (note: "기능·디자인·가격 등을 모두 고려해 주세요.")
   이유 문항은 만들지 마세요(보고서가 쓰지 않는다).
9. 개선 아이디어 — 주관식 "{제품명}을(를) 사용하면서 더 나아졌으면 하는 점이나 추가되었으면 하는 기능이 있다면 자유롭게 작성해 주세요."
10. 기타 기업 요청사항 — 사전요청서의 '고객에게 확인하고 싶은 질문'·'기타 요청사항'을 응답자가 답할 수 있는
    설문 문항으로 바꿉니다. **질문·요청을 하나도 빠뜨리지 마세요** — 한 질문에 여러 물음이 섞여 있으면
    (예: "이해할 수 있었나요? 행동할 의향이 생겼나요?") 단일성 원칙대로 나눠 각각 문항으로 만듭니다.
    물음표가 하나여도 기준이 둘이면 나눕니다(예: "가장 어렵거나 시간이 오래 걸린 단계" → 가장 어려웠던 단계 /
    가장 시간이 오래 걸린 단계, "상담이나 의료기관 연계에 활용" → 상담에 활용 / 의료기관 연계에 활용).
    기업의 한 질문을 나눴으면 첫 문항 caution에 "요청서 원문은 한 질문이었음"을 남기세요.
    분석을 요청한 내용(예: "적정 가격대 분석 가능한지")은 그 분석에 필요한 응답을 받는 문항으로 만듭니다
    (예: 적정 가격대를 묻는 객관식 구간 또는 주관식). 이미 위에서 묻는 내용과 겹칠 때만 생략하고, 설문으로
    물을 수 없는 요청(테스터 선정 조건 등)만 reviewNotes로 옮기세요.
    - 사전요청서가 "출시 예정"·"준비 중"이라고 밝힌 기능(예: 약봉투 촬영)은 평가에서 빼지만, 출시에 대비해 수요를 묻는
      척도 한 문항을 이 단계에 둡니다: "'{기능명}' 기능이 추가된다면 얼마나 유용할 것 같나요?"
      (note: 기능 한 문장 설명 + " 0=전혀 유용하지 않다, 10=매우 유용하다"), caution "출시 예정 기능이라 평가 대신 수요를
      묻는 문항입니다. 문항을 넣을지와 기능 설명이 맞는지 실무자 확인이 필요합니다." '의향'이라는 말은 쓰지 마세요
      (보고서가 '의향' 문항을 추천 의향으로 오인할 수 있다). 이유 문항은 만들지 않습니다.
    - 특정 화면·기능의 UI/UX를 중점 검토해 달라는 요청은 reviewNotes로 넘기지 말고 **화면마다** 문항으로 만듭니다:
      척도 "'{화면명}' 화면에서 원하는 정보를 찾기 쉬웠나요?"(note "0=매우 어려웠다, 10=매우 쉬웠다") /
      척도 "'{화면명}' 화면의 내용을 이해하기 쉬웠나요?"(같은 형식) / followUp 주관식
      "'{화면명}' 화면에서 불편했거나 바뀌었으면 하는 점을 알려 주세요." 이미 같은 내용을 묻는 문항이 있으면 그 문항은 생략합니다.

# 이유 문항 (코드가 붙인다 — 만들지 마세요)
이유(주관식) 문항이 많으면 테스터가 쓰다가 이탈한다. 그래서 보고서가 실제로 읽는 자리에만 코드가 붙인다:
기능별 만족도, 4대 가치 네 문항, 추천 의향. 표준 단계(인적 사항~종합 만족도)에서는 이유 문항을 만들지 마세요.
기타 기업 요청사항에서는 기업이 이유를 물어 달라고 한 경우에만 만듭니다.

# 제품(대상자)이 둘 이상일 때
사전요청서에 기능 목록이나 핵심구매요인이 제품·대상자별로 따로 있으면(예: 일반인용 앱 / 기관용 서비스)
한 설문 안에서 응답자를 나눕니다.
- 모두에게 묻는 인적 사항(나이·성별 등)을 먼저 묻고, **그 바로 뒤에** 객관식-단일 "어떤 서비스를 체험하셨나요?"
  (보기 = 제품명 그대로, id = "track"). 응답자에게 자연스러운 순서이고, 설문 도구의 분기 로직도 이 문항에 건다.
- 한쪽 대상자에게만 맞는 인적 사항은 서비스 선택 문항 **뒤에** 둡니다(앞에 두면 분기를 걸 수 없다).
- 인적 사항 중 한쪽 대상자에게만 맞는 문항, 각 제품의 기능 평가·핵심구매요인·고객에게 확인하고 싶은 질문은
  branchOn="track", branchValue=해당 제품명. 그 하위 이유 문항도 같은 branchOn/branchValue를 가집니다.
- 타사 제품 경험·가치 만족도·추천·종합 만족도·개선 아이디어도 **제품별로 따로** 만듭니다(같은 branchOn/branchValue).
  담당자가 이 설문을 제품별 설문으로 나눠 돌리므로, 한 문항에 두 제품의 이름·가격·대상이 섞이면 안 됩니다
  (예: 무료 앱 응답자에게 기관용 요금제를 보여주는 가격 문항). 문구의 제품명은 그 제품 이름으로 씁니다.
  분기 없는 공통 문항은 서비스 선택 문항 앞의 인적 사항(나이·성별 등)뿐입니다.
- 각 기능 문항의 note 맨 앞에 "[제품명]"을 붙여 어느 제품 문항인지 보이게 합니다.
- 한 제품에만 해당하는 excludedFeatures의 name과 reviewNotes는 맨 앞에 "[제품명]"을 붙입니다.
  나눠 돌리면 의미가 없는 메모(희망 응답 비율, 결과보고서를 제품별로 나눌지)는 맨 앞에 "[공통 설문]"을 붙입니다.
- reviewNotes에 "[공통 설문] 결과보고서는 제품별로 나눠 만들어야 할 수 있다"는 점과 희망 응답 비율을 남깁니다.

# 문장 규칙 (설문 문항 작성 가이드)
- 통일성: 모든 문항을 "~요?" / "~해 주세요." 말투로 통일하세요. "~습니까?", "~십니까?"는 쓰지 마세요.
  "있으신가요?", "보신 적 있으신가요?", "만족스러우셨나요?" 같은 과도한 높임도 피하세요("있나요?", "보신 적이 있나요?",
  "만족스러웠나요?"). 표준 구성의 지정 문구도 모두 이 규칙을 따른 것입니다.
- 명확성: 전문 용어·업계 약어 대신 일상어로. UI, UX, 인터페이스, 직관성, 어플리케이션 같은 말은 문항·보기에 쓰지 마세요
  ("화면 디자인", "사용하기 쉬웠나요?", "앱"). 기능명은 사전요청서 표기를 작은따옴표로 감싸 그대로 씁니다.
- 중립성: "편리한", "훨씬 좋은"처럼 답을 유도하는 표현 금지. 척도 양 끝은 서로 반대말로 대칭이 되게
  ("0=매우 비싸다, 10=매우 싸다" — "매우 합리적이다"처럼 한쪽만 평가어인 것 금지).
- 구체성: "자주", "많이" 대신 기간·횟수 기준("최근 1주일 동안", "하루에 몇 번").
- 단일성: 한 문항에 하나만 묻습니다. "쉽고 재미있었나요?"처럼 두 판단을 묶거나, "본인 또는 가족이", "약이나
  건강기능식품"처럼 대상을 둘 묶어 응답자마다 다르게 읽히는 문항은 나눕니다.
- 배타성: 수치 구간 보기는 경계가 겹치지 않게 "1회 이상 3회 미만"처럼 씁니다. 범주 보기도 한 사람이 둘에 해당하지
  않게 기준을 하나로 정합니다(현재 하는 일과 보유 자격을 한 문항에 섞지 말 것, '기타 ○○ 종사자'와 '기타(직접 입력)'를
  같이 두지 말 것). 응답자 중 해당하지 않는 사람이 있으면(예: 경력 문항에 미종사자) 그 보기도 넣습니다.
- 예외포용성: 경험·선호·복수선택 객관식에는 "해당 없어요", "잘 모르겠어요", "기타(직접 입력)" 중 맞는 것을 넣으세요.
  '사용해 보신 적이 있나요?' 같은 경험 문항에는 "기억나지 않아요"를 넣습니다(매뉴얼 2-1). 성별에는 넣지 않습니다.
- 여러 개가 동시에 해당할 수 있는 보기(기대하는 혜택, 우려되는 점, 불편했던 점 등)와 기업이 "유형별로 구분해
  분석"해 달라고 한 문항은 객관식-복수로 만들고 문구에 "모두 선택해 주세요"를 넣습니다. 하나만 고르게 하면 두 번째
  이유가 사라집니다.

# 필드 규칙
- 척도(0-10)·주관식은 options를 비웁니다. 객관식은 options가 반드시 있어야 합니다.
- required: 척도·객관식·이유 주관식은 true. 개선 아이디어와 기타 기업 요청사항의 자유 서술은 false.
- 사전요청서에 없는 기능·가격·사실을 지어내지 마세요. 모르면 비우고 확인 사항으로 남깁니다.
- 확인 사항은 **해당 문항의 caution에** 적습니다(예: 임의로 정한 보기 구간, 기업 요청을 해석해 만든 문항,
  테스터가 실제로 써볼 수 있는지 불확실한 기능, 문서에 없어 비워둔 가격). 담당자는 문항 옆에서 이 글을 봅니다.
  특정 문항에 붙일 수 없는 것(보고서를 제품별로 나눌지, 테스터 모집 조건, 빼기로 한 단계)만 reviewNotes에 둡니다.
  둘 다 짧게 — 한두 문장, 사실과 할 일만.

# 예시 (투블럭에이아이 '키위티' 사전요청서 일부 → 문항 일부)
사전요청서: 제품 타겟 "공교육(학교) 선생님, 사교육(학원 및 교습소) 선생님" / 세부기능 "6 개인 링크 복사하기 — 암호화된 개인 링크를 복사하여 학생에게 전달…", "10 코드 입력 — 프로모션 코드나 기관 이용권 코드 입력", "11 이용권 구매" / 고객에게 확인하고 싶은 질문 "5. 현장에서 가장 도움이 된 기능은 무엇인가?"
문항:
- [인적 사항 및 특성·경험 조사] 객관식-단일 "현재 어디에서 학생을 가르치고 계신가요?" 보기 [초등학교, 중학교, 고등학교, 학원·교습소, 기타(직접 입력)]
- [기능별 고객 경험 평가 - 자사 제품 평가] 척도(0-10) "'개인 링크 복사하기' 기능에 대해 얼마나 만족하시나요?" note "'개인 링크 복사하기'는 학생에게 보낼 개인 링크를 만들어, 학생이 제출한 글이 '나의 평가'에 자동으로 쌓이게 하는 기능입니다."
- (followUp) 주관식 "그렇게 평가하신 이유는 무엇인가요?" note "해당 기능에서 부족한 점이나 추가 아이디어가 있다면 함께 작성해 주세요."
- excludedFeatures: 코드 입력·이용권 구매 — "테스트 기간에 결제·코드 발급 없이 써볼 수 없음"
- [기타 기업 요청사항] 객관식-단일 "수업 현장에서 가장 도움이 된 기능은 무엇인가요?" 보기 [평가한 기능 목록…, 기타(직접 입력)] + followUp 주관식 "그 기능이 도움이 된 이유를 알려 주세요."`;

/** 사전요청서는 길어야 수천 자다. 엉뚱한 대용량 파일이 들어와도 토큰이 폭주하지 않게 자른다. */
const MAX_INPUT_CHARS = 40_000;

export async function generateSurvey(documentText: string): Promise<SurveyDraft> {
  const { output } = await withClaudeGuard("survey-generate", () =>
    streamStructured<z.infer<typeof SurveySchema>>(
      {
        model: anthropic(MODEL),
        instructions: { role: "system", content: SYSTEM_PROMPT },
        prompt: `다음 사전 요청서로 설문 문항을 설계하세요.\n\n${documentText.slice(0, MAX_INPUT_CHARS)}`,
        output: Output.object({ schema: SurveySchema }),
        // 16000이면 기능이 많고 서비스가 둘인 요청서(피매치, 순위 문항 포함)에서 출력이 잘렸다(실측 2026-10-06).
        maxOutputTokens: 32000,
        // 규칙과 순서가 이미 명시된 작업이고, reasoning이 켜져 있으면 출력 예산을 먼저 쓴다(stage1.ts 참고).
        reasoning: "none",
        // 배포 함수 제한 300초 안에 재시도까지 끝나야 한다. 이유·순위 문항을 코드로 옮긴 뒤 한 번에 106~115초(실측 2회).
        hardTimeoutMs: 170_000,
      },
      "survey-generate",
    ),
  );
  return normalizeSurvey(output);
}

/** PRD 6.8.1 미해결 — 설문 도구가 막지 않으면 같은 기능을 여러 순위에 고를 수 있고 순위·사분면 분석이 틀어진다. */
export const RANK_CAUTION = "WALLA에서 1위~마지막 순위 문항에 '중복 선택 방지'를 반드시 설정하세요. 설정하지 않으면 같은 기능을 여러 순위에 고를 수 있어 순위·사분면 분석이 틀어집니다.";

/** "해당 없어요"·"선호하는 기능이 없어요"처럼 앞 질문의 전제를 부정하는 보기 — 이 응답자에겐 이유 문항이 성립하지 않는다. */
export const EXCEPTION_OPTION = /해당 없|없(었)?어요$|모르겠어요|기억나지 않아요|사용하지 못했어요/;

/**
 * 프롬프트 틀의 "{제품명}을(를)"이 그대로 남은 조사를 고른다 — 앞 글자 받침으로 정한다(실측: 피매치 "필톡을(를)",
 * "biz cares를(를)"). 한글이 아닌 글자 뒤는 받침을 알 수 없어 중복("를(를)")만 합친다.
 */
export function fixParticles(text: string): string {
  const pairs: [string, string][] = [["을", "를"], ["이", "가"], ["은", "는"], ["과", "와"]];
  let out = text;
  for (const [withCoda, without] of pairs) {
    out = out
      .replace(new RegExp(`(${withCoda}|${without})\\((${withCoda}|${without})\\)`, "g"), (m, a, b, offset: number) => {
        const prev = out.charCodeAt(offset - 1);
        if (prev >= 0xac00 && prev <= 0xd7a3) return (prev - 0xac00) % 28 ? withCoda : without;
        return a === b ? a : m;
      });
  }
  return out;
}

const STAGE = {
  feature: "기능별 고객 경험 평가 - 자사 제품 평가",
  rival: "기능별 고객 경험 평가 - 타사 제품 평가",
  values: "가치 만족도 평가",
  intent: "구매/추천 의향 조사",
} as const;

/**
 * 이유 문항은 **보고서가 읽는 자리에만** 붙인다(2026-10-19 담당자 — 이유 문항이 많으면 테스터가 이탈한다).
 * 근거는 표준목차(docs/STAGE_MAPPING.xlsx)와 발행 원본 2종(리바랩스·케어클)에서 실제로 인용된 자리다.
 * - 기능별 만족도: Ⅲ장 1절 극성 도넛·인용(필수, 원본 2종 모두 인용)
 * - 4대 가치 4개 전부: Ⅵ장 1절 가치마다 긍정·부정 의견 표 L25(필수, 원본 2종 모두 인용)
 * - 추천 의향: Ⅸ장 1절 의견(케어클 원본 '추천 고객 의견' 인용)
 * 뺀 것: 종합 만족도(원본 2종 모두 인용 없음), 타사 만족도(장점·단점 문항이 비교표 L14를 채운다),
 * 핵심구매요인(코드가 읽지 않고 원본 인용도 없음), 순위·사용 의향, 시점별 여정(케어클 원본에도 없음).
 */
const needsReason = (q: SurveyQuestion) =>
  q.type === "척도(0-10)" && (
    q.stage === STAGE.feature ||
    q.stage === STAGE.values ||
    (q.stage === STAGE.intent && /추천/.test(q.text)));

const ORDINAL = ["가장", "두 번째로", "세 번째로", "네 번째로", "다섯 번째로", "여섯 번째로", "일곱 번째로", "여덟 번째로", "아홉 번째로", "열 번째로",
  "열한 번째로", "열두 번째로", "열세 번째로", "열네 번째로", "열다섯 번째로"];
const featureName = (q: SurveyQuestion) => q.text.match(/['‘’]([^'‘’]+)['‘’]\s*기능/)?.[1]?.trim() ?? q.text.trim();

/**
 * 표준 단계의 이유 문항과 기능 중요도 순위 문항을 코드로 붙인다 — 모델이 실행마다 다르게 만들던 것이고(실측: 이유 문항
 * 수·문구가 실행마다 달랐다) 형식이 정해져 있어 판단이 필요 없다. 모델이 만들어 둔 것은 지우고 새로 붙인다.
 * 표준 단계 밖(기타 기업 요청사항)의 이유 문항은 모델 판단이라 그대로 둔다.
 */
export function attachStandardFollowUps(input: SurveyQuestion[], productName: string): SurveyQuestion[] {
  const standard = new Set<string>(SURVEY_STAGES.slice(0, SURVEY_STAGES.indexOf("개선 아이디어")));
  const isModelReason = (q: SurveyQuestion, prev: SurveyQuestion | undefined) =>
    q.followUp && q.type === "주관식" && standard.has(q.stage) && !!prev && prev.type !== "주관식"
    && !(q.stage === STAGE.rival && !/이유/.test(q.text)); // 타사 이름·장점·단점은 남긴다
  const kept: SurveyQuestion[] = [];
  for (const q of input) {
    // 순위는 코드만 만든다. 모델이 지시를 어기고 만든 순위 안내 문항도 지운다(실측: "순서대로 순위를 매겨 주세요" 주관식).
    const modelRank = rankOf(q) !== null || (q.stage === STAGE.feature && q.type !== "척도(0-10)" && /순위|순서대로/.test(q.text));
    if (modelRank || isModelReason(q, kept.at(-1))) continue;
    kept.push(q);
  }
  const track = productTrack(kept);
  const productOf = (q: SurveyQuestion) => (track && q.branchOn === track.id ? q.branchValue : "");
  const out: SurveyQuestion[] = [];
  for (const q of kept) {
    out.push(q);
    const branch = { branchOn: q.branchOn, branchValue: q.branchValue };
    if (needsReason(q)) {
      out.push({
        id: `${q.id}_reason`, stage: q.stage, type: "주관식", options: [], required: true, followUp: true, ...branch, caution: "",
        text: q.stage === STAGE.feature ? "그렇게 평가하신 이유는 무엇인가요?" : "위와 같이 평가한 이유는 무엇인가요?",
        note: q.stage === STAGE.feature ? "해당 기능에서 부족한 점이나 추가 아이디어가 있다면 함께 작성해 주세요." : "",
      });
    }
    // 이 제품의 마지막 기능 만족도 뒤에 순위 묶음을 둔다.
    const features = kept.filter((f) => f.stage === STAGE.feature && f.type === "척도(0-10)" && productOf(f) === productOf(q));
    if (q !== features.at(-1) || features.length < 2) continue;
    const names = features.map(featureName);
    const label = productOf(q) || productName;
    names.forEach((_, k) => out.push({
      id: `${q.id}_rank${k + 1}`,
      stage: STAGE.feature, type: "객관식-단일", options: names, required: true, followUp: k > 0, ...branch, caution: "",
      text: k === 0
        ? `${label}의 기능 중 가장 중요하다고 생각하는 기능은 무엇인가요? (1순위)`
        : `${ORDINAL[k] ?? `${k + 1}번째로`} 중요하다고 생각하는 기능은 무엇인가요? (${k + 1}순위)`,
      note: k === 0 ? `중요하다고 생각하는 순서대로 1순위부터 ${names.length}순위까지 하나씩 골라 주세요. 같은 기능을 두 번 고르지 마세요.` : "",
    }));
  }
  return out;
}

export const UPCOMING_CAUTION = "출시 예정 기능이라 평가 대신 수요를 묻는 문항입니다. 문항을 넣을지와 기능 설명이 맞는지 실무자 확인이 필요합니다.";

/**
 * "출시 예정"·"준비 중"이라 평가에서 뺀 기능마다 수요 문항이 있게 한다(2026-10-19 담당자 — 약봉투 촬영). 프롬프트로도
 * 지시하지만 실측 2회 중 1회는 표기가 엇갈린다며 모델이 만들지 않았다. 이미 있으면(기능명 + "유용") 그대로 둔다.
 * '의향'이라는 말을 쓰지 않는다 — 보고서가 '의향' 문항을 추천 의향(NPS)으로 오인할 수 있다.
 */
export function addUpcomingFeatureQuestions(questions: SurveyQuestion[], excluded: { name: string; reason: string }[]): SurveyQuestion[] {
  const out = [...questions];
  const track = productTrack(out);
  excluded.filter((f) => /출시 예정|준비 중|출시 전/.test(`${f.name} ${f.reason}`)).forEach((f, i) => {
    const product = f.name.match(/^\[([^\]]+)\]/)?.[1] ?? "";
    const name = f.name.replace(/^\[[^\]]+\]\s*/, "").replace(/\s*\(.*\)$/, "").trim();
    if (!name || out.some((q) => q.text.includes(name) && /유용/.test(q.text))) return;
    const branch = track && track.options.includes(product) ? { branchOn: track.id, branchValue: product } : { branchOn: "", branchValue: "" };
    const at = out.findLastIndex((q) => q.stage === "기타 기업 요청사항" && (!branch.branchOn || q.branchValue === branch.branchValue));
    const question: SurveyQuestion = {
      id: `upcoming_${i + 1}`, stage: "기타 기업 요청사항", type: "척도(0-10)", options: [], required: true, followUp: false, ...branch,
      text: `'${name}' 기능이 추가된다면 얼마나 유용할 것 같나요?`,
      note: "출시를 준비 중인 기능입니다. 0=전혀 유용하지 않다, 10=매우 유용하다",
      caution: UPCOMING_CAUTION,
    };
    out.splice(at >= 0 ? at + 1 : out.length, 0, question);
  });
  return out;
}

/** 모델 출력에서 형식이 어긋난 부분만 바로잡는다 — 판단은 건드리지 않는다. */
/** 모델 출력 형식. 검사 스크립트가 손으로 만든 입력도 받도록 `plan`은 생략할 수 있다. */
export type RawSurvey = Omit<z.infer<typeof SurveySchema>, "plan"> & { plan?: z.infer<typeof SurveySchema>["plan"] };

export function normalizeSurvey(raw: RawSurvey): SurveyDraft {
  const seen = new Set<string>();
  const questions: SurveyQuestion[] = raw.questions.map((q, i) => {
    let id = q.id.trim() || `q${i + 1}`;
    while (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    const options = isChoice(q.type) ? q.options.filter((o) => o.trim()) : [];
    // 보기 없는 객관식은 응답할 수 없다 — 실측: '나이를 입력해 주세요'를 객관식-단일로 냈다.
    const type = isChoice(q.type) && options.length === 0 ? "주관식" : q.type;
    // 척도는 양 끝 라벨이 문항의 일부다(매뉴얼 2-3). 실측(피매치): 기능 만족도 note에 기능 설명만 쓰고 라벨을 빠뜨렸다.
    const base = q.note.trim();
    const note = type === "척도(0-10)" && !/0\s*[=:]/.test(base)
      ? [base && !/[.!?]$/.test(base) ? `${base}.` : base, "0=매우 불만족, 10=매우 만족"].filter(Boolean).join(" ")
      : q.note;
    // 보기 없이 분기만 건 문항(branchValue 빈 값)은 분기가 아니다. 실측(피매치 재생성): 이유 문항 31개가 앞 문항에
    // 빈 값으로 걸려 WALLA 설정 목록에 "''를 고른 사람에게만 보임"이 찍혔다.
    const branched = q.branchValue.trim() ? {} : { branchOn: "", branchValue: "" };
    return { ...q, id, type, text: fixParticles(q.text), options: options.map(fixParticles), note: fixParticles(note), ...branched };
  });
  // 단계 순서대로 다시 놓는다. 딸린 문항은 본문항을 따라간다. 실측(피매치 재생성): 기타 기업 요청사항 2문항이
  // 구매/추천 앞에 끼어 번호가 단계와 어긋났다.
  let mainStage = 0;
  const rank = questions.map((q) => {
    const idx = (SURVEY_STAGES as readonly string[]).indexOf(q.stage);
    if (!q.followUp || idx < 0) mainStage = idx < 0 ? SURVEY_STAGES.length : idx;
    return mainStage;
  });
  const order = questions.map((_, i) => i).sort((a, b) => rank[a] - rank[b] || a - b);
  questions.splice(0, questions.length, ...order.map((i) => questions[i]));
  questions.splice(0, questions.length, ...attachStandardFollowUps(questions, raw.productName.trim()));
  questions.splice(0, questions.length, ...addUpcomingFeatureQuestions(questions, raw.excludedFeatures));
  for (const [i, q] of questions.entries()) {
    // 매뉴얼 2-5: 복수 선택은 문구에서 알 수 있어야 한다. 실측(피매치): 복수 선택 3문항 모두 표기가 없었다.
    if (q.type === "객관식-복수" && !/모두|중복/.test(q.text)) q.text = `${q.text.trim()} (중복 선택 가능)`;
    // '해당 없어요'를 고른 사람에게 "그 단계가 불편했던 이유"를 물으면 답할 수 없다. 분기는 '='만 표현하므로 표시로 남긴다.
    const prev = questions[i - 1];
    // 제품이 둘이면 딸린 문항도 제품 분기를 갖는다 — 분기가 없는지가 아니라 앞 문항과 같은 분기인지로 본다.
    if (prev && q.followUp && q.branchOn === prev.branchOn && q.type === "주관식" && isChoice(prev.type)) {
      const none = prev.options.find((o) => EXCEPTION_OPTION.test(o));
      if (none) q.caution = [`'${none}' 응답자는 이 문항을 건너뛰도록 WALLA 로직을 설정하세요.`, q.caution].filter(Boolean).join(" ");
    }
  }
  // 순위 묶음(1순위~N순위)의 첫 문항에 경고를 코드로 단다 — 모델이 빠뜨려도 항상 뜬다.
  for (const q of questions) if (rankOf(q) === 1) q.caution = [RANK_CAUTION, q.caution].filter(Boolean).join(" ");
  // 분기 대상은 앞 문항이어야 한다 — 없는 id를 가리키면 조건을 지운다.
  for (const q of questions) {
    if (q.branchOn && !questions.slice(0, questions.indexOf(q)).some((p) => p.id === q.branchOn)) {
      q.branchOn = "";
      q.branchValue = "";
    }
  }
  return {
    companyName: raw.companyName.replace(/\(?주식회사\)?|\(주\)|㈜/g, "").trim(),
    productName: raw.productName.trim(),
    questions,
    excludedFeatures: raw.excludedFeatures,
    reviewNotes: raw.reviewNotes,
    plan: raw.plan,
  };
}
