@AGENTS.md

# 사용성테스트 결과보고서 자동생성 솔루션

전체 요구사항은 [PRD.md](./PRD.md) 참조 (v1.3, SW/App형만 빌드 대상). 이 문서는 코드베이스에서
바로 도출되지 않는 결정·제약만 기록한다.

## 스택

- Next.js 16(App Router) + Tailwind, Vercel 단일 스택 배포. 별도 백엔드 서버 없음.
- `ai`(v7) + `@ai-sdk/react` + `@ai-sdk/anthropic` — 채팅 오케스트레이션 및 tool calling.
  로컬에 `node_modules/ai/docs/`가 실제 문서 소스이므로, API 사용법이 헷갈리면 웹 검색보다
  이 폴더를 먼저 확인할 것 (버전이 빠르게 바뀜).
- `@vercel/blob` — 클라이언트 업로드(브라우저→Blob 직접 전송)로 500MB까지 지원. 서버 업로드
  경로(Route Handler를 거치는 방식)는 Vercel의 4.5MB 요청 바디 제한에 걸리므로 절대 사용하지 않는다.
- `xlsx`(SheetJS) — raw data 파싱.
- **DB는 Supabase Postgres**(사용자 결정, 2026-07-16 — PRD가 가정했던 Vercel Postgres/Neon 대신).
  `postgres`(postgres.js)로 `DATABASE_URL`에 연결한다. `@vercel/postgres`는 deprecated이므로
  쓰지 않는다. **Supabase의 Transaction pooler(6543 포트)를 쓸 때는 `postgres(url, { prepare:
  false })`가 필수다** — pgbouncer transaction 모드는 prepared statement를 지원하지 않는다
  (`lib/db/client.ts` 참고). 로컬 개발용으로 `brew install postgresql@17`도 설치되어 있지만
  (`brew services list`로 확인 가능), 실제 개발·테스트는 전부 Supabase로 직접 한다 — 로컬
  Postgres는 지금 안 쓴다.

## 골든 테스트셋

`data/` 폴더(`.gitignore` 처리됨, 응답자 개인정보 포함이라 커밋 금지)에 리바랩스·케어클 raw data와
**실제 발행된 결과보고서 PDF 원본**(리바랩스 2025.09.05자, 케어클 2025.10.28자)이 있다. v1 검증
기준은 **리바랩스**(SW/App형, 100건, 59컬럼) 하나로 고정한다(PRD 9.1절).
`npm run check:golden`으로 WALLA 스키마 검증 + 정량 통계 계산 로직을 실제 파일에 대고 바로
확인할 수 있다.

**중요한 원칙(2026-07-16 사용자 확인)**: 골든 체크의 기대값은 "실제 보고서 문구와 토씨 하나까지
일치"가 목적이 아니다. 이 프로젝트의 의도는 담당자가 처음부터 다 쓰던 보고서의 **정확하고 자세한
틀**을 자동 생성해 검수·수정 부담을 줄이는 것이지, 특정 과거 보고서를 완전히 복제하는 게 아니다.
그래서:
- **정량 수치(평균/SD/NPS/비율)**: raw data에서 결정론적으로 계산되는 값이라 편집 여지가 없다.
  실제 보고서와 대조해 검증하되, 계산이 정말 맞는지는 raw data 직접 재계산으로 독립 확인한다
  (아래 사례 참고). 이 값들은 골든 체크로 엄격하게(정확히 일치) 검증해도 된다.
- **정성적 내용(카테고리명·인사이트·제언 문구)**: 사람이 검수·수정하는 게 설계 의도이므로, 특정
  보고서의 정확한 워딩과 100% 일치할 필요는 없다. PRD 1.3절의 느슨한 기준(카테고리 커버리지
  70%+, 극성 판정 일치율 90%/75%)이 이런 항목에 맞는 검증 강도다 — 정량 체크처럼 exact-match로
  강제하지 말 것.

**실제 있었던 사례**: 리바랩스 보고서를 페이지별로 대조하던 중, "즐거움1(재미·흥미도)" 항목의
표준편차가 보고서에는 3.12로 적혀있는데 우리 계산은 2.96이었다. raw data(40번 컬럼)를 직접
재계산해 2.96이 맞다는 걸 확인했다 — 보고서 쪽이 바로 옆 문항(실용성2, SD 3.12)값을 복사-붙여넣기
하다 실수한 것으로 추정된다. `scripts/check-golden-sample.ts`는 이런 이유로 보고서 숫자를
맹목적으로 베끼지 않고, **우리가 raw data로 독립 재검증한 값**을 기대값으로 쓴다. 새로 보고서와
대조할 때도 이 원칙을 지킬 것 — 불일치를 발견하면 먼저 raw data로 직접 재계산해 어느 쪽이 맞는지
확인하고, 무조건 보고서 숫자에 맞추려 하지 말 것.

## WALLA 스키마 검증 (`lib/walla/`)

- `schema.ts`의 컬럼 스펙은 PRD 5.1절 표를 코드화한 것. 6/8/10/12/14/16번(기능 만족도)과
  24번(경쟁서비스 경험 유무) 컬럼은 프로젝트마다 문구가 달라지므로 리터럴이 아니라 정규식으로
  느슨하게 매칭한다 — 나머지는 리터럴 일치.
- 시트 마지막에 서식만 남은 빈 컬럼/빈 행이 흔하다(실측: 리바랩스 원본은 60번째 열이 빈 유령
  컬럼, 데이터는 892개 트레일링 빈 행 포함). `parse.ts`/`schema.ts`가 이를 자동으로 잘라낸다.

## 정량 통계 계산 (`lib/quant/`, Phase 2)

- `basic.ts`: 평균/표준편차(표본, ddof=1)·범주분포·상대중요도·NPS 계산. LLM 미사용
  (4.1절 설계 원칙 — 정량은 항상 규칙 기반).
  - **표준 원칙(2026-07-24 사용자 확정): 앞으로 SW제품형(리바랩스류)·실제품형(케어클류)을
    막론하고 모든 사분면(중요도-만족도) 그래프는 아래 FGI 방법으로만 추출·생성한다.** 상대중요도
    공식·사분면 경계·9칸 우선순위 모두 FGI 기준을 따르며, 임의 산식을 새로 만들지 말 것. FGI
    원본 엑셀은 `기능`·`핵심구매요소` 두 시트가 있고 둘 다 같은 공식/사분면을 쓴다 — 어떤 축
    (기능 기준이든 핵심구매요소 기준이든)으로 그리든 이 방법을 그대로 적용한다.
  - **상대중요도(사분면 X축)는 알파브라더스 FGI 원본 산식으로 확정**했다(2026-07-24,
    `data/FGI_데이터_정리_및_그래프_생성.xlsx`의 상대중요도 K열 수식 대조). 공식:
    **`상대중요도 = 5 − 10 × (평균 우선순위 − 1) / (항목 수 − 1)`** — 1위=+5, N위=−5로
    **항목 수 N과 무관하게 항상 ±5** 범위. 예전 산식 `(N+1) − 2×평균순위`는 **N=6일 때만**
    이 FGI 공식과 같아서(리바랩스 6개 기능은 값 불변, golden 93/93 유지) N이 다르면 ±(N−1)로
    어긋났다 — FGI 공식으로 일반화해 어떤 raw data(항목 수)든 ±5로 나온다. 케어클 렌더러
    (`lib/pdf-carecl-v1/quant.ts`)의 상대중요도도 같은 공식을 쓴다.
  - **사분면(중요도-만족도) 그래프는 FGI 방법과 일치**(2026-07-24 리바랩스로 렌더 검증):
    X=상대중요도(−5~5) 경계 **−2/+2**, Y=만족도(0~10) 경계 **6/8**, 9칸→5단계 우선순위
    (좌상단 "개선 필요성 적음·최하" … 우하단 "긴급 개선·최상"). `ImportanceSatisfactionChart`/
    `renderQuadrantChart`의 셀 문구가 FGI 엑셀 셀과 글자까지 동일함을 확인. **"영역별 참고
    지표"의 9칸 평가기준 다이어그램은 코드로 그리던 `CanvasPriorityReference` 대신 FGI 원본
    이미지를 그대로 쓴다**(2026-07-24 사용자 제공, `data/사분면그래프_평가기준.png` →
    `public/images/quadrant-priority-reference.png`로 복사, `sectionsQuant.tsx`의
    `PRIORITY_REF_PATH`). 이미지 옆에 우선순위 표(`PriorityLegendTable`)+판정기준
    (`PriorityDetailNotes`)을 두는데, **원본은 이미지(좌)와 표(우)가 나란히 배치**돼 있다
    (2026-07-25 원본 28페이지 재대조로 확정). ~~2026-07-24엔 "`Image`를 flex 형제 열에
    두면 옆 열이 붕괴해 범례가 사라지는 실측 버그"가 있다고 기록해 위/아래로 쌓았었는데~~,
    **2026-07-25 재검증 결과 이미지에 `flex`가 아니라 고정 pt 폭(`width:200`, `flexDirection:
    "row"`인 부모 안에서도 flex 없이 고정폭)을 주면 옆 열이 붕괴하지 않고 정상적으로 나란히
    렌더링된다** — 예전 버그는 이미지에 flex 기반 폭을 준 게 원인이었던 것으로 추정, 원본과
    같은 좌(이미지)/우(표) 배치로 되돌렸다. **사분면 차트(`CanvasQuadrantChart`) 바로 뒤에
    이어지는 배너에 걸려있던 `break`도 제거**했다(2026-07-25) — 무조건 새 페이지로 넘겨서
    앞 표("기능별 중요 순위 종합") 페이지 공간이 남아도 못 쓰고, 사분면 차트 페이지도 절반만
    채운 채 끝나는 낭비가 컸다. 지금은 배너+차트를 `wrap={false}` 하나로만 묶어 자연스럽게
    이어지게 하고, "영역별 참고 지표"(제목+이미지+표, 좌우 배치로 짧아짐)도 별도
    `wrap={false}`로 묶어 앞 페이지에 공간이 남으면 이어지고 없으면 통째로 다음 페이지로
    넘어가게 했다 — **참고 이미지 폭은 300→200으로 줄였다**(페이지 넘김은 계산이 아니라
    실제 렌더로 확인, 300/250은 여전히 다음 페이지로 밀렸고 200에서 안정적으로 들어감).
    **사분면은 항목마다 "우선순위 + 만족도"가 둘 다 있어야 그릴 수 있다** — 리바랩스는 기능이
    둘 다 있어 그려지지만 케어클은 핵심구매요소(순위만)·기능(만족도만)이 반쪽이라 사분면을
    못 그린다(원본 케어클 보고서에도 사분면이 없는 이유).
- `compute.ts`의 `computeQuantStats`가 Ⅱ(인적사항)·Ⅲ(기능만족도)·Ⅳ(핵심구매요소)·Ⅴ(4대가치)·
  Ⅵ(UX품질)·Ⅷ(NPS·종합만족도) 섹션을 계산한다. **Ⅶ 교차분석은 아직 미구현.**
- **실측 함정**: 18~23번(순위 응답) 컬럼의 항목명은 6/8/…/16번(기능 만족도) 헤더에서 추출한
  짧은 이름과 문구가 다르다(예: "실시간 거점형" ↔ "실시간 위치 기반 거점형 콘텐츠"). 이름을
  그대로 비교하면 순위 데이터가 다른 항목으로 취급돼 상대중요도가 틀어진다.
  `lib/walla/normalize.ts`의 `alignToFeatureName`이 어절 포함관계로 정렬한다 — 새 raw data
  포맷을 지원할 때 이 정렬 로직이 여전히 맞는지 반드시 재확인할 것.
- `npm run check:golden`이 Ⅲ(기능별 만족도)·Ⅳ(핵심구매요소 상대중요도·분포)·Ⅴ(4대가치)·
  Ⅵ(UX품질)·Ⅷ(NPS·종합만족도) 전 섹션, 총 49개 값을 실제 발행 보고서 기준으로 대조한다
  (2026-07-16 확인 기준 49/49 PASS). 정량 로직을 건드리면 반드시 다시 돌려서 전부 PASS인지
  확인할 것 — 이게 v1의 최소 회귀 테스트다(9.3절 정신). Ⅶ 교차분석 구현 시 참고할 실측값(연령대별·
  성별 기능/4대가치 만족도 차이)도 보고서 41~42페이지에 있다.

## Stage1 정성 파이프라인 (`lib/pipeline/stage1.ts`, Phase 3)

- PRD 6.2절 프롬프트(few-shot 4개 포함)를 그대로 옮겼다 — 4.4절이 "6장 프롬프트 본문은 변경
  없음"이라고 명시하므로 임의로 다듬지 말 것.
- **`generateObject`가 아니라 `generateText({ output: Output.object({ schema }) })`를 쓴다.**
  PRD 4.4절은 "generateObject + Zod"라고 표현하지만, 이 프로젝트가 쓰는 AI SDK 버전에서는
  `generateObject`/`streamObject`가 deprecated이고(`node_modules/ai/docs/03-ai-sdk-core/
  60-telemetry.mdx` 참고) `Output.object()`가 그 후속 API다. 강제되는 구조·의미는 동일.
- `runStage1ImprovementIdea`는 6.6절 변형(개선아이디어, 58번 컬럼) — 점수·극성 없이 절 분리만.
- **`temperature: 0`은 실측 결과 `claude-sonnet-5`에서 아무 효과가 없다.** PRD 10장은 재현성
  확보를 위해 temperature=0을 요구하지만, `claude-sonnet-5`는 temperature 파라미터를 아예
  지원하지 않아 AI SDK가 조용히 무시하고 경고만 남긴다(`npm run check:stage1` 실행 시 실제로
  확인됨: `Warning: ... temperature is not supported by claude-sonnet-5 and will be ignored`).
  코드에는 다른 모델로 바꿀 경우를 대비해 남겨뒀지만, 이 모델을 쓰는 한 재현성은 temperature로
  확보되지 않는다는 뜻이다 — 11장 리스크 6번("재현성 허용 오차")이 v1.1이 가정했던 것보다 더
  중요한 이슈가 됐다. 프롬프트나 few-shot을 건드릴 때 이 점을 감안할 것.
- `npm run check:stage1`이 PRD 6.2절 few-shot 예시 4개를 실제 API로 재실행해 verbatim 규칙
  준수 여부와 극성 판정을 검증한다(2026-07-16 실행 기준 4/4 PASS 확인). **ANTHROPIC_API_KEY 필요,
  실제 과금 발생** — golden 스크립트와 달리 자동으로 돌리지 말고 프롬프트를 건드렸을 때만 수동
  실행할 것. `tsx` 스크립트는 Next.js와 달리 `.env.local`을 자동으로 읽지 않으므로 package.json에
  `tsx --env-file=.env.local`로 명시했다 — 새 검증 스크립트를 추가할 때 이 패턴을 따를 것.

## Stage2 + 병렬 오케스트레이션 (`lib/pipeline/`, Phase 4)

- `stage2.ts`: PRD 6.3절 프롬프트(카테고리+대표인용+인사이트 초안) 그대로. `runStage2ImprovementIdea`는
  6.6절 변형(개선아이디어, 극성 없이 카테고리화만).
