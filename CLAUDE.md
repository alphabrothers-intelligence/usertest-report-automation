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

- `basic.ts`: 평균/표준편차(표본, ddof=1)·범주분포·상대중요도(6.8절 공식)·NPS 계산. LLM 미사용
  (4.1절 설계 원칙 — 정량은 항상 규칙 기반).
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
