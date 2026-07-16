"use client";

import { useChat } from "@ai-sdk/react";
import { useState } from "react";
import { FileUploadButton, type UploadedFile } from "@/components/FileUploadButton";
import { AttachHintBubble } from "@/components/AttachHintBubble";
import type { QuantStats } from "@/lib/quant/compute";
import type { PipelineResult, QuestionResult } from "@/lib/pipeline/orchestrate";
import { PolarityReview, type PolarityReviewItem } from "@/components/PolarityReview";
import { InsightEditor, type InsightReviewItem } from "@/components/InsightEditor";
import {
  RecommendationReview,
  type RecommendationReviewItem,
  type HedgeViolation,
} from "@/components/RecommendationReview";

interface ValidateInputOutput {
  fileName: string | null;
  valid: boolean;
  error?: string;
  expectedColumnCount?: number;
  actualColumnCount?: number;
  respondentCount?: number;
  featureNames?: string[];
  errors?: { index: number; expected: string; actual: string }[];
}

function ValidateInputCard({
  state,
  output,
}: {
  state: string;
  output?: ValidateInputOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        raw data 검증 중...
      </div>
    );
  }

  if (!output || output.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "검증 중 오류가 발생했습니다."}
      </div>
    );
  }

  if (!output.valid) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        <p className="font-medium">
          WALLA 표준 59컬럼 스키마와 일치하지 않습니다 (컬럼 {output.actualColumnCount}
          /{output.expectedColumnCount}).
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {output.errors?.map((e) => (
            <li key={e.index}>
              {e.index === -1
                ? e.expected
                : `${e.index}번 컬럼: "${e.expected}" 예상 → "${e.actual}" 발견`}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
      <p className="font-medium">
        {output.fileName ?? "raw data"} 파일을 정상적으로 받았습니다.
      </p>
      <p className="mt-1">
        응답자 {output.respondentCount}명 · 59컬럼 스키마 일치
      </p>
      {output.featureNames && output.featureNames.length > 0 && (
        <p className="mt-1">기능: {output.featureNames.join(", ")}</p>
      )}
    </div>
  );
}

interface ComputeQuantStatsOutput {
  ok: boolean;
  error?: string;
  stats?: QuantStats;
}

function QuantStatsCard({
  state,
  output,
}: {
  state: string;
  output?: ComputeQuantStatsOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        정량 통계 계산 중...
      </div>
    );
  }

  if (!output?.ok || !output.stats) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "정량 통계 계산 중 오류가 발생했습니다."}
      </div>
    );
  }

  const s = output.stats;
  const rankedImportance = [...s.relativeImportance].sort((a, b) => b.score - a.score);

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <p className="font-medium">정량 통계 계산 완료 (응답자 {s.respondentCount}명)</p>

      <p className="mt-3 font-medium">기능별 만족도</p>
      <ul className="mt-1 space-y-0.5">
        {s.featureSatisfaction.map((f) => (
          <li key={f.name}>
            {f.name}: {f.mean}점 (SD {f.sd})
          </li>
        ))}
      </ul>

      <p className="mt-3 font-medium">핵심구매요소 상대중요도 (높은 순)</p>
      <ul className="mt-1 space-y-0.5">
        {rankedImportance.map((r) => (
          <li key={r.name}>
            {r.name}: {r.score}
          </li>
        ))}
      </ul>

      <p className="mt-3 font-medium">4대가치 만족도</p>
      <ul className="mt-1 space-y-0.5">
        <li>기능적: {s.fourValues.functional.mean}점</li>
        <li>심미적: {s.fourValues.aesthetic.mean}점</li>
        <li>경제적: {s.fourValues.economic.mean}점</li>
        <li>사회·공공적: {s.fourValues.social.mean}점</li>
      </ul>

      <p className="mt-3 font-medium">종합만족도 · NPS</p>
      <ul className="mt-1 space-y-0.5">
        <li>전반적 만족도: {s.overallSatisfaction.mean}점 (SD {s.overallSatisfaction.sd})</li>
        <li>
          NPS: {s.nps.npsScore} (추천 {s.nps.promoterPct}% · 중립 {s.nps.passivePct}% · 비추천{" "}
          {s.nps.detractorPct}%)
        </li>
      </ul>
    </div>
  );
}

interface RunQualitativeAnalysisOutput extends Partial<PipelineResult> {
  ok: boolean;
  error?: string;
}

