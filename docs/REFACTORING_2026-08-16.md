# 코드 리팩토링 기록 — 1·2·3·4·5·6·7차 통합 (2026-08-16~17)

## 목표

- 기존 기능·화면·API 응답을 변경하지 않는다.
- 데이터 로딩, 편집 상태, 문서 렌더링, HWPX 슬롯 정의의 책임을 분리한다.
- 동일 구현의 중복을 제거한다.
- TypeScript, ESLint, Next.js 프로덕션 빌드로 회귀를 확인한다.

## 1차 리팩토링

### HWPX 웹 미리보기

- `components/HwpxPreviewStudio.tsx`
  - 화면 조립과 사용자 액션 연결만 담당한다.
- `components/hwpx-preview/useHwpxPreviewWorkspace.ts`
  - 보고서 작업공간 조회와 로딩·오류 상태만 담당한다.
- `components/hwpx-preview/useHwpxPreviewEdits.ts`
  - `contentEditable` 변경의 LocalStorage 복원·저장·수집·초기화만 담당한다.
- `components/hwpx-preview/model.ts`
  - API 응답 타입, 목차 정의, HTML 블록 조회와 키워드 추출을 담당한다.
- `components/hwpx-preview/RivalabsPreviewPages.tsx`
  - A4 페이지와 리바랩스 원본형 페이지 렌더링만 담당한다.

### HWPX 템플릿 패치

- `lib/hwpx/rivalabsSwTemplateMap.ts`
  - DB 값과 웹 편집값을 HWPX 문단 패치로 변환하는 규칙만 담당한다.
- `lib/hwpx/rivalabsSwTemplateSlots.ts`
  - 원본 HWPX 문단 번호, 원본 기준 문구, 기능별 슬롯 용량만 담당한다.

### PDF 및 개발 도구

- 설문 문항 번호 계산에서 렌더 중 가변 변수를 수정하던 코드를 순수한 인덱스 계산으로 변경했다.
- 완전히 동일했던 `render-reference-v2.tsx`와 `render-rivalabs-v3.tsx` 구현을 하나로 통합했다.
- Next.js 앱과 실행 방식이 다른 CommonJS HWPX POC 도구의 ESLint 규칙을 파일 범위로 분리했다.

## 2차 리팩토링

### 보고서 작업공간 조립

- `lib/report/workspace.ts`
  - Ⅰ~Ⅷ장 조립과 전체 섹션 연결을 담당한다.
- `lib/report/workspaceConclusion.ts`
  - Ⅸ장 종합 결과 및 제언의 표, 사분면, 결과 요약, 개선 전략, 기능별 고객 제언 조립만 담당한다.
  - 기존 블록 ID, 표시 문구, HTML 구조와 데이터 소스를 유지했다.
  - 중요도 최솟값을 행마다 다시 계산하던 부분을 한 번만 계산하도록 정리했다.

### 웹 보고서 분석 근거와 인용문 검토

- `components/ReportWebDocument.tsx`
  - 보고서 화면 상태, 편집 동작, 스크롤 위치와 패널 연결에 집중한다.
- `components/report-web-document/analysisEvidence.ts`
  - 블록 ID별 종합 분석·종합 결과·제언 근거 정의를 한곳에서 관리한다.
- `components/report-web-document/quoteEndingMarkup.ts`
  - 인용문 끝맺음 검토 표시를 DOM에 적용하고, 저장·복사 시 검토용 표시를 제거하는 동작을 담당한다.

### 파일 규모 변화

- `lib/report/workspace.ts`: 1,625줄 → 1,434줄
- `components/ReportWebDocument.tsx`: 1,143줄 → 1,095줄
- 분리된 로직은 이름이 명확한 전용 모듈로 이동했으며, 전체 기능 코드는 삭제하지 않았다.

## 3차 리팩토링

### 웹 문서 시각적 셸 분리

- `components/report-web-document/ReportDocumentChrome.tsx`
  - 목차, 섹션 배너, 우측 보고서 작업 패널을 담당한다.
  - 기존 목차 스크롤, 정성 대기 표시, 선택 블록 속성 편집 동작을 유지한다.
- `components/ReportWebDocument.tsx`
  - 보고서 편집 상태, 인용문·분석 근거 연결, 섹션 본문 렌더링에 집중한다.
  - 1,095줄에서 965줄로 축소했다.

