// PRD 5.0절 제품 정보 입력 스펙. 전체가 선택 입력이며, 채워지지 않은 필드는 PDF에서 "입력
// 필요"로 남는다(lib/pdf/sectionsQuant.tsx의 SectionOverview 참고) — AI가 임의로 추정해
// 채우지 않는다는 원칙(종합전략제언과 동일, PRD 7.3절).
//
// "주요 기능 목록"(기능명+설명+이미지 반복 리스트)은 이미지 첨부 흐름까지 포함해야 해서
// 범위에서 뺐다 — 알려진 갭으로 CLAUDE.md에 기록.
export interface ProductInfo {
  companyName?: string;
  homepage?: string;
  representative?: string;
  contactPerson?: string;
  serviceName?: string;
  serviceSummary?: string;
  businessArea?: string;
  industry?: string;
  operatingEnvironment?: string;
  businessStage?: string;
  // Ⅰ장 "2. 사용성 테스트 진행 일정" 용 (2026-07-20 추가) — 실제 보고서 양식에 맞춰 목차에
  // 소목차로 반영. 나머지 필드와 동일하게 전부 선택 입력이고, 건너뛰어도 나중에 다시 채울 수
  // 있다(제품/기업 정보 카드에 함께 노출).
  testPeriod?: string;
  testTarget?: string;
  testManager?: string;
  // Ⅰ장 "주요 기능" 표 칸(2026-07-22 추가) — 원본 3페이지의 기능 스크린샷+기능명·설명
  // 목록에 해당한다. 이미지 첨부 흐름이 없어 자동 추출은 안 되고(알려진 갭), 담당자가 채팅으로
  // 직접 작성해 넣는다. 안 채우면 PDF에 빈 칸으로 남아 나중에 편집해 넣을 수 있다.
  mainFeatures?: string;
  // 페이지 하단 푸터의 "{연도} by {브랜드명}" 문구(2026-07-21 추가) — 기본값은 "Alphabrothers"
  // (이 보고서를 만드는 에이전시 자신의 정체성, CLAUDE.md 참고). 사용자가 다른 회사명으로
  // 발행하고 싶으면("2026 by testipie로 바꿔줘") 이 필드로 채팅에서 바로 바꿀 수 있다.
  // 로고 이미지 자체(우측 워드마크 PNG)는 고정이다 — 커스텀 로고 이미지 업로드는 지원하지
  // 않는다(제품 정보에 이미지 첨부 흐름이 아직 없는 것과 같은 갭, CLAUDE.md 참고).
  footerBrandName?: string;
  // 표지 공통 템플릿용. coverDate가 비어 있으면 PDF 생성일을, coverLogoUrl이 비어 있으면
  // ALPHA BROTHERS 기본 로고를 사용한다. 로고는 업로드 파일의 공개 URL 또는 사용자가 제공한
  // 이미지 URL을 저장한다.
  coverDate?: string;
  coverLogoUrl?: string;
}

export const PRODUCT_INFO_FIELD_LABELS: Record<keyof ProductInfo, string> = {
  companyName: "기업명",
  homepage: "홈페이지",
  representative: "대표자",
  contactPerson: "업무담당자",
  serviceName: "서비스명",
  serviceSummary: "서비스 요약",
  businessArea: "사업영역",
  industry: "산업분야",
  operatingEnvironment: "운영환경",
  businessStage: "사업화단계",
  testPeriod: "테스트 진행 기간",
  testTarget: "테스트 대상",
  testManager: "담당자",
  mainFeatures: "주요 기능",
  footerBrandName: "보고서 하단 브랜드명(기본: Alphabrothers)",
  coverDate: "표지 발행일 (예: 2025.09.05)",
  coverLogoUrl: "표지 로고 이미지 URL (비우면 기본 로고 사용)",
};
