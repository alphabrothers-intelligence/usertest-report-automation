# Codex 인계 문서 (2026-07-25 기준)

> 이 문서는 Claude Code 세션에서 지금까지 만든 "보고서 생성" 전체(파이프라인 + PDF/DOCX/HWPX
> 렌더러 + 채팅 오케스트레이션 + 웹 편집 작업공간)를 Codex가 이어서 작업할 수 있도록 개조식으로
> 정리한 것이다. **세부 결정 이유·실측 버그·수치 근거는 `CLAUDE.md`(코드에서 바로 안 드러나는
> 결정만 기록)와 `PRD.md`(요구사항 원본, v1.3+v1.5)가 정본이다** — 이 문서는 "무엇이 어디에
> 있는지"의 지도이고, "왜 그렇게 했는지"는 CLAUDE.md를 검색해서 볼 것. 코드를 고치기 전에
> 반드시 CLAUDE.md 관련 절을 먼저 읽을 것 — 특히 react-pdf 폰트/유니코드/페이지 넘김 관련
> 실측 버그들은 문서화 안 하고 재발하면 똑같은 시간을 또 쓰게 된다.

## 0. 스택 요약

- Next.js 16 App Router + Tailwind, Vercel 단일 배포(별도 백엔드 없음).
- `ai`(v7) + `@ai-sdk/react` + `@ai-sdk/anthropic`(+`@ai-sdk/openai` 일부) — 채팅 오케스트레이션.
- Supabase Postgres(`postgres.js`, `DATABASE_URL`, pgbouncer transaction pooler 쓰면
  `prepare:false` 필수).
- `@vercel/blob` — 클라이언트 업로드(raw data), 서버 업로드(생성물: PDF/DOCX/HWPX).
- `xlsx`(raw data 파싱), `@react-pdf/renderer`(PDF), `docx`(Word), 직접 구현한 HWPX 빌더.
- 정량 계산은 **항상 로컬 TypeScript 결정론적 계산**(Claude/OpenAI 호출 없음) — 유일한 예외는
  `lib/claudeQuant/`(아래 6번, 현재 미사용).

## 1. 보고서 생성 파이프라인 (raw data → 저장된 분석 결과)

- `lib/walla/` — raw data(WALLA 59컬럼 스키마) 파싱·검증.
  - `schema.ts`: 컬럼 스펙. 헤더 검증은 **키워드(포함) 매칭**(2026-07-23, 예전엔 정확 일치).
  - `normalize.ts`: 응답 정규화, `alignToFeatureName`(순위응답↔기능만족도 항목명 정렬),
    `resolveFeatureDisplayNames`(정식 표시명 — 순위 응답 원문 중 가장 긴 것을 채택).
  - `parse.ts`: 시트 파싱, 트레일링 빈 행/유령 컬럼 자동 절단.
- `lib/quant/` — 정량 통계(Phase 2, **LLM 미사용, 규칙 기반**).
  - `basic.ts`: 평균/SD/NPS/상대중요도(FGI 공식)/사분면 우선순위/연령대 분포/교차표 등.
  - `compute.ts`: `computeQuantStats()` — Ⅱ~Ⅷ장 전체 통계를 하나의 `QuantStats` 객체로 계산.
    이 객체가 PDF/DOCX/HWPX/웹 작업공간 전부의 **단일 진실 소스**다.
  - `crossAnalysis.ts`: Ⅶ장 연령대별/성별 교차분석(그룹 평균 비교, uxQuality 포함).
  - **회귀 테스트**: `npm run check:golden` — 리바랩스 골든셋 기준 93/93 값 대조. 정량 로직을
    건드리면 반드시 재실행.