- `confidence.ts`: 6.4절 극성 판정 신뢰도 규칙(감정어 포함 여부, LLM 재호출 없음).
- `questions.ts`의 `buildQuestionSpecs`가 WallaRecord[]에서 정성 처리 대상 14문항(기능6+
  4대가치4+유사서비스만족도+전반적만족도+NPS+개선아이디어)을 추출한다. 실측 확인: 리바랩스
  골든셋 기준 유사서비스만족도만 n=91(24번 컬럼이 "있음"인 응답자만), 나머지는 전부 n=100.
- `orchestrate.ts`의 `runQualitativePipeline`이 4.2절 병렬 처리 요구사항을 구현한다.
  **`p-limit`을 Stage1용/Stage2용으로 반드시 분리해서 쓴다** — 같은 limiter를 안에서 또 호출하면
  (Stage1 작업들이 limiter를 다 채운 상태에서 그 안의 Stage2 호출이 슬롯을 못 얻어) 교착 상태에
  빠진다는 게 p-limit 공식 문서의 경고다. 하나로 합치려는 유혹이 들어도 이 이유로 하지 말 것.
  동시성은 `PIPELINE_CONCURRENCY` 환경변수로 조정 가능(기본 8, 13.3절 실험 2 대상).
- `runQualitativeAnalysis` 채팅 도구는 **정량 통계를 보여준 뒤 사용자 승인을 받고서만** 호출하도록
  시스템 프롬프트에 명시했다 — 14문항 × Stage1/2로 실제 API를 수십 회 호출하는 비용·시간이 드는
  작업이라 computeQuantStats처럼 자동으로 이어붙이지 않는다.
- `npm run check:qualitative`가 리바랩스 골든셋 전체로 파이프라인을 돌려 처리시간(Vercel 300초
  제한 대비)과 quotes verbatim·clause_count 합계 정합성을 검증한다. **ANTHROPIC_API_KEY 필요,
  실제 과금 발생(약 32회 이상의 API 호출)** — 자동 실행하지 말고 수동으로만 돌릴 것.
- **정성 파이프라인 fidelity 검증용 참고 데이터**: 실제 보고서 8~26페이지에 문항별 실측
  긍정/부정/중립 비율이 있다(예: 펫과의 산책 긍정26.6%·부정70.4%·중립3.0%). PRD 1.3절의 극성
  판정 일치율 기준(긍정 vs 나머지 90%+, 부정 vs 중립 75%+)을 실측 검증할 때 이 비율을
  참고하되, 위 "골든 테스트셋" 절의 원칙대로 **exact-match를 강제하는 골든 체크로 만들지는
  말 것** — 카테고리·인사이트는 사람이 다듬는 영역이라 정량 체크와 검증 강도가 다르다.
- **`claude-sonnet-5`는 기본적으로 reasoning(내부 사고)이 켜져 있고, reasoning 토큰이
  `maxOutputTokens` 예산을 먼저 소비한다.** 100명 전체를 한 번에 처리하는 큰 문항에서 이걸
  모르고 `maxOutputTokens: 16000`만 주면, 토큰 예산을 거의 다 "생각"에 써버리고 실제 응답은
  응답자 1명분(371자)만 나오다 잘린다(`NoOutputGeneratedError`/`finishReason:"length"`로
  재현됨, 2026-07-16). `stage1.ts`/`stage2.ts`의 모든 `generateText` 호출에 반드시
  `reasoning: "none"`(같은 예산으로 100명 전체 처리 가능해짐, 실측 확인)과 충분한
  `maxOutputTokens`(Stage1 32000 / Stage2 16000)를 같이 준다 — **`reasoning: "none"`을
  지우지 말 것**. 이 fix 이후 `check:qualitative-fidelity`로 재검증한 결과 극성 판정 정확도가
  오히려 개선됐다(긍정 95.8%→100%, 부정/중립 71.4%→85.7%) — Stage1/2는 few-shot으로 규칙이 이미
  명시된 분류·추출 작업이라 별도 reasoning이 불필요하고, 꺼두는 게 (예산을 다 뺏기지 않으므로)
  오히려 결과 품질에 유리하다.
