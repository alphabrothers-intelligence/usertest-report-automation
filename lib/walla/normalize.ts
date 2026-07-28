// WALLA 표준 59컬럼 데이터 행을 내부 스키마(PRD 4장)로 정규화한다.
import { extractFeatureNames, extractUxQualityNames } from "./schema";

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

function asString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * XLSX의 사용 범위가 실제 응답보다 넓게 남는 경우가 있다. 리바랩스 원본은 100명 응답 뒤에
 * 첫 열(리크루팅 ID)만 남은 892개 행이 포함돼 있었다. 첫 열만 있는 행은 설문 응답이 아니므로
 * 공통 정규화 전에 제거한다. 반대로 2열 이후에 값이 하나라도 있으면 부분 응답으로 보존한다.
 */
export function filterWallaResponseRows(dataRows: unknown[][]): unknown[][] {
  return dataRows.filter((row) => row.slice(1).some((value) => asString(value) !== null));
}

/**
 * 18~23번(순위 응답) 컬럼의 항목명은 6/8/10/12/14/16번(기능 만족도) 헤더에서 추출한 짧은
 * 이름과 문구가 다르다(실측: "실시간 거점형" ↔ "실시간 위치 기반 거점형 콘텐츠"). 순위 응답값의
 * 모든 어절이 후보 기능명에 부분 문자열로 포함되면 같은 기능으로 정렬한다.
 */
function alignToFeatureName(raw: string, featureNames: string[]): string {
  if (featureNames.includes(raw)) return raw;

  let best: { name: string; tokenCount: number } | null = null;
  for (const name of featureNames) {
    const tokens = name.split(/\s+/).filter(Boolean);
    const allTokensPresent = tokens.every((token) => raw.includes(token));
    if (allTokensPresent && (!best || tokens.length > best.tokenCount)) {
      best = { name, tokenCount: tokens.length };
    }
  }
  return best?.name ?? raw;
}

/**
 * 6/8/10/12/14/16번 헤더에서 뽑은 기능명은 짧게 축약돼 있다(예: "실시간 거점형"). 그런데
 * 실제 발행 보고서는 18~23번(순위 응답) 컬럼에 응답자가 실제로 본 더 긴 설명형 문구
 * ("실시간 위치 기반 거점형 콘텐츠")를 차트·표 라벨로 쓴다(2026-07-21 실측 대조 — 사용자가
 * "항목 풀네임을 써달라"고 요청). 특정 기능 하나만 하드코딩해 늘리면 다른 프로젝트 raw
 * data에 안 맞으므로, 일반화된 규칙으로 푼다: 순위 응답 컬럼 전체를 훑어 각 짧은 기능명에
 * `alignToFeatureName`으로 매칭되는 원문 중 **가장 긴 것**을 그 기능의 정식 표시명으로
 * 채택한다(짧은 이름보다 긴 게 없으면 짧은 이름을 그대로 쓴다). 이 이름이 featureSatisfaction·
 * rank 등 하위 전체에서 쓰이는 유일한 기준명이 된다 — golden 체크 기대값도 이 긴 이름
 * 기준으로 맞춰야 한다.
 */
function resolveFeatureDisplayNames(shortNames: string[], dataRows: unknown[][]): string[] {
  const longest = new Map<string, string>(shortNames.map((n) => [n, n]));
  for (const row of dataRows) {
    for (const col of [18, 19, 20, 21, 22, 23]) {
      const raw = asString(row[col]);
      if (!raw) continue;
      const matched = alignToFeatureName(raw, shortNames);
      const current = longest.get(matched) ?? matched;
      if (raw.length > current.length) longest.set(matched, raw);
    }
  }
  return shortNames.map((n) => longest.get(n) ?? n);
}

export interface ScoreReason {
  score: number | null;
  reason: string | null;
}

export interface FeatureSatisfaction extends ScoreReason {
  name: string;
}

export interface UxQualityItem extends ScoreReason {
  name: string; // 헤더에서 추출한 실제 문항명(예: "조작 편의성") — extractUxQualityNames 참고
}

export interface UxQualityPair {
  usability: UxQualityItem; // 실용성N)
  fun: UxQualityItem; // 즐거움N)
}

