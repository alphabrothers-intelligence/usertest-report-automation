/**
 * 실제 발행 보고서 PDF에서 "정답"을 읽어오는 공용 파서(부수 효과 없음).
 * `check:qualitative-fidelity`(저장된 결과 채점)와 `check:fast-polarity`(프롬프트 전후 비교)가
 * 같은 정답지를 봐야 하므로 한 곳에 둔다. `pdftotext`(poppler) 필요.
 */
import { execFileSync } from "node:child_process";

export type Polarity = "positive" | "negative" | "neutral";
export const POLARITY_BY_KR: Record<string, Polarity> = { 긍정: "positive", 부정: "negative", 중립: "neutral" };
export const KR_BY_POLARITY: Record<Polarity, string> = { positive: "긍정", negative: "부정", neutral: "중립" };

export const REPORT_PDF = "data/[알파브라더스] 리바랩스_사용성테스트_결과보고서_0904_상연.pdf";
/** Ⅲ장 기능별 정성 분석 + Ⅷ장 NPS·종합만족도 구간. Ⅴ장(32~35쪽)은 2단 조판이라 왼쪽 긍정과
 * 오른쪽 부정이 같은 줄에 섞여 나와 극성 귀속이 불가능해 제외한다. */
export const PAGE_RANGE = { from: 8, to: 26 };

export interface Label {
  page: number;
  polarity: Polarity;
  quote: string;
}

/** 원본이 문항마다 배너에 찍어둔 극성 비율("1. 긍정 의견 (28.7%)"). 응답 전수 기준이다. */
export interface OriginalShare {
  feature: string;
  polarity: Polarity;
  pct: number;
}

export function reportText(): string {
  return execFileSync("pdftotext", ["-f", String(PAGE_RANGE.from), "-l", String(PAGE_RANGE.to), "-layout", REPORT_PDF, "-"], {
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

export function extractOriginalShares(text: string): OriginalShare[] {
  const shares: OriginalShare[] = [];
  let feature: string | null = null;
  for (const line of text.split("\n")) {
    const question = line.match(/^\s*Q\d+\.\s*[‘'"]([^’'"]+)[’'"]/);
    if (question) feature = question[1].trim();
    const banner = line.match(/^\s*\d+\.\s*(긍정|부정|중립)\s*의견\s*\(([\d.]+)%\)/);
    if (banner && feature) {
      const polarity = POLARITY_BY_KR[banner[1]];
      if (!shares.some((share) => share.feature === feature && share.polarity === polarity)) {
        shares.push({ feature, polarity, pct: Number(banner[2]) });
      }
    }
  }
  return shares;
}

export function extractLabels(text: string): Label[] {
  const labels: Label[] = [];
  text.split("\f").forEach((page, index) => {
    const pageNumber = PAGE_RANGE.from + index;
    // 극성 배너로 페이지를 잘라, 배너 아래 구간의 인용문에만 그 극성을 붙인다.
    const segments = page.split(/^\s*\d+\.\s*(긍정|부정|중립)\s*의견/m);
    for (let i = 1; i < segments.length; i += 2) {
      const polarity = POLARITY_BY_KR[segments[i]];
      // 줄바꿈으로 끊긴 인용문을 잇기 위해 구간 전체의 공백을 한 칸으로 눌러 붙인다.
      const body = segments[i + 1]?.replace(/\s+/g, " ") ?? "";
      for (const match of body.matchAll(/[“"]([^”"]{10,})[”"]/g)) {
        const quote = match[1].trim();
        if (!quote.startsWith("→")) labels.push({ page: pageNumber, polarity, quote });
      }
    }
  });
  return labels;
}

/** 원본 Q제목의 기능명("실시간 거점형")과 우리 이름("실시간 위치 기반 거점형 콘텐츠")은 표기가
 * 달라 어절 포함 관계로 맞춘다(lib/walla/normalize.ts의 alignToFeatureName과 같은 원리). */
export function matchesFeature(feature: string, candidate: string): boolean {
  const name = candidate.replace(/^feature:/, "").replace(/^'|'$/g, "");
  return feature.split(/\s+/).filter(Boolean).every((word) => name.includes(word))
    || name.split(/\s+/).filter(Boolean).every((word) => feature.includes(word));
}