- **프롬프트 캐싱**: Stage1/Stage2의 시스템 프롬프트(few-shot 포함)는 표준 문항마다 동일한
  텍스트가 반복 전송된다(Stage1은 문항당 1회 = 최대 13회, Stage2는 문항×극성당 1회 = 최대
  39회). **이 프로젝트가 쓰는 AI SDK 버전은 `generateText`의 `system` 단축 파라미터를 아예
  지원하지 않는다** — 넣으면 "System messages are not allowed in the prompt or messages
  fields. Use the instructions option instead."로 즉시 에러가 난다(실측 확인, 2026-07-16).
  `@ai-sdk/anthropic`의 캐싱 문서(`node_modules/@ai-sdk/anthropic/docs/05-anthropic.mdx`)가
  보여주는 "messages 배열에 role:\"system\"" 예제도 이 AI SDK 코어 버전 기준으로는 틀렸다 —
  실제로는 `node_modules/ai/docs/02-foundations/03-prompts.mdx`의 "Provider Options >
  Message Level" 안내대로 `instructions: { role: "system", content, providerOptions:
  { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } } }` 형태로 줘야 한다.
  ttl을 기본값(5분)이 아니라 1h로 잡은 이유는 파이프라인 1회 실행이 실측 900초+ 걸릴 수 있어서
  (`check:category-coverage`), 5분 TTL이면 뒤쪽 문항이 캐시가 만료된 뒤 호출될 수 있기 때문.
  최소 작업 스크립트로 직접 검증(2026-07-16): 동일 시스템 프롬프트로 2회 연속 호출 시 1차는
  `cacheWriteTokens`, 2차는 `cacheReadTokens`가 찍히는 것을 확인했다. 개선아이디어 변형
  (`runStage1ImprovementIdea`/`runStage2ImprovementIdea`)은 문항당 1회만 호출되므로(58번
  컬럼 단일 문항) 캐싱 이득이 없어 일부러 적용하지 않았다.

## DB 스키마 + 체크포인트 A/B (`lib/db/`, `components/PolarityReview.tsx`,
## `components/InsightEditor.tsx`, Phase 5)

- `lib/db/schema.sql`이 스키마 원본이다. `npm run db:migrate`로 적용(idempotent, `create table
  if not exists`라 몇 번을 돌려도 안전). 별도 마이그레이션 프레임워크(drizzle-kit 등)는 아직 없다
  — 스키마가 더 복잡해지기 전에 도입을 검토할 것.
- 테이블: `reports`(파일당 1행, file_url 유니크) → `questions`(문항 14개) → `clauses`(Stage1,
  standard 문항만) / `categories`(Stage2, polarity는 improvement 문항에서 null). 체크포인트 상태는
  `clauses.reviewed`/`overridden_polarity`, `categories.insight_approved`/`insight_final`
  컬럼에 저장한다 — 별도 리뷰 테이블을 안 두고 대상 테이블에 바로 컬럼을 얹는 방식을 택했다.
- `computeQuantStats`가 `upsertReportQuantStats`로 report를 만들고, `runQualitativeAnalysis`가
  `saveQualitativeResults`로 문항·절·카테고리를 저장한다. **재실행하면 해당 report의 문항을
  전부 지우고 새로 채운다** — 체크포인트 승인 이력도 함께 초기화된다(PRD가 재실행 시 이력 유지
  여부를 규정하지 않아 "재실행 = 새로 검수"로 단순화, `lib/db/reports.ts`의 `saveQualitativeResults`
  주석 참고).
- **체크포인트 버튼과 채팅 도구가 같은 DB 함수를 두 경로로 호출하는 구조**: 카드의 버튼 클릭은
  `/api/checkpoint/polarity`, `/api/checkpoint/insight` Route Handler를 직접 호출(LLM을 거치지
  않아 빠르고 비용 없음). 사용자가 채팅에 자연어로 지시하면(`"이건 부정이야"`) `submitPolarityReview`/
  `submitInsightReview` 채팅 도구가 호출된다. 두 경로 모두 `lib/db/reports.ts`의 동일한 함수를
  쓰므로 로직이 중복되지 않는다 — PRD 7장이 "버튼 클릭 또는 자연어 답장 둘 다로 가능해야 한다"고
  명시한 요구사항을 이렇게 구현했다.
- `getPolarityReviewQueue`는 `confidence='low' and reviewed=false`인 clause만 반환한다(6.4절
  "전수 노출 시 검수 피로 발생" 원칙, 7.1절). `getInsightReviewQueue`는 `insight_approved=false`인
  카테고리 전부를 반환한다(insight는 전수 검수 대상, 7.2절).
- 실제 Supabase 인스턴스에 대고 CRUD 전체(트랜잭션, `text[]` 배열 컬럼, JSONB, PATCH API 라우트
  end-to-end)를 스크립트로 라이브 검증 완료(2026-07-16).

## 제언 · 결과요약 · 종합전략제언 (`lib/pipeline/recommendation.ts`, `summary.ts`, `hedgeCheck.ts`,
## `components/RecommendationReview.tsx`, Phase 6)

- `recommendation.ts`: PRD 6.5절 헤지워딩 프롬프트 그대로. `runRecommendation({sectionLabel,
  dataSummary})`는 세 군데서 재사용된다 — `generateRecommendation` 도구의 section이
  `core_purchase_factor`(Ⅳ 핵심구매요소 해석) / `dev_priority`(Ⅸ 개발우선순위제언) /
  `strategic_draft`(종합전략제언 초안 도움), `generateFeatureRecommendation` 도구는 기능별
  As-is→To-be(질문별 부정 카테고리를 DB에서 조회해 근거로 사용). 전부 Tier 2(AI초안+체크포인트B
  대상②)이므로 생성 즉시 `recommendations` 테이블에 저장되고(단, strategic_draft는 저장하지
  않는다 — 종합전략제언은 담당자가 최종 결정), 승인 전까지 최종 문서에 안 들어간다.
- `summary.ts`: PRD 6.9절 결과요약 프롬프트. Tier 1(완전 자동생성, 해석 없음)이라 승인 절차가
  없고 DB에도 저장하지 않는다 — computeQuantStats가 이미 저장한 quant_stats를 그때그때 근거로
  써서 매번 새로 생성한다.
- `hedgeCheck.ts`의 `checkHedgeWording`은 PRD 7.2절 "금지 표현 목록에 대한 문자열 매칭" 1차
  검사를 그대로 구현한 규칙 기반 함수(LLM 재호출 없음). 문장이 "사실 서술"인지 "해석"인지는
  구분하지 않고 전체 텍스트에서 금지 표현·헤지 표현 존재 여부만 본다 — PRD 원문이 요구하는
  검증 강도 그대로이며, 이 이상의 정교한 문장 단위 분류는 범위 밖이다. `generateRecommendation`/
  `generateFeatureRecommendation`/`getRecommendationReviewQueue` 도구가 생성·조회 시마다
  자동으로 이 검사를 돌려 `hedgeViolations`를 함께 반환한다.
- `saveStrategicInputTool`(7.3절)은 AI가 아무것도 생성하지 않는다 — 사용자가 채팅으로 전달한
  고객사 요청사항·우선 고려 지표·제언 초안을 그대로 `strategic_inputs`에 저장할 뿐이다. 부분
  필드만 여러 번 나눠 보내도 `saveStrategicInput`의 `coalesce` upsert가 기존 값을 지우지 않고
  누적한다(라이브 테스트로 확인).
- 체크포인트 B 대상②(제언)도 A/B와 동일한 이중 경로 패턴을 따른다: 카드 버튼은
  `/api/checkpoint/recommendation`을 직접 호출하고, 자연어 지시는 `submitRecommendationReview`
  채팅 도구가 처리하며, 둘 다 `lib/db/reports.ts`의 `approveRecommendation`을 공유한다.

## PDF 조립 (`lib/pdf/`, Phase 7)

- **모든 보고서 공통 원칙 — 도표·양식·테마·페이지 넘김은 전부 결정론적 렌더링 코드다.**
  PDF의 시각 포맷(색상·글꼴·크기·줄 간격·표 양식·차트 스타일)은 100% `lib/pdf/*.tsx`+
  `lib/pdf/theme.ts`+`lib/charts/canvasCharts.ts`로 결정되고 채팅 LLM 프롬프트와 무관하다.
  `assembleReport()`는 항상 같은 컴포넌트 트리를 거치므로, 이 코드를 고치면 **어떤 raw data로
  만든 보고서에도** 같은 양식이 자동 적용된다(기능명·설문 문항·수치는 각 raw data의 WALLA
  스키마에서 결정론적으로 도출). 특정 프로젝트에 하드코딩하지 말고 항상 데이터에서 도출할 것.
- **페이지 넘김(pagination) 원칙(2026-07-23 사용자 요청) — "표 하나를 통째로 못 넣는 페이지는
  쪼개서 자연스럽게 이어지게, 페이지는 꽉 채우게".** 큰 표를 `wrap={false}`로 통째 묶으면 한
  페이지에 다 안 들어갈 때 표 전체가 다음 페이지로 밀려 앞 페이지에 빈 공간이 생긴다. **표
  컨테이너에는 `wrap={false}`를 걸지 말고**(페이지 경계에서 쪼개지게), **쪼개지면 안 되는 최소
  단위는 "행 하나"** 로 잡아 그 행에만 `wrap={false}`를 건다.
  - **"병합 셀"(예: 설문 항목 표의 단계 열)이 있어도 그 그룹 전체를 한 `wrap={false}` 블록으로
    묶지 말 것** — 문항이 많은 단계(예: 사용자 경험 품질평가 8문항)가 남은 공간에 안 들어가면
    블록 통째로 밀려 앞 페이지에 큰 여백이 생긴다(2026-07-23 "이런 페이지 넘김은 옳지 않다"
    지적). 대신 **문항(행) 단위로 흐르게** 하고, 병합 라벨은 그룹의 첫 행에만 넣고 단계 셀은
    그룹 내부에선 아래 테두리 없이 배경색으로 이어지다 그룹 끝에서만 구분선을 그어 "병합된 열"
    처럼 보이게 한다. 그룹이 페이지를 넘어가면 다음 페이지엔 라벨 없는 배경색 칸이 이어져(같은
    그룹 연속임을 시각적으로 유지) 페이지가 낭비되지 않는다(`SurveyQuestionTable`이 이 패턴 —
    `flatMap`으로 문항 행을 펼치고 `qi===0`일 때만 라벨).
  - 작은 표(NPS 요약·UX 점수표 등)는 한 행씩만 `wrap={false}`로 두거나 그대로 둬도 무방하다.
    큰 빈 칸이 있는 행(`OverviewTable`의 "주요 기능")은 그 행만 `wrap={false}`.
  - `wrap={false}`가 페이지 경계 근처 렌더링 이상을 항상 막아주진 않으니(아래 "색깔 조각" 사례)
    새 표를 추가하면 **실제 렌더로 페이지 넘김을 눈으로 확인할 것**.
- **PRD 8장의 "react-pdf가 직접 그래프를 못 그리므로 PNG로 먼저 생성해야 한다"는 가정은 틀렸다
  (실측, 2026-07-16).** `@react-pdf/renderer`는 `View`의 flexbox만으로 막대그래프를 충분히
  그릴 수 있고, `Svg`/`Rect`/`Path` 등 벡터 프리미티브도 네이티브로 지원한다. 그래서 외부 캔버스
  라이브러리나 PNG 래스터화 단계를 아예 두지 않았다(`lib/pdf/charts.tsx` — `BarChart`,
  `DivergingBarChart`, `PolarityStackedBar` 전부 `View`만으로 구현). Vercel 서버리스에 native
  바이너리(canvas 등) 의존성이 없어도 되므로 오히려 더 안전한 선택이다.
- **치명적이었던 실측 버그: WOFF2 폰트를 등록하면 폰트 로드 자체는 성공하지만 렌더링된 PDF에서
  텍스트가 전부(!) 사라진다** — 레이아웃(막대그래프 트랙, 표 테두리, 섹션 헤더 배경색)은 정상인데
  글자만 통째로 안 보이는 형태라 원인 파악이 까다로웠다. WOFF(비압축)로 바꾸니 즉시 해결됐고,
  파일 크기도 7.8MB(서브셋팅 실패로 추정)에서 60KB(정상 서브셋팅)로 줄었다. **`lib/pdf/fonts.ts`는
  반드시 `.woff`를 쓸 것 — `.woff2`로 되돌리지 말 것.** 폰트 파일은 `public/fonts/`에 있다
  (`@fontsource/noto-sans-kr`에서 추출, OFL 라이선스라 재배포 가능. 패키지 자체는 설치돼 있지
  않음 — 파일만 복사해서 쓴다).
- **Roman 숫자 유니코드(Ⅰ~Ⅸ, U+2160대)도 이 폰트에서 깨진다**(엉뚱한 라틴 소문자로 대체됨).
  `SectionHeader`의 `numeral` prop에는 일반 ASCII `"I"`, `"II"`, `"III"`... 를 쓴다 — 유니코드
  로마 숫자 문자를 다시 넣지 말 것.
- `fontStyle: "italic"`도 쓰면 안 된다 — 이탤릭 폰트 파일을 등록하지 않아서 즉시 에러가 난다
  (`Could not resolve font ... fontStyle italic`). 기울임이 필요하면 색상/크기로 구분할 것.
- 6.9절 결과요약 프롬프트가 "개조식으로 요약"을 지시하면 모델이 마크다운(`#`, `##`, `-`, `**`)을
  섞어 쓰는 경우가 있다. `react-pdf`의 `Text`는 마크다운을 해석하지 않으므로 그대로 두면 `#`이
  글자 그대로 찍힌다. `sectionsQualitative.tsx`의 `MarkdownLite`가 렌더링 단계에서만 가볍게
  변환한다(굵은 소제목/불릿/인라인 `**` 제거) — **프롬프트 문구 자체는 건드리지 않는다**(4.4절
  원칙, 6장 프롬프트 불변).
- `assembleReport`(`lib/pdf/assemble.ts`)는 체크포인트 게이트를 강제한다: `getPendingInsightReviews`/
  `getPendingRecommendationReviews`가 하나라도 있으면 실패를 반환하고 PDF를 만들지 않는다
  (PRD 8장 "insight는 승인된 버전으로 교체된 뒤에만... 승인 전에는 문서가 발행되지 않는다").
  `getQuestionsWithApprovedCategories`가 애초에 `insight_approved=true`인 카테고리만 돌려주므로
  이 게이트를 통과하면 렌더링 자체는 항상 승인된 데이터만 쓴다.
- **체크포인트 A(극성 재배치)는 Stage2 카테고리 재구성에 반영되지 않는다** — 개별 clause의
  `overridden_polarity`는 추적용으로만 저장되고, PDF의 카테고리 묶음(긍정/부정/중립)은 Stage2가
  원래 클러스터링한 대로 나간다. 재배치된 clause를 다른 카테고리로 옮기려면 Stage2를 다시 돌려야
  하는데 이건 v1 범위 밖이다 — 알려진 단순화로 남겨둠.
- 완성된 PDF는 채팅 메시지에 base64로 통째로 넣지 않고 **Vercel Blob에 업로드해 URL만 반환**한다
  (PRD 3장 ⑩ "채팅에 다운로드 링크 제공"이라는 표현을 그대로 따름 — 대화 페이로드 크기·스트리밍
  성능을 위해서이기도 하다). `@vercel/blob`의 서버사이드 `put()`을 쓴다(브라우저 업로드용
  `@vercel/blob/client`의 `upload()`와는 다른 함수 — 헷갈리지 말 것).
- **Ⅰ장(개요)의 제품 정보(PRD 5.0절)는 v1.4에서 입력 흐름이 생겼다** (`lib/productInfo/`,
  `saveProductInfoTool`/`extractProductInfoFromFile` 채팅 도구, `components/ProductInfoCard.tsx`).
  두 경로 지원: ① 사용자가 채팅에 직접 타이핑 → 그대로 저장(해석 없음). ② raw data가 아닌
  기업소개 파일(PDF/워드/텍스트)을 첨부 → `lib/productInfo/extractText.ts`(pdf-parse/mammoth로
  텍스트 추출) → `runProductInfoExtraction`(Claude 구조화 추출, `reasoning:"none"`) → 카드로
  보여주고 **사용자 확인 후에만** 저장(추출은 AI 해석이 개입되므로 자동 저장 금지, Tier 2
  방식B와 같은 원칙). `reports.product_info` 컬럼에 jsonb `||` 병합으로 upsert되므로, raw data
  업로드 전에 기업 정보부터 얘기해도 대화 맥락에 기억해뒀다가 raw data의 fileUrl을 안 뒤에
  저장하면 된다(실측 확인: 부분 필드 2회 저장이 누적되는 것을 raw SQL round-trip으로 검증,
  2026-07-20). **"주요 기능 목록"(기능명+설명+이미지 리스트, 5.0절 세 번째 필드)은 이미지 첨부
  흐름까지 필요해서 범위에서 뺐다** — 텍스트 필드 10개만 지원. PPT(.pptx) 첨부 지원도 아직 없다
  (PDF/워드/텍스트만) — 둘 다 알려진 갭.
- **최종 PDF 다운로드 링크 버그(2026-07-19 발견)는 2026-07-20 수정 완료.** Blob 스토어가
  private 전용이라 `assembleReport`의 `put(..., { access: "public" })`이 실패했던 문제를,
  ① 업로드 자체를 `access: "private"`로 바꾸고 ② `app/api/download/route.ts` 프록시 라우트를
  새로 만들어 해결했다. 이 라우트는 `?u=<블롭 URL>&name=<파일명>` 쿼리를 받아 서버가
  `BLOB_READ_WRITE_TOKEN`으로 대신 읽어서 스트리밍해주므로, 사용자에게 주는 링크는 원본 private
  블롭 URL이 아니라 이 프록시 URL이다(`assembleReport`가 반환하는 `pdfUrl`이 이미 프록시
  URL 형태). **`u` 파라미터는 반드시 `*.private.blob.vercel-storage.com` 호스트인지 검증한다**
  — 이 라우트가 임의 URL을 대신 가져와주는 오픈 프록시가 되는 걸 막기 위한 안전장치이니 이
  검증을 지우지 말 것. 실측 검증(2026-07-20): 실제 DB의 report(정성 분석 없이 quant_stats만
  있는 상태 — 체크포인트 대상이 0건이라 게이트를 그대로 통과함을 활용해 무료로 테스트)로
  `assembleReport`를 직접 호출해 진짜 10페이지 PDF를 생성하고, 반환된 프록시 URL을 실제
  로컬 서버에 curl로 요청해 원본과 동일한 PDF 바이트가 내려오는 것과 Ⅰ장 10개 필드가 전부
  올바르게 렌더링되는 것을 확인했다. 허용되지 않은 호스트·누락된 파라미터에 대한 400 거부도
  같이 검증했다.

## CI + 정성 파이프라인 fidelity 측정 (`.github/workflows/ci.yml`,
## `scripts/check-qualitative-fidelity.ts`, Phase 8)

- GitHub Actions(`ci.yml`)가 push/PR마다 typecheck·lint·build를 돌린다. **`check:golden`은
  CI에 안 걸려 있다** — 리바랩스 raw data가 응답자 정보 포함이라 gitignore돼 있어 CI 환경에
  없기 때문. `lib/quant/`나 `lib/walla/`를 건드리는 변경은 머지 전에 로컬에서 반드시
  `npm run check:golden`을 돌려 89/89 유지되는지 확인할 것 — CI가 자동으로 잡아주지 않는다.
  DATABASE_URL·ANTHROPIC_API_KEY 등 환경변수 없이도 `next build`는 통과한다(실측 확인 —
  Route Handler는 build 시점에 실행되지 않고, DB/LLM 클라이언트는 첫 요청 때 지연 초기화된다).
- `check:qualitative-fidelity`가 PRD 9.2절이 요구하는 **극성 판정 일치율**을 실제 발행 보고서의
  원문 인용문(24개 표본, 6개 문항)으로 측정한다. **실측 결과(2026-07-16)**:
  - 긍정 vs 나머지: **95.8%** (목표 90%+) → PASS
  - 부정 vs 중립: **71.4%**(14건 중 10건, 목표 75%+) → FAIL(근소, 표본 14건이라 1건 차이로
    합격선을 넘나든다 — 통계적으로 약함)
  - 실패 4건 중 1건은 명백한 오분류("일반 레이스를 플레이 해야하는 이유를 못 찾겠습니다"를
    positive로 판정), 나머지 3건은 "구체적 손해 서술 없는 불만족 표현"이라는, PRD 11장 3번
    항목이 이미 예견한 부정/중립 경계의 근본적 모호함에 해당한다.
  - **이 결과를 이유로 6.2절 프롬프트를 임의로 수정하지 않았다** — 4.4절 원칙(6장 프롬프트는
    v1.1 이후 불변) 때문. 대신 6.4절 신뢰도 규칙이나 체크포인트 A 운영 로그를 통해 개선하는
    것이 PRD가 의도한 경로다(11장 3번). 표본을 늘려 재측정하거나 프롬프트 자체를 바꾸는 결정은
    사용자와 상의 후 별도로 진행할 것.
  - 스크립트는 `ANTHROPIC_API_KEY` 필요(약 6회 호출, 저렴) — `check:stage1`과 마찬가지로 자동
    실행하지 말고 프롬프트를 건드렸을 때만 수동 실행할 것.

## 채팅 오케스트레이션 신뢰성 (`app/api/chat/route.ts`, v1.4 UX 원칙 구현 중 발견)

3.2절 UX 원칙(목차 동의 카드, 제품정보 카드 등 "A 다음엔 반드시 B, 사용자 응답 전엔 멈춤" 같은
게이트)을 실제로 만들고 나서, **시스템 프롬프트 지시문만으로는 이런 게이트가 안정적으로 지켜지지
않는다는 게 실제 브라우저로 반복 테스트해서 확인됐다**(2026-07-20). typecheck·lint·단발성 스크린샷
한두 장으로는 못 잡는 종류의 버그라, Playwright로 첨부→검증→카드 응답→다음 카드까지 전체 흐름을
여러 번 반복 실행하고, 서버 로그·네트워크 페이로드까지 직접 까봐야 재현·확정할 수 있었다. 이후
비슷한 게이트를 추가할 때는 이 절차(라이브 반복 실행 + 로그 확인)를 반드시 다시 거칠 것 — 텍스트
지시문을 "더 강하게" 쓰는 것만으로 고쳤다고 믿지 말 것.

- **문제 1: 같은 도구를 한 턴 안에서, 또는 다음 턴에서 다시 호출함.** 예를 들어 사용자가
  제품정보 카드에서 "건너뛰기"를 눌러도, 모델이 validateInput·presentProductInfoPrompt를 처음부터
  다시 호출해 카드가 또 뜨는 게 재현됐다. 시스템 프롬프트에 "이미 호출했으면 다시 호출하지
  마라"고 아무리 명시해도(일반 지시문 + 매 턴 대화 기록을 스캔해서 동적으로 주입하는 지시문
  둘 다) 확률적으로만 지켜졌다.
  **해결**: `streamText`의 `prepareStep` 콜백에서, 한 대화당 한 번만 불러야 하는 도구
  목록(`validateInput`·`presentProductInfoPrompt`·`presentReportPlan`)에 대해 (a) 이전 턴
  메시지 기록(`hasCompletedTool`로 `state:"output-available"` 스캔)과 (b) 이번 턴에서
  이미 실행된 스텝(`steps`의 `toolCalls`) 둘 다 확인해서, 이미 완료된 도구는 `activeTools`에서
  아예 빼버린다. 지시가 아니라 도구 자체를 못 부르게 막는 방식이라 확정적이다.
- **문제 2: A 도구 호출 직후, 모델이 지시된 B 도구를 안 부르고 그냥 텍스트만 쓰고 턴을 끝냄.**
  예: computeQuantStats가 끝나면 반드시 presentReportPlan을 부르라고 프롬프트에 명시했는데도,
  모델이 정량 통계 결과에 대한 설명 텍스트만 쓰고 멈춰서 목차 카드가 영영 안 뜨는 게 재현됐다.
  **해결**: 같은 `prepareStep`에서 "A는 끝났는데 B는 아직"인 상태를 감지하면
  `toolChoice: { type: "tool", toolName: "B" }`로 다음 스텝에 그 도구 호출을 강제한다.
  현재 두 전이 구간에 적용: validateInput → presentProductInfoPrompt, computeQuantStats →
  presentReportPlan. 새로운 "A 다음엔 반드시 B" 게이트를 추가할 때 이 패턴을 재사용할 것.
- **문제 3: 채팅 메시지가 화면에 통째로 중복 렌더링됨**(카드+텍스트가 그대로 한 번 더 나타남).
  React가 `Encountered two children with the same key`를 콘솔에 경고하는 것으로 원인을 확인
  했다 — `useChat`(AI SDK)이 드물게 같은 `id`를 가진 메시지를 두 개 내보내는 게 실측으로
  확인됨(원인이 라이브러리 내부라 여기서 직접 고칠 수 없음). **해결**: `app/page.tsx`에서
  `useChat`이 반환한 `messages`를 그대로 렌더링하지 않고, 같은 `id`가 여러 개면 마지막 것만
  남기고 걸러낸(`findLastIndex` 기반) `messages`를 만들어 그걸로 렌더링한다. 근본 원인(라이브러리
  버그)을 고친 게 아니라 렌더링 직전에 증상을 걸러내는 방어 코드이니, `ai`/`@ai-sdk/react`를
  업그레이드하면 이 필터가 여전히 필요한지 재확인할 것.
- 이 세 가지 모두 **프로덕션 빌드(`next build && next start`)로 재현·검증했다** — dev 모드의
  React Strict Mode가 렌더링을 이중으로 돌리는 특성 때문에 dev에서 본 중복이 실제 버그인지
  Strict Mode 아티팩트인지 헷갈릴 수 있다(실제로 문제 1을 처음 dev 모드에서 봤을 때는 Strict
  Mode 때문이라고 오판할 뻔했다). **이런 종류의 "반복 호출·중복 렌더링" 버그를 조사할 때는
  반드시 프로덕션 빌드로 재현되는지부터 확인할 것.**

## 파일 업로드 신뢰성 + 채팅 입력창 개선 (`lib/blob/getWithRetry.ts`, `components/FileUploadButton.tsx`,
## `app/page.tsx`, `components/ChatMarkdown.tsx`, 2026-07-20)

- **"파일을 찾을 수 없음" 에러 — 진짜 원인은 `onUploadCompleted` 콜백(중요)**: 담당자가 실사용
  중 raw data 업로드 직후 validateInput이 이 에러로 실패하는 걸 실제로 겪었다(스크린샷으로 재현
  확인). 처음에는 `@vercel/blob`의 `get()`이 404를 예외가 아니라 `null`로 반환하는 걸 보고
  (`node_modules/@vercel/blob/dist/index.js` 확인) 업로드 직후 곧바로 읽을 때 생기는 전파 지연
  (eventual consistency)이라 판단해 `lib/blob/getWithRetry.ts`로 재시도(최대 4회, ~6초)를
  추가했는데 — **여전히 재현됐다.** 서버 로그에 재시도 5번 전부 MISS가 찍히는 걸 보고서야
  타이밍 문제가 아니라는 게 확실해졌다. 직접 진단 스크립트로 서버사이드 `put()` → 즉시 `get()`을
  해보니 100% 즉시 성공했는데, 앱이 실제로 쓰는 **클라이언트 업로드 토큰 방식**(브라우저가
  `@vercel/blob/client`의 `upload()`로 직접 Blob에 쓰고, `app/api/upload/route.ts`의
  `handleUpload`가 완료 후 `onUploadCompleted` 콜백을 받는 구조)만 재현이 됐다. 로컬 dev
  (`localhost:3000`)는 외부에서 도달 가능한 URL이 없어서 "onUploadCompleted provided but no
  callbackUrl could be determined" 경고가 매 업로드마다 찍혔는데, **이 콜백이 도달하지 못하면
  private 블롭이 완전히 커밋되지 않는 것으로 보인다** — `onUploadCompleted`를 아예 제거하니
  (원래 내용도 빈 함수였다 — 체크포인트 상태 저장은 `lib/db/reports.ts`가 무관하게 처리) 같은
  파일로 즉시(`attempt=0 hit`, 재시도 0회) 성공했다. **`app/api/upload/route.ts`에
  `onUploadCompleted`를 다시 추가하지 말 것** — 뭔가를 하고 싶어지면(예: 업로드 완료 시점에
  DB 기록) 콜백 대신 클라이언트가 업로드 성공 후 별도로 서버를 호출하는 방식을 쓸 것. 이 사건은
  **"에러 메시지가 그럴듯해 보이는 첫 가설(eventual consistency)에 안주하지 말고, 재시도를
  걸어도 여전히 실패하면 즉시 다음 가설로 넘어가 직접 진단 스크립트로 격리해봐야 한다"**는
  교훈으로 남긴다 — 재시도 자체는 틀린 처방이 아니었지만(실제로 순수 타이밍 이슈에 대한 안전망
  가치는 있다) 근본 원인이 아니었다.
- **Blob 404 재시도 (`lib/blob/getWithRetry.ts`)**: 위 근본 원인과는 별개로, 업로드 직후 곧바로
  읽는 경로는 여전히 이론상 진짜 eventual-consistency 타이밍 이슈에 노출될 수 있어 안전망으로
  남겨뒀다. `lib/walla/loadFromUrl.ts`(raw data), `lib/productInfo/extractText.ts`(기업소개
  파일), `app/api/download/route.ts`(완성된 PDF) 세 곳 모두 이 공유 헬퍼를 쓴다 — 셋 다 "방금
  업로드/생성된 blob을 바로 읽는다"는 같은 위험 패턴이기 때문. **`onUploadCompleted` 제거 이후
  에도 완전히 사라지지 않았다** — 같은 날(2026-07-20) 라이브 테스트 중 6회에 1회꼴로 재현됐다
  (당시 재시도 예산 4회/~6초로는 부족). "이 에러는 절대 나면 안 된다"는 요구사항이라 재시도를
  7회(~15.5초)로 늘렸다 — 이후 4회 연속 재현 시도에서는 재발하지 않았지만, 원래도 드문
  현상이었으므로 100% 근절을 보장하는 확인은 아니다. 재발하면 원인 후보를 다시 넓혀볼 것
  (Vercel Blob 자체의 드문 진짜 지연 등).
- **`prepareStep`이 validateInput 실패도 성공처럼 취급하던 버그(중요, 위와 같은 시점에 같이
  발견)**: `doneEver("validateInput")`은 도구가 **호출됐는지**만 보고 **결과가 성공했는지**는
  안 봐서, validateInput이 파일을 못 찾아 실패해도 다음 스텝에 presentProductInfoPrompt를
  강제로 호출해버렸다 — 시스템 프롬프트의 "실패하면 이유를 설명하고 멈추세요" 지시와 정반대로
  동작한 것. 그 결과 한 메시지 안에 에러 카드와 (조건상 나오면 안 되는) 성공 카드가 같이 섞여
  나오는, 사용자가 보기에 순서가 이상한 화면이 됐다. `steps`에서 이번 턴의 `validateInput`
  `toolResults`를 찾아 `output.valid`를 직접 확인하고, 실패했으면 강제하지 않도록 고쳤다 —
  다른 "A 다음엔 반드시 B" 강제 전이를 추가할 때도 A의 **성공 여부**까지 확인해야 하는지 검토할
  것(지금까지의 전이들은 실패해도 다음 단계로 넘어가도 무해한 것들이라 이 문제가 안 드러났었다).
- **다중 파일 첨부**: `FileUploadButton`이 `<input multiple>`로 여러 파일을 한 번에 업로드하고
  (병렬 `Promise.all`), `app/page.tsx`의 `attachedFiles`가 배열로 바뀌었다 — raw data 파일과
  기업소개 파일을 한 메시지에 같이 첨부하는 흐름을 지원한다.
- **업로드 도중 전송 막기(중요)**: 다중 첨부를 만들고 나서 실측으로 발견한 문제 — 파일마다
  업로드 완료 시점이 다른데(작은 파일이 먼저 끝남), 전송 버튼이 "아직 업로드 중인 파일이
  있다"를 몰라서 큰 파일이 채 안 끝났는데 전송하면 그 파일이 통째로 메시지에서 빠진 채 나가는
  게 재현됐다. `FileUploadButton`이 `onUploadingChange` 콜백으로 업로드 상태를 부모에 올리고,
  `app/page.tsx`가 업로드 중에는 전송 버튼을 비활성화하고 "파일 업로드 중..." 표시를 띄운다.
- **입력창을 `<input>`에서 `<textarea>`로 교체(중요, 근본 원인)**: 사용자 피드백 중
  "여러 줄로 붙여넣은 긴 요구사항이 화면을 다 채운다, Claude처럼 접어달라"를 처리하려고
  긴 사용자 메시지 접기(`CollapsibleChatMarkdown`)를 만들었는데, Playwright로 검증하다가
  접기가 전혀 작동하지 않는 게 발견됐다. 원인은 HTML 스펙의 "value sanitization algorithm"—
  `<input type="text">`는 값에 들어있는 개행 문자를 렌더링 이전에 자동으로 제거한다. 즉 기존
  입력창은 애초에 여러 줄 텍스트를 보낼 수 없는 구조였다(사용자가 여러 줄을 붙여넣어도 한 줄로
  뭉개져서 전송됨) — 접기 기능 이전에 이미 있던, 별개의 잠재 버그였다. `<textarea>`로 바꾸고
  Enter=전송/Shift+Enter=줄바꿈(Claude/ChatGPT 컨벤션)으로 만들었고, 입력 길이에 따라
  높이가 자동으로 늘어나다 200px에서 스크롤되게 했다(`onChange`에서 `scrollHeight` 기반으로
  인라인 `style.height` 조정, 전송 시 `ref`로 리셋).
- **사용자 말풍선에서 원문 URL 숨기기**: `buildMessageText`가 모델이 fileUrl을 읽을 수 있도록
  `[업로드된 파일]\n파일명: ...\nURL: ...` 블록을 채팅 텍스트에 그대로 심어 보내는데, 기존에는
  이 블록이 화면에도 원문 그대로(긴 blob URL 포함) 다시 보였다. 모델에게 보내는 실제 텍스트는
  그대로 두고(도구 호출에 URL이 필요하므로), **렌더링 직전에만** `extractFileBlocks()`로 파일
  블록을 분리해 작은 칩(📎 파일명)으로 보여주고, 나머지 사용자 타이핑 텍스트만
  `CollapsibleChatMarkdown`으로 표시한다(`app/page.tsx`). 이 접기는 사용자 메시지에만
  적용한다 — 어시스턴트 텍스트는 카드 요약을 우선하는 기존 원칙 때문에 대체로 짧다.
- 다중 파일 첨부·업로드 중 전송 차단·textarea 전환·URL 숨김/긴 메시지 접기는 프로덕션 빌드
  (`next build && next start`) 대상 Playwright 라이브 테스트로 검증했다(다중 파일 첨부 →
  업로드 완료까지 대기 → 긴 텍스트 전송 → 칩 2개 노출·원문 URL 비노출·6줄 초과 시 "더보기"
  접힘·펼치면 전체 노출, 2026-07-20). `onUploadCompleted` 제거는 dev 서버(`next dev`)에서
  서버 로그의 재시도 attempt별 hit/miss를 직접 찍어보며 확정했다 — 재시도 로직만으로는 안 되고
  콜백 제거 후에야 `attempt=0 hit`으로 즉시 성공하는 걸 확인했다.

## 실제 발행 보고서 양식 대조 작업 (`lib/pipeline/reportPlan.ts`, `lib/pipeline/surveyQuestions.ts`,
## `lib/pipeline/polaritySummary.ts`, `lib/pdf/ReportDocument.tsx`, `components/QuantStatsSummary.tsx`,
## 2026-07-20)

담당자가 "제가 data 폴더에 저장해둔 실제 발행 보고서와 최대한 같은 양식·섹션 구성으로 나와야
한다"고 명시적으로 요청해서, 실제 리바랩스 PDF(2025.09.05자)를 페이지별로 대조하며 구조를
맞췄다. 자세한 배경·우선순위 결정은 memory의 `project-report-format-fidelity` 참고.

- **목차(ToC) 페이지 신규**: `lib/pdf/ReportDocument.tsx`의 `TableOfContents`가
  `lib/pipeline/reportPlan.ts`의 `buildReportPlan()`을 그대로 써서 채팅 목차 카드
  (`components/ReportPlanCard.tsx`)와 제목·소목차가 항상 일치한다 — 따로 두면 한쪽만 고칠 때
  어긋난다(실제로 처음엔 어긋나 있었다: Ⅱ장 제목이 채팅 카드는 "인적사항", PDF는 "인적사항 및
  특성조사"였음. 지금은 `reportPlan.ts`의 `title`이 `lib/pdf/sectionsQuant.tsx`·
  `sectionsQualitative.tsx`의 `<SectionHeader title="...">` 문자열과 정확히 같아야 한다는
  규칙을 주석으로 박아뒀다). react-pdf는 선언적 렌더링이라 다른 위치의 "실제 페이지 번호"를
  미리 계산해 넣을 방법이 없어서(bookmark는 뷰어 사이드바 개요일 뿐 본문 텍스트가 아님),
  숫자 대신 `id`+`Link` 기반 클릭 이동으로 대체했다 — 알려진 단순화.
- **Ⅰ장 소목차 확장**: "2. 사용성 테스트 진행 일정"(테스트 진행 기간·대상·담당자, 제품정보
  카드에 선택 필드 3개 추가 — `lib/productInfo/types.ts`), "3. 사용성 테스트 설문 항목"
  (`lib/pipeline/surveyQuestions.ts`). 후자는 **실제 보고서 5페이지의 설문 항목 표를 그대로
  베끼지 않았다** — 그 표 자체가 "핵심 요인" 단일 선택형 문항(원본 28번 컬럼)을 마치 6개의
  개별 만족도 문항인 것처럼 잘못 나열해뒀고 문항 번호도 본문(Q13)과 표(Q16)가 서로 달랐다
  (실제 보고서 원본에 있던 오류를 발견한 사례). 대신 WALLA 59컬럼 스키마(`lib/walla/schema.ts`)
  에서 결정론적으로 구성해, 다른 프로젝트 raw data에도 재사용 가능하고 정확한 틀이 되게 했다.
  - **문항 텍스트는 반드시 실제 raw data 헤더에서 도출한다(2026-07-23 사용자 강조: "문항의
    개수·내용이 실제 raw data와 맞아야 한다, 무조건 raw data 기반").** 예전 `buildSurveyQuestionRows`
    는 걷기앱 전용 문구("산책", "걷기 기반 서비스")를 하드코딩해서 다른 raw data엔 안 맞았다.
    지금은 `buildSurveyQuestionRows(headerRow)`가 스키마의 고정 컬럼 역할(단계)에 헤더 텍스트를
    매핑한다 — `computeQuantStats(records, headerRow)`가 이걸 호출해 `QuantStats.surveyQuestions`
    에 담고, `SectionOverview`(PDF)·`ReportDocx.ts`(DOCX)가 그대로 쓴다. **다른 raw data를 넣으면
    그 데이터의 실제 컬럼이 문항으로 나온다.** 새 정량 필드나 설문 관련 코드를 만질 때 이
    "raw data가 ground truth" 원칙을 깨지 말 것(정량 통계도 전부 raw data에서 결정론적으로 계산 —
    golden 체크가 최소 회귀 테스트).
    - **입력 포맷 권장사항 + 검증 완화(PRD 5.1절에 정식 기록, 2026-07-23 결정·구현 완료)**:
      리바랩스 헤더는 요약 라벨("나이", "조작 편의성")이라 보고서 설문 표도 요약 라벨로 나온다.
      원본 보고서의 전체 문항("나이를 입력해주세요" 등)으로 나오게 하려면 담당자가 raw data
      헤더에 전체 문항을 넣어야 하는데, **예전 WALLA 검증은 대부분 컬럼을 정확 일치(header ===
      label)로 봐서** 전체 문항을 넣으면 검증이 실패했다. **이를 포함 검사로 완화했다** —
      `lib/walla/schema.ts`의 `literal`을 `keyword`(header.includes(label))로 바꾸고,
      끝 앵커가 걸려 있던 세 패턴(`기능 만족도$`·`경험 유무$`·`가치 만족도$`)의 `$`를 제거했다.
      요약 라벨은 전체 문항의 부분 문자열이라 **기존 raw data도 그대로 통과(golden 93/93 유지)**
      하고, 전체 문항 헤더도 통과하며, 엉뚱한 파일(59열 전부 불일치)은 여전히 거부된다(라이브
      스크립트로 세 케이스 다 확인). **열의 위치(index)는 여전히 고정 검사**하므로 열 역할 식별은
      유지된다 — 완화된 것은 "그 위치의 문구가 토씨까지 같아야 한다"는 조건뿐이다. `includes`라
      정확 일치보다 오탐 여지가 조금 늘지만(예: 1번 열에 "나이"를 포함한 엉뚱한 문구도 통과),
      위치까지 다 맞아떨어져야 하므로 실제 오탐 위험은 낮다고 판단. 단, `실용성N)`·`즐거움N)`
      접두 패턴은 **구조 마커라 그대로 유지**했다(extractUxQualityNames가 이 접두로 문항명을
      추출하므로 — 전체 문항을 넣어도 이 접두는 반드시 앞에 있어야 한다).
  - **설문 항목 표 페이지 맞춤(2026-07-23)**: 표준 문항 수(약 31개)는 행 세로 여백을 줄여
    ("총 문항" 푸터까지) 한 페이지에 다 들어가게 했다 — 4줄만 다음 페이지로 넘쳐 빈 페이지가
    생기던 문제. 문항이 훨씬 많은 raw data는 페이지 넘김 원칙(위 "pagination")대로 문항 단위로
    자연스럽게 이어진다.
- **긍정/부정/중립 표시를 굵은 배너로**: "1. 긍정 의견 (28.7%)" 형식(`sectionsQualitative.tsx`의
  `PolarityBanner`). 기존엔 작은 회색 라벨 하나뿐이었다.
- **극성별 총평 박스(`lib/pipeline/polaritySummary.ts`) — 처음엔 기본 파이프라인에 넣었다가
  완전히 분리했다(2026-07-20~21, 같은 세션 안에서 있었던 일)**: 실제 보고서의 "[긍정 의견
  요약]" 박스 형식. PRD 6장 소속이 아닌 신규 프롬프트라 "프롬프트 불변" 원칙과 무관하다
  (extract.ts와 같은 예외 사유).
  1. **처음 설계**: Stage2 직후 같은 흐름 안에서 호출(`orchestrate.ts`에 3번째 p-limit
     `summaryLimit`으로 Stage1/Stage2와 분리). DB `questions.polarity_summaries`(jsonb)
     컬럼 추가 — **마이그레이션(`npm run db:migrate`) 잊지 말 것**, 스키마만 고치고
     마이그레이션을 안 돌려 `column does not exist` 에러로 한 번 걸렸다.
  2. **실사용 중 사고**: `generateText` 호출에 타임아웃을 안 줬더니, 응답 없이 걸린 호출 하나가
     `Promise.all`을 영원히 안 끝내서 14문항 전체가 15분 넘게 멈췄다(담당자가 실제로 겪음).
     `timeout: 60000`을 추가하고 개별 호출 실패를 try/catch로 격리했다.
  3. **그런데도 안 끝남 → 속도 실험 두 번**: "동시성을 8→14로 올리면 빨라질까"(21분간 요약
     호출 27개 전부 타임아웃 → 중단), "문항 내부 응답자를 청크로 나눠 병렬화하면 빨라질까"
     (`lib/pipeline/stage1Chunked.ts`로 구현해서 테스트, 33분간 타임아웃 18개+ 계속 증가 →
     중단). 둘 다 실패. 두 실험의 공통점은 "API 호출 개수를 늘리는 방향"이었다는 것.
  4. **최종 결론**: 원래 안정적으로 잘 돌던 Stage1+Stage2 파이프라인 위에 극성 요약(문항당
     최대 3회, 14문항이면 최대 42회)을 얹은 것 자체가 그 시점의 API 사용 여력을 넘겨버렸다는
     것이 가장 그럴듯한 설명이었다 — 그래서 청크 병렬화는 완전히 되돌렸다(`stage1Chunked.ts`
     삭제, `orchestrate.ts`를 원래 형태로 복원, `polaritySummaries` 필드도 `orchestrate.ts`
     결과 타입에서 제거). **극성 요약은 이제 기본 파이프라인에서 완전히 빠졌고**, 사용자가
     명시적으로 요청할 때만 실행되는 별도 opt-in 도구가 됐다 —
     `lib/pipeline/generatePolaritySummaries.ts`(리포트 단위 오케스트레이션, 이미 저장된
     카테고리를 재료로 써서 Stage1/2를 다시 안 돈다) + `app/api/chat/route.ts`의
     `generatePolaritySummaries` 도구(시스템 프롬프트에 "자동으로 이어 부르지 말 것, 사용자가
     명시 요청했을 때만" 명시). DB 저장도 분리했다 — `saveQualitativeResults`는 더 이상
     `polarity_summaries`를 안 채우고, `saveQuestionPolaritySummaries`(신규)가 나중에 따로
     UPDATE한다. `getQuestionsWithAllCategories`(신규)는 `getQuestionsWithApprovedCategories`
     와 달리 insight 승인 여부를 안 가린다 — 요약은 체크포인트 B를 기다리지 않고 바로 만들 수
     있어야 한다는 판단.
  5. **뒤늦게 발견한 교란 요인**: 이 조사가 다 끝난 뒤에야 담당자가 Anthropic 콘솔을 확인했는데,
     그 시점 조직 크레딧이 $17 수준(월 $200 한도 중 $131+ 이미 사용)까지 떨어져 있었고
     "잔액 부족" 경고가 떠 있었다 — 오늘 실험들이 겪은 타임아웃·멈춤이 (병렬화 방식의 문제가
     아니라) **크레딧 소진에 따른 API 측 지연/제한 때문이었을 가능성**을 배제할 수 없다. 위
     3번 실험의 "동시성/청크 둘 다 역효과"라는 결론은 이 교란 요인이 통제되지 않은 상태에서
     나온 것이라 **확정적이지 않다** — 크레딧이 충전된 뒤 조용한 시점에 다시 측정해봐야
     정확한 인과관계를 알 수 있다. 다만 극성 요약을 기본 흐름에서 분리한 결정 자체는(정석
     분석은 최대한 빠르게, 부가 기능은 선택적으로) 크레딧 문제와 무관하게 여전히 올바른
     방향이라고 판단해 그대로 유지했다.
  - `app/page.tsx`의 `QualitativeAnalysisCard`에 **경과 시간 실시간 표시 + 임계값별 안내
    문구**를 추가했다(`useElapsedSeconds` 훅). 90초부터 "예상보다 조금 더 걸리고 있어요",
    180초부터는 카드가 노란색으로 바뀌며 "정상 범위를 벗어났다 + 새로고침해도 안전하다
    (raw data·정량 통계는 이미 저장됨)"는 안내로 바뀐다 — "1~2분 걸릴 수 있어요"라고만 써놓고
    그 시간이 지나도 그대로면 사용자가 판단할 근거가 없다는 원칙(memory
    `feedback-user-first-design` 참고). 이건 원인이 무엇이든(레이트리밋이든 크레딧이든) 계속
    유효한 안전장치라 그대로 남겨뒀다.
  - **Stage1/Stage2 `generateText` 호출에는 아직 명시적 타임아웃이 없다**(undici 기본 300초
    헤더 타임아웃이 암묵적 상한이긴 하지만 명시적이지 않음) — 같은 종류의 무한 대기 사고가
    거기서 재현되면 검토할 것.
- **채팅 카드에 막대그래프 도입**(`components/QuantStatsSummary.tsx`): 표만 나열하면 "어느 게
  더 큰지" 한눈에 안 보인다는 피드백으로 순수 CSS 막대그래프로 전면 교체(`BarRow`,
  `DivergingBarRow` — 상대중요도는 음수도 나오므로 0 기준 좌우 막대). 도표 제목이 작고 안
  굵어서 구별이 안 된다는 후속 피드백으로 굵게+밑줄+박스 그룹핑(`subLabel`, `chartGroupBox`)도
  추가했다.
- **"정량 통계가 왜 나왔는지" 카드 자체에 고정 문구**: 채팅 텍스트 설명 한 번으로는 부족했다
  (사용자가 두 번 지적) — `QuantStatsCard`의 로딩 문구(`app/page.tsx`)와
  `QuantStatsSummary`의 완료 후 문구 둘 다에 "방금 동의하신 목차의 Ⅱ~Ⅷ장에 들어갈 내용"이라는
  설명을 코드로 고정했다. 채팅 프롬프트 지시에 의존하지 않고 컴포넌트 자체에 박아두는 방식은
  이 세션에서 반복적으로 검증된 신뢰성 패턴이다(위 "채팅 오케스트레이션 신뢰성" 절 참고).
- **나이를 평균±SD로만 보여주던 버그**: "어떤 나이대가 많은지" 판단이 안 된다는 지적으로 실제
  보고서처럼 10대/20대/30대/40대 이상 분포로 교체(`lib/quant/basic.ts`의
  `ageBracketDistribution`). 골든 체크에 4개 검증 추가(93/93 PASS) — Ⅱ장(인적사항)이 기존에
  golden 체크 대상이 아니었던 공백도 같이 메웠다.
- **`prepareStep`이 validateInput 실패를 성공처럼 취급하던 버그**: `doneEver("validateInput")`은
  호출 여부만 보고 성공 여부는 안 봐서, 파일을 못 찾아 실패해도 다음 카드를 강제로 띄워버렸다
  (시스템 프롬프트의 "실패하면 멈추세요" 지시와 정반대로 동작). `steps`에서 이번 턴
  `validateInput`의 `toolResults`를 찾아 `output.valid`를 직접 확인하도록 고쳤다 — 다른
  "A 다음엔 반드시 B" 강제 전이를 추가할 때도 A의 **성공 여부**까지 확인해야 하는지 검토할 것.
- **Blob 404 재시도 예산 확대**: `onUploadCompleted` 제거(위 절 참고) 이후에도 6회 중 1회꼴로
  재현되어(기존 재시도 예산 4회/~6초로는 부족), 7회(~15.5초)로 늘렸다. "절대 나면 안 되는
  에러"라는 요구사항 때문에 실측 확인된 여유보다 더 넉넉하게 잡았다.
- **차트를 실제 보고서 사진(설문 항목 표·인적사항 세로 막대·4대가치 평균선·UX 레이더)과
  대조해 재구현(2026-07-21)** — 담당자가 참고 스크린샷 4장을 첨부하며 "사용자가 보고서를
  생성하고 최대한 수정을 하지 않도록" 최대한 동일한 양식을 요청했다.
  - **설문 항목 표의 "단계" 열을 진짜 병합 셀처럼**: 기존엔 그룹 헤더 행을 표 전체 폭으로 한 줄
    넣는 방식이었는데, 실제 보고서는 왼쪽 좁은 열에 "인적사항 및 특성조사" 같은 단계명이 세로로
    여러 행에 걸쳐 하나로 보이게 되어 있다. `<Table>`에 rowspan이 없어서, `flexDirection:"row"`
    컨테이너 안에 왼쪽 열(`flex: stage.questions.length`로 가중치를 줘서 문항 수에 비례한 높이
    확보, `justifyContent:"center"`로 텍스트를 그 구간 중앙에 배치)과 오른쪽 열(문항 전부를
    개별 행으로 나열)을 나란히 두는 방식으로 흉내냈다 — react-pdf(Yoga flexbox)의 기본
    `alignItems:"stretch"` 교차축 동작 덕에 왼쪽 열 각 칸이 오른쪽 문항 개수만큼 실제로
    늘어난다. `lib/pdf/sectionsQuant.tsx`의 `SectionOverview`.
  - **`VerticalBarChart`/`VerticalBarChartWithAverage`(신규, `lib/pdf/charts.tsx`)**: 실제
    보고서의 "[응답 결과]" 세로 막대그래프(제목 배너 + 막대 위 값 라벨 + y축 그리드라인 + x축
    카테고리 라벨) 형식. Ⅱ장 인적사항 Q1~Q5, Ⅳ장 핵심구매요소 응답 분포, Ⅴ장 4대가치(평균선
    오버레이 버전)에 적용했다. 기존 `BarChart`(가로 막대, 표 형태 항목 나열용)와는 별도 —
    용도가 다르다.
  - **`RadarChart`(신규, `lib/pdf/charts.tsx`)**: `Svg`/`Polygon`/`Line`/`Circle`만으로 그린
    방사형 차트(트리고노메트리로 축 각도·꼭짓점 계산, PNG 불필요 — PDF 조립 절의 "PNG 불필요"
    원칙 그대로 유지). Ⅵ장 UX 품질에 [전체]/[실용성]/[즐거움] 3개를 그린다. 값 차이가 잘 보이게
    0~10 전체 스케일이 아니라 실측 최소/최대값 기준으로 확대한 min/max를 쓴다(실제 보고서도
    같은 방식).
    - **실측 버그 1 — SVG 안 `<Text>`가 한글 폰트를 상속 못 받아 글자가 깨짐**: 페이지 전체
      스타일(`theme.ts`)에 `fontFamily: "Noto Sans KR"`을 지정해도, `Svg` 내부의 `Text`는 그
      상속 체인 밖이라 기본 폰트(한글 미지원)로 렌더링돼 라벨이 "äç11", "·pÀ1" 같은 글자 깨짐
      (mojibake)으로 나왔다. 렌더링은 되는데 텍스트가 아예 안 보이던 기존 WOFF2 버그(위 PDF
      조립 절)와는 다른 증상 — 이번엔 "보이긴 하는데 엉뚱한 글자"였다. **SVG `<Text>`에는
      `fontFamily`를 명시적으로 다시 줘야 한다** — `style={{ fontFamily: "Noto Sans KR" }}`.
      상속을 믿지 말 것.
    - **실측 버그 2 — 축 라벨이 캔버스 경계에서 잘림**: 라벨을 그리드 반경의 1.22배 지점에
      그리는데, `Svg`의 width/height를 그리드 지름(`size`)과 똑같이 잡아서 라벨 텍스트가
      viewBox 밖으로 나가는 부분이 그대로 잘려나갔다("실용성2"가 "실"만 남는 식). 그리드
      반경은 그대로 두고 `Svg` 캔버스 자체를 `LABEL_MARGIN`(30pt)만큼 사방으로 더 키우는
      방식으로 고쳤다(`canvasSize = size + LABEL_MARGIN * 2`, 그 중앙에 그리드를 배치) — 다음에
      비슷한 SVG 라벨-바깥-그리기 컴포넌트를 추가할 때 이 패턴(그리드 크기와 캔버스 크기를
      분리)을 재사용할 것.
  - 검증은 매번 실제 DB의 quant-only 테스트 report로 `renderToBuffer`를 직접 호출해 로컬 PDF
    파일로 렌더링하고 Read 도구로 페이지를 눈으로 확인하는 방식으로 했다(Blob 업로드까지 갈
    필요 없이 `assembleReport`의 렌더링 부분만 재사용) — 코드 리뷰만으로는 SVG 텍스트 상속
    문제나 캔버스 클리핑 같은 버그를 못 잡는다는 걸 이번에도 확인했다.
  - `SectionCrossAnalysis`(Ⅶ 교차분석)는 이번 대조 범위에 없었던 섹션이라 기존 가로
    `BarChart`를 그대로 쓴다 — 전체 일관성을 원하면 별도로 논의할 것.
- **Ⅲ장·Ⅳ장 추가 대조(2026-07-21, 같은 날 두 번째 라운드)** — 담당자가 다른 실제 보고서
  페이지(Q13 핵심요인 순위표, Q12 순위 구성 누적막대, 기능별 중요순위종합표, 중요도-만족도
  사분면 그래프 스크린샷 4장)를 추가로 첨부하며 "대부분 이런 형식의 세로 막대 그래프가 주를
  이룬다"고 확인, 핵심구매요소·기능별 상대중요도-만족도 그래프를 실제 양식대로 맞춰달라고
  요청했다. 사분면 그래프 배경 색칠 정밀도와 Q12 순위 구성 차트 포함 여부를 먼저
  AskUserQuestion으로 확인 — 둘 다 "완전 재현"/"지금 포함"으로 최대 범위를 선택받았다.
  - **새 데이터 계산 — `rankPositionComposition`(`lib/quant/basic.ts`)**: 기존
    `relativeImportance`가 Q12(기능 중요도 순위) 응답을 "항목별 점수"로 집계하는 것과 달리,
    이건 같은 원본 순위 데이터(`r.rank`, 응답자별 [1위,2위,...] 항목명 배열)를 "순위 위치별
    항목 구성비"로 다르게 잘라본다 — 예: 1위 자리에 어떤 항목이 몇 % 선택됐는지. `compute.ts`의
    `QuantStats.rankPositionComposition`으로 노출. 골든 체크 93/93 그대로 PASS(기존 계산
    로직은 안 건드림).
  - **`RankCompositionChart`(신규, `lib/pdf/charts.tsx`)**: 순위별(1위~n위) 가로 누적
    막대그래프 + 상단 범례(항목명×고정 팔레트 색상 8색). Ⅳ장 "기능 중요도 순위 구성"에 적용.
  - **`ImportanceSatisfactionChart` + `PriorityLegendTable`(신규, `lib/pdf/charts.tsx`)**:
    중요도(X, -5~5)×만족도(Y, 0~10) 사분면 산점도. 실제 보고서는 셀 하나하나의 정확한 색상값을
    스크린샷에서 뽑아낼 방법이 없어서, 보고서 하단 "영역별 참고 지표"가 명시한 판정 로직
    (중요도 높고 만족도 낮을수록 우선순위 상승)을 그대로 공식화했다 — X·Y를 각각 3등분해 9개
    셀을 만들고 `col + row - 2`(대각선 방향) 점수로 최상/상/중/하/최하 5단계 배경색을 결정한다.
    범례는 별도 `PriorityLegendTable`로 분리(재사용 가능하게).
    - **실측 버그 — 인접한 두 데이터 라벨이 겹침**: "펫 레이싱"(중요도 -2.25, 만족도 6.04)과
      "펫 교배"(중요도 -2.58, 만족도 5.85)처럼 좌표가 가까운 두 항목은 라벨을 항상 점 위쪽에
      고정 배치하면 서로 겹쳐 읽을 수 없게 렌더링됐다(2026-07-21 실측). 각 라벨을 그리기 전에
      이미 배치된 라벨들과의 픽셀 거리(가로 22pt·세로 9pt 이내)를 확인해, 충돌하면 점 아래쪽
      (기본 위쪽 대신)으로 뒤집는 간단한 충돌 회피 로직을 추가했다 — 완벽한 전역 최적화는
      아니지만 소수 항목(6개 내외)에서 실제로 겹치는 경우를 없애기에는 충분했다. 비슷하게 점이
      많이 모이는 산점도/좌표 라벨 컴포넌트를 또 추가한다면 이 패턴(직전에 배치한 라벨과의
      거리 체크 → 반대쪽으로 오프셋)을 재사용할 것.
  - **Ⅲ장(`SectionFeatureExperience`, `sectionsQualitative.tsx`) 기능별 만족도**: 기존 가로
    `BarChart`를 `VerticalBarChartWithAverage`로 교체(항목 내림차순 정렬 + 전체 평균 빨간
    선 오버레이, 실제 보고서와 동일 형식) + 순위표(순위/기능/평균만족도, 1위 파란색·6위(최하)
    주황색 배경 강조 — 실제 보고서와 동일).
  - **Ⅳ장(`SectionCorePurchaseFactor`) 전체 재구성**: ① "가장 영향을 미치는 핵심 요인"
    (기존 `VerticalBarChart`) 바로 아래 순위표(No/핵심기능/순위/비율) 추가, ② "기능 중요도
    순위 구성" `RankCompositionChart` 신규 추가, ③ "기능별 상대중요도" 기존
    `DivergingBarChart` 유지 + "기능별 중요 순위 종합" 표(1~6위를 열로, 기능명·상대중요도를
    행으로 하는 전치 테이블, `<Table>`에 rowspan이 없어 열 단위 View를 나란히 배치하는 방식으로
    구현) 추가, ④ "기능별 상대 중요도-만족도 그래프" `ImportanceSatisfactionChart` +
    `PriorityLegendTable` 신규 추가. 기존 "해석"(제언 텍스트)은 그대로 마지막에 유지.
  - 검증은 이전과 같은 방식(실제 DB report의 raw data URL에서 `computeQuantStats`를 다시
    돌려 최신 `QuantStats`로 `renderToBuffer` 직접 호출) — DB에 저장된 `quant_stats`는 이번
    코드 변경 이전에 계산된 구버전이라 새 필드(`rankPositionComposition`)가 없어서, DB 캐시를
    그대로 쓰지 않고 raw data부터 재계산해야 했다(2026-07-21 실측으로 확인).

- **Ⅳ장·Ⅶ장·Ⅷ장 3차 대조(2026-07-21, 같은 날 세 번째 라운드)** — 담당자가 다른 실제 보고서
  페이지 8장(연령대별/성별 클러스터 막대+레이더, NPS 척도 설명 그래픽, 개선된 순위표, 사분면
  그래프)을 추가로 첨부하며 "교차분석 그래프도 이런식으로", "NPS 지수... 이미지가 그대로
  들어가도록"을 요청했다.
  - **`GroupedBarChart`(신규, `lib/pdf/charts.tsx`)**: 여러 시리즈(연령대 4개·성별 2개)를
    항목별로 나란히 비교하는 클러스터 세로 막대그래프 + 범례 + 확대된(0이 아닌) y축. Ⅶ장
    "연령대별/성별 차이"의 "기능별 만족도 차이"·"4대가치 만족도 차이" 4개 차트에 적용 —
    기존엔 그룹마다 별도 BarChart를 나열해서 그룹 간 비교가 한눈에 안 됐다.
  - **`RadarChartOverlay`(신규, `lib/pdf/charts.tsx`)**: RadarChart(단일 시리즈)와 별개로 여러
    데이터 폴리곤을 겹쳐 그리고 범례를 붙인다. Ⅶ장 성별 UX품질(실용성/즐거움)에 적용 — 이걸
    위해 `lib/quant/crossAnalysis.ts`의 `CrossAnalysisGroup`에 `uxQuality`(usability/fun
    평균) 필드를 새로 추가했다(연령대·성별 그룹 둘 다 계산, compute.ts의 uxLabels 패턴 재사용).
  - **`NpsGauge`(신규, `lib/pdf/charts.tsx`)**: 0~10점을 사람 아이콘 11개로 나열한 NPS 척도
    게이지(Bain & Company 척도 형식). 아이콘은 이미지 자산 없이 `Circle`(머리)+`Path`(몸통,
    베지어 곡선 하나로 사람 실루엣 근사)만으로 그렸다 — PDF 조립 절의 "PNG 불필요" 원칙 재적용.
    0~6점 회색(Detractors)·7~8점 중간회색(Passives)·9~10점 검정(Promoters) 3단계 색상.
  - **Ⅷ장 NPS 문구 처리 원칙**: Bain 설명·Promoter/Passive/Detractor 정의·NPS 공식은 일반
    지식이라 고정 템플릿 문구로 그대로 넣었다. 하지만 실제 보고서의 판단 불렛트("...알파브라더스
    기존 데이터 대비 '낮은 시장성' 수준...")는 특정 회사 자체 기준값과 비교하는 문구라, 다른
    프로젝트 raw data에 그대로 쓰면 틀린 비교가 된다(surveyQuestions.ts가 실제 보고서의 설문
    항목 표를 그대로 베끼지 않은 것과 같은 원칙). `npsJudgmentLines()`가 그 문구의 판단
    로직(NPS 부호로 시장성 판단, 중립고객 비율로 구매전환요소 진단)만 재사용해 우리 계산값으로
    채운 문장을 동적으로 생성한다 — 사용자가 "판단 문구를 그대로 쓰되"라고 답했지만, 회사명이
    박힌 비교 문구 자체는 일반화가 불가능해 로직만 유지했다.
  - **Ⅳ장 정리**: 사용자가 "기능별 상대중요도 그래프는 없어도 되고"라고 확인해 기존
    `DivergingBarChart`(가로 발산 막대)를 제거했다. "기능별 중요 순위 종합" 표에는 Ⅲ장
    순위표와 같은 패턴(1위 파란 배경·6위(최하) 주황 배경)의 하이라이트를 추가했다 — 이번
    대조 전까지는 이 표만 하이라이트가 빠져 있었다.
  - **모든 페이지 하단에 3분할 푸터 추가**(`lib/pdf/ReportDocument.tsx`, `theme.ts`의
    `footerRow`/`footerSide`/`footerCenter`): 왼쪽 "{연도} by {기업명}", 가운데 "- 쪽수/전체
    -", 오른쪽 기업명 대문자(실제 로고 이미지 자산이 없어 텍스트 워드마크로 대체 — 알려진
    단순화). 실제 보고서 푸터가 "2025 by Alphabrothers ... ALPHA BROTHERS"였는데, 이건
    보고서 발행사가 아니라 **테스트 대상 서비스 회사 자신의 저작권 표시**로 판단해(그래야
    임의 클라이언트에 일반화 가능) `productInfo.companyName`을 그대로 재사용했다 — 회사 정보를
    아직 입력하지 않은 리포트는 "입력 필요"로 표시된다(실측 확인).
  - **실측 버그 — 폰트에 없는 유니코드 기호가 텍스트를 통째로 지워버림(중요, 2026-07-21)**:
    판단 불렛트에 원래 "▶"(U+25B6)를 썼는데, 렌더링 결과 "¶구매의향..."처럼 기호가 깨지고
    앞 글자까지 밀리는 mojibake로 나왔다(Read 도구로 직접 스크린샷 확인). NPS 공식 박스의
    "−"(연산자 마이너스, U+2212)도 같은 문제. 더 심각했던 건 "기능별 중요 순위 종합" 표
    바로 위 설명 문구에 쓴 "±"(U+00B1) — 이건 mojibake조차 안 나고 **문장 전체가 렌더링에서
    통째로 사라졌다**(레이아웃엔 자리가 안 잡히고 그냥 없었던 것처럼 비워짐). 전부 ASCII로
    바꿔서 해결(▶→•, −→-, ±5→+5~-5). 이건 CLAUDE.md에 이미 기록된 "Roman 숫자 유니코드도
    이 폰트에서 깨진다"·"SVG Text가 폰트 상속을 못 받아 글자가 깨진다" 버그와 **같은 근본
    원인의 세 번째 사례**다 — `NotoSansKR-Regular.woff`/`-Bold.woff`는 서브셋팅된 폰트라
    기본 한글·영문·일부 특수문자 외의 코드포인트(로마 숫자, 수학 연산자 기호, 화살표/삼각형
    기호 등)를 포함하지 않을 가능성이 높다. **새로운 특수 유니코드 문자(화살표, 연산자 기호,
    장식용 불릿 등)를 텍스트에 넣을 때는 반드시 실제 렌더링 결과를 눈으로 확인할 것** — 이미
    검증된 문자 집합(`•`, `-`, `→`, 일반 한글·영문·숫자·기본 문장부호)만 안전하다고 가정하지
    말고, 코드 리뷰만으로는 이 클래스의 버그를 못 잡는다(이번에도 Read 도구로 직접 페이지를
    렌더링해서야 발견했다).
  - **담당자가 우리가 보낸 PDF를 열어본 화면과 이 세션의 자동 검증(Read 도구로 PDF→이미지
    변환) 결과가 달라 보인다고 보고한 사건**: 담당자가 Desktop에 저장해준 미리보기 PDF의
    Ⅳ장 표·사분면 그래프가 "너무 깨졌다"고 알려왔는데, 같은 파일을 Read 도구로 스크린샷
    떠서 본 이 세션에서는 문제가 안 보였다. 정확한 증상을 다시 설명해달라고 요청해둔
    상태이며, 위에서 발견한 "폰트에 없는 문자가 텍스트를 지워버리는" 버그가 유력한 원인
    후보다(정확히 이 세션의 스크린샷 도구와 실제 PDF 뷰어가 특수문자 처리 방식이 다를 수
    있고, 사라진 텍스트 한 줄이 레이아웃을 밀어서 표 전체가 어긋나 보였을 가능성). 담당자의
    후속 설명을 받으면 재확인할 것 — 아직 완전히 종결된 이슈는 아니다.

- **Ⅲ·Ⅳ·Ⅵ·Ⅶ·Ⅷ장 4차 대조 + 아키텍처 질문(2026-07-21, 같은 날 네 번째 라운드) — data/ 폴더의
  실제 발행 PDF 원본을 직접 읽고 대조.** 담당자가 "제발 data 폴더에 있는 예시들을 모두
  꼼꼼하게 읽어달라"고 요청해서, 이번엔 담당자가 캡처한 스크린샷이 아니라
  `data/[알파브라더스] 리바랩스_사용성테스트_결과보고서_0904_상연.pdf`(56페이지) 원본을
  Read 도구로 직접 여러 구간 읽어 대조했다.
  - **아키텍처 질문에 대한 답 — "지금까지 도표 스타일이 프롬프트에 있던 거냐?"**: 아니다.
    PDF 시각 포맷은 100% `lib/pdf/*.tsx` 결정론적 코드이고 채팅 LLM 프롬프트와 무관하다 —
    `assembleReport()`는 항상 같은 렌더링 컴포넌트 트리를 거치므로, 코드를 고치면 이후
    생성되는 모든 보고서에 자동 적용된다(어느 클라이언트든, 채팅에서 뭐라고 요청했든).
  - **실측으로 발견한 진짜 버그 — UX 품질 축 이름이 raw data에 이미 있는데 버려지고
    있었다**: `실용성N)/즐거움N)` raw data 헤더(예: `"실용성1)\r\n조작 편의성"`)에 실제
    문항명이 붙어있는데, 기존 코드는 이 접미사를 버리고 "실용성1"이라는 일반 라벨만 썼다.
    `extractFeatureNames`(기능명 추출)과 같은 원리로 `extractUxQualityNames()`(신규,
    `lib/walla/schema.ts`)를 추가해 실제 문항명을 추출하고, `normalize.ts`의
    `UxQualityItem`에 `name` 필드를 새로 붙여(기존엔 없었음) `compute.ts`·`crossAnalysis.ts`
    양쪽에서 하드코딩된 라벨 대신 이 이름을 쓰도록 고쳤다. `runResultSummary`(Ⅸ장 결과요약)
    같은 다운스트림 소비자는 코드를 안 건드려도 자동으로 실제 문항명을 쓰게 됐다(값을 통해
    전파되므로) — 데이터 흐름을 한 곳에서 고치면 여러 군데가 같이 맞춰지는 예시.
  - **Ⅵ장**: 레이더 그리드에 링(동심원)마다 실제 수치 라벨(4.00/4.50/.../6.50, 위쪽 축을
    따라)을 추가(`RadarChart`/`RadarChartOverlay` 공통), 실용성/즐거움 점수표
    (`UxScoreTable`, 신규) 추가 — 열별 최댓값 파란/최솟값 주황 하이라이트, Ⅲ/Ⅳ장 순위표와
    같은 패턴.
  - **Ⅳ장**: "기능별 상대중요도" 가로 발산 막대그래프 삭제(담당자 확인: "없어도 되고"),
    "기능별 중요 순위 종합" 표에 1위 파란/6위(최하) 주황 하이라이트 추가(Ⅲ장 표와 동일 패턴,
    이번 대조 전까지 이 표만 하이라이트가 빠져 있었다).
  - **Ⅲ장 "기능별 만족도 조사 결과" 차트 재설계**: `VerticalBarChartWithAverage`에
    `min`(0이 아닌 확대 축)·`yAxisTitle`(세로 y축 제목)·`legendBarLabel`/
    `legendAverageLabel`(막대색·평균선색 범례, 값 인라인 표시) prop을 새로 추가했다 —
    기존엔 "평균 {값}" 텍스트 하나만 왼쪽에 작게 붙어있어 무엇을 뜻하는 색인지 안 보인다는
    지적이 있었다. Ⅴ장(4대가치) 호출부는 그대로 둬서(새 prop들은 전부 optional) 기존 동작을
    안 건드렸다.
    - **실측 버그 — `transform:"rotate(-90)"`로 세로 y축 제목을 만들면 글자가 뭉개짐**:
      react-pdf의 CSS 유사 `transform: rotate()`는 지원되지만(`@react-pdf/stylesheet`
      README에 명시), 좁은 flex 부모(width:12) 안에서 먼저 줄바꿈된 뒤 회전되는 것으로
      보이는 현상이 실측 확인됐다("만족도 평균"이 알아볼 수 없는 조각으로 쪼개짐). **세로쓰기는
      글자를 한 자씩 개별 `<Text>`로 줄바꿈해 쌓는 방식이 훨씬 안정적이다** — transform
      기반 회전 텍스트를 또 시도하기 전에 이 사례를 참고할 것.
  - **`SubsectionHeader`(신규, `lib/pdf/sectionsQuant.tsx`)**: 실제 보고서의 "1 | 제목"
    번호 박스 소제목 형식(테두리 박스, 왼쪽 좁은 번호 칸). `SectionHeader`(장 전체 남색
    배너)보다 한 단계 작은 단위로, Ⅵ장("1 사용자 경험 품질 평가 결과 분석")과 Ⅶ장
    ("1 교차 분석 결과 및 분석")에 적용했다 — 다른 장(Ⅲ·Ⅳ·Ⅴ 등)에도 이 패턴이 있지만
    이번 대조 범위(담당자가 첨부한 페이지)에 없어서 아직 안 건드렸다.
  - **알파브라더스 로고(`public/images/alphabrothers-logo.png`, `data/Wordmard_
    AlphaBrothers.png`에서 복사)**: `data/[알파브라더스] ...pdf` 파일명에서 드러나듯
    Alphabrothers는 테스트 대상 서비스 회사(리바랩스·케어클 등)가 아니라 **이 보고서를
    만드는 에이전시 — 이 도구 자신의 정체성**이다. 그래서 페이지 하단 푸터를
    `productInfo.companyName`이 아니라 고정 "{연도} by Alphabrothers" + 로고로 바꿨다.
    `data/`는 gitignore돼 배포에 안 실리므로 `public/images/`에 복사해서 쓴다(fonts.ts와
    같은 이유).
    - **실측 버그(중요) — `fixed` View의 `render()` 콜백 반환값 안에 `Image`를 넣으면
      이미지가 통째로 누락된다**: "표지·목차·마지막 페이지는 푸터를 안 보여준다"는 조건부
      로직을 `<View fixed render={({pageNumber}) => pageNumber<=2 ? null : (<>...<Image
      .../></>)}}`처럼 짰더니, 텍스트는 정상인데 로고 이미지만 완전히 빠졌다(파일 크기로
      확인: 조건부 렌더 방식 114KB vs 항상 렌더 방식 326KB — 212KB가 통째로 안 실렸다).
      `data/`에서 복사한 파일 자체는 문제없음(같은 이미지를 `render` 없이 직접 배치하면
      정상 렌더됨, 최소 재현 스크립트로 확인). react-pdf가 `Image` 같은 임베드 자산은
      정적으로 선언된 위치에서만 인식하고, `render()` 콜백이 반환하는 트리 안의 `Image`는
      자산 등록 단계에서 놓치는 것으로 보인다. **해결**: `Image`는 항상 정적으로 렌더하고
      (표지·목차·마지막 페이지에도 작게 로고만 남는다 — 알려진 단순화), "페이지별로 비운다"는
      조건부 로직은 `Text`의 `render()`(문자열만 반환, 검증된 안전한 패턴)로만 처리한다.
      **`fixed`+`render()` 조합 안에 `Image`(또는 다른 임베드 자산)를 넣어야 하는 상황이
      다시 생기면, 반드시 파일 크기 비교로 실제로 임베드됐는지부터 확인할 것** — 에러 없이
      조용히 누락되는 버그라 코드 리뷰나 타입체크로는 못 잡는다.
  - **레이더 라벨 여백 재발 버그**: 위 UX 품질 축 이름 수정으로 라벨이 "실용성1"(4자)에서
    "규칙·목표 이해 용이성"(10자+) 같은 실제 문항명으로 길어지면서, 이전에 고쳤던 라벨
    잘림 버그(2026-07-21 세션 초반, "실용성2"→"실"로 잘리던 것)가 **다른 원인으로 재발**했다
    — 그때 정한 `LABEL_MARGIN`(30/28pt)이 짧은 라벨 기준이라 긴 라벨엔 다시 부족했다.
    65pt로 늘려서 해결(`RadarChart`·`RadarChartOverlay` 둘 다) — 라벨 길이가 바뀔 수 있는
    컴포넌트는 여백을 데이터 종속적으로 재검토해야 한다는 교훈.

- **5차 대조(2026-07-21, 같은 날 다섯 번째 라운드) — Ⅱ·Ⅶ·Ⅸ장 신규 콘텐츠 + "LLM 호출 없이도
  되는가" 질문.** 담당자가 실제 보고서 스크린샷 5장을 더 첨부하며 세 가지를 요청: ①
  Ⅸ장 결과요약에 "기능별 고객 경험 평가" 표+사분면 그래프, ② Ⅱ장 성별 응답 아래 성별×연령대
  교차표, ③ Ⅳ장 핵심 기능 라벨이 다른 표에서도 깨지는 문제 수정. 그리고 핵심 질문: "이게
  LLM 호출을 추가하는 게 아니라 기존 정성 분석 결과가 성공했다면 바로 할 수 있는 것 아니냐."
  - **답 — 맞다, 둘 다 새 LLM 호출이 필요 없었다.** Ⅶ장 교차분석은 100% 정량 그룹 평균
    비교라 원래도 LLM이 없었고, Ⅸ장 "기능별 고객 경험 평가" 표의 긍정/중립/부정 비율도
    **이미 저장된 Stage2 카테고리(`clause_count`×`polarity`)를 문항당 합산**하면 되는
    거라(Ⅲ장 `QuestionQualitativeBlock`이 쓰는 `polarityPct()`를 그대로 재사용) 새 LLM
    호출이 필요 없다 — 정성 분석이 이미 성공했다면(Stage1/2가 돌았다면) 이 표는 그 결과를
    "다른 각도로 잘라서 보여주는" 것뿐이다. 정성 분석이 아직 없는 문항은 0%로 표시된다.
  - **의도적으로 구현하지 않은 것 — "핵심 세그먼트"·"유지·관리형 고객군" 같은 마케팅
    판단 문구**: Ⅶ장 "[전반적 만족도 경향]" 불렛(어느 그룹이 전 영역에서 가장 높은/낮은
    평균을 보이는지)은 규칙 기반(순위 비교)으로 만들었지만, 실제 보고서의 "[종합 분석]"
    문구처럼 그룹에 비즈니스적 의미를 부여하는 건("핵심 세그먼트", "서비스의 디자인·
    스토리·공유 가치에 매력을 느끼는 경향" 등) 데이터만으로 안전하게 일반화할 수 없는
    해석이라 뺐다 — 다른 프로젝트 raw data에 똑같은 템플릿을 적용하면 근거 없는 주장이 될
    위험이 있다. 이런 수준의 해석이 필요하면 `recommendation.ts`와 같은 패턴(Tier 2, AI
    초안 + 체크포인트 승인)의 새 기능으로 검토할 것 — 그건 이번 라운드 범위 밖으로 남겨뒀다.
  - **`extractUxQualityNames`와 같은 원리로, `keyFactorDistribution` 라벨도 raw data
    원문("성취 및 보상 요소 (걸음 수 보상, 미션 보상 등)")을 그대로 쓰고 있었다.** 실제
    보고서는 괄호 설명을 뗀 짧은 버전만 쓴다. `keyFactorDistribution.label` 자체(및 golden
    체크의 기대값)는 raw data 원문을 그대로 유지하고(계산 레이어를 안 건드리는 원칙),
    `shortenLabel()`(신규, `sectionsQuant.tsx`)로 **표시할 때만** 괄호를 제거한다 — Ⅳ장
    차트 x축과 표 셀 양쪽에 적용.
  - **`CrossTabStackedBar`(신규, `lib/pdf/charts.tsx`) + `crossTabCount`(신규,
    `lib/quant/basic.ts`)**: 두 범주형 변수(성별×연령대)의 교차표를 가로 누적 막대로
    보여준다. `RankCompositionChart`와 모양은 비슷하지만 그건 비율(%, 합계 100)을,
    이건 실제 응답자 수(명)를 그대로 보여준다는 차이가 있다 — 그래서 응답자 수가 적은
    행(예: 남성 34명)은 여성(66명) 행보다 막대가 짧게 끝난다. Ⅱ장 Q2(성별) 응답 바로
    아래에 적용했다. `ageBracketLabel`/`AGE_BRACKETS`를 `basic.ts`에서 export해서
    (기존엔 비공개) `crossAnalysis.ts`의 연령대 구간 로직과 같은 걸 재사용한다.
  - **`FeatureExperienceSummaryTable`(신규, `sectionsQualitative.tsx`)**: Ⅸ장
    "1. 사용성테스트 결과 요약" 안에 Ⅳ장과 같은 `ImportanceSatisfactionChart`+
    `PriorityLegendTable`를 재사용하고, 그 아래 기능명/평균만족도/상대중요도/긍정·중립·
    부정 비율 6열 표를 붙였다.
    - **실측 버그 — 정성 분석이 없어 값이 전부 0일 때, "최댓값 강조" 로직이 모든 행을
      다 칠해버림**: 6개 기능 전부 긍정/중립/부정 비율이 0%로 동률이라 `value === max`
      조건이 항상 참이 되어, 의미 있는 강조가 아니라 열 전체가 하이라이트되는 잘못된
      결과가 나왔다. `max > 0`일 때만 강조하도록 가드 추가 — 실제 값이 없는데 "이게
      제일 좋다"고 색칠하는 건 데이터 없음과 최댓값을 혼동시키는 표시라 위험하다는 교훈.
    - **실측 버그 — 사분면 차트+범례 블록이 페이지 경계 근처에서 정체불명의 색깔 조각을
      다음 페이지에 남김**: `wrap={false}`를 차트+범례 행에 추가했는데도 해결이 안 됐고,
      블록 전체(`FeatureExperienceSummaryTable`)를 `break`로 새 페이지에서 시작하게
      하니 사라졌다 — `wrap={false}`가 항상 페이지 경계 근처 렌더링 이상을 막아주는 건
      아니라는 사례. 비슷한 "다음 페이지에 조각이 남는" 증상을 만나면 `wrap={false}`부터
      시도하되, 안 되면 `break`로 애초에 페이지 경계 근처에 안 놓이게 하는 것도 검토할 것.

- **6차 대조(2026-07-21, 같은 날 여섯 번째 라운드) — 가독성 세부조정 + 브랜딩 커스터마이징.**
  담당자가 자사(가정: 주식회사 테스티파이) 명의로 발행할 가능성을 언급하며 "로고/푸터 문구를
  채팅으로 바꿔달라고 하면 당황하지 말고 반영해야 한다"고 요청 — 이번 라운드에서 처리.
  - **`ProductInfo.footerBrandName`(신규)**: 페이지 하단 "{연도} by {브랜드명}" 문구를
    채팅으로 바꿀 수 있게 됐다(`saveProductInfoTool`의 zod 스키마에 추가 → 기존 제품정보
    저장 도구가 그대로 처리, 새 프롬프트 지시 불필요 — PRODUCT_INFO_FIELD_LABELS에 추가하면
    `ProductInfoCard.tsx`도 자동으로 항목을 보여준다). **로고 이미지 자체(우측 워드마크
    PNG)는 고정이다** — 커스텀 로고 업로드는 지원하지 않는다(제품 정보에 이미지 첨부 흐름이
    없는 것과 같은 알려진 갭). `runProductInfoExtraction`(기업소개 파일 추출)의 필드 순회를
    `PRODUCT_INFO_FIELD_LABELS`가 아니라 `ProductInfoExtractionSchema.shape` 자체를
    기준으로 바꿨다 — footerBrandName처럼 "ProductInfo 전체 필드엔 있지만 추출 스키마엔
    없는" 필드가 앞으로 또 생겨도 두 목록이 어긋나는 타입 에러가 재발하지 않는다.
  - **기능명 정식 표시명 버그(중요) — "실시간 거점형" 대 "실시간 위치 기반 거점형 콘텐츠"**:
    raw data의 6/8/10/12/14/16번 헤더에는 짧은 이름("실시간 거점형")이, 18~23번(순위 응답)
    컬럼 원문에는 더 긴 설명형 문구("실시간 위치 기반 거점형 콘텐츠")가 들어있는데, 지금까지
    코드 전체(featureSatisfaction·relativeImportance·crossAnalysis·모든 차트)가 짧은 쪽만
    정식 이름으로 썼다. 실제 발행 보고서는 긴 쪽을 쓴다. 특정 기능 하나만 하드코딩해 늘리면
    다른 프로젝트 raw data에 안 맞으므로, `resolveFeatureDisplayNames()`(신규,
    `lib/walla/normalize.ts`)로 일반화했다 — 순위 응답 컬럼 전체를 훑어 각 짧은 이름에
    매칭되는 원문 중 **가장 긴 것**을 정식 표시명으로 채택한다. 이 이름이 이제
    `featureSatisfaction[].name`·`rank[]` 등 하위 전체의 유일한 기준명이다 — golden 체크
    기대값 딕셔너리의 키도 함께 바꿔야 했다(93/93 유지, 계산값 자체는 안 바뀜, 이름만 바뀜).
  - **Ⅶ장 그룹 막대그래프 3종 개선**: ① 범례에서 `(n=17)` 등 표본수 제거(그래프 제목
    가독성 저해 지적) — n수는 이미 다른 표에 있어 중복이었다. ② 항목(기능명) 순서를 원본
    컬럼 순서가 아니라 **Ⅲ장 "기능별 만족도"와 같은 순서(전체 평균 만족도 내림차순)**로
    통일 — 실제 보고서를 직접 대조해 확인한 정렬 기준. ③ `GroupedBarChart` 내부 여백 조정 —
    기존엔 그룹 안 막대끼리도 그룹 사이만큼 벌어져 있어 "그룹"이라는 게 안 보였다. 그룹 안
    막대는 거의 붙게(`marginHorizontal: 0.2`, `width: "96%"`), 그룹 사이만 벌어지게
    (`paddingHorizontal: 4`) 바꿨다.
  - **레이더 차트 그리드 숫자가 어중간했던 버그**: 기존엔 min/max를 0.5 단위로만 반올림하고
    gridLevels는 항상 6으로 고정해서, (max-min)이 정확히 3.0이 아니면(예: 2.5) 4.08/4.67/
    5.25처럼 나누어떨어지지 않는 숫자가 나왔다("숫자값 범위가 너무 과도하다"는 지적).
    `computeNiceRadarRange()`(신규, `lib/pdf/charts.tsx`)가 `niceStep()`(막대그래프가 이미
    쓰던 "예쁜 간격" 로직)으로 먼저 간격을 정하고, min/max와 gridLevels를 그 간격의 배수로
    맞춘다 — Ⅵ장 UX품질 레이더 3종·Ⅶ장 성별 UX 레이더 오버레이 둘 다 적용, 이제 항상
    4.00/4.50/5.00처럼 깔끔하게 나온다.
  - **NPS 게이지를 코드 생성 → 사용자 제공 원본 이미지로 교체**: 담당자가 "생성하지 말고
    제가 준 사진을 그대로 쓰라"고 명시적으로 요청 — `data/NPS 지수 산출_이미지.png`를
    `public/images/nps-scale.png`로 복사해서 `<Image>`로 직접 삽입, 기존
    `NpsGauge`(Circle+Path로 사람 아이콘을 직접 그리던 컴포넌트, `lib/pdf/charts.tsx`)는
    완전히 삭제했다 — 이 이미지 안에 사람 아이콘 게이지와 NPS 공식 박스가 이미 다 들어있어서
    별도로 그릴 필요가 없어졌다.
    - **"▶" 유니코드 삼각형을 다시 요청받음 — SVG 도형으로 우회**: 이전 라운드에서 "▶"이
      폰트에 없어 mojibake가 난다는 걸 확인하고 "•"으로 바꿨는데, 이번에 담당자가 다시
      "▶ 문자를 써달라"고 명시적으로 요청했다. 텍스트 글자로는 여전히 안 되므로(서브셋
      폰트에 글자가 없는 근본 원인은 그대로), `TriangleBullet`(신규,
      `sectionsQualitative.tsx`) — `Svg`+`Polygon` 하나로 그린 작은 삼각형을 텍스트 대신
      쓴다. 시각적으로 "▶"과 동일해 보이면서 폰트 글자셋 문제를 완전히 피해간다 — 이후
      비슷한 요청(유니코드 기호를 텍스트로 넣어달라는데 폰트에 없는 경우)이 오면 이 패턴을
      재사용할 것.
    - **NPS 요약표 스타일도 실제 보고서에 맞춤**: 헤더 셀 배경을 연한 파란색(`#dbeafe`)으로,
      "NPS 지수"와 "구매 고객" 사이(입력값 2칸 vs 비율 breakdown 3칸을 구분하는 경계)에
      굵은 세로선(`borderRightWidth: 2.5`)을 넣었다.
  - **사분면 차트(`ImportanceSatisfactionChart`) 라벨이 셀 경계를 침범하는 문제**: 기능명이
    위 정식 표시명 버그 수정으로 길어지면서(예: "실시간 위치 기반 거점형 콘텐츠") 한 줄
    라벨이 옆 셀까지 넘쳤다. `wrapQuadrantLabel()`(신규)이 8자 넘는 라벨을 공백 근처에서
    최대 2줄로 쪼갠다 — 점 근처에 라벨이 여러 개 몰리면(예: 비슷한 점수의 기능 3개가 인접)
    2줄 라벨끼리도 약간 겹칠 수 있다는 건 알려진 한계로 남겨뒀다(완벽한 충돌 회피는 범위 밖).

- **7차 대조(2026-07-21, 같은 날 일곱 번째 라운드) — 세부 레이아웃 버그 4건.**
  담당자가 생성 결과와 원본 보고서를 나란히 대조한 스크린샷 기준으로 지적한 항목.
  - **`VerticalBarChart`/`VerticalBarChartWithAverage` 값 라벨을 막대 밖(위)에서 막대
    안(위쪽)으로 이동**: "수치 정보는 막대 그래프 안에 넣어달라"는 요청 — 막대 View 자체에
    `alignItems:"center", paddingTop:3`을 주고 값 Text를 그 안의 첫 자식으로 넣는 방식으로
    바꿨다. **평균선(빨간 선)은 막대 View보다 나중에(JSX상 이후에) 그리도록 순서를 바꿨다**
    — react-pdf/Yoga는 나중 형제를 위에 그리므로, 이제 평균선이 막대에 가려지지 않고 항상
    또렷하게 보인다("빨간색 선은 그래프 위로 오게" 요청).
  - **Ⅴ장 4대가치 차트도 Ⅲ장과 완전히 같은 패턴으로 통일**: 기존엔 `min`(확대 축)·
    `yAxisTitle`·`legendBarLabel`/`legendAverageLabel` prop들이 Ⅲ장 호출부에만 적용돼
    있었다(그 prop 자체는 컴포넌트에 이미 있었음) — Ⅴ장 호출부에도 적용해서 "왜 어떤
    차트는 세로축 범위가 0~10인데 어떤 건 확대돼 있냐" 같은 불일치를 없앴다. 앞으로 이
    컴포넌트를 새로 쓰는 곳이 생기면 이 4개 prop(min/yAxisTitle/legendBarLabel/
    legendAverageLabel)을 항상 같이 채우는 걸 기본으로 할 것 — "일부 차트만 신경 써서
    예쁘고 나머지는 예전 스타일"이 되지 않게.
  - **페이지 번호를 "3 / 17"에서 "-3-"로, 그리고 진짜 페이지 정중앙으로**: 기존엔 쪽수
    Text가 좌측 텍스트·우측 로고 이미지와 같은 `flexDirection:"row"` 안에서 `flex:1`로
    가운데 칸을 차지했는데, 로고 이미지가 고정폭(55)이라 좌우가 비대칭이 되어 "가운데
    칸의 중앙"이 "행 전체의 진짜 중앙"과 어긋났다. `position:"absolute", left:0, right:0`
    으로 푸터 행 전체 너비 기준 독립적으로 중앙 정렬해서, 좌우 형제 요소의 너비와 무관하게
    항상 정확히 중앙에 오게 했다.
  - **표가 깨지는 실측 버그(중요) — `TransposedRankTable`(신규, `lib/pdf/charts.tsx`)**:
    Ⅲ장 "기능별 만족도 순위 종합", Ⅳ장 "기능별 중요 순위 종합" 두 표가 긴 기능명("실시간
    위치 기반 거점형 콘텐츠")이 2줄로 줄바꿈되면 다음 텍스트(값)가 그 위에 겹쳐 보이는
    문제가 있었다. 원인은 "항목마다 독립된 세로 View 스택"으로 구현했던 구조 — 열들이
    서로 독립적이라 Yoga가 행 높이를 맞춰줄 방법이 없었다(추정). **"행"을
    `flexDirection:"row"`로 만들고 그 안에 라벨 열+항목별 셀을 나란히 두는 진짜 표
    구조**로 바꿔서, 표준 flexbox 행 높이 규칙(같은 행의 셀은 가장 큰 셀 기준으로 키가
    맞춰짐)에 따라 어떤 셀이 줄바꿈되든 그 행 전체가 같이 늘어나게 했다 — 겹침이 원천적으로
    불가능해졌다. **이후 "N개 항목을 열로 나열하는 순위표"를 또 만들 일이 있으면 반드시
    이 컴포넌트(행 기반 구조)를 재사용할 것 — 열 기반 스택 구조로 되돌리지 말 것.**
  - **사분면 차트 + "영역별 참고 지표" 완전 재현**: `width={340}→{380}`로 키우고,
    `PriorityLegendTable`(기존, 우선순위/개선필요성 표) 옆에 **`PriorityMiniDiagram`(신규)**
    — 9칸짜리 작은 우선순위 다이어그램을 실제 보고서 원문 그대로("개선 필요성 적음
    우선순위 최하" 등 칸별 문구까지)와 **`PriorityDetailNotes`(신규)** — 색상 스와치 +
    상세 판정 기준 문장 5줄(실제 보고서 원문)을 추가했다. 색상·배치 로직은 기존 메인
    사분면 차트와 완전히 같은 공식(`col+row-2`)을 재사용해서 세 컴포넌트(메인 차트·미니
    다이어그램·범례 표)의 색이 항상 서로 일치한다 — 나중에 우선순위 색상 팔레트를 바꾸면
    `PRIORITY_LEVELS` 하나만 고치면 세 군데 다 같이 바뀐다.

- **8차 대조(2026-07-23) — Ⅱ 성별·Ⅲ 기능별 만족도 원본 재대조 + 검증 완화.** 담당자가 원본
  페이지(Ⅳ page8, Ⅲ page27)와 Q2 성별 좌우(원본/우리) 대조 스크린샷을 첨부하며 "원본과
  다른 포맷을 전부 원본과 같게"를 요청. `render:quant-preview`로 실제 렌더 → 페이지별 대조로
  진행했다(Ⅳ page8은 이미 원본과 동일해 손대지 않음).
  - **Q2 성별 — 세로 막대 + 성별×연령 교차표를 하나의 "[응답 결과]" 박스 안에 통합**:
    원본은 % 세로 막대와 교차표(명수)를 한 테두리 박스에 함께 넣는다. `VerticalBarChart`에
    `footer?: ReactNode` prop을 추가해 박스 안(막대 아래)에 교차표를 넣고, `CrossTabStackedBar`
    에 `axisTitle`("응답자 수")·`embedded`(바깥 여백 제거) prop 추가 + 막대 두께 14→20pt.
  - **Ⅲ 기능별 만족도 순위표에 라벤더 배너 제목**: `TransposedRankTable`에 `title?: string`
    prop 추가(있으면 `chartBannerBg` 배너를 표 상단에 붙임). Ⅲ은 `title="기능별 만족도 순위
    종합"`을 준다. **Ⅳ "기능별 중요 순위 종합"은 배너 없이 bold 소제목**(원본 page8이 그
    형식) — 원본이 페이지마다 이 표 제목 스타일이 다르다(page27은 배너, page8은 소제목).
  - **숫자 소수점 2자리 통일**: 원본은 만족도/상대중요도/표준편차를 항상 2자리로 쓴다(7.20,
    6.35). 예전엔 `{item.value}`를 그대로 찍어 7.2로 나왔다. `VerticalBarChartWithAverage`
    막대 라벨·범례 평균, `TransposedRankTable` 값, `SectionFourValuesTable`의 평균·표준편차를
    전부 `.toFixed(2)`로 바꿨다. y축 눈금(4/5/6/7/8)은 정수 그대로 둔다(2자리 아님).
  - **`computeBarWithAverageRange`를 확대 축 → 정수 넉넉 축으로 되돌림(중요, 사용자 명시
    결정)**: 예전엔 "값이 몰려 있으면 축을 데이터 스프레드의 25%만 여백으로 좁혀 막대를
    키우는" 확대 방식이었는데(2026-07-21 요청), 이번에 담당자가 원본(y축 4~8, step 1)과
    대조하고 **"원본과 동일(4~8점)"을 명시 선택**했다. 그래서 `min=floor(dataMin)-1`,
    `max=floor(dataMax)+1`(정수 경계, step 1)로 바꿨다 — Ⅲ 기능별 만족도·Ⅴ 4대가치가 이 함수를
    공유하므로 둘 다 정수 넉넉 축이 된다. **이건 이전의 "확대 축" 결정을 사용자가 의도적으로
    뒤집은 것이니, "막대가 다 비슷해 보인다"는 옛 피드백을 근거로 다시 확대 축으로 되돌리지
    말 것**(되돌리려면 반드시 사용자와 재확인).
  - **WALLA 검증 완화(같은 날)**: `literal`(정확 일치) → `keyword`(포함) + 끝 앵커 패턴 `$`
    제거. 위 "입력 포맷 권장사항 + 검증 완화" 절 참고.
  - 알려진 잔여 차이: Ⅲ 순위표에서 6.35 동점인 "펫과의 산책"·"실시간 위치 기반 거점형 콘텐츠"의
    3위/4위 순서가 원본과 반대다(우리는 컬럼 순서 기준 안정 정렬, 원본은 임의) — 동점이라
    무해한 미세 차이로 남겨둠.

## 현재 구현 범위 (Phase 7까지 — v1 로드맵 핵심 기능 전체 + Phase 8 일부)

- 채팅 셸 + raw data 업로드 + 정량 통계 + 정성 분석(14문항 병렬) + 체크포인트 A/B(극성·인사이트·
  제언) + 결과요약·제언 생성 + 종합전략제언 입력 + 제품 정보 입력(직접 입력/파일 추출) +
  **최종 PDF 조립 및 다운로드 링크 제공**까지 전체 파이프라인이 채팅 하나로 끝까지 이어진다.
  DB(Supabase)에 모든 중간 상태가 영속화된다. GitHub Actions CI(typecheck/lint/build)와
  정성 fidelity 측정 스크립트도 갖춰져 있다.
- **담당자가 실제 구현물을 직접 써보며 PRD 1.1절 문제 정의를 5 Whys로 재검토(v1.4)**한 결과
  나온 3.2절 "UX 설계 원칙"(완전한 구조화 카드로 텍스트 재요약 방지, 정성 분석 착수 전
  목차/섹션 구성 동의 체크포인트, 문항 단위 접기/펼치기)은 **구현 완료**됐다. Phase 9
  (동시성·레이트리밋 튜닝, 13장 실험 계획)는 여전히 남아있지만, 근본원인(팀장의 검수 부담)에
  더 직접 닿아있던 UX 갭·제품 정보 입력을 먼저 처리했다.
- 이후 담당자가 실제 채팅으로 라이브 테스트를 하며 준 2차 피드백까지 반영해 UX를 한 번 더
  다듬었다(2026-07-20): 제품 정보 카드가 validateInput 직후 자동으로 뜨는 별도 체크포인트가
  됨(`presentProductInfoPrompt`), 정량 통계 카드에 NPS·종합만족도·1위 기능 등 핵심 요약 타일이
  추가되고 8개 섹션이 접기/펼치기로 바뀜, 목차 카드도 굵은 제목+접기/펼치기로 바뀜, 채팅
  일반 텍스트에 경량 마크다운(볼드·목록) 렌더러가 추가됨. 이 작업 중 위 "채팅 오케스트레이션
  신뢰성" 절의 세 가지 버그(도구 반복 호출, 다음 도구 호출 누락, 메시지 중복 렌더링)를 라이브
  테스트로 발견해 같이 고쳤다.
- 알려진 기능 갭: 제품 정보 중 "주요 기능 목록"(기능명+설명+이미지, 5.0절)은 텍스트 필드만
  지원하고 이미지 첨부 흐름은 없음, 기업소개 파일에서 PPT(.pptx)는 아직 지원 안 함(PDF/워드/
  텍스트만), Tier 2/3 입력 경로(구조화된 요약본·자유서술 요약, 5.2·5.3절 — v1은 Tier 1 raw
  data 경로만 구현), 자유형식 요약 추출용 체크포인트 0(7.0절). (최종 PDF 다운로드가 private
  Blob 스토어에서 깨지던 버그는 2026-07-20 프록시 다운로드 라우트로 수정 완료 — 위 PDF 조립
  절 참고.)
- `.env.local`은 각자 로컬에 생성해야 한다(`.env.local.example` 참고). `ANTHROPIC_API_KEY`
  없이는 `/api/chat`이 스트리밍 에러를 반환하고, `DATABASE_URL` 없이는 `computeQuantStats`
  이후 모든 도구가 실패한다(정상 동작 — 서버가 죽지는 않음). `check:stage1`·`check:qualitative`도
  API 키가 필요하다.
- **비밀번호에 `#` 같은 URL 예약 문자가 있으면 반드시 percent-encoding할 것**(`#`→`%23`).
  안 하면 `psql`은 통과하는데(libpq가 다르게 파싱) 앱의 URL 파서는 `#` 이후를 프래그먼트로
  잘라버려 인증 실패가 난다 — 실제로 겪은 문제(2026-07-16).