- `lib/pipeline/` — 정성 분석(Phase 3~4, Claude 사용) + 오케스트레이션.
  - `stage1.ts`/`stage2.ts`: 절 분리 + 극성판정 → 카테고리화+대표인용+인사이트초안.
    `reasoning:"none"` 필수(안 지우면 100명 처리 시 응답 잘림, CLAUDE.md 실측 기록).
  - `questions.ts`: 정성 처리 대상 14문항 스펙 추출.
  - `orchestrate.ts`: `runQualitativePipeline()` — Stage1/Stage2 병렬 처리(p-limit 분리 필수).
  - `confidence.ts`: 극성판정 신뢰도(체크포인트 A 대상 필터링용, LLM 재호출 없음).
  - `recommendation.ts`: 헤지워딩 제언 생성(핵심구매요소 해석/개발우선순위/기능별 As-is→To-be).
  - `summary.ts`: 결과요약(Tier 1, 승인 절차 없음, 매번 재생성).
  - `hedgeCheck.ts`: 금지 표현 문자열 매칭(LLM 재호출 없음).
  - `polaritySummary.ts`/`generatePolaritySummaries.ts`: 극성별 총평 박스 — **opt-in 전용**,
    기본 파이프라인에서 완전히 분리됨(과거 크레딧/타임아웃 사고, CLAUDE.md 참고).
  - `reportPlan.ts`: 목차(Ⅰ~Ⅸ) 구조 — 채팅 카드·PDF ToC·웹 작업공간 TOC가 전부 이 함수 하나를
    공유(제목 문자열이 세 곳에서 반드시 일치해야 함).
  - `surveyQuestions.ts`: Ⅰ장 설문 항목 표를 raw data 헤더에서 결정론적으로 구성.
  - `claudeGuard.ts`: (신규 파일, 확인 필요 — grep으로 참조처 파악 권장.)
- `lib/db/` — 영속화.
  - `schema.sql`: `reports`→`questions`→`clauses`/`categories`, `recommendations`,
    `strategic_inputs`. `npm run db:migrate`(idempotent).
  - `reports.ts`: 모든 CRUD + 체크포인트 A/B 함수(`saveQualitativeResults`,
    `approveRecommendation` 등). 채팅 도구와 REST 라우트가 이 함수들을 공유.
- `lib/productInfo/` — Ⅰ장 제품 정보 입력(직접 입력 / 파일 추출 두 경로).
- `lib/claudeUsage.ts` — Claude 호출 사용량 로깅 공통 함수.

## 2. PDF 렌더러 — **3개 존재, 용도가 다름**

### 2-1. `lib/pdf/` — **프로덕션 렌더러(유일하게 앱이 실제로 쓰는 것)**
- `ReportDocument.tsx`(표지+ToC+본문 조립), `theme.ts`(색상/폰트/여백), `fonts.ts`(WOFF 등록 —
  **`.woff2` 쓰면 텍스트가 통째로 사라지는 실측 버그, 절대 `.woff2`로 되돌리지 말 것**),
  `charts.tsx`(막대/레이더/사분면/누적막대 등 전부 `View`/`Svg` 네이티브, PNG 래스터화 안 씀),
  `sectionsQuant.tsx`(Ⅰ~Ⅷ 정량 섹션), `sectionsQualitative.tsx`(정성 섹션+Ⅸ),
  `assemble.ts`(`assembleReport()` — 체크포인트 게이트 강제, Blob 업로드).
- `app/api/chat/route.ts`의 `assembleReportTool`이 PDF+DOCX+HWPX를 한 번에 호출.
- **오늘(2026-07-25) 세션에서 이 파일을 직접 고쳤다** — 아래 8번 참고.
- 검증: `npm run render:quant-preview`(DB/Claude 호출 없이 로컬 raw data로 즉시 렌더),
  결과물 `output/pdf/리바랩스_원본재현_정량검증.pdf`.

### 2-2. `lib/pdf-carecl-v1/` — **케어클(실제품형) 전용 검증 렌더러**
- `lib/pdf/`를 재사용하지 않고 독립 구현(README 명시). 실제품형은 SW/App형과 장 구성이 다름
  (8개 장: 개요/인적사항/기능별 고객경험/고객여정/핵심구매요소/4대가치/NPS·종합만족도/종합제언).
