import {
  completeQualitativeSectionAnalysisRun,
  failQualitativeSectionAnalysisRun,
  startQualitativeSectionAnalysisRun,
  type QualitativeJobRow,
  type QualitativeSectionAnalysisKey,
} from "@/lib/db/qualitativeJobs";
import {
  getQuestionsWithAllCategories,
  getReportById,
  saveReportResultSummary,
} from "@/lib/db/reports";
import { toClaudeUsageRecord, type ClaudeUsageRecord } from "@/lib/claudeUsage";
import { detectProductType } from "@/lib/report/productType";
import { runSectionAnalysesForReport } from "@/lib/pipeline/sectionAnalysis";
import { runResultSummary } from "@/lib/pipeline/summary";
import { runFeatureCustomerRecommendations } from "@/lib/pipeline/customerRecommendations";
import {
  runAllFeatureImprovementRecommendations,
  runDevPriorityRecommendation,
} from "@/lib/pipeline/recommendation";
import { runPolaritySummariesForReport } from "@/lib/pipeline/generatePolaritySummaries";
import { recordQualitativeJobUsage } from "@/lib/pipeline/qualitativeJobUsage";
import {
  saveCustomerRecommendations,
  saveFeatureImprovementRecommendations,
  saveStrategyRecommendations,
} from "@/lib/pipeline/recommendationPersistence";

export type SectionAnalysisStatus = {
  status: "skipped" | "completed" | "partial";
  completed?: string[];
  failed?: string[];
};

function requestedSections(report: Awaited<ReturnType<typeof getReportById>>): QualitativeSectionAnalysisKey[] {
  const base: QualitativeSectionAnalysisKey[] = report?.quant_stats
    && (report.product_type ?? detectProductType(report.quant_stats)) === "physical"
    ? ["corePurchaseFactor"]
    : ["featureExperience", "corePurchaseFactor", "fourValues", "fourValueItems", "uxQuality", "crossAnalysis"];
  // 경쟁재 표는 서술 응답이 있을 때만 필요하다.
  return report?.quant_stats?.demographics.priorServiceDetail?.responses?.length
    ? [...base, "competitorTable"]
    : base;
}

async function saveResultSummary(
  job: QualitativeJobRow,
  report: NonNullable<Awaited<ReturnType<typeof getReportById>>>,
  generated: Awaited<ReturnType<typeof runSectionAnalysesForReport>>,
): Promise<void> {
  if (!report.quant_stats) return;
  try {
    const qualitative = await getQuestionsWithAllCategories(job.report_id);
    const usages: ClaudeUsageRecord[] = [];
    const startedAt = Date.now();
    const summary = await runResultSummary({
      quantStats: report.quant_stats,
      qualitative,
      sectionAnalyses: generated,
      productType: report.product_type ?? detectProductType(report.quant_stats),
      onUsage: (usage) => usages.push(toClaudeUsageRecord("result-summary", usage, {
        elapsedMs: Date.now() - startedAt,
        attempt: 1,
      })),
    });
    await saveReportResultSummary(job.report_id, summary);
    await recordQualitativeJobUsage({
      jobId: job.id, itemId: null, phase: "section_analysis", usages,
      errorLabel: "[qualitative-job] 결과요약 사용량 저장 실패",
    });
  } catch (error) {
    console.error("[qualitative-job] Ⅸ.1 결과요약 자동 생성 실패", error);
  }
}

