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
import { getReportById, getQuestionsWithAllCategories, saveQualitativeQuestionResult, saveRecommendation } from "@/lib/db/reports";
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
import { runDevPriorityRecommendation, runAllFeatureImprovementRecommendations } from "@/lib/pipeline/recommendation";
import { runFeatureCustomerRecommendations } from "@/lib/pipeline/customerRecommendations";
import { runPolaritySummariesForReport } from "@/lib/pipeline/generatePolaritySummaries";
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
        throw new Error(
          loaded.fetchError ?? "원본 파일을 다시 읽지 못했습니다. 파일을 다시 첨부한 뒤 재시도해주세요.",
        );
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
        const requested = report?.quant_stats && (report.product_type ?? detectProductType(report.quant_stats)) === "physical"
          ? ["corePurchaseFactor"] as const
          : ["featureExperience", "corePurchaseFactor", "fourValues", "fourValueItems", "uxQuality", "crossAnalysis"] as const;
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

      // Ⅸ.2 개선 전략 제언 · Ⅸ.3 기능별 고객 제언 종합 — 둘 다 이미 저장된 정량+정성 결과만
      // 재료로 쓰므로(2026-07-30 신규), 위 섹션 분석과 마찬가지로 실패해도 Stage1·Stage2 상태를
      // 되돌리지 않도록 별도로 격리한다. 체크포인트 B 대상②라 초안 상태로 저장될 뿐, 승인 전엔
      // 최종 문서에 반영되지 않는다(assembleReport의 게이트가 그대로 지킨다).
      try {
        const report = await getReportById(job.report_id);
        if (report?.quant_stats) {
          const qualitative = await getQuestionsWithAllCategories(job.report_id);
          const productType = report.product_type ?? detectProductType(report.quant_stats);
          const recUsages: ClaudeUsageRecord[] = [];

          // Promise.all은 한쪽이 스키마 검증 실패 등으로 reject하면 이미 성공해 비용을 지불한
          // 다른 쪽 결과까지 버린다(2026-07-30 실측 — Ⅸ.3 스키마 실패로 Ⅸ.2가 저장 전에 유실됨).
          // allSettled로 서로 독립적으로 저장해, 한쪽이 실패해도 다른 쪽 결과는 지킨다.
          // 2026-08-03: "기능 개선 제안"(feature_improvement:*)도 여기서 같이 자동 생성한다 —
          // 예전엔 사용자가 채팅에서 기능마다 개별 요청해야만 채워졌는데, 원본 보고서는 이
          // 항목이 항상 채워져 있어야 한다(담당자 요청). runAllFeatureImprovementRecommendations는
          // 내부적으로 기능별 allSettled를 이미 하므로 절대 reject하지 않는다.
          // 2026-08-04: "응답 요약"(긍정/부정/중립 총평, 극성 요약)도 같은 배치에 추가했다 —
          // 문항당 1회 호출로 줄어든 뒤(예전엔 최대 3회) 실측 시간·비용이 안전한 수준으로
          // 확인돼(13문항·동시성2 기준 약 80초·$0.14) 자동화했다(lib/pipeline/
          // generatePolaritySummaries.ts 상단 주석 참고). runPolaritySummariesForReport는
          // 문항별 try/catch로 이미 격리돼 있어 이 배열 안에서도 절대 reject하지 않는다.
          const [devPriorityResult, featureCustomerResult, featureImprovementResults, polaritySummaryResult] = await Promise.allSettled([
            runDevPriorityRecommendation(report.quant_stats, qualitative, productType, (u) => recUsages.push(u)),
            runFeatureCustomerRecommendations(report.quant_stats, qualitative, (u) => recUsages.push(u)),
            runAllFeatureImprovementRecommendations(report.quant_stats, qualitative, (u) => recUsages.push(u)),
            runPolaritySummariesForReport(job.report_id, (u) => recUsages.push(u)),
          ]);

          if (devPriorityResult.status === "fulfilled") {
            await saveRecommendation({ reportId: job.report_id, section: "dev_priority", draft: devPriorityResult.value });
          } else {
            console.error("[qualitative-job] Ⅸ.2 개발우선순위제언 생성 실패", devPriorityResult.reason);
          }
          if (featureCustomerResult.status === "fulfilled") {
            await saveRecommendation({
              reportId: job.report_id,
              section: "feature_customer_recommendations",
              draft: JSON.stringify(featureCustomerResult.value),
            });
          } else {
            console.error("[qualitative-job] Ⅸ.3 기능별 고객 제언 종합 생성 실패", featureCustomerResult.reason);
          }
          if (featureImprovementResults.status === "fulfilled") {
            await Promise.all(featureImprovementResults.value.map(({ featureName, draft }) =>
              saveRecommendation({ reportId: job.report_id, section: `feature_improvement:${featureName}`, draft }),
            ));
          } else {
            console.error("[qualitative-job] Ⅸ.2 기능 개선 제안 자동 생성 실패", featureImprovementResults.reason);
          }
          // runPolaritySummariesForReport는 문항별로 saveQuestionPolaritySummaries를 내부에서
          // 직접 호출하므로(위 세 항목과 달리 draft 저장을 여기서 또 할 필요 없음), 여기서는
          // 결과 로그만 남긴다.
          if (polaritySummaryResult.status === "fulfilled") {
            console.info("[qualitative-job] 응답 요약 자동 생성 완료", polaritySummaryResult.value);
          } else {
            console.error("[qualitative-job] 응답 요약 자동 생성 실패", polaritySummaryResult.reason);
          }

          try {
            await Promise.all(recUsages.map((usage) => saveQualitativeJobUsage({
              jobId,
              itemId: null,
              phase: "section_analysis",
              usage,
            })));
          } catch (usageError) {
            console.error("[qualitative-job] Ⅸ.2/Ⅸ.3 사용량 저장 실패", usageError);
          }
        }
      } catch (recommendationError) {
        console.error("[qualitative-job] Ⅸ.2/Ⅸ.3 자동 생성 실패", recommendationError);
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
