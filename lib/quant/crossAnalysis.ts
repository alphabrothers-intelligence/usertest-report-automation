// Ⅶ 교차분석 (연령대별·성별 기능/4대가치 만족도 차이). LLM 미사용, 규칙 기반(4.1절 원칙).
// 연령대 구간(10대/20대/30대/40대 이상)은 실제 발행 보고서와 대조해 확정했다
// (리바랩스 골든셋 기준 17/35/38/10명 정확히 일치, CLAUDE.md 참고).
import type { WallaRecord } from "@/lib/walla/normalize";
import { meanSd } from "./basic";

export type AgeGroup = "10대" | "20대" | "30대" | "40대 이상";

function ageGroupOf(age: number): AgeGroup {
  if (age < 20) return "10대";
  if (age < 30) return "20대";
  if (age < 40) return "30대";
  return "40대 이상";
}

export interface CrossAnalysisGroup {
  group: string;
  n: number;
  featureSatisfaction: { name: string; mean: number }[];
  fourValues: {
    functional: number;
    aesthetic: number;
    economic: number;
    social: number;
  };
  uxQuality: {
    usability: { name: string; mean: number }[];
    fun: { name: string; mean: number }[];
  };
}

export interface CrossAnalysis {
  byAgeGroup: CrossAnalysisGroup[];
  byGender: CrossAnalysisGroup[];
}

function scores(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null);
}

const UX_INDICES = [0, 1, 2, 3] as const;

function summarizeGroup(group: string, members: WallaRecord[]): CrossAnalysisGroup {
  const featureNames = members[0]?.featureSatisfaction.map((f) => f.name) ?? [];
  return {
    group,
    n: members.length,
    featureSatisfaction: featureNames.map((name, idx) => ({
      name,
      mean: meanSd(scores(members.map((m) => m.featureSatisfaction[idx]?.score ?? null))).mean,
    })),
    fourValues: {
      functional: meanSd(scores(members.map((m) => m.values.functional.score))).mean,
      aesthetic: meanSd(scores(members.map((m) => m.values.aesthetic.score))).mean,
      economic: meanSd(scores(members.map((m) => m.values.economic.score))).mean,
      social: meanSd(scores(members.map((m) => m.values.social.score))).mean,
    },
    uxQuality: {
      usability: UX_INDICES.map((idx) => ({
        name: members[0]?.uxQuality[idx]?.usability.name ?? `실용성${idx + 1}`,
        mean: meanSd(scores(members.map((m) => m.uxQuality[idx]?.usability.score ?? null))).mean,
      })),
      fun: UX_INDICES.map((idx) => ({
        name: members[0]?.uxQuality[idx]?.fun.name ?? `즐거움${idx + 1}`,
        mean: meanSd(scores(members.map((m) => m.uxQuality[idx]?.fun.score ?? null))).mean,
      })),
    },
  };
}

export function computeCrossAnalysis(records: WallaRecord[]): CrossAnalysis {
  const ageGroups: AgeGroup[] = ["10대", "20대", "30대", "40대 이상"];
  const byAgeGroup = ageGroups
    .map((group) => summarizeGroup(group, records.filter((r) => r.age !== null && ageGroupOf(r.age) === group)))
    .filter((g) => g.n > 0);

  const genders = [...new Set(records.map((r) => r.gender).filter((g): g is string => g !== null))];
  const byGender = genders.map((gender) => summarizeGroup(gender, records.filter((r) => r.gender === gender)));

  return { byAgeGroup, byGender };
}