async function runSectionFollowup(job: QualitativeJobRow): Promise<SectionAnalysisStatus> {
  try {
    const report = await getReportById(job.report_id);
    const requested = requestedSections(report);
    const usages: ClaudeUsageRecord[] = [];
    const runIds = new Map<string, string>();
    const generated = await runSectionAnalysesForReport(job.report_id, {
      concurrency: 2,
      onUsage: (usage) => usages.push(usage),
      onSectionStart: async (key) => {
        const run = await startQualitativeSectionAnalysisRun({ jobId: job.id, reportId: job.report_id, sectionKey: key });
        runIds.set(key, run.id);
      },
      onSectionComplete: async (key) => {
        const runId = runIds.get(key);
        if (runId) await completeQualitativeSectionAnalysisRun(runId);
      },
      onSectionError: async (key, error) => {
        const runId = runIds.get(key);
        if (runId) await failQualitativeSectionAnalysisRun(runId, error instanceof Error ? error.message : String(error));
      },
    });
    await recordQualitativeJobUsage({
      jobId: job.id, itemId: null, phase: "section_analysis", usages,
      errorLabel: "[qualitative-job] 섹션 분석 사용량 저장 실패",
    });
    const completed = requested.filter((key) => Boolean(generated[key]));
    const failed = requested.filter((key) => !generated[key]);
    const status: SectionAnalysisStatus = { status: failed.length === 0 ? "completed" : "partial", completed, failed };
    // 결과요약 실패는 저장된 섹션 분석 상태를 되돌리지 않는다.
    if (report?.quant_stats) await saveResultSummary(job, report, generated);
    return status;
  } catch (error) {
    console.error("[qualitative-job] 섹션 분석 후속 단계 실패", error);
    return { status: "partial", completed: [], failed: ["section-analysis"] };
  }
}

async function runRecommendationFollowup(job: QualitativeJobRow): Promise<void> {
  try {
    const report = await getReportById(job.report_id);
    if (!report?.quant_stats) return;
    const qualitative = await getQuestionsWithAllCategories(job.report_id);
    const productType = report.product_type ?? detectProductType(report.quant_stats);
    const usages: ClaudeUsageRecord[] = [];

    // 각 제언은 독립적으로 저장한다. 하나가 실패해도 다른 생성 결과를 보존한다.
    const [priority, customer, improvements, polarity] = await Promise.allSettled([
      runDevPriorityRecommendation(report.quant_stats, qualitative, productType, (usage) => usages.push(usage)),
      runFeatureCustomerRecommendations(report.quant_stats, qualitative, (usage) => usages.push(usage)),
      runAllFeatureImprovementRecommendations(report.quant_stats, qualitative, (usage) => usages.push(usage)),
      runPolaritySummariesForReport(job.report_id, (usage) => usages.push(usage)),
    ]);

    if (priority.status === "fulfilled") {
      await saveStrategyRecommendations(job.report_id, priority.value);
    } else {
      console.error("[qualitative-job] Ⅸ.2 개발우선순위제언 생성 실패", priority.reason);
    }
    if (customer.status === "fulfilled") {
      await saveCustomerRecommendations(job.report_id, customer.value);
    } else {
      console.error("[qualitative-job] Ⅸ.3 기능별 고객 제언 종합 생성 실패", customer.reason);
    }
    if (improvements.status === "fulfilled") {
      await saveFeatureImprovementRecommendations(job.report_id, improvements.value);
    } else {
      console.error("[qualitative-job] Ⅸ.2 기능 개선 제안 자동 생성 실패", improvements.reason);
    }
    // 극성 요약은 생성 함수가 직접 저장한다.
    if (polarity.status === "fulfilled") {
      console.info("[qualitative-job] 응답 요약 자동 생성 완료", polarity.value);
    } else {
      console.error("[qualitative-job] 응답 요약 자동 생성 실패", polarity.reason);
    }
    await recordQualitativeJobUsage({
      jobId: job.id, itemId: null, phase: "section_analysis", usages,
      errorLabel: "[qualitative-job] Ⅸ.2/Ⅸ.3 사용량 저장 실패",
    });
  } catch (error) {
    console.error("[qualitative-job] Ⅸ.2/Ⅸ.3 자동 생성 실패", error);
  }
}

/** 마지막 Stage2가 끝났을 때만 실행한다. 후속 작업 오류는 문항 완료 상태에 영향을 주지 않는다. */
export async function runCompletedJobFollowups(job: QualitativeJobRow): Promise<SectionAnalysisStatus> {
  const sectionAnalyses = await runSectionFollowup(job);
  await runRecommendationFollowup(job);
  return sectionAnalyses;
}