function QuestionResultBlock({ q }: { q: QuestionResult }) {
  if (q.kind === "improvement") {
    return (
      <div className="mt-2">
        <p className="font-medium">{q.label}</p>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {q.stage2.categories.map((c) => (
            <li key={c.label}>
              [{c.label}] ({c.clause_count}건) → {c.insight}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const lowConfidenceCount = q.clauses.filter((c) => c.confidence === "low").length;
  const polarityOrder = ["positive", "negative", "neutral"] as const;
  const polarityLabel = { positive: "긍정", negative: "부정", neutral: "중립" };

  return (
    <div className="mt-2">
      <p className="font-medium">
        {q.label}
        {lowConfidenceCount > 0 && (
          <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">
            검수 필요 {lowConfidenceCount}건
          </span>
        )}
      </p>
      {polarityOrder.map((polarity) => {
        const stage2 = q.stage2ByPolarity[polarity];
        if (!stage2) return null;
        return (
          <div key={polarity} className="mt-1">
            <p className="text-xs text-zinc-500">{polarityLabel[polarity]}</p>
            <ul className="list-disc space-y-1 pl-5">
              {stage2.categories.map((c) => (
                <li key={c.label}>
                  [{c.label}] ({c.clause_count}건) → {c.insight}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function QualitativeAnalysisCard({
  state,
  output,
}: {
  state: string;
  output?: RunQualitativeAnalysisOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        정성 응답 분석 중... (14개 문항 병렬 처리, 1~2분 정도 걸릴 수 있어요)
      </div>
    );
  }

  if (!output?.ok || !output.questions) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "정성 응답 분석 중 오류가 발생했습니다."}
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <p className="font-medium">
        정성 응답 분석 완료 (14개 문항, {((output.elapsedMs ?? 0) / 1000).toFixed(1)}초)
      </p>
      <p className="mt-1 text-xs text-zinc-500">
        아래 인사이트는 AI 초안입니다 — 담당자 검수 전이며, 최종 보고서에는 검수 후에만 반영됩니다.
      </p>
      {output.questions.map((q) => (
        <QuestionResultBlock key={q.id} q={q} />
      ))}
    </div>
  );
}

interface PolarityReviewQueueOutput {
  ok: boolean;
  error?: string;
  items?: PolarityReviewItem[];
}

function PolarityReviewQueueCard({
  state,
  output,
}: {
  state: string;
  output?: PolarityReviewQueueOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        체크포인트 A 항목 조회 중...
      </div>
    );
  }
  if (!output?.ok || !output.items) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "체크포인트 A 조회 중 오류가 발생했습니다."}
      </div>
    );
  }
  return <PolarityReview items={output.items} />;
}

interface InsightReviewQueueOutput {
  ok: boolean;
  error?: string;
  items?: InsightReviewItem[];
}

function InsightReviewQueueCard({
  state,
  output,
}: {
  state: string;
  output?: InsightReviewQueueOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        체크포인트 B 항목 조회 중...
      </div>
    );
  }
  if (!output?.ok || !output.items) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "체크포인트 B 조회 중 오류가 발생했습니다."}
      </div>
    );
  }
  return <InsightEditor items={output.items} />;
}

interface ResultSummaryOutput {
  ok: boolean;
  error?: string;
  summary?: string;
}

function ResultSummaryCard({ state, output }: { state: string; output?: ResultSummaryOutput }) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        결과요약 생성 중...
      </div>
    );
  }
  if (!output?.ok || !output.summary) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "결과요약 생성 중 오류가 발생했습니다."}
      </div>
    );
  }
  return (
    <div className="w-full whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <p className="font-medium">사용성테스트 결과 요약</p>
      <p className="mt-2">{output.summary}</p>
    </div>
  );
}

interface RecommendationDraftOutput {
  ok: boolean;
  error?: string;
  section?: string;
  draft?: string;
  hedgeViolations?: HedgeViolation[];
}

function RecommendationDraftCard({
  state,
  output,
}: {
  state: string;
  output?: RecommendationDraftOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        제언 생성 중...
      </div>
    );
  }
  if (!output?.ok || !output.draft) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "제언 생성 중 오류가 발생했습니다."}
      </div>
    );
  }
  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <p className="font-medium">제언 초안 ({output.section}) — 검수 대기 중</p>
      {output.hedgeViolations && output.hedgeViolations.length > 0 && (
        <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {output.hedgeViolations.map((v) => (
            <p key={v.detail}>⚠ {v.detail}</p>
          ))}
        </div>
      )}
      <p className="mt-2 whitespace-pre-wrap">{output.draft}</p>
    </div>
  );
}

interface RecommendationReviewQueueOutput {
  ok: boolean;
  error?: string;
  items?: RecommendationReviewItem[];
}

function RecommendationReviewQueueCard({
  state,
  output,
}: {
  state: string;
  output?: RecommendationReviewQueueOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        제언 검수 항목 조회 중...
      </div>
    );
  }
  if (!output?.ok || !output.items) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "제언 검수 항목 조회 중 오류가 발생했습니다."}
      </div>
    );
  }
  return <RecommendationReview items={output.items} />;
}

