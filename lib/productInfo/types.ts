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
};
