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
