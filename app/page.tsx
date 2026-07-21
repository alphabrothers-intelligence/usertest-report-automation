"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";
import { FileUploadButton, type UploadedFile } from "@/components/FileUploadButton";
import { AttachHintBubble } from "@/components/AttachHintBubble";
import type { QuantStats } from "@/lib/quant/compute";
import { QuantStatsSummary } from "@/components/QuantStatsSummary";
import { ReportPlanCard, type ReportPlanOutput } from "@/components/ReportPlanCard";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";
import {
  ProductInfoExtractedCard,
  ProductInfoSavedCard,
  type ProductInfoExtractedOutput,
  type ProductInfoSavedOutput,
} from "@/components/ProductInfoCard";
import { ProductInfoPromptCard } from "@/components/ProductInfoPromptCard";
import { ChatMarkdown, CollapsibleChatMarkdown } from "@/components/ChatMarkdown";
import { PRODUCT_INFO_FIELD_LABELS, type ProductInfo } from "@/lib/productInfo/types";
import type { PipelineResult } from "@/lib/pipeline/orchestrate";
import { QualitativeResultsAccordion } from "@/components/QualitativeResults";
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
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        raw data 검증 중...
      </div>
    );
  }

  if (!output || output.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "검증 중 오류가 발생했습니다."}
      </div>
    );
  }

  if (!output.valid) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
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
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-base text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
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

// 목차 카드에 동의한 직후 "지금부터 뭘 계산하는지"를 로딩 문구 자체에 고정으로 박아둔다
// (2026-07-20 피드백: "정량 통계를 낼 거다, 확인하고 넘어가는 절차다"를 고지하고 싶다는
// 요청 — 모델이 매 턴 챗 텍스트로 이걸 서술해주길 기대하는 대신, 로딩 카드 자체에 코드로
// 고정하면 항상 확실하게 보인다). buildReportPlan의 numeral·title을 그대로 써서 목차 카드와
// 어긋나지 않게 한다.
const QUANT_STATS_SECTION_TITLES = buildReportPlan([])
  .filter((sec) => !["I", "IX"].includes(sec.numeral))
  .map((sec) => `${sec.numeral}.${sec.title}`)
  .join(" · ");

function QuantStatsCard({
  state,
  output,
}: {
  state: string;
  output?: ComputeQuantStatsOutput;
}) {
  if (state !== "output-available") {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="font-medium text-zinc-700 dark:text-zinc-300">정량 통계 계산 중...</p>
        <p className="mt-1 text-sm">
          방금 동의하신 목차 중 {QUANT_STATS_SECTION_TITLES}에 들어갈 정량 통계를 raw data로
          계산하고 있어요.
        </p>
      </div>
    );
  }

  if (!output?.ok || !output.stats) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "정량 통계 계산 중 오류가 발생했습니다."}
      </div>
    );
  }

  return <QuantStatsSummary s={output.stats} />;
}

interface RunQualitativeAnalysisOutput extends Partial<PipelineResult> {
  ok: boolean;
  error?: string;
}

/**
 * "1~2분 정도 걸릴 수 있어요"라고만 써놓고 그 시간이 지나도 그대로면, 사용자가 계속 기다려야
 * 할지 뭔가 잘못된 건지 판단할 방법이 없다는 실측 피드백(2026-07-20 — 실제로 정성 분석이
 * 15분 넘게 안 끝난 사례가 있었다, lib/pipeline/polaritySummary.ts의 타임아웃 누락 버그).
 * 경과 시간을 직접 보여주고, 예상 시간을 넘기면 안내 문구 자체를 바꿔서 "지금 상태가 정상
 * 범위인지"를 사용자가 스스로 판단할 수 있게 한다.
 */
function useElapsedSeconds(): number {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (startRef.current === null) startRef.current = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return elapsed;
}