- 입력: `data/[케어클] 사용성테스트 raw data.csv`(gitignore, 로컬에만 존재).
- 정성 분석 미실행 구간은 "정성 분석 결과 대기" placeholder로 정직하게 표시.
- 검증: `npx tsx scripts/render-carecl-v1.ts` → `output/pdf/케어클_실물제품형_정량검증_v1.pdf`.
- **아직 15쪽짜리 정량 검증본**, 원본 53쪽 전체 문구 복제본 아님 — 정성 분석 붙이면 확장 예정.

### 2-3. `lib/pdf-rivalabs-v3/` — **실험적 "격리 렌더러", 프로덕션 아님**
- README: "`lib/pdf/`의 작업 사본, 원본은 수정하지 않고 여기서만 원본 PDF와 시각 대조·보정"
  (2026-07-23 사용자 지정). **채택하려면 검수 후 `lib/pdf`에 선택 반영해야 하는 실험 트랙** —
  지금 앱은 이 렌더러를 쓰지 않는다.
- Pretendard 폰트 사용(프로덕션 `lib/pdf`는 Noto Sans KR) — 서로 다른 폰트 실험 중이라는 뜻.
- 검증: `npx tsx scripts/render-rivalabs-v3.ts` → `output/pdf/리바랩스_원본재현_v3_격리렌더러.pdf`.
- **주의**: `scripts/render-rivalabs-v3.tsx`(.tsx, 확장자 다름)가 별도로 존재하는데 내용이
  `scripts/render-reference-v2.tsx`와 사실상 동일해 보인다 — 실수로 남은 중복/구버전 파일일
  가능성이 있으니 손대기 전에 먼저 diff로 확인할 것.
- `scripts/render-reference-v2.tsx`(`npm run render:reference-v2`)도 "`lib/pdf/`를 전혀
  재사용하지 않는 독립 렌더러 v2"라고 자체 명시 — v2와 v3의 관계(v3가 v2 이후 버전인지, 서로
  다른 실험 갈래인지)는 코드만으로 명확하지 않으니 작업 전에 실제로 두 산출물을 열어 비교
  권장.

### 2-4. 시각 QA — `lib/layoutQa/openai.ts`
- OpenAI(`gpt-5.6-terra`, env `OPENAI_LAYOUT_QA_MODEL`)로 원본 페이지 이미지 vs 생성 페이지
  이미지를 비교해 레이아웃 차이만 구조화 판정(텍스트 문장 품질은 안 봄). 실제 수정은 여전히
  사람/코드가 함.
- `scripts/check-visual-layout.ts`(`npm run check:visual-layout`, `.env.local` 필요) 가 이걸 호출.
- `OPENAI_API_KEY` 없으면 명시적 에러(선택 기능이라 PDF 생성 자체엔 영향 없음).

## 3. DOCX / HWPX 내보내기 (2026-07-23 추가)

- `lib/docx/` — `assemble.ts`(`assembleReportDocx()`, PDF와 완전히 같은 게이트·데이터 소스),
  `ReportDocx.ts`(Ⅰ~Ⅸ 동일 구성, `docx` 패키지는 벡터/네이티브 차트 미지원이라 **차트는
  PNG 이미지로 삽입**), `chartImage.ts`, `theme.ts`, `helpers.ts`.
  - 차트 PNG는 `lib/charts/canvasCharts.ts`(`@napi-rs/canvas` 기반, `ctx.measureText()`로
    정확한 텍스트 폭 측정)로 생성 — 예전엔 SVG+sharp 방식이었는데 텍스트 폭 추정이 부정확해서
    라벨이 삐져나오는 문제로 교체됨.
- `lib/hwpx/` — `assemble.ts`(`assembleReportHwpx()`), `ReportHwpx.ts`. 현재 텍스트 출력은
  PDF와 동일한 확정 데이터를 쓰되, 표/인용문 블록은 아직 PDF만큼 풍부하지 않을 수 있음
  (주석에 "향후 확장 시 동일 데이터 계약 유지 목적"이라고 명시돼 있어 미완성 신호로 읽힘 —
  실제 산출물을 열어 완성도 확인 권장).
