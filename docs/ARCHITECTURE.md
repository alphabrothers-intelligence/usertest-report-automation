# 코드 구조

이 문서는 실행 경로와 모듈 책임을 빠르게 찾기 위한 지도다. 기능·양식의 세부 계약은
`CLAUDE.md`, 제품 요구사항은 `PRD.md`를 따른다.

## 입력에서 보고서까지

1. `components/wizard/`, `components/survey/`와 `app/api/wizard/`, `app/api/survey/`가 입력·설문 흐름을 담당한다.
   설문 화면은 `SurveyStudio`의 로딩·저장, `SurveyList`의 목록, `SurveyEditor`의 문항 편집으로 나뉜다.
2. `lib/walla/`가 원자료를 읽고 정규화한다. `lib/agent/`는 범용 설문 역할과 장 구성을 판단한다.
3. `lib/quant/`가 정량 통계를 계산한다. 정성 분석은 `lib/pipeline/`이 단계별로 수행한다.
4. `lib/db/`가 보고서, 문항, 카테고리, 작업 상태를 저장한다. 정성 작업 API는
   `app/api/qualitative-jobs/[jobId]/run-next/route.ts`가 한 문항의 한 단계만 실행한다.
5. `lib/report/workspace.ts`가 장별 빌더를 연결한다. 정성 블록 HTML은
   `workspaceQualitative.ts`, 옛 통계 보정은 `workspaceCompatibility.ts`, 문항 순서는
   `workspaceQuestionOrder.ts`가 담당한다.
   `components/ReportStudio.tsx`와 `components/ReportWebDocument.tsx`가 조립된 블록을
   편집·표시한다.
6. 백그라운드 PDF·DOCX·HWPX 조립 경로는 `lib/report/assemblyData.ts`에서 같은 저장본을 읽는다.
   PDF·DOCX에 필요한 결과요약 생성·캐시는 `lib/report/assemblySummary.ts`가 담당한다.

## 변경할 때 지켜야 할 경계

- 원자료 파싱과 통계 산식은 보고서 렌더러에서 다시 구현하지 않는다.
- 정성 작업의 Stage1·Stage2 완료 상태와 후속 섹션 분석·제언 생성 상태는 분리한다.
  사용량 저장 실패도 완료된 분석의 재실행을 유발하지 않는다.
- 브라우저 초안 승격은 `lib/editor/workspaceDraft.ts`가 담당한다.
- `lib/pdf-rivalabs-v3/`와 `lib/pdf-carecl-v1/`는 원본 보고서 대조용 독립 렌더러다.
  각 디렉터리의 README가 명시한 격리 목적을 확인한 뒤 공통화 여부를 판단한다.
- `scripts/`는 앱 밖에서 실행하는 검사·생성 도구다. 배포 빌드는 `tsconfig.build.json`으로
  앱 코드를 검사하고, CI는 별도로 전체 저장소 TypeScript 코드를 검사한다.

## 회귀 검사

| 변경 영역 | 우선 실행할 명령 |
|---|---|
| 앱 코드 전반 | `npm run check:types`, `npm run lint`, `npm run build` |
| 원자료·정량 계산 | `npm run check:golden` |
| 설문 파일 | `npm run check:survey-xlsx` |
| 웹 작업공간 조립 | `npm run check:workspace-characterization`, `npm run check:workspace-plan` |
| HWPX 구조 | `npm run check:report-hwpx` |

`check:workspace-characterization`은 고정 출력 지문을 비교한다. 지문이 다를 때는 실제
출력 변경의 의도를 먼저 확인하고, 단지 검사를 통과시키기 위해 기대값을 갱신하지 않는다.