### Ⅰ장 개요 빌더 분리

- `lib/report/workspaceOverview.ts`
  - 기업 개요, 제품·서비스 개요, 테스트 일정, 설문 항목 표 HTML을 담당한다.
  - 원래 사용하던 블록 ID, 색상, 병합 셀, 빈 값 안내 문구를 유지한다.
- `lib/report/workspace.ts`
  - Ⅰ장 구현 세부사항을 직접 갖지 않고 장별 빌더를 조합한다.
  - 1,434줄에서 1,277줄로 축소했다.

## 4차 리팩토링

### 분석 근거·인용문 패널 콘텐츠 분리

- `components/report-web-document/EvidencePanelContent.tsx`
  - 종합 분석 근거, 제언 재생성 UI, 인용문과 원문 대조, 끝맺음 보완 상태 표시를 담당한다.
  - API 호출과 보고서 상태 변경은 부모에 유지하고, 콜백을 통해 사용자 동작만 전달한다.
- `components/ReportWebDocument.tsx`
  - 원문 조회·끝맺음 보완·제언 재생성 요청과 전체 문서 상태 관리에 집중한다.
  - 965줄에서 899줄로 축소했다.

### Ⅱ장 인적 사항 빌더와 차트 생성기 분리

- `lib/report/workspaceDemographics.ts`
  - 나이, 성별, 운영체제, 걷기 습관, 성별×연령 교차표와 유사 서비스 경험 블록을 담당한다.
- `lib/report/workspaceCharts.ts`
  - 분포 차트, 평균 차트, 보고서 블록용 안전 ID 생성을 담당한다.
- `lib/report/workspace.ts`
  - Ⅱ장 구현과 공통 차트 생성 세부사항을 제거하고 장별 빌더 조합에 집중한다.
  - 1,277줄에서 1,215줄로 축소했다.

## 5차 리팩토링

### 보고서 작업공간 특성화 테스트

- `scripts/check-workspace-characterization.ts`
  - 실제 리바랩스 raw data로 생성한 Ⅰ~Ⅸ장 전체 블록 JSON을 SHA-256으로 고정한다.
  - Ⅲ장 전체 데이터와 장·블록 ID·종류·순서를 별도 지문으로 함께 검증한다.
- `npm run check:workspace-characterization`
  - 리팩토링으로 문구, HTML, 수치, 블록 순서 또는 구조가 하나라도 바뀌면 실패한다.

### Ⅲ장 기능별 고객 경험 빌더 분리

- `lib/report/workspaceFeatureExperience.ts`
  - 기능별 만족도, 중요도 순위 구성, 사분면, 우선순위 해석과 Ⅲ장 블록 조립을 담당한다.
  - 기존 정성 HTML 생성과 섹션 분석 패널은 명시적 서비스로 주입받아 현재 출력 규칙을 그대로 사용한다.
- `lib/report/workspace.ts`
  - Ⅲ장 세부 구현을 제거하고 전용 장 빌더 연결만 담당한다.
  - 1,215줄에서 1,053줄로 축소했다.

### 동일성 검증 결과

- 전체 Ⅰ~Ⅸ장 JSON 지문 일치
- Ⅲ장 전체 JSON 지문 일치
- 장·블록 ID·종류·순서 지문 일치

## 6차 리팩토링

### Ⅳ~Ⅷ장 보고서 빌더 분리

- `lib/report/workspaceCorePurchaseFactor.ts`
  - Ⅳ장 핵심구매요소 분포·순위표·종합 해석 패널을 담당한다.
- `lib/report/workspaceFourValues.ts`
  - Ⅴ장 4대 가치 정성 블록·평균 차트·표·종합 해석을 담당한다.
- `lib/report/workspaceUxQuality.ts`
  - Ⅵ장 실용성·즐거움 레이더 차트와 분석 패널을 담당한다.
- `lib/report/workspaceCrossAnalysis.ts`
  - Ⅶ장 연령·성별 교차 차트·표와 저장된 해석을 담당한다.
- `lib/report/workspaceNps.ts`
  - Ⅷ장 NPS 도식·기준 설명·종합 만족도·개선 아이디어를 담당한다.
- `lib/report/workspace.ts`
  - 장 내부 구현을 제거하고 Ⅰ~Ⅸ장 빌더의 입력과 의존성을 연결하는 조립점으로 축소했다.
  - 1,053줄에서 673줄로 축소했다.

