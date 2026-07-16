// WALLA 표준 59컬럼 데이터 행을 내부 스키마(PRD 4장)로 정규화한다.
import { extractFeatureNames } from "./schema";

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

export interface ScoreReason {
  score: number | null;
  reason: string | null;
}

export interface FeatureSatisfaction extends ScoreReason {
  name: string;
}

export interface UxQualityPair {
  usability: ScoreReason; // 실용성N)
  fun: ScoreReason; // 즐거움N)
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
  const featureNames = extractFeatureNames(headerRow);
  const featureCols = [6, 8, 10, 12, 14, 16];

  return dataRows.map((row, i): WallaRecord => {
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
        return raw === null ? "" : alignToFeatureName(raw, featureNames);
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
        { usability: scoreReason(row, 38, 39), fun: scoreReason(row, 40, 41) },
        { usability: scoreReason(row, 42, 43), fun: scoreReason(row, 44, 45) },
        { usability: scoreReason(row, 46, 47), fun: scoreReason(row, 48, 49) },
        { usability: scoreReason(row, 50, 51), fun: scoreReason(row, 52, 53) },
      ],
      overallSatisfaction: scoreReason(row, 54, 55),
      nps: scoreReason(row, 56, 57),
      improvementIdea: asString(row[58]),
    };
  });
}
