import { saveQualitativeJobUsage } from "@/lib/db/qualitativeJobs";
import type { ClaudeUsageRecord } from "@/lib/claudeUsage";

type UsagePhase = "stage1" | "stage2" | "section_analysis";

/** 사용량 기록 실패 때문에 이미 끝난 분석을 다시 실행하지 않는다. */
export async function recordQualitativeJobUsage(params: {
  jobId: string;
  itemId: string | null;
  phase: UsagePhase;
  usages: ClaudeUsageRecord[];
  errorLabel: string;
}): Promise<void> {
  const { jobId, itemId, phase, usages, errorLabel } = params;
  try {
    await Promise.all(usages.map((usage) => saveQualitativeJobUsage({ jobId, itemId, phase, usage })));
  } catch (error) {
    console.error(errorLabel, error);
  }
}