function QualitativeAnalysisCard({
  state,
  output,
}: {
  state: string;
  output?: RunQualitativeAnalysisOutput;
}) {
  const elapsed = useElapsedSeconds();

  if (state !== "output-available") {
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    const elapsedLabel = `경과 ${minutes}분 ${seconds}초`;
    const isTakingTooLong = elapsed >= 180;
    const isSlowerThanExpected = elapsed >= 90;
    return (
      <div
        className={`rounded-lg border px-5 py-4 text-base ${
          isTakingTooLong
            ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            : "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
        }`}
      >
        {isTakingTooLong ? (
          <>
            <p className="font-medium">예상보다 많이 오래 걸리고 있어요 ({elapsedLabel})</p>
            <p className="mt-1 text-sm">
              서버에서 계속 처리 중일 수 있지만, 보통 1~2분이면 끝나는 작업이라 이 정도로 길어지는
              건 정상 범위를 벗어난 상태예요. 조금 더 기다려보시거나, 계속 안 끝나면 페이지를
              새로고침한 뒤 다시 시도해주세요 — raw data와 정량 통계는 이미 저장되어 있어서
              다시 시작해도 처음부터 다시 하지 않아도 됩니다.
            </p>
          </>
        ) : isSlowerThanExpected ? (
          <p>정성 응답 분석 중... 예상(1~2분)보다 조금 더 걸리고 있어요 ({elapsedLabel})</p>
        ) : (
          <p>정성 응답 분석 중... (14개 문항 병렬 처리, 1~2분 정도 걸릴 수 있어요 · {elapsedLabel})</p>
        )}
      </div>
    );
  }

  if (!output?.ok || !output.questions) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "정성 응답 분석 중 오류가 발생했습니다."}
      </div>
    );
  }

  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-5 py-4 text-base text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <p className="text-base font-semibold">
        정성 응답 분석 완료 (14개 문항, {((output.elapsedMs ?? 0) / 1000).toFixed(1)}초)
      </p>
      <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
        아래 인사이트는 AI 초안입니다 — 담당자 검수 전이며, 최종 보고서에는 검수 후에만 반영됩니다.
      </p>
      <QualitativeResultsAccordion questions={output.questions} />
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
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        체크포인트 A 항목 조회 중...
      </div>
    );
  }
  if (!output?.ok || !output.items) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
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
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        체크포인트 B 항목 조회 중...
      </div>
    );
  }
  if (!output?.ok || !output.items) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
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
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        결과요약 생성 중...
      </div>
    );
  }
  if (!output?.ok || !output.summary) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
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
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        제언 생성 중...
      </div>
    );
  }
  if (!output?.ok || !output.draft) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "제언 생성 중 오류가 발생했습니다."}
      </div>
    );
  }
  return (
    <div className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <p className="font-medium">제언 초안 ({output.section}) — 검수 대기 중</p>
      {output.hedgeViolations && output.hedgeViolations.length > 0 && (
        <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300">
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
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        제언 검수 항목 조회 중...
      </div>
    );
  }
  if (!output?.ok || !output.items) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
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
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        저장 중...
      </div>
    );
  }
  if (!output?.ok) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "저장 중 오류가 발생했습니다."}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-base text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
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
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        최종 보고서 PDF 조립 중...
      </div>
    );
  }
  if (!output?.ok || !output.pdfUrl) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-base text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {output?.error ?? "PDF 조립 중 오류가 발생했습니다."}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-4 text-base text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
      <p className="font-medium">최종 보고서 PDF가 완성됐습니다.</p>
      <a
        href={output.pdfUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-block rounded-full bg-emerald-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-800"
      >
        PDF 다운로드
      </a>
    </div>
  );
}

