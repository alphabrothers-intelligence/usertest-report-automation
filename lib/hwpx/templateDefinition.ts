/**
 * 보고서 HWPX 원본의 선택 규칙.
 *
 * 이 파일은 분석 파이프라인과 분리된 "출력 계약"이다. 정량·정성 분석을 다시 실행하거나
 * 값을 바꾸지 않고, 이미 저장된 결과를 어느 원본 양식에 배치할지 결정한다.
 *
 * 실제 파일명은 macOS/NFD 정규화가 섞여 있을 수 있으므로, 런타임에서는 한글 파일명을
 * 직접 조합하지 않고 아래의 식별 단어로 data 디렉터리에서 하나만 찾는다.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

export type HwpxTemplateId = "rivalabs-sw" | "carecl-physical" | "integrated";

export type HwpxTemplateDefinition = {
  id: HwpxTemplateId;
  label: string;
  /** templates/ 하위에 승인된 공양식이 배치되기 전까지 원본 data 파일을 식별하는 단어. */
  sourceNameIncludes: readonly string[];
  /** 원본 문서가 고정으로 제공하는 기능별 분석 반복 영역 수. */
  featureCapacity: number;
  /** 원본 자체의 문단·표·이미지·목차 구조를 복제해야 한다는 표시. */
  cloneSource: true;
};

export const HWPX_TEMPLATE_DEFINITIONS: Record<HwpxTemplateId, HwpxTemplateDefinition> = {
  "rivalabs-sw": {
    id: "rivalabs-sw",
    label: "SW 사용성 테스트 · 리바랩스 원본",
    sourceNameIncludes: ["리바랩스", "0904"],
    // DB의 리바랩스 검증본은 6개 기능을 가진다. 공양식(5개)을 사용하면 마지막 기능이 누락된다.
    featureCapacity: 6,
    cloneSource: true,
  },
  "carecl-physical": {
    id: "carecl-physical",
    label: "실제품 사용성 테스트 · 케어클 원본",
    sourceNameIncludes: ["케어클", "251028"],
    featureCapacity: 0,
    cloneSource: true,
  },
  "integrated": {
    id: "integrated",
    label: "통합 사용성 테스트 · 승인 대기 템플릿",
    // 통합 원본은 두 보고서를 HTML로 합치는 것이 아니라, 별도 승인 HWPX로 추가해야 한다.
    sourceNameIncludes: [],
    featureCapacity: 0,
    cloneSource: true,
  },
};

export function selectHwpxTemplate(productType: "sw" | "physical" | null | undefined): HwpxTemplateDefinition {
  return productType === "physical"
    ? HWPX_TEMPLATE_DEFINITIONS["carecl-physical"]
    : HWPX_TEMPLATE_DEFINITIONS["rivalabs-sw"];
}

/**
 * 원본과 같은 페이지 수를 유지하려면, 원본이 제공한 반복 영역 수를 초과해선 안 된다.
 * 0은 아직 케어클/통합 원본의 반복 영역 맵을 작성하지 않았다는 뜻이며 안전하게 차단한다.
 */
export function assertFeatureCapacity(template: HwpxTemplateDefinition, featureCount: number): void {
  if (template.featureCapacity === 0) {
    throw new Error(`${template.label}의 반복 영역 맵이 아직 준비되지 않았습니다.`);
  }
  if (featureCount > template.featureCapacity) {
    throw new Error(`${template.label}은 기능 ${template.featureCapacity}개까지만 원본 레이아웃을 보장합니다. 현재 결과는 ${featureCount}개입니다.`);
  }
}

/**
 * 개발·배포 환경에서 HWPX 원본의 유니코드 정규화(NFC/NFD)가 달라도 같은 파일을 찾는다.
 * 통합 템플릿은 승인된 별도 원본이 추가되기 전에는 의도적으로 해석하지 않는다.
 */
export async function resolveHwpxTemplatePath(template: HwpxTemplateDefinition): Promise<string> {
  if (template.sourceNameIncludes.length === 0) {
    throw new Error(`${template.label} 원본 HWPX가 아직 등록되지 않았습니다.`);
  }

  const dataDir = path.join(process.cwd(), "data");
  const required = template.sourceNameIncludes.map((value) => value.normalize("NFD"));
  const entries = await readdir(dataDir);
  const matches = entries.filter((entry) => {
    const normalized = entry.normalize("NFD");
    return normalized.endsWith(".hwpx") && required.every((word) => normalized.includes(word));
  });

  if (matches.length !== 1) {
    throw new Error(`${template.label} 원본을 하나로 찾지 못했습니다. 발견 수: ${matches.length}`);
  }
  return path.join(dataDir, matches[0]);
}