export interface WallaRecord {
  respondentId: number; // 1-based, raw data 행 순서
  segment: string | null; // 리크루팅
  age: number | null;
  gender: string | null;
  os: string | null;
  avgWalkTime: string | null;
  walkFrequencyPerWeek: string | null;
  featureSatisfaction: FeatureSatisfaction[]; // 6개, 컬럼 순서
  rank: string[]; // 1위~6위 응답(항목명), 길이 6
  priorService: {
    hasExperience: boolean | null;
    usedServices: string | null;
    satisfaction: number | null;
    reason: string | null;
  };
  keyFactor: { choice: string | null; reason: string | null };
  values: {
    functional: ScoreReason;
    aesthetic: ScoreReason;
    economic: ScoreReason;
    social: ScoreReason;
  };
  uxQuality: UxQualityPair[]; // 4개 (실용성1~4 / 즐거움1~4 짝)
  overallSatisfaction: ScoreReason;
  nps: ScoreReason;
  improvementIdea: string | null;
}

function scoreReason(row: unknown[], scoreCol: number, reasonCol: number): ScoreReason {
  return { score: asNumber(row[scoreCol]), reason: asString(row[reasonCol]) };
}

export function normalizeWallaRows(
  headerRow: unknown[],
  dataRows: unknown[][],
): WallaRecord[] {
  const responseRows = filterWallaResponseRows(dataRows);
  const shortFeatureNames = extractFeatureNames(headerRow);
  const featureNames = resolveFeatureDisplayNames(shortFeatureNames, responseRows);
  const featureCols = [6, 8, 10, 12, 14, 16];
  const uxNames = extractUxQualityNames(headerRow);

  return responseRows.map((row, i): WallaRecord => {
    const hasExperienceRaw = asString(row[24]);
    return {
      respondentId: i + 1,
      segment: asString(row[0]),
      age: asNumber(row[1]),
      gender: asString(row[2]),
      os: asString(row[3]),
      avgWalkTime: asString(row[4]),
      walkFrequencyPerWeek: asString(row[5]),
      featureSatisfaction: featureCols.map((col, idx) => ({
        name: featureNames[idx],
        ...scoreReason(row, col, col + 1),
      })),
      rank: [18, 19, 20, 21, 22, 23].map((col) => {
        const raw = asString(row[col]);
        if (raw === null) return "";
        const shortMatch = alignToFeatureName(raw, shortFeatureNames);
        const idx = shortFeatureNames.indexOf(shortMatch);
        return idx >= 0 ? featureNames[idx] : shortMatch;
      }),
      priorService: {
        hasExperience:
          hasExperienceRaw === null ? null : /있|네|예/.test(hasExperienceRaw),
        usedServices: asString(row[25]),
        satisfaction: asNumber(row[26]),
        reason: asString(row[27]),
      },
      keyFactor: { choice: asString(row[28]), reason: asString(row[29]) },
      values: {
        functional: scoreReason(row, 30, 31),
        aesthetic: scoreReason(row, 32, 33),
        economic: scoreReason(row, 34, 35),
        social: scoreReason(row, 36, 37),
      },
      uxQuality: [
        {
          usability: { name: uxNames.usability[0], ...scoreReason(row, 38, 39) },
          fun: { name: uxNames.fun[0], ...scoreReason(row, 40, 41) },
        },
        {
          usability: { name: uxNames.usability[1], ...scoreReason(row, 42, 43) },
          fun: { name: uxNames.fun[1], ...scoreReason(row, 44, 45) },
        },
        {
          usability: { name: uxNames.usability[2], ...scoreReason(row, 46, 47) },
          fun: { name: uxNames.fun[2], ...scoreReason(row, 48, 49) },
        },
        {
          usability: { name: uxNames.usability[3], ...scoreReason(row, 50, 51) },
          fun: { name: uxNames.fun[3], ...scoreReason(row, 52, 53) },
        },
      ],
      overallSatisfaction: scoreReason(row, 54, 55),
      nps: scoreReason(row, 56, 57),
      improvementIdea: asString(row[58]),
    };
  });
}
