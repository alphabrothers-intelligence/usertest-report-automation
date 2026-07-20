import { anthropic } from "@ai-sdk/anthropic";
import {
  streamText,
  convertToModelMessages,
  tool,
  stepCountIs,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { loadWallaFromUrl } from "@/lib/walla/loadFromUrl";
import { extractFeatureNames, WALLA_COLUMN_COUNT } from "@/lib/walla/schema";
import { normalizeWallaRows } from "@/lib/walla/normalize";
import { computeQuantStats } from "@/lib/quant/compute";
import { buildQuestionSpecs } from "@/lib/pipeline/questions";
import { buildReportPlan } from "@/lib/pipeline/reportPlan";
import { runQualitativePipeline } from "@/lib/pipeline/orchestrate";
import { runRecommendation } from "@/lib/pipeline/recommendation";
import { runResultSummary } from "@/lib/pipeline/summary";
import { checkHedgeWording } from "@/lib/pipeline/hedgeCheck";
import { assembleReport } from "@/lib/pdf/assemble";
import { extractTextFromDocument } from "@/lib/productInfo/extractText";
import { runProductInfoExtraction } from "@/lib/productInfo/extract";
import {
  upsertReportQuantStats,
  getReportByFileUrl,
  saveQualitativeResults,
  getPendingPolarityReviews,
  reviewClausePolarity,
  getPendingInsightReviews,
  approveInsight,
  saveRecommendation,
  getPendingRecommendationReviews,
  approveRecommendation,
  getCategoriesForQuestion,
  saveStrategicInput,
  getStrategicInput,
  saveProductInfo,
} from "@/lib/db/reports";

export const maxDuration = 300; // Vercel Fluid Compute 기본 실행시간 (PRD 10장)

const CHAT_MODEL = process.env.ANTHROPIC_CHAT_MODEL ?? "claude-sonnet-5";

const SYSTEM_PROMPT = `당신은 "사용성테스트 결과보고서 자동생성" 챗봇입니다. 담당자가 raw data(xlsx/csv)를
채팅에 첨부하면, 보고서 생성 파이프라인을 안내합니다. 기업/제품 소개 파일(PDF/워드/텍스트)이나
채팅으로 직접 알려주는 기업 정보도 받을 수 있습니다.

# 현재 지원 범위 (Phase 7)
- raw data 업로드 접수, WALLA 표준 59컬럼 스키마 검증, 정량 통계 계산, 정성 응답 분석(14개 문항),
  체크포인트 A(극성 판정 검수)·체크포인트 B(인사이트·제언 검수), 결과요약·제언 생성, 종합전략제언
  입력, 기업/제품 정보 입력(직접 입력 또는 파일 추출), 최종 PDF 보고서 조립까지 전부 지원합니다.
- 정량 계산은 규칙 기반 도구가 수행하며, 당신은 그 결과를 임의로 재계산하거나 반올림을
  바꾸지 않습니다. raw data 없이 수치를 추정하거나 지어내지 마세요.

# 도구 사용 규칙 — 순서대로

**중요: 이 대화에서 validateInput·presentProductInfoPrompt·presentReportPlan은 각각 최대
한 번만 호출하세요.** 대화 기록(이전 턴들)을 먼저 확인해서, 같은 fileUrl에 대해 이미 호출해
카드가 표시된 도구는 사용자가 무슨 말을 하든 다시 호출하지 마세요 — "건너뛸게요" 같은 응답은
그 카드의 다음 단계로 넘어가라는 신호일 뿐, 처음부터 다시 시작하라는 뜻이 아닙니다.

1. 파일 URL이 첨부되면 validateInput으로 WALLA 59컬럼 스키마를 확인하세요. 실패하면 이유를
   설명하고 멈추세요.
2. **validateInput이 성공하면 곧바로 presentProductInfoPrompt를 호출해 기업/제품 정보
   입력 카드를 보여주세요.** 이 카드는 사용자가 "건너뛰기" 버튼을 누르거나("건너뛸게요"),
   입력 필드를 채워 "저장하고 계속" 버튼을 누를 때까지 응답을 기다립니다 — **사용자가
   이 카드에 응답하기 전에는 computeQuantStats를 호출하지 마세요.**
   - 사용자가 필드를 채워 보냈으면("다음 기업/제품 정보를 저장해주세요..." 형식으로 옵니다)
     saveProductInfoTool로 그 값 그대로 저장하세요(해석·추정 없이).
   - **사용자가 건너뛰겠다고 하면 validateInput이나 presentProductInfoPrompt를 다시 호출하지
     말고, 저장도 하지 말고 곧바로 3번(computeQuantStats)으로 넘어가세요.**
   - **raw data(xlsx/csv)가 아닌** PDF/워드/텍스트 파일이 첨부되면(카드 입력과 별개로 언제든)
     기업소개 자료로 보고 extractProductInfoFromFile로 정보를 추출하세요. 추출은 AI 해석이
     개입되므로 절대 바로 저장하지 말고, 추출된 내용을 카드로 보여준 뒤 사용자가 확인·승인했을
     때만 saveProductInfoTool로 저장하세요.
3. **기업 정보 단계가 끝나면(저장 또는 건너뛰기), computeQuantStats보다 먼저 presentReportPlan을
   호출해서 목차/섹션 구성 계획 카드를 보여주세요.** featureNames 인자에는 validateInput이
   반환한 featureNames를 그대로 넘기세요. 사용자가 카드의 "동의하고 진행" 버튼을 누르거나
   자연어로 승인하기 전까지는 computeQuantStats를 호출하지 마세요 — 목차를 먼저 확정해야
   사용자가 "이제 뭘 계산하는 건지" 맥락을 갖고 다음 단계를 받아들일 수 있습니다.
   presentReportPlan 결과는 카드로 완전히 표시되니 텍스트로 다시 나열하지 마세요.
4. **목차 계획에 동의를 받으면 computeQuantStats를 같은 fileUrl로 호출해 정량 통계를
   계산·저장하세요.** 도구 결과는 화면에 이미 완전한 카드(인적사항·기능별 만족도·핵심구매요소·
   4대가치·UX품질·NPS·교차분석 전부 포함)로 렌더링되니 같은 수치를 채팅 텍스트로 다시
   요약·나열하지 마세요. 대신 **"방금 보여드린 목차·섹션에 들어갈 정량 통계를 raw data로
   분석한 결과입니다" 같은 한 문장으로, 이 카드가 바로 위 목차 계획과 어떻게 연결되는지
   명시적으로 짚어주세요** — 사용자가 이 통계가 왜 지금 나오는지 맥락 없이 받아보지 않도록
   하기 위함입니다.
5. **정량 통계 카드를 보여준 다음에는, 정성 분석(문항 14개, 시간·비용이 큰 작업)을 진행해도
   될지 짧은 텍스트로 먼저 물어보고, 사용자가 명시적으로 승인("네", "진행해줘" 등)하기 전까지는
   runQualitativeAnalysis를 호출하지 마세요.** 사용자가 원치 않는 방향으로 비용을 먼저 써버리는
   걸 막기 위함입니다. 승인을 받으면 runQualitativeAnalysis를 호출하세요. 완료되면 문항별
   카테고리명과 인사이트 초안을 간결히 정리해서 보여주세요.
6. 정성 분석이 끝나면 getPolarityReviewQueue를 호출해 신뢰도 낮은(체크포인트 A 대상) 응답이
   있는지 확인하고, 있으면 사용자에게 검수를 안내하세요. 사용자가 "이건 부정이야" 같은 자연어로
   판정을 바꾸면 submitPolarityReview를 호출하세요(카드의 버튼 클릭은 별도 API로 직접 처리되며,
   이 도구는 자연어 지시를 받았을 때만 사용합니다).
7. 체크포인트 A가 끝나면(또는 대상이 없으면) getInsightReviewQueue로 아직 승인되지 않은
   인사이트를 보여주세요. 사용자가 문장을 수정해달라고 하면 submitInsightReview로 반영하세요.
   **insight는 원래 담당자가 직접 쓰는 영역이므로, 사용자가 명시적으로 승인하거나 수정 문구를
   주기 전까지는 임의로 승인 처리하지 마세요.**
8. 체크포인트 B(인사이트)까지 끝나면 generateResultSummary로 6.9절 결과요약을 생성해 보여주세요
   (완전 자동생성, 해석 없는 사실 나열이라 별도 승인 절차가 없습니다).
9. 사용자가 제언(핵심구매요소 해석, 개발우선순위, 기능개선제안)을 요청하면 generateRecommendation
   또는 generateFeatureRecommendation을 호출하세요. 생성된 제언은 자동으로 헤지 워딩 위반 여부가
   검사됩니다 — hedgeViolations가 있으면 사용자에게 "이 문장은 단정적으로 들릴 수 있다"고
   알려주세요. 제언도 인사이트처럼 AI 초안이므로 getRecommendationReviewQueue로 검수 대상을
   보여주고, submitRecommendationReview로 승인·수정을 반영하세요.
10. **종합 전략 제언(7.3절)은 AI가 생성하지 않습니다.** 고객사 요청사항과 우선 고려 지표는
   사용자가 채팅으로 전달한 내용을 saveStrategicInput으로 그대로 저장하세요. 제언 초안도 원칙적으로
   담당자가 직접 씁니다 — 사용자가 명시적으로 "초안 도와줘"라고 요청했을 때만
   generateRecommendation(section="strategic_draft")으로 초안을 만들고, 반드시 "이건 초안이니
   전면 수정하셔도 됩니다"라고 안내하세요.
11. 사용자가 "최종 보고서 만들어줘"처럼 명시적으로 요청하면 assembleReportTool을 호출하세요.
   pendingInsightCount·pendingRecommendationCount가 0보다 크면 실패한 것이므로, 어떤 체크포인트가
   남았는지 안내하고 검수를 먼저 끝내도록 유도하세요(재호출 금지). 성공하면 pdfUrl을 그대로
   전달하고, 다운로드 링크임을 알려주세요.

# 원칙
- runQualitativeAnalysis가 만드는 insight, generateRecommendation이 만드는 제언 문장은 전부
  AI 초안입니다. 체크포인트에서 승인되기 전까지는 "초안, 검수 대기 중"이라는 점을 분명히 하세요.
- raw data 없이 정량 수치를 추정하거나 지어내지 마세요.
- **도구 결과는 화면에 카드형 UI로 렌더링됩니다. 카드가 이미 보여주는 수치·목록·표를 채팅
  텍스트로 다시 요약·나열하지 마세요.** 카드에 없는 맥락(다음에 뭘 할지, 승인이 필요한지 등)만
  짧은 일반 문장으로 덧붙이세요.
- 그 짧은 설명 문장에는 **별표 두 개로 감싼 볼드와 하이픈 목록은 실제로 렌더링되니 핵심 단어나
  다음 행동을 강조할 때 적절히 쓰세요**(Claude.ai 채팅 말투를 참고). 다만 샵 기호 제목이나
  파이프 기호 표 문법은 렌더링되지 않으니 쓰지 마세요 — 표·구조화된 데이터는 항상 카드로만
  전달하세요.`;

// 모델이 "이 도구는 이번 대화에서 이미 한 번 호출했다"는 걸 프롬프트 지시만으로는 안정적으로
// 지키지 못하는 게 실측으로 확인됐다(2026-07-20) — presentProductInfoPrompt 카드가 사용자의
// "건너뛰기" 응답 뒤에도 다시 나타나는 걸 라이브 테스트로 재현함. 지시문에 맡기는 대신, 매 턴
// 메시지 기록을 직접 스캔해서 이미 완료된 도구를 기계적으로 판별하고, 그 사실을 시스템
// 프롬프트에 그때그때 주입한다 — 모델의 기억력이 아니라 실제 상태에 기반하므로 훨씬 확실하다.
function hasCompletedTool(messages: UIMessage[], toolName: string): boolean {
  return messages.some((m) =>
    m.parts?.some(
      (p) => p.type === `tool-${toolName}` && "state" in p && p.state === "output-available",
    ),
  );
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const onceOnlyTools = ["validateInput", "presentProductInfoPrompt", "presentReportPlan"];
  const alreadyDoneNotes = onceOnlyTools
    .filter((name) => hasCompletedTool(messages, name))
    .map((name) => `- ${name}은(는) 이 대화에서 이미 완료됐습니다. 다시 호출하지 마세요.`);
  const systemPromptForTurn = alreadyDoneNotes.length
    ? `${SYSTEM_PROMPT}\n\n# 이번 턴 상태 확인 (메시지 기록에서 기계적으로 판별함)\n${alreadyDoneNotes.join("\n")}\n사용자의 가장 최근 메시지에 대한 응답만 처리하고, 위 도구들은 호출하지 마세요.`
    : SYSTEM_PROMPT;

  const tools = {
    presentProductInfoPrompt: tool({
      description:
        "validateInput 성공 직후 호출한다. 기업/제품 정보(PRD 5.0절) 입력을 요청하는 카드를 " +
        "보여준다. 이 카드는 사용자가 건너뛰거나 정보를 입력해 응답할 때까지 대기 상태이며, " +
        "사용자가 응답하기 전까지 computeQuantStats를 호출하지 않는다. **같은 fileUrl에 대해 " +
        "이 대화에서 이미 한 번 호출했다면 다시 호출하지 않는다** — 사용자의 건너뛰기/입력 " +
        "응답이 오면 그 응답을 처리하고 다음 단계로 넘어간다.",
      inputSchema: z.object({}),
      execute: async () => ({ ok: true }),
    }),
    extractProductInfoFromFile: tool({
      description:
        "raw data(xlsx/csv)가 아닌 기업/제품 소개 파일(PDF/워드/텍스트)에서 기업 정보(PRD 5.0절 " +
        "필드)를 추출한다. 문서에 없는 내용은 채우지 않는다. 이 결과는 AI 해석이 개입되므로 " +
        "바로 저장하지 말고 사용자에게 확인받은 뒤 saveProductInfoTool로 저장할 것.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("기업소개 파일의 URL (raw data 파일 URL이 아님)"),
      }),
      execute: async ({ fileUrl }) => {
        try {
          const text = await extractTextFromDocument(fileUrl);
          const extracted = await runProductInfoExtraction(text);
          return { ok: true, extracted };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "추출에 실패했습니다." };
        }
      },
    }),
    saveProductInfoTool: tool({
      description:
        "기업/제품 정보(PRD 5.0절)를 저장한다. 사용자가 채팅으로 직접 알려준 값이거나, " +
        "extractProductInfoFromFile로 추출한 뒤 사용자가 확인·승인한 값만 넘길 것 — " +
        "AI가 임의로 추정한 값을 넣지 않는다. 여러 번 나눠 호출해도 이전에 저장된 필드는 " +
        "유지되고 새 필드만 덧붙는다. fileUrl은 raw data 파일의 URL이다(기업소개 파일 URL 아님).",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("raw data 파일의 URL — 이 report에 정보를 귀속시키는 키"),
        companyName: z.string().optional(),
        homepage: z.string().optional(),
        representative: z.string().optional(),
        contactPerson: z.string().optional(),
        serviceName: z.string().optional(),
        serviceSummary: z.string().optional(),
        businessArea: z.string().optional(),
        industry: z.string().optional(),
        operatingEnvironment: z.string().optional(),
        businessStage: z.string().optional(),
      }),
      execute: async ({ fileUrl, ...productInfo }) => {
        await saveProductInfo({ fileUrl, productInfo });
        return { ok: true, saved: productInfo };
      },
    }),
    validateInput: tool({
      description:
        "채팅에 첨부된 xlsx/csv raw data 파일이 WALLA 표준 59컬럼 스키마(SW/App형)와 일치하는지 검증한다. " +
        "URL로 파일을 내려받아 헤더 행을 컬럼별로 대조한다.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("Vercel Blob에 업로드된 raw data 파일의 URL"),
        fileName: z.string().optional().describe("원본 파일명"),
      }),
      execute: async ({ fileUrl, fileName }) => {
        const loaded = await loadWallaFromUrl(fileUrl);
        if (!loaded.ok || !loaded.parsed || !loaded.validation) {
          return { valid: false, error: loaded.fetchError };
        }

        const featureNames = loaded.validation.valid
          ? extractFeatureNames(loaded.parsed.headerRow)
          : [];

        return {
          fileName: fileName ?? null,
          valid: loaded.validation.valid,
          expectedColumnCount: WALLA_COLUMN_COUNT,
          actualColumnCount: loaded.validation.columnCount,
          respondentCount: loaded.parsed.dataRows.length,
          featureNames,
          errors: loaded.validation.errors,
        };
      },
    }),
    computeQuantStats: tool({
      description:
        "검증된 WALLA raw data 파일의 정량 섹션(인적사항 분포, 기능별 만족도, 핵심구매요소 " +
        "상대중요도, 4대가치, UX품질, NPS·종합만족도)을 규칙 기반으로 계산하고 DB에 저장한다. " +
        "validateInput이 valid=true를 반환한 fileUrl에 대해서만 호출하며, presentReportPlan에 " +
        "사용자가 동의한 뒤에만 호출한다 — 목차 계획을 먼저 보여줘서 이 통계가 왜 지금 나오는지 " +
        "맥락을 준 다음이어야 한다.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("validateInput에 사용했던 것과 동일한 raw data URL"),
        fileName: z.string().optional().describe("원본 파일명"),
      }),
      execute: async ({ fileUrl, fileName }) => {
        const loaded = await loadWallaFromUrl(fileUrl);
        if (!loaded.ok || !loaded.parsed || !loaded.validation) {
          return { ok: false, error: loaded.fetchError };
        }
        if (!loaded.validation.valid) {
          return {
            ok: false,
            error: "WALLA 59컬럼 스키마와 일치하지 않는 파일입니다. validateInput 결과를 먼저 확인하세요.",
          };
        }

        const records = normalizeWallaRows(loaded.parsed.headerRow, loaded.parsed.dataRows);
        const stats = computeQuantStats(records);
        await upsertReportQuantStats({
          fileUrl,
          fileName: fileName ?? null,
          respondentCount: records.length,
          quantStats: stats,
        });
        return { ok: true, stats };
      },
    }),
    presentReportPlan: tool({
      description:
        "기업 정보 단계가 끝난 직후, computeQuantStats를 호출하기 전에 raw data를 바탕으로 " +
        "보고서 목차·섹션이 각각 어떤 근거로 채워질지 계획을 제시하고 사용자 동의를 구한다 " +
        "(PRD 3.2절). 정량 통계를 먼저 계산하지 않고 이 계획부터 보여주는 이유는, 사용자가 " +
        "'이제 뭘 계산하는 건지' 맥락을 먼저 알고 다음 단계를 받아들이게 하기 위함이다. 목차 " +
        "구성 자체는 항상 동일한 표준 스키마(Ⅰ~Ⅸ)를 따르므로 규칙 기반으로 계산하며, " +
        "featureNames만 이 raw data에 맞게 채워 넣는다. 사용자가 동의(버튼 클릭 또는 자연어 " +
        "승인)하기 전까지는 computeQuantStats를 호출하지 않는다. **같은 fileUrl에 대해 이 " +
        "대화에서 이미 한 번 호출했다면 다시 호출하지 않는다.**",
      inputSchema: z.object({
        featureNames: z.array(z.string()).describe("validateInput에서 확인한 기능명 목록"),
        qualitativeQuestionCount: z
          .number()
          .default(14)
          .describe("정성 분석 대상 문항 수(표준 구성은 14)"),
      }),
      execute: async ({ featureNames, qualitativeQuestionCount }) => {
        return {
          sections: buildReportPlan(featureNames),
          qualitativeQuestionCount,
        };
      },
    }),
    runQualitativeAnalysis: tool({
      description:
        "14개 정성 문항(기능 6개+4대가치 4개+유사서비스만족도+전반적만족도+NPS+개선아이디어)을 " +
        "Stage1(문장분리+극성판정)·Stage2(카테고리+인용+인사이트초안)로 병렬 처리하고 DB에 저장한다. " +
        "실제 Claude API를 수십 회 호출하는 무거운 작업이므로, 사용자가 진행을 승인했을 때만 호출한다. " +
        "computeQuantStats가 먼저 실행되어 report가 생성되어 있어야 한다.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("validateInput에 사용했던 것과 동일한 raw data URL"),
      }),
      execute: async ({ fileUrl }) => {
        const report = await getReportByFileUrl(fileUrl);
        if (!report) {
          return {
            ok: false,
            error: "이 파일의 report가 아직 없습니다. computeQuantStats를 먼저 호출하세요.",
          };
        }

        const loaded = await loadWallaFromUrl(fileUrl);
        if (!loaded.ok || !loaded.parsed || !loaded.validation) {
          return { ok: false, error: loaded.fetchError };
        }
        if (!loaded.validation.valid) {
          return {
            ok: false,
            error: "WALLA 59컬럼 스키마와 일치하지 않는 파일입니다. validateInput 결과를 먼저 확인하세요.",
          };
        }

        const records = normalizeWallaRows(loaded.parsed.headerRow, loaded.parsed.dataRows);
        const specs = buildQuestionSpecs(records);
        const pipeline = await runQualitativePipeline(specs);
        await saveQualitativeResults(report.id, pipeline);
        return { ok: true, ...pipeline };
      },
    }),
    getPolarityReviewQueue: tool({
      description:
        "체크포인트 A(7.1절): 신뢰도 낮음으로 플래그된, 아직 검수되지 않은 극성 판정 목록을 " +
        "조회한다. runQualitativeAnalysis 완료 후 호출한다.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("validateInput에 사용했던 것과 동일한 raw data URL"),
      }),
      execute: async ({ fileUrl }) => {
        const report = await getReportByFileUrl(fileUrl);
        if (!report) return { ok: false, error: "report를 찾을 수 없습니다.", items: [] };
        const items = await getPendingPolarityReviews(report.id);
        return { ok: true, items };
      },
    }),
    submitPolarityReview: tool({
      description:
        "사용자가 자연어로 극성 판정을 승인하거나 다른 극성으로 재배치하도록 지시했을 때 호출한다. " +
        "카드의 버튼 클릭은 별도 API로 직접 처리되므로 이 도구를 거치지 않는다.",
      inputSchema: z.object({
        clauseId: z.string().describe("getPolarityReviewQueue 결과의 clause id"),
        decision: z
          .enum(["approve", "positive", "negative", "neutral"])
          .describe("approve=원래 판정 유지하며 승인, 나머지=해당 극성으로 재배치"),
      }),
      execute: async ({ clauseId, decision }) => {
        await reviewClausePolarity(clauseId, decision === "approve" ? null : decision);
        return { ok: true };
      },
    }),
    getInsightReviewQueue: tool({
      description:
        "체크포인트 B(7.2절): 아직 승인되지 않은 카테고리별 인사이트 초안 목록을 조회한다. " +
        "체크포인트 A 이후(또는 대상이 없으면 정성 분석 직후) 호출한다.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("validateInput에 사용했던 것과 동일한 raw data URL"),
      }),
      execute: async ({ fileUrl }) => {
        const report = await getReportByFileUrl(fileUrl);
        if (!report) return { ok: false, error: "report를 찾을 수 없습니다.", items: [] };
        const items = await getPendingInsightReviews(report.id);
        return { ok: true, items };
      },
    }),
    submitInsightReview: tool({
      description:
        "사용자가 자연어로 인사이트 문장을 승인하거나 수정하도록 지시했을 때 호출한다. " +
        "승인만 하는 경우 finalText에 기존 insight_draft를 그대로 전달한다. " +
        "카드의 버튼 클릭은 별도 API로 직접 처리되므로 이 도구를 거치지 않는다.",
      inputSchema: z.object({
        categoryId: z.string().describe("getInsightReviewQueue 결과의 category id"),
        finalText: z.string().describe("승인할 최종 인사이트 문장(수정본 또는 원본)"),
      }),
      execute: async ({ categoryId, finalText }) => {
        await approveInsight(categoryId, finalText);
        return { ok: true };
      },
    }),
    generateResultSummary: tool({
      description:
        "PRD 6.9절: computeQuantStats가 저장한 정량 통계만 근거로 '사용성테스트 결과 요약' " +
        "섹션을 개조식으로 생성한다(해석 없음, 완전 자동생성이라 별도 검수 절차가 없다). " +
        "computeQuantStats가 먼저 실행되어 있어야 한다.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("computeQuantStats에 사용했던 것과 동일한 raw data URL"),
      }),
      execute: async ({ fileUrl }) => {
        const report = await getReportByFileUrl(fileUrl);
        if (!report?.quant_stats) {
          return { ok: false, error: "정량 통계가 없습니다. computeQuantStats를 먼저 호출하세요." };
        }
        const summary = await runResultSummary(report.quant_stats);
        return { ok: true, summary };
      },
    }),
    generateRecommendation: tool({
      description:
        "PRD 6.5절 헤지워딩 프롬프트로 제언 문단을 생성해 DB에 저장한다(체크포인트 B 대상②, " +
        "승인 전까지 초안). section='core_purchase_factor'는 Ⅳ 핵심구매요소 해석, " +
        "'dev_priority'는 Ⅸ 개발우선순위제언, 'strategic_draft'는 종합전략제언 초안 도움 " +
        "요청(사용자가 명시적으로 요청했을 때만)이다.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("computeQuantStats에 사용했던 것과 동일한 raw data URL"),
        section: z.enum(["core_purchase_factor", "dev_priority", "strategic_draft"]),
      }),
      execute: async ({ fileUrl, section }) => {
        const report = await getReportByFileUrl(fileUrl);
        if (!report?.quant_stats) {
          return { ok: false, error: "정량 통계가 없습니다. computeQuantStats를 먼저 호출하세요." };
        }

        const sectionLabel = {
          core_purchase_factor: "핵심구매요소 해석",
          dev_priority: "개발 우선순위 제언",
          strategic_draft: "종합 전략 제언",
        }[section];

        let dataSummary: unknown = {
          relativeImportance: report.quant_stats.relativeImportance,
          featureSatisfaction: report.quant_stats.featureSatisfaction,
        };
        if (section === "strategic_draft") {
          const strategicInput = await getStrategicInput(report.id);
          dataSummary = {
            customerRequest: strategicInput?.customer_request,
            priorityMetric: strategicInput?.priority_metric,
            overallSatisfaction: report.quant_stats.overallSatisfaction,
            nps: report.quant_stats.nps,
            relativeImportance: report.quant_stats.relativeImportance,
          };
        }

        const draft = await runRecommendation({ sectionLabel, dataSummary });
        const hedgeViolations = checkHedgeWording(draft);

        if (section !== "strategic_draft") {
          await saveRecommendation({ reportId: report.id, section, draft });
        }
        return { ok: true, section, draft, hedgeViolations };
      },
    }),
    generateFeatureRecommendation: tool({
      description:
        "PRD 6.5절: 특정 기능의 '기능개선제안(As-is→To-be)' 제언을 그 기능의 정량 수치와 " +
        "부정 응답 카테고리(Stage2 결과)를 근거로 생성해 DB에 저장한다(체크포인트 B 대상②). " +
        "runQualitativeAnalysis가 먼저 실행되어 있어야 카테고리를 참고할 수 있다.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("validateInput에 사용했던 것과 동일한 raw data URL"),
        featureName: z.string().describe("기능명 (예: '펫과의 산책'). validateInput의 featureNames 중 하나"),
      }),
      execute: async ({ fileUrl, featureName }) => {
        const report = await getReportByFileUrl(fileUrl);
        if (!report?.quant_stats) {
          return { ok: false, error: "정량 통계가 없습니다. computeQuantStats를 먼저 호출하세요." };
        }

        const satisfaction = report.quant_stats.featureSatisfaction.find(
          (f) => f.name === featureName,
        );
        const importance = report.quant_stats.relativeImportance.find(
          (r) => r.name === featureName,
        );
        const categories = await getCategoriesForQuestion(report.id, `feature:${featureName}`);
        const negativeCategories = categories
          .filter((c) => c.polarity === "negative")
          .map((c) => ({ label: c.label, insight: c.insight_final ?? c.insight_draft }));

        const section = `feature_improvement:${featureName}`;
        const dataSummary = { featureName, satisfaction, relativeImportance: importance, negativeCategories };
        const draft = await runRecommendation({
          sectionLabel: `'${featureName}' 기능개선제안(As-is→To-be)`,
          dataSummary,
        });
        const hedgeViolations = checkHedgeWording(draft);
        await saveRecommendation({ reportId: report.id, section, draft });
        return { ok: true, section, draft, hedgeViolations };
      },
    }),
    getRecommendationReviewQueue: tool({
      description: "체크포인트 B 대상②(7.2절): 아직 승인되지 않은 제언 문단 목록을 조회한다.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("validateInput에 사용했던 것과 동일한 raw data URL"),
      }),
      execute: async ({ fileUrl }) => {
        const report = await getReportByFileUrl(fileUrl);
        if (!report) return { ok: false, error: "report를 찾을 수 없습니다.", items: [] };
        const items = await getPendingRecommendationReviews(report.id);
        return {
          ok: true,
          items: items.map((r) => ({ ...r, hedgeViolations: checkHedgeWording(r.draft) })),
        };
      },
    }),
    submitRecommendationReview: tool({
      description:
        "사용자가 자연어로 제언 문단을 승인하거나 수정하도록 지시했을 때 호출한다. " +
        "카드의 버튼 클릭은 별도 API로 직접 처리되므로 이 도구를 거치지 않는다.",
      inputSchema: z.object({
        recommendationId: z.string().describe("getRecommendationReviewQueue 결과의 id"),
        finalText: z.string().describe("승인할 최종 제언 문단(수정본 또는 원본)"),
      }),
      execute: async ({ recommendationId, finalText }) => {
        await approveRecommendation(recommendationId, finalText);
        return { ok: true };
      },
    }),
    saveStrategicInputTool: tool({
      description:
        "PRD 7.3절: 종합 전략 제언 입력. AI가 생성하지 않고 담당자가 채팅으로 전달한 고객사 " +
        "요청사항·우선 고려 지표·제언 초안을 그대로 저장한다. 사용자가 언급한 필드만 채우면 된다.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("validateInput에 사용했던 것과 동일한 raw data URL"),
        customerRequest: z.string().optional().describe("고객사 요청사항 (예: '마케팅을 활용한 매출 증대 방안 요청')"),
        priorityMetric: z.string().optional().describe("우선 고려 지표 (예: '구매전환율')"),
        draft: z.string().optional().describe("담당자가 직접 작성한 제언 초안 전문"),
      }),
      execute: async ({ fileUrl, customerRequest, priorityMetric, draft }) => {
        const report = await getReportByFileUrl(fileUrl);
        if (!report) return { ok: false, error: "report를 찾을 수 없습니다." };
        await saveStrategicInput({ reportId: report.id, customerRequest, priorityMetric, draft });
        return { ok: true };
      },
    }),
    assembleReportTool: tool({
      description:
        "PRD 8장: 최종 PDF 보고서를 조립해 Vercel Blob에 업로드하고 다운로드 링크를 반환한다. " +
        "체크포인트 A/B(인사이트·제언)가 전부 승인되지 않았으면 실패하며 대기 건수를 알려준다 — " +
        "이 경우 사용자에게 어떤 검수가 남았는지 안내하고 이 도구를 다시 호출하지 마세요.",
      inputSchema: z.object({
        fileUrl: z.string().url().describe("validateInput에 사용했던 것과 동일한 raw data URL"),
      }),
      execute: async ({ fileUrl }) => {
        return assembleReport(fileUrl);
      },
    }),
  };

  // prepareStep으로 "이미 완료된 once-only 도구"를 다음 스텝의 activeTools에서 아예 빼버린다.
  // 시스템 프롬프트 지시만으로는 같은 턴 안의 여러 스텝에 걸친 반복 호출까지는 못 막는 게
  // 실측으로 확인됐다(2026-07-20, 라이브 브라우저 테스트로 재현 — "건너뛰기" 처리 도중 같은
  // 턴에서 presentProductInfoPrompt가 두 번 호출됨). steps(이번 턴에서 이미 실행된 스텝)와
  // messages(이전 턴 기록) 양쪽을 다 보는 이유는, 이전 턴에 완료된 것과 이번 턴에 막 완료된 것
  // 둘 다 걸러야 하기 때문이다 — 도구 자체를 못 부르게 하는 것이라 프롬프트 지시보다 훨씬 확실하다.
  const onceOnlyToolNames = onceOnlyTools.filter((name) => name in tools) as (keyof typeof tools)[];

  const result = streamText({
    model: anthropic(CHAT_MODEL),
    system: systemPromptForTurn,
    messages: await convertToModelMessages(messages),
    // validateInput → presentProductInfoPrompt → presentReportPlan → computeQuantStats →
    // (승인 시) runQualitativeAnalysis → 체크포인트 A/B 조회·반영 → 결과요약·제언 생성까지
    // 한 턴에 여러 단계가 이어질 수 있어 여유 있게 허용한다.
    stopWhen: stepCountIs(10),
    tools,
    prepareStep: async ({ steps }) => {
      const calledThisTurn = new Set(steps.flatMap((s) => s.toolCalls.map((tc) => tc.toolName)));
      // doneBefore: 이전 턴(=사용자가 실제로 응답한 뒤)에 완료된 것만. doneEver: 이번 턴에
      // 막 호출된 것까지 포함. "사용자 응답을 기다려야 하는" 전이는 doneBefore로만 강제해야
      // 한다 — doneEver로 강제하면 카드를 보여준 바로 다음 스텝에서 사용자 응답도 없이 다음
      // 단계로 넘어가버려서 "대기" 자체가 무의미해진다.
      const doneBefore = (name: string) => hasCompletedTool(messages, name);
      const doneEver = (name: string) => calledThisTurn.has(name) || doneBefore(name);

      // 시스템 프롬프트로 "A 다음엔 반드시 B를 호출하라"고 지시해도, 모델이 A 호출 직후 도구
      // 호출 없이 텍스트만 쓰고 턴을 끝내버리는 경우가 실측으로 확인됐다(2026-07-20 — 라이브
      // 브라우저 테스트에서 computeQuantStats 이후 presentReportPlan을 호출하지 않고 멈춤).
      // 지시에 맡기지 않고 toolChoice로 다음 도구를 강제한다.
      //
      // validateInput → presentProductInfoPrompt는 같은 턴 안에서 바로 이어져야 하므로(사용자
      // 대기가 필요 없는 전이) doneEver 기준으로 강제한다.
      if (doneEver("validateInput") && !doneEver("presentProductInfoPrompt")) {
        return { toolChoice: { type: "tool", toolName: "presentProductInfoPrompt" } };
      }
      // 아래 두 전이는 카드에 대한 사용자 응답(건너뛰기/입력, 목차 동의)을 반드시 기다려야
      // 하므로, "이번 턴에 막 호출됨"만으로는 강제하지 않는다 — 이전 턴에 완료된(=사용자가
      // 실제로 응답해서 새 턴이 시작된) 경우에만 다음 도구를 강제한다.
      if (doneBefore("presentProductInfoPrompt") && !doneEver("presentReportPlan")) {
        return { toolChoice: { type: "tool", toolName: "presentReportPlan" } };
      }
      if (doneBefore("presentReportPlan") && !doneEver("computeQuantStats")) {
        return { toolChoice: { type: "tool", toolName: "computeQuantStats" } };
      }

      const toExclude = new Set(onceOnlyToolNames.filter((name) => doneEver(name)));
      if (toExclude.size === 0) return undefined;
      return {
        activeTools: (Object.keys(tools) as (keyof typeof tools)[]).filter(
          (name) => !toExclude.has(name),
        ),
      };
    },
  });

  return result.toUIMessageStreamResponse();
}
