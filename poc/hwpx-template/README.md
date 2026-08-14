# HWPX 원본 템플릿 로컬 POC

이 폴더는 서비스와 분리된 로컬 실험 공간이다. 기존 API, 웹뷰, 분석 파이프라인, DB 값은
수정하지 않는다. DB에서는 이미 생성된 정량·정성·제언 결과를 **읽기만** 하며, 원본 HWPX는
복사본에만 적용한다.

## 목표

1. 리바랩스(SW)·케어클(실제품) 원본 HWPX의 페이지·표·서식·이미지 프레임을 보존한다.
2. 기존 DB 분석 결과를 원본의 문단, 표 셀, 그래프 이미지 슬롯에 넣는다.
3. 공통 정성 모듈(도넛, 비율 표, 극성별 요약, 상세 분석)을 두 템플릿에 동일하게 사용한다.
4. 최종 HWPX를 PDF로 변환한 결과를 웹 미리보기의 기준으로 사용한다.

## 금지 사항

- `app/`, `components/`, `lib/pipeline/`의 서비스 경로를 이 POC 때문에 변경하지 않는다.
- Claude/정량 분석을 재실행하지 않는다.
- 원본 `data/*.hwpx` 파일을 직접 수정하지 않는다.
- 텍스트만 덮어써 원본 글꼴, 굵게, 밑줄, 문단 간격을 잃는 방식을 사용하지 않는다.

## 실행 흐름

```text
DB 저장 결과 (읽기 전용)
  → input/<report-id>.json
  → template-contract.json의 슬롯 매핑
  → output/<report-id>.hwpx
  → HWPX 검증 / page guard
  → Hancom PDF 변환
  → PDF 기반 웹 미리보기
```

## 검증 기준

- HWPX 스킬의 `validate.py`, `page_guard.py`, `content_guard.py` 통과
- 원본과 동일한 ZIP 부속 파일·스타일 정의·표 구조 보존
- 문단·표·그래프 값이 DB 입력과 일치
- PDF와 웹뷰가 동일한 최종 PDF를 표시