### 동일성 검증 결과

- 분리 전·후 전체 Ⅰ~Ⅸ장 JSON 지문 일치
- Ⅲ장 전체 JSON 지문 일치
- 장·블록 ID·종류·순서 지문 일치
- 블록 ID, HTML, 수치, 문구와 배열 순서 변경 없음

## 7차 리팩토링

### 웹 보고서 분석 근거·인용문 요청 훅 분리

- `components/report-web-document/useReportEvidence.ts`
  - 스크롤 위치에 따른 분석 근거·인용문 원문 전환을 담당한다.
  - 인용문 원문 조회, 문장 끝맺음 생성, 단건·일괄 적용과 제언 재생성 API 상태를 관리한다.
  - 기존 원문 요청 경쟁 방지 번호와 끝맺음 요청 25초 제한을 유지한다.
  - 기존 API 경로, HTTP 메서드, 요청 본문, 오류 문구와 보고서 HTML 치환 규칙을 유지한다.
- `components/report-web-document/ReportBlockView.tsx`
  - 제목·차트·표·정성 텍스트·병합 표 블록의 컴포넌트 매핑을 담당한다.
  - 병합 표 직접 편집, AI 요약 생성과 내장 SVG PNG 다운로드 동작을 함께 캡슐화한다.
  - 기존 `ReportWebDocument.tsx`의 `BlockView`·서식 함수 export는 호환 재노출로 유지한다.
- `components/ReportWebDocument.tsx`
  - 분석 근거 API 구현을 제거하고 보고서 레이아웃, 블록 선택·편집, 목차·내보내기 연결에 집중한다.
  - 블록 종류별 렌더링 구현도 제거해 문서 전체 조립만 담당한다.
  - 899줄에서 332줄로 축소했다.

### 기능 보존 범위

- 스크롤 읽기선 32%와 근거 선택 우선순위 유지
- 분석 근거가 없는 구간의 패널 초기화 동작 유지
- 인용문 원문 그룹화·중복 제거·응답 순서 유지
- 제언 재생성 대상 블록과 적용 방식 유지
- 문장 끝맺음 단건·일괄 변경 표시 HTML 유지

## 8차 리팩토링

### 웹 보고서 내비게이션·복사·내보내기 분리

- `components/report-web-document/useReportNavigation.ts`
  - 목차와 소제목 이동, 섹션 DOM 참조, `IntersectionObserver` 기반 활성 섹션 감지를 담당한다.
  - 기존 부드러운 스크롤과 `rootMargin: -15% 0px -70% 0px`, `threshold: 0` 기준을 유지한다.
- `components/report-web-document/useReportClipboard.ts`
  - 보고서 선택 영역의 HTML·RTF·평문 복사와 현재 섹션 버튼 복사를 담당한다.
  - 한글 호환 복사 우회 속성, 선택 범위 검사와 기존 MIME 구성을 유지한다.
- `components/report-web-document/useReportExport.ts`
  - 현재 섹션의 차트·표 ZIP 내보내기와 기존 파일명 규칙을 담당한다.
- `components/ReportWebDocument.tsx`
  - 위 브라우저 동작의 구현을 제거하고 보고서 레이아웃과 상태 조립에 집중한다.
  - 332줄에서 245줄로 축소했다.

### 검증 결과

- TypeScript 오류 0건
- ESLint 오류 0건, 기존 경고 23건 유지
- 전체 Ⅰ~Ⅸ장·Ⅲ장·블록 구조 특성화 해시 모두 일치
- Next.js 16.2.10 프로덕션 빌드 및 30개 페이지 생성 성공

## 변경 이유