- `app/api/chat/route.ts`의 `assembleReportTool` 하나가 PDF→DOCX→HWPX 순서로 세 개를 다
  조립해서 링크 세 개를 반환한다(resultSummary는 PDF 조립 시 한 번만 생성해 재사용 —
  Claude 토큰 중복 소모 방지).

## 4. 채팅 오케스트레이션 (`app/api/chat/route.ts`, `app/page.tsx`)

- 도구 목록(순서대로): `presentProductInfoPrompt`, `extractProductInfoFromFile`,
  `saveProductInfoTool`, `validateInput`, `computeQuantStats`, `estimateQualitativeAnalysis`,
  `presentReportPlan`, `runQualitativeAnalysis`, `generatePolaritySummaries`(opt-in),
  `getPolarityReviewQueue`, `submitPolarityReview`, `getInsightReviewQueue`,
  `submitInsightReview`, `generateResultSummary`, `generateRecommendation`,
  `generateFeatureRecommendation`, `getRecommendationReviewQueue`,
  `submitRecommendationReview`, `saveStrategicInputTool`, `assembleReportTool`.
- **신뢰성 패턴(중요, 재사용할 것)**: `prepareStep` 콜백에서 (a) once-only 도구는 이미
  완료됐으면 `activeTools`에서 제거, (b) "A 다음엔 반드시 B" 전이는 `toolChoice`로 강제.
  텍스트 지시문만으로는 확률적으로만 지켜진다는 게 실측 확인됨(CLAUDE.md "채팅 오케스트레이션
  신뢰성" 절 — 새 게이트 추가 시 반드시 이 패턴 재사용, 그리고 A의 **성공 여부**까지 확인해야
  하는지 검토).
- `app/page.tsx`: `useChat` 메시지 중복 렌더링 방어(같은 id 마지막 것만 남김), 다중 파일 첨부,
  업로드 중 전송 차단, textarea 개행 지원, 첨부 URL 칩 처리, 긴 메시지 접기.
- 카드 컴포넌트: `ProductInfoPromptCard`/`ProductInfoCard`, `ReportPlanCard`,
  `QuantStatsSummary`(막대그래프 카드), `PolarityReview`, `InsightEditor`,
  `RecommendationReview`, `QualitativeResults`.

## 5. 웹 편집 작업공간 (`/viewer`, PRD v1.5, 이번 세션 최대 작업)

**목표**: 실제 생성된 보고서 내용을 목차별로 클릭해서 보고, 서식(굵게/밑줄/기울임/화살표)
유지 복사로 한글 파일에 붙여넣을 수 있게, 정량 표/차트도 값/색/축범위를 편집하고 PNG/ZIP으로
내보낼 수 있게 하는 것.

- `lib/report/sections.ts`: `ReportChartBlock`/`ReportTableBlock`/`ReportTextBlock` 유니언
  타입, `ReportSectionContent`(9개 섹션).
- `lib/report/workspace.ts`: `buildReportWorkspaceSeed()` — DB의 `QuantStats`(+정성 데이터
  있으면 그것도)에서 9개 섹션 콘텐츠를 만든다. `normalizeQuantStats()`가 스키마 드리프트(오래된
  DB row에 새 필드 없음)를 방어적으로 채움.
- `lib/report/richText.ts`: 굵게/밑줄/기울임 nested run 파싱, 클립보드 HTML 직렬화, 맑은 고딕
  강제.
- `lib/report/domClipboard.ts`: 실제 DOM을 걸어 `getComputedStyle()`을 인라인으로 굳혀
  `<p>`/`<table>` 블록의 클립보드 HTML을 만든다(브라우저는 붙여넣기 시 CSS 클래스는 무시하고
  인라인 스타일+시맨틱 태그만 반영하므로).