interface SaveStrategicInputOutput {
  ok: boolean;
  error?: string;
}

function SaveStrategicInputCard({
  state,
  output,
}: {
  state: string;
  output?: SaveStrategicInputOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        저장 중...
      </div>
    );
  }
  if (!output?.ok) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "저장 중 오류가 발생했습니다."}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
      종합 전략 제언 내용을 저장했습니다.
    </div>
  );
}

interface AssembleReportOutput {
  ok: boolean;
  error?: string;
  pendingInsightCount?: number;
  pendingRecommendationCount?: number;
  pdfUrl?: string;
}

function AssembleReportCard({ state, output }: { state: string; output?: AssembleReportOutput }) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        최종 보고서 PDF 조립 중...
      </div>
    );
  }
  if (!output?.ok || !output.pdfUrl) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "PDF 조립 중 오류가 발생했습니다."}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
      <p className="font-medium">최종 보고서 PDF가 완성됐습니다.</p>
      <a
        href={output.pdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block rounded-full bg-emerald-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
      >
        PDF 다운로드
      </a>
    </div>
  );
}

export default function Chat() {
  const [input, setInput] = useState("");
  const [showAttachHint, setShowAttachHint] = useState(true);
  const { messages, sendMessage, status } = useChat();

  function handleUploaded(file: UploadedFile) {
    setShowAttachHint(false);
    sendMessage({
      text: `[업로드된 파일]\n파일명: ${file.name}\nURL: ${file.url}\n\n이 raw data 파일을 검증해줘.`,
    });
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 dark:bg-black">
      <div className="flex w-full max-w-2xl flex-1 flex-col px-4 py-8">
        <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          사용성테스트 결과보고서 자동생성
        </h1>

        <div className="flex flex-1 flex-col gap-4 pb-32">
          {messages.length === 0 && (
            <p className="text-sm text-zinc-500">
              raw data(xlsx)를 첨부하거나 메시지를 보내 대화를 시작하세요.
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={`whitespace-pre-wrap text-sm ${
                message.role === "user"
                  ? "self-end rounded-2xl bg-zinc-900 px-4 py-2 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                  : "self-start text-zinc-900 dark:text-zinc-100"
              } max-w-full`}
            >
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  return <div key={i}>{part.text}</div>;
                }
                if (part.type === "tool-validateInput") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-md">
                      <ValidateInputCard
                        state={part.state}
                        output={part.output as ValidateInputOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-computeQuantStats") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-md">
                      <QuantStatsCard
                        state={part.state}
                        output={part.output as ComputeQuantStatsOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-runQualitativeAnalysis") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-md">
                      <QualitativeAnalysisCard
                        state={part.state}
                        output={part.output as RunQualitativeAnalysisOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-getPolarityReviewQueue") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-md">
                      <PolarityReviewQueueCard
                        state={part.state}
                        output={part.output as PolarityReviewQueueOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-getInsightReviewQueue") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-md">
                      <InsightReviewQueueCard
                        state={part.state}
                        output={part.output as InsightReviewQueueOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-generateResultSummary") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-md">
                      <ResultSummaryCard
                        state={part.state}
                        output={part.output as ResultSummaryOutput | undefined}
                      />
                    </div>
                  );
                }
                if (
                  part.type === "tool-generateRecommendation" ||
                  part.type === "tool-generateFeatureRecommendation"
                ) {
                  return (
                    <div key={i} className="mt-2 w-full max-w-md">
                      <RecommendationDraftCard
                        state={part.state}
                        output={part.output as RecommendationDraftOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-getRecommendationReviewQueue") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-md">
                      <RecommendationReviewQueueCard
                        state={part.state}
                        output={part.output as RecommendationReviewQueueOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-saveStrategicInputTool") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-md">
                      <SaveStrategicInputCard
                        state={part.state}
                        output={part.output as SaveStrategicInputOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-assembleReportTool") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-md">
                      <AssembleReportCard
                        state={part.state}
                        output={part.output as AssembleReportOutput | undefined}
                      />
                    </div>
                  );
                }
                return null;
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 flex w-full justify-center border-t border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-black">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!input.trim()) return;
            sendMessage({ text: input });
            setInput("");
          }}
          className="flex w-full max-w-2xl items-end gap-2 px-4 py-4"
        >
          <div className="relative">
            {showAttachHint && (
              <AttachHintBubble onDismiss={() => setShowAttachHint(false)} />
            )}
            <FileUploadButton onUploaded={handleUploaded} disabled={status !== "ready"} />
          </div>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="메시지를 입력하세요..."
            disabled={status !== "ready"}
            className="flex-1 rounded-full border border-zinc-300 px-4 py-2 text-sm outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            disabled={status !== "ready" || !input.trim()}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-50 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            전송
          </button>
        </form>
      </div>
    </div>
  );
}
