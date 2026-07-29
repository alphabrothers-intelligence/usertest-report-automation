import { NextResponse } from "next/server";
import {
  claimNextQualitativeJobItem,
  completeQualitativeJobItem,
  completeQualitativeJobStage1,
  failQualitativeJobItem,
  getQualitativeJob,
  startQualitativeSectionAnalysisRun,
  completeQualitativeSectionAnalysisRun,
  failQualitativeSectionAnalysisRun,
  saveQualitativeJobUsage,
} from "@/lib/db/qualitativeJobs";
import { getReportById, saveQualitativeQuestionResult } from "@/lib/db/reports";
import { detectProductType } from "@/lib/report/productType";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { buildQuestionSpecs } from "@/lib/pipeline/questions";
import {
  runQualitativeStage1,
  runQualitativeStage2,
  type QualitativeStage1Checkpoint,
} from "@/lib/pipeline/orchestrate";
import { runSectionAnalysesForReport } from "@/lib/pipeline/sectionAnalysis";
import type { ClaudeUsageRecord } from "@/lib/claudeUsage";

// 한 호출은 Stage1 또는 Stage2 하나만 처리한다. Vercel의 요청 제한보다 작은 작업 단위다.
export const maxDuration = 300;

export async function POST(_request: Request, context: RouteContext<"/api/qualitative-jobs/[jobId]/run-next">) {
  const { jobId } = await context.params;
  const job = await getQualitativeJob(jobId);
  if (!job) return NextResponse.json({ error: "정성 분석 작업을 찾을 수 없습니다." }, { status: 404 });
  if (["completed", "completed_with_failures", "failed", "cancelled"].includes(job.status)) {
    return NextResponse.json({ job, message: "더 처리할 문항이 없습니다." });
  }

  const item = await claimNextQualitativeJobItem(jobId);
  if (!item) return NextResponse.json({ job, message: "현재 처리할 문항이 없습니다. 다른 작업자가 처리 중일 수 있습니다." });

  try {
    if (item.phase === "stage1") {
      const loaded = await loadWallaFromUrl(job.file_url);
      if (!loaded.ok || !loaded.parsed || !loaded.validation?.valid) {
        throw new Error(loaded.fetchError ?? "WALLA raw data를 다시 읽지 못했습니다.");
      }
      const records = normalizeWallaRows(loaded.parsed.headerRow, loaded.parsed.dataRows);
      const spec = buildQuestionSpecs(records).find((candidate) => candidate.id === item.question_key);
      if (!spec) throw new Error(`원본 raw data에서 ${item.question_key} 문항을 찾지 못했습니다.`);
      const usages: ClaudeUsageRecord[] = [];
      const checkpoint = await runQualitativeStage1(spec, { onUsage: (usage) => usages.push(usage) });
      // 사용량 저장 실패가 이미 성공한 분석 결과를 다시 API 호출하게 만들어서는 안 된다.
      // 따라서 로그만 남기고, 정성 결과 완료 자체는 보장한다.
      try {
        await Promise.all(usages.map((usage) => saveQualitativeJobUsage({
          jobId,
          itemId: item.id,
          phase: "stage1",
          usage,
        })));
      } catch (usageError) {
        console.error("[qualitative-job] Stage1 사용량 저장 실패", usageError);
      }
      await completeQualitativeJobStage1(item.id, checkpoint);
      return NextResponse.json({ ok: true, item: { id: item.id, questionKey: item.question_key, phase: "stage1", nextPhase: "stage2" } });
    }

    if (!item.checkpoint) throw new Error("Stage2 실행에 필요한 Stage1 체크포인트가 없습니다.");
    const result = await runQualitativeStage2(item.checkpoint as QualitativeStage1Checkpoint);
    await saveQualitativeQuestionResult(job.report_id, result);
    await completeQualitativeJobItem(item.id);

    // 새 4개 섹션 분석은 정성 분석의 별도 기능이 아니라, 모든 문항 분석이 정상 저장된 뒤
    // 이어지는 최종 결과 해석 단계다. 다만 기존 Stage1·Stage2 실패 결과를 덮거나, 실패
    // 작업에 추가 비용을 발생시키지 않도록 작업 전체가 `completed`일 때만 실행한다.
    // 한 작업의 마지막 Stage2만 이 조건을 만족하므로 중복 실행되지 않는다.
    const completedJob = await getQualitativeJob(jobId);
    let sectionAnalyses: { status: "skipped" | "completed" | "partial"; completed?: string[]; failed?: string[] } = {
      status: "skipped",
    };
    if (completedJob?.status === "completed") {
      // 이 후속 단계 실패는 이미 성공한 문항별 Stage1·Stage2 상태를 실패로 되돌리면 안 된다.
      // 따라서 별도로 격리해 응답 메타데이터에만 남기고, 필요 시 이 단계만 재실행할 수 있게 한다.
      try {
        const report = await getReportById(job.report_id);
        const requested = report?.quant_stats && detectProductType(report.quant_stats) === "physical"
          ? ["corePurchaseFactor"] as const
          : ["featureExperience", "corePurchaseFactor", "fourValues", "uxQuality"] as const;
        const sectionUsages: ClaudeUsageRecord[] = [];
        const sectionRunIds = new Map<string, string>();
        const generated = await runSectionAnalysesForReport(job.report_id, {
          concurrency: 2,
          onUsage: (usage) => sectionUsages.push(usage),
          // 내부 운영 이력: 사용자에게는 별도 카드/단계를 보이지 않지만, 4개 분석 각각의
          // 시작·성공·실패와 소요 시간을 남겨 재현성 및 성능을 판단한다.
          onSectionStart: async (key) => {
            const run = await startQualitativeSectionAnalysisRun({
              jobId,
              reportId: job.report_id,
              sectionKey: key,
            });
            sectionRunIds.set(key, run.id);
          },
          onSectionComplete: async (key) => {
            const runId = sectionRunIds.get(key);
            if (runId) await completeQualitativeSectionAnalysisRun(runId);
          },
          onSectionError: async (key, error) => {
            const runId = sectionRunIds.get(key);
            if (runId) await failQualitativeSectionAnalysisRun(
              runId,
              error instanceof Error ? error.message : String(error),
            );
          },
        });
        try {
          await Promise.all(sectionUsages.map((usage) => saveQualitativeJobUsage({
            jobId,
            itemId: null,
            phase: "section_analysis",
            usage,
          })));
        } catch (usageError) {
          console.error("[qualitative-job] 섹션 분석 사용량 저장 실패", usageError);
        }
        const completed = requested.filter((key) => Boolean(generated[key]));
        const failed = requested.filter((key) => !generated[key]);
        sectionAnalyses = { status: failed.length === 0 ? "completed" : "partial", completed, failed };
      } catch (sectionError) {
        console.error("[qualitative-job] 섹션 분석 후속 단계 실패", sectionError);
        sectionAnalyses = { status: "partial", completed: [], failed: ["section-analysis"] };
      }
    }

    return NextResponse.json({
      ok: true,
      item: { id: item.id, questionKey: item.question_key, phase: "stage2", completed: true },
      sectionAnalyses,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failQualitativeJobItem(item.id, message);
    return NextResponse.json({ ok: false, item: { id: item.id, questionKey: item.question_key, phase: item.phase }, error: message }, { status: 500 });
  }
}