- `lib/report/exportImage.ts`: 차트는 SVG→Image→canvas→PNG, **표는 Canvas2D
  `fillText`/`strokeRect` 직접 드로잉**(foreignObject 방식은 Chrome이 캔버스를 tainted 처리해
  `toBlob()`이 항상 실패 — 실측 확정 버그, foreignObject로 되돌리지 말 것). ZIP 다운로드는
  `jszip`으로 `[data-report-export]` 마킹된 요소를 훑음.
- `components/report/EditableBarChart.tsx`/`EditableTable.tsx`: 값 클릭 편집, 색상/축 범위,
  개별 PNG 다운로드 버튼.
- `components/ReportWebDocument.tsx`: `activeSection` prop으로 **선택된 섹션 하나만
  조건부 렌더링**(예전엔 9개 전부 항상 렌더링 + 스크롤 앵커였음). TOC 클릭→해당 섹션 전환,
  부분 복사 시 복사 버튼/ZIP 버튼 텍스트는 제외.
- `components/ReportWebWorkspace.tsx`: 순수 passthrough(상태는 `ReportStudio`가 소유).
- `components/ReportStudio.tsx`: 최상위 상태 소유자. `sections: ReportSectionContent[]` 단일
  상태, localStorage 저장(`STORAGE_KEY = "usertest-report-studio-v3"`, `sourceFileUrl`로
  다른 보고서 간 오염 방지), PDF 탭은 읽기 전용 iframe만(좌표 오버레이 편집 제거됨).
- `components/RichReportEditor.tsx`: 툴바 = 굵게/밑줄/**기울임**/제언 화살표/서식 유지 복사만
  (제목·글머리표 버튼 없음 — 사용자가 명시적으로 불필요하다고 확인). "서식 유지 복사" 버튼은
  `"write" in navigator.clipboard`(예전엔 `navigator`에 대고 검사해서 항상 false였던 오타
  버그 — 볼드가 전혀 안 먹던 근본 원인, 수정 완료).
- `app/viewer/page.tsx`: `?source=<raw data URL>&section=<로마숫자>` 쿼리 파싱.
- `app/api/report-workspace/route.ts`: 시드 데이터 API.
- **범위 한정(사용자 확정)**: 정량 표/차트 편집은 **웹 작업공간 표시/내보내기 전용 로컬
  오버라이드**다 — DB `quant_stats`나 PDF 재계산에는 영향 없음. ZIP 다운로드는 **현재 보고
  있는 섹션만**(전체 일괄 아님).
- **단계적 완료 상태**: 정량 데이터가 이미 있는 Ⅱ·Ⅳ·Ⅵ·Ⅶ은 실제 데이터로 완전히 채워짐.
  Ⅰ·Ⅲ·Ⅴ·Ⅷ·Ⅸ는 정량만 채워지고 정성 자리는 `pending:true`(정직한 "정성 분석 승인 후 표시").
  **후속 패스로 남은 일(요청받으면 진행)**: 정성 카테고리/인용문/인사이트를 해당 섹션에 채우는
  작업 — DB에 이미 승인 대기 중인 Stage1/2 결과가 있다면 체크포인트 승인만으로 가능(재분석
  불필요, 비용 없음), 없다면 `runQualitativeAnalysis`를 새로 돌려야 함(비용 발생).
- 검증 방법(반드시 실제 브라우저로): Playwright로 목차 클릭→단일 섹션 렌더링, 차트/표 값
  편집, PNG/ZIP 다운로드, 클립보드 HTML 내용까지 확인 — 19/19 체크 통과 이력 있음(스크립트는
  세션 scratchpad에 있었고 저장소에 커밋되지 않음, 재작성 필요 시 이 문서의 패턴 참고).

## 6. 미사용/실험 상태로 남아있는 코드 (확인 필요)