/**
 * 첨부 파일은 곧바로 전송하지 않고 입력창에 "붙어있는" 상태로만 두고, 실제 전송은 사용자가
 * 메시지를 입력해서 보낼 때 이루어진다(ChatGPT/Claude와 동일한 UX) — 사용자가 어떤 말을
 * 하든 자유롭게 대화할 수 있어야 한다는 피드백 반영. 사용자가 아무 텍스트도 안 쓰고 파일만
 * 첨부한 채 전송하면, 기존 동작과 동일하게 "검증해줘" 기본 문구를 붙여 보낸다.
 *
 * raw data 파일 하나 + 기업소개 파일 하나처럼 여러 개를 한 메시지에 같이 첨부할 수 있다
 * (2026-07-20 피드백) — 모델이 fileUrl을 알아야 하므로 각 파일을 블록으로 이어붙인다.
 */
function buildMessageText(files: UploadedFile[], userText: string): string {
  const trimmed = userText.trim();
  if (files.length === 0) return trimmed;
  const fileBlocks = files
    .map((f) => `[업로드된 파일]\n파일명: ${f.name}\nURL: ${f.url}`)
    .join("\n\n");
  return trimmed ? `${fileBlocks}\n\n${trimmed}` : `${fileBlocks}\n\n이 파일을 확인해줘.`;
}

const FILE_BLOCK_RE = /\[업로드된 파일\]\n파일명: (.+)\nURL: (\S+)\n*/g;

/**
 * buildMessageText가 채팅 텍스트에 심어 보낸 파일 블록(모델이 fileUrl을 읽는 데 필요)을
 * 화면에는 원문 URL까지 그대로 다시 보여줄 필요가 없어서(2026-07-20 피드백 — Claude처럼
 * 첨부는 작은 칩으로만, 사용자가 쓴 텍스트는 텍스트대로), 렌더링 직전에만 분리해낸다.
 * 모델에게 보내는 실제 메시지 텍스트는 그대로 두고 표시만 바꾸는 것이라 안전하다.
 */
function extractFileBlocks(text: string): { files: UploadedFile[]; remainder: string } {
  const files: UploadedFile[] = [];
  const remainder = text
    .replace(FILE_BLOCK_RE, (_match, name: string, url: string) => {
      files.push({ name, url });
      return "";
    })
    .trimStart();
  return { files, remainder };
}