- 한 컴포넌트가 네트워크 요청, 브라우저 저장소, 편집 이벤트, 페이지 렌더링을 모두 담당하면 수정 영향 범위를 예측하기 어렵다.
- HWPX 문단 번호와 패치 생성 규칙이 한 파일에 섞이면 원본 양식 교체 시 로직까지 함께 수정하게 된다.
- 렌더 과정에서 외부 변수를 증가시키면 React 재렌더링에서 문항 번호가 달라질 가능성이 있다.
- 동일한 렌더러 두 벌은 수정 누락과 출력 불일치의 원인이 된다.
- Ⅸ장 결과표와 제언 생성은 다른 장의 조립 로직과 변경 주기가 달라 독립 경계가 필요하다.
- 분석 근거 문구와 인용문 DOM 처리가 화면 상태 코드에 섞이면 근거 추가와 표시 수정의 영향 범위가 커진다.
- 목차·섹션 배너·속성 패널은 보고서 내용과 독립적인 화면 셸이므로 본문 상태 코드와 분리할 필요가 있다.
- Ⅰ장 개요는 고유한 표 구조와 스타일을 가지므로 다른 장의 정량·정성 조립 로직과 분리하는 편이 안전하다.
- 분석 근거와 원문 패널은 상태 전환이 많지만, 표시 자체는 입력 props로 결정되는 독립 UI이므로 부모의 API 처리와 분리할 수 있다.
- 인적 사항 장은 정성 분석과 결합되지 않은 독립 정량 섹션이라 장별 분리의 회귀 위험이 낮다.
- 장별 코드를 이동하기 전에 현재 출력을 특성화 테스트로 고정해야 기능 변경 없는 리팩토링임을 기계적으로 증명할 수 있다.
- 목차 감지, 한글 호환 복사, 섹션 내보내기는 서로 다른 브라우저 API를 사용하므로 문서 레이아웃과 독립적으로 검증할 수 있는 경계가 필요하다.

## Claude Code 공유용 리팩토링 포인트

- 기능 변경 없음: API 경로, 편집 키, LocalStorage 키, 화면 문구, HWPX 패치 형식 유지
- 데이터 로딩과 UI 렌더링 분리
- 로컬 편집 상태를 전용 훅으로 캡슐화
- HWPX 원본 슬롯 상수와 패치 생성 규칙 분리
- 중복 PDF 렌더러를 호환 진입점 방식으로 단일화
- 렌더 중 변수 변경 제거, 순수 계산으로 변경
- POC 실행 도구의 ESLint 규칙을 앱 코드와 분리
- 새 코드 영역 TypeScript/ESLint 오류 0건
- 전체 ESLint 오류 100건에서 0건으로 감소(기존 경고 23건은 후속 정리 대상)
- Ⅸ장 종합 결과·제언 빌더를 별도 모듈로 분리
- 분석 근거 정의와 인용문 끝맺음 DOM 처리를 웹 문서 컴포넌트에서 분리
- 기존 블록 ID·API·편집 키·화면 문구·HTML 출력 구조 유지
- 목차·섹션 배너·우측 작업 패널을 전용 화면 셸 컴포넌트로 분리
- Ⅰ장 개요 표와 설문 항목 표 생성기를 전용 장 빌더로 분리
- 종합 분석 근거·인용문 원문·끝맺음 보완 표시를 전용 패널 콘텐츠로 분리
- Ⅱ장 인적 사항 빌더와 공통 분포·평균 차트 생성기를 분리
- 실제 raw data 기반 전체 작업공간·Ⅲ장·블록 구조 특성화 테스트 추가
- Ⅲ장 기능별 고객 경험 조사·분석 빌더를 전용 모듈로 분리
- Ⅳ~Ⅷ장 핵심구매요소·4대 가치·UX 품질·교차 분석·NPS 빌더를 장별 모듈로 분리
- 장별 빌더가 기존 정성 HTML과 분석 패널 생성기를 명시적 의존성으로 전달받도록 구성
- 웹 보고서 분석 근거·인용문·제언 API 상태와 DOM 반영을 전용 훅으로 분리
- 웹 보고서의 블록 종류별 렌더링과 rich-static 편집·요약 요청을 전용 컴포넌트로 분리
- 웹 보고서의 목차 이동·스크롤스파이, 한글 호환 복사, 섹션 ZIP 내보내기를 전용 훅으로 분리
- 프로덕션 빌드와 HWPX 구조 검증을 회귀 기준으로 사용

## 후속 권장 순서

1. `lib/pdf/charts.tsx`와 `lib/pdf-rivalabs-v3/charts.tsx`의 공통 계산 로직을 UI 독립 모듈로 추출한다.
2. PDF 전용 이미지에 대한 접근성 린트 정책과 남은 미사용 인자를 정리한다.
3. 각 템플릿별 골든 PDF/HWPX 비교 테스트를 CI에 연결한다.