- `lib/claudeQuant/`(`analyze.ts`, `schema.ts`): Claude로 정량 JSON을 뽑는 **레거시/대안
  경로** — `grep` 결과 앱 어디에서도 import되지 않음(프로덕션은 `lib/quant/compute.ts`의
  로컬 계산만 씀, "정량은 항상 규칙 기반" 원칙과도 맞음). 삭제할지 유지할지 사용자에게 확인
  후 정리 권장.
- `lib/pdf-rivalabs-v3/`: 위 2-3 참고, 실험 트랙.
- `scripts/render-rivalabs-v3.tsx` vs `.ts`: 중복 가능성, 확인 필요.
- `output/`, `tmp/`: 로컬 검증 산출물 저장소, `.gitignore` 대상인지 확인 필요(현재 git status
  상 untracked로 나옴 — 커밋 방지 원한다면 `.gitignore`에 추가 검토).

## 7. 검증 명령어 모음

```bash
npx tsc --noEmit                       # 타입체크
npm run check:golden                   # 정량 회귀(93/93), API 키 불필요, 자주 돌릴 것
npm run render:quant-preview           # lib/pdf/ 프로덕션 렌더러로 즉시 PDF 생성(DB/Claude 없음)
npx tsx scripts/render-carecl-v1.ts    # 케어클 렌더러
npx tsx scripts/render-rivalabs-v3.ts  # 실험 렌더러 v3
npm run render:reference-v2            # 독립 렌더러 v2
npm run check:visual-layout            # OpenAI 시각 QA (.env.local 필요, 과금)
npm run check:stage1                   # Stage1 few-shot 검증 (API 키 필요, 과금, 수동 실행)
npm run check:qualitative              # 정성 파이프라인 전체 (API 키 필요, 과금, 수동 실행)
npm run check:qualitative-fidelity     # 극성판정 일치율 측정 (API 키 필요, 과금, 수동 실행)
npm run check:category-coverage
npm run db:migrate                     # 스키마 적용(idempotent)
```

## 8. 오늘(2026-07-25) 세션에서 실제로 고친 것

`lib/pdf/sectionsQuant.tsx`의 "기능별 상대 중요도-만족도 그래프"(Ⅳ장) 페이지 넘김 버그 수정:

1. 사분면 차트 배너에 걸려있던 `break`(무조건 새 페이지) 제거 → 배너+차트를 `wrap={false}`
   하나로만 묶어, 앞 표("기능별 중요 순위 종합") 페이지에 공간이 남으면 자연스럽게 이어지게 함.
2. "영역별 참고 지표"(제목+FGI 참고이미지+우선순위표+판정기준)를 **원본처럼 이미지(좌)/표(우)
   나란히 배치**로 변경 — 예전엔 "Image를 flex 형제 열에 두면 옆 열이 붕괴한다"는 2026-07-24
   실측 버그 기록 때문에 위/아래로 쌓여 있었는데, 이번엔 이미지에 **고정 pt 폭**(flex 아님)을
   주니 붕괴 없이 정상 렌더링됨을 재확인(예전 버그는 flex 기반 폭이 원인이었던 것으로 추정).
3. 참고 이미지 폭을 300→200으로 축소(페이지 넘김은 계산이 아니라 실제 렌더로 확인하며 조정 —
   300/250은 여전히 다음 페이지로 밀렸고 200에서 사분면 차트와 같은 페이지에 안정적으로 들어감).

결과: 예전엔 사분면 차트 페이지가 절반 가까이 빈 채로 끝나고 "영역별 참고 지표"가 통째로 다음
페이지로 밀렸는데, 지금은 차트+참고지표+해석까지 한 페이지에 자연스럽게 들어간다(전체 페이지 수
19→18로 감소). `npx tsc --noEmit` 클린, `npm run check:golden` 93/93 유지 확인 완료.
CLAUDE.md에도 이 내용과 정정된 "Image flex 붕괴 버그" 기록을 반영해둠 — 아래 CLAUDE.md의 해당
절(사분면/영역별 참고 지표 부분) 검색해서 확인할 것.