export default function Chat() {
  const [input, setInput] = useState("");
  const [showAttachHint, setShowAttachHint] = useState(true);
  const [attachedFiles, setAttachedFiles] = useState<UploadedFile[]>([]);
  const [isUploadingFiles, setIsUploadingFiles] = useState(false);
  const { messages: rawMessages, sendMessage, status } = useChat();
  // useChat이 드물게 같은 id의 메시지를 두 번 내보내는 게 실측으로 확인됐다(React "Encountered
  // two children with the same key" 경고, 2026-07-20 라이브 테스트 — 목차 동의로 넘어가는
  // 턴에서 재현됨). 원인이 라이브러리 내부라 여기서 직접 고칠 수 없으니, 렌더링 직전에 같은
  // id를 가진 메시지는 마지막 것만 남기고 걸러낸다 — 카드가 두 번 뜨는 걸 막는 가장 확실한 지점.
  const messages = rawMessages.filter(
    (m, i) => rawMessages.findLastIndex((m2) => m2.id === m.id) === i,
  );

  function handleUploaded(file: UploadedFile) {
    setShowAttachHint(false);
    setAttachedFiles((prev) => [...prev, file]);
  }

  function removeAttachedFile(url: string) {
    setAttachedFiles((prev) => prev.filter((f) => f.url !== url));
  }

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submitComposer() {
    // 파일이 아직 업로드 중일 때 전송하면 그 파일이 통째로 누락된 채 메시지가 나가는
    // 문제가 실측으로 확인됐다(여러 파일을 동시 첨부하면 업로드 완료 시점이 서로 달라서
    // 벌어짐, 2026-07-20) — 업로드 중에는 전송 자체를 막는다.
    if (isUploadingFiles) return;
    if (!input.trim() && attachedFiles.length === 0) return;
    sendMessage({ text: buildMessageText(attachedFiles, input) });
    setInput("");
    setAttachedFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  const composerForm = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submitComposer();
      }}
      className="w-full max-w-4xl px-4"
    >
      <div className="rounded-3xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {attachedFiles.map((file) => (
              <div
                key={file.url}
                className="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              >
                <span aria-hidden>📎</span>
                <span>{file.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachedFile(file.url)}
                  aria-label="첨부 제거"
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // Claude/ChatGPT처럼 입력 길이에 맞춰 늘어나되 일정 높이 이상은 스크롤되게 한다.
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
          }}
          onKeyDown={(e) => {
            // Enter로 전송, Shift+Enter로 줄바꿈 — 여러 줄 요구사항을 붙여넣어도 그대로
            // 살아있어야 "더보기" 접기가 의미가 있다(단일 줄 input은 줄바꿈을 브라우저가
            // 자동으로 지워버려서 여러 줄 메시지 자체가 불가능했다 — 2026-07-20 실측 확인).
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitComposer();
            }
          }}
          placeholder="오늘 어떤 보고서를 만들어드릴까요?"
          disabled={status !== "ready"}
          rows={1}
          className="max-h-[200px] w-full resize-none bg-transparent px-5 pb-2 pt-4 text-base outline-none placeholder:text-zinc-400 disabled:opacity-50 dark:placeholder:text-zinc-500"
        />
        <div className="flex items-center justify-between px-3 pb-3">
          <div className="relative">
            {showAttachHint && <AttachHintBubble onDismiss={() => setShowAttachHint(false)} />}
            <FileUploadButton
              onUploaded={handleUploaded}
              onUploadingChange={setIsUploadingFiles}
              disabled={status !== "ready"}
            />
          </div>
          {isUploadingFiles && (
            <span className="text-sm text-zinc-400 dark:text-zinc-500">파일 업로드 중...</span>
          )}
          <button
            type="submit"
            disabled={
              status !== "ready" ||
              isUploadingFiles ||
              (!input.trim() && attachedFiles.length === 0)
            }
            aria-label="전송"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-zinc-50 disabled:opacity-30 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <span aria-hidden>↑</span>
          </button>
        </div>
      </div>
    </form>
  );

  if (messages.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-4 dark:bg-black">
        <div className="flex w-full max-w-4xl flex-col items-center gap-6">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
            사용성테스트 결과보고서 자동생성
          </h1>
          {composerForm}
          <p className="text-sm text-zinc-500">
            raw data(xlsx/csv)를 첨부하거나 메시지를 보내 대화를 시작하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-zinc-50 dark:bg-black">
      <div className="flex w-full min-w-0 max-w-4xl flex-1 flex-col px-4 py-8">
        <h1 className="mb-6 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          사용성테스트 결과보고서 자동생성
        </h1>

        <div className="flex min-w-0 flex-1 flex-col gap-4 pb-32">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`min-w-0 whitespace-pre-wrap break-words text-base ${
                message.role === "user"
                  ? "self-end rounded-2xl bg-zinc-900 px-4 py-2 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                  : "self-start text-zinc-900 dark:text-zinc-100"
              } max-w-full`}
            >
              {message.parts.map((part, i) => {
                if (part.type === "text") {
                  if (message.role !== "user") {
                    return <ChatMarkdown key={i} text={part.text} />;
                  }
                  // 사용자 메시지는 buildMessageText가 심어 보낸 [업로드된 파일] 블록(모델용)을
                  // 그대로 다시 보여주지 않고 작은 칩으로만 표시하고, 긴 텍스트는 접어둔다
                  // (2026-07-20 피드백 — Claude.ai 벤치마킹).
                  const { files, remainder } = extractFileBlocks(part.text);
                  return (
                    <div key={i}>
                      {files.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1.5">
                          {files.map((f) => (
                            <span
                              key={f.url}
                              className="flex items-center gap-1 rounded-full border border-current/20 bg-current/5 px-2.5 py-0.5 text-sm"
                            >
                              <span aria-hidden>📎</span>
                              {f.name}
                            </span>
                          ))}
                        </div>
                      )}
                      {remainder && <CollapsibleChatMarkdown text={remainder} />}
                    </div>
                  );
                }
                if (part.type === "tool-presentProductInfoPrompt") {
                  if (part.state !== "output-available") {
                    return (
                      <div key={i} className="mt-2 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-5 py-4 text-base text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                        기업/제품 정보 입력 카드 준비 중...
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="mt-2 w-full">
                      <ProductInfoPromptCard
                        onSkip={() =>
                          sendMessage({
                            text: "제품 정보 입력은 건너뛸게요. 다음 단계로 진행해주세요.",
                          })
                        }
                        onSubmit={(fields: ProductInfo) => {
                          const lines = (Object.keys(PRODUCT_INFO_FIELD_LABELS) as (keyof ProductInfo)[])
                            .filter((key) => (fields[key] ?? "").trim() !== "")
                            .map((key) => `${PRODUCT_INFO_FIELD_LABELS[key]}: ${fields[key]}`)
                            .join("\n");
                          sendMessage({
                            text: `다음 기업/제품 정보를 저장해주세요.\n${lines}`,
                          });
                        }}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-extractProductInfoFromFile") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <ProductInfoExtractedCard
                        state={part.state}
                        output={part.output as ProductInfoExtractedOutput | undefined}
                        onApprove={() =>
                          sendMessage({
                            text: "확인했어요, 이 기업 정보로 저장해주세요.",
                          })
                        }
                      />
                    </div>
                  );
                }
                if (part.type === "tool-saveProductInfoTool") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <ProductInfoSavedCard
                        state={part.state}
                        output={part.output as ProductInfoSavedOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-validateInput") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <ValidateInputCard
                        state={part.state}
                        output={part.output as ValidateInputOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-computeQuantStats") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <QuantStatsCard
                        state={part.state}
                        output={part.output as ComputeQuantStatsOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-presentReportPlan") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <ReportPlanCard
                        state={part.state}
                        output={part.output as ReportPlanOutput | undefined}
                        onApprove={() =>
                          sendMessage({
                            text: "이 목차/섹션 구성에 동의합니다. 정량 통계 계산을 진행해주세요.",
                          })
                        }
                      />
                    </div>
                  );
                }
                if (part.type === "tool-runQualitativeAnalysis") {
                  return (
                    <div key={i} className="mt-2 w-full">
                      <QualitativeAnalysisCard
                        state={part.state}
                        output={part.output as RunQualitativeAnalysisOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-getPolarityReviewQueue") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-2xl">
                      <PolarityReviewQueueCard
                        state={part.state}
                        output={part.output as PolarityReviewQueueOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-getInsightReviewQueue") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-2xl">
                      <InsightReviewQueueCard
                        state={part.state}
                        output={part.output as InsightReviewQueueOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-generateResultSummary") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-2xl">
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
                    <div key={i} className="mt-2 w-full max-w-2xl">
                      <RecommendationDraftCard
                        state={part.state}
                        output={part.output as RecommendationDraftOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-getRecommendationReviewQueue") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-2xl">
                      <RecommendationReviewQueueCard
                        state={part.state}
                        output={part.output as RecommendationReviewQueueOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-saveStrategicInputTool") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-2xl">
                      <SaveStrategicInputCard
                        state={part.state}
                        output={part.output as SaveStrategicInputOutput | undefined}
                      />
                    </div>
                  );
                }
                if (part.type === "tool-assembleReportTool") {
                  return (
                    <div key={i} className="mt-2 w-full max-w-2xl">
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

      <div className="fixed bottom-0 left-0 flex w-full justify-center bg-gradient-to-t from-zinc-50 from-60% to-transparent pb-6 pt-10 dark:from-black">
        {composerForm}
      </div>
    </div>
  );
}
