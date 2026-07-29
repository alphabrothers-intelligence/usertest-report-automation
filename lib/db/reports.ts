import { sql } from "./client";
import type { QuantStats } from "@/lib/quant/compute";
import type { PipelineResult, QuestionResult } from "@/lib/pipeline/orchestrate";
import type { Polarity } from "@/lib/pipeline/stage1";
import type { ProductInfo } from "@/lib/productInfo/types";

export interface ReportRow {
  id: string;
  file_url: string;
  file_name: string | null;
  respondent_count: number | null;
  quant_stats: QuantStats | null;
  product_info: ProductInfo | null;
  /** 정량 통계에서 한 번만 만든 Claude 결과 요약. 재렌더링 때 재사용한다. */
  result_summary: string | null;
  /** 섹션 단위 정성 분석(Ⅲ.2 기능 분석·Ⅳ 핵심구매요소·Ⅴ.2 4대가치 종합·Ⅵ.2 UX 품질).
   * lib/pipeline/sectionAnalysis.ts가 생성해 저장한다. 웹 뷰어가 인라인 편집한다. */
  section_analyses: SectionAnalyses | null;
  created_at: string;
  updated_at: string;
}

/** reports.section_analyses jsonb의 형태. sectionAnalysis.ts의 SectionAnalyses와 동일. */
export interface SectionAnalyses {
  featureExperience?: string;
  corePurchaseFactor?: string;
  fourValues?: string;
  uxQuality?: string;
}

/**
 * 제품 정보(PRD 5.0절)는 raw data 업로드보다 먼저 대화에 나올 수 있어, quant_stats와
 * 마찬가지로 file_url에 upsert한다 — 어느 쪽이 먼저 저장되든 reports 행이 생기고
 * 나머지 컬럼은 나중에 채워진다. jsonb `||` 병합이라 이미 저장된 필드는 이번 호출에
 * 없으면 그대로 유지된다(부분 필드만 여러 번 나눠 보내도 누적, saveStrategicInput과 동일한
 * coalesce 원칙).
 */
export async function saveProductInfo(params: {
  fileUrl: string;
  productInfo: ProductInfo;
}): Promise<void> {
  await sql`
    insert into reports (file_url, product_info, updated_at)
    values (${params.fileUrl}, ${sql.json(JSON.parse(JSON.stringify(params.productInfo)))}, now())
    on conflict (file_url) do update set
      product_info = coalesce(reports.product_info, '{}'::jsonb) || excluded.product_info,
      updated_at = now()
  `;
}

export async function getProductInfoByFileUrl(fileUrl: string): Promise<ProductInfo | null> {
  const [row] = await sql<{ product_info: ProductInfo | null }[]>`
    select product_info from reports where file_url = ${fileUrl}
  `;
  return row?.product_info ?? null;
}

/** raw data 파일 하나당 report 하나. 같은 fileUrl로 재검증하면 정량 통계를 덮어쓴다. */
export async function upsertReportQuantStats(params: {
  fileUrl: string;
  fileName: string | null;
  respondentCount: number;
  quantStats: QuantStats;
}): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into reports (file_url, file_name, respondent_count, quant_stats, updated_at)
    values (
      ${params.fileUrl},
      ${params.fileName},
      ${params.respondentCount},
      ${sql.json(JSON.parse(JSON.stringify(params.quantStats)))},
      now()
    )
    on conflict (file_url) do update set
      file_name = excluded.file_name,
      respondent_count = excluded.respondent_count,
      quant_stats = excluded.quant_stats,
      result_summary = null,
      section_analyses = null,
      updated_at = now()
    returning id
  `;
  return row.id;
}

export async function getReportByFileUrl(fileUrl: string): Promise<ReportRow | null> {
  const [row] = await sql<ReportRow[]>`select * from reports where file_url = ${fileUrl}`;
  return row ?? null;
}

export async function getReportById(reportId: string): Promise<ReportRow | null> {
  const [row] = await sql<ReportRow[]>`select * from reports where id = ${reportId}`;
  return row ?? null;
}

/**
 * 구버전 정량 저장본에는 Ⅷ장의 전반적 만족도 분포가 없을 수 있다. 원본 raw data로
 * 한 번 보완한 값만 해당 JSON 필드에 저장한다. 다른 정량·정성 분석 결과는 변경하지 않는다.
 */
export async function saveOverallSatisfactionDistribution(
  reportId: string,
  distribution: number[],
): Promise<void> {
  await sql`
    update reports
    set
      quant_stats = jsonb_set(
        coalesce(quant_stats, '{}'::jsonb),
        '{overallSatisfactionDistribution}',
        ${sql.json(distribution)}::jsonb,
        true
      ),
      updated_at = now()
    where id = ${reportId}
  `;
}

/** 정량 통계 기반 결과 요약을 저장한다. PDF/DOCX의 단순 재생성은 이 값을 재사용한다. */
export async function saveReportResultSummary(reportId: string, resultSummary: string): Promise<void> {
  await sql`
    update reports
    set result_summary = ${resultSummary}, updated_at = now()
    where id = ${reportId}
  `;
}

/** 섹션 단위 정성 분석을 저장한다(부분 병합 — 이미 저장된 섹션은 이번에 없으면 유지). */
export async function saveReportSectionAnalyses(
  reportId: string,
  analyses: Partial<SectionAnalyses>,
): Promise<void> {
  await sql`
    update reports
    set
      section_analyses = coalesce(section_analyses, '{}'::jsonb) || ${sql.json(JSON.parse(JSON.stringify(analyses)))}::jsonb,
      updated_at = now()
    where id = ${reportId}
  `;
}

/**
 * 정성 파이프라인 결과를 report에 영속화한다. 재실행 시 이전 문항·절·카테고리를 전부
 * 지우고 새로 채운다(체크포인트 승인 이력까지 포함해 초기화 — PRD가 재실행 시 승인 이력
 * 유지 여부를 규정하지 않아 v1은 "재실행 = 새로 검수"로 단순화했다).
 */
export async function saveQualitativeResults(
  reportId: string,
  pipeline: PipelineResult,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`delete from questions where report_id = ${reportId}`;

    for (const q of pipeline.questions) {
      // 극성 요약은 별도 opt-in으로 비워 둔다. 다만 NPS 판단문은 NPS 문항의 기존 고속
      // 분석 1회에 함께 생성되는 선택 산출물이므로 이 JSON에만 보관한다.
      const persistedSummaries = q.kind === "standard" && q.npsJudgment
        ? { nps_judgment: q.npsJudgment }
        : null;
      const [questionRow] = await tx<{ id: string }[]>`
        insert into questions (report_id, question_key, label, kind, polarity_summaries)
        values (${reportId}, ${q.id}, ${q.label}, ${q.kind}, ${persistedSummaries ? tx.json(persistedSummaries) : null})
        returning id
      `;
      const questionId = questionRow.id;

      if (q.kind === "improvement") {
        if (q.stage2.categories.length > 0) {
          const rows = q.stage2.categories.map((c) => ({
            question_id: questionId,
            polarity: null as Polarity | null,
            label: c.label,
            clause_count: c.clause_count,
            quotes: c.quotes,
            insight_draft: c.insight,
          }));
          await tx`insert into categories ${tx(rows)}`;
        }
        continue;
      }

      if (q.clauses.length > 0) {
        const clauseRows = q.clauses.map((c) => ({
          question_id: questionId,
          respondent_id: c.respondent_id,
          clause: c.clause,
          raw_clause: c.raw_clause,
          polarity: c.polarity,
          rationale: c.rationale,
          confidence: c.confidence,
        }));
        await tx`insert into clauses ${tx(clauseRows)}`;
      }

      const categoryRows = (Object.keys(q.stage2ByPolarity) as Polarity[]).flatMap((polarity) => {
        const stage2 = q.stage2ByPolarity[polarity];
        if (!stage2) return [];
        return stage2.categories.map((c) => ({
          question_id: questionId,
          polarity,
          label: c.label,
          clause_count: c.clause_count,
          quotes: c.quotes,
          insight_draft: c.insight,
        }));
      });
      if (categoryRows.length > 0) {
        await tx`insert into categories ${tx(categoryRows)}`;
      }
    }
  });
}

/**
 * 정성 분석 한 문항을 독립적으로 저장한다.
 *
 * 긴 전체 분석이 중단돼도 이미 끝난 문항은 남아야 하므로, 백그라운드 작업자와 채팅 경로는
 * 이 함수를 사용한다. 같은 question_key를 다시 실행하면 그 문항의 절·카테고리만 교체하며,
 * 다른 문항과 검수 결과는 건드리지 않는다.
 */
export async function saveQualitativeQuestionResult(
  reportId: string,
  q: QuestionResult,
): Promise<void> {
  await sql.begin(async (tx) => {
    const persistedSummaries = q.kind === "standard" && q.npsJudgment
      ? { nps_judgment: q.npsJudgment }
      : null;
    const [questionRow] = await tx<{ id: string }[]>`
      insert into questions (report_id, question_key, label, kind, polarity_summaries)
      values (${reportId}, ${q.id}, ${q.label}, ${q.kind}, ${persistedSummaries ? tx.json(persistedSummaries) : null})
      on conflict (report_id, question_key) do update set
        label = excluded.label,
        kind = excluded.kind,
        polarity_summaries = excluded.polarity_summaries
      returning id
    `;
    const questionId = questionRow.id;
    await tx`delete from clauses where question_id = ${questionId}`;
    await tx`delete from categories where question_id = ${questionId}`;

    if (q.kind === "improvement") {
      if (q.stage2.categories.length > 0) {
        await tx`insert into categories ${tx(q.stage2.categories.map((c) => ({
          question_id: questionId,
          polarity: null as Polarity | null,
          label: c.label,
          clause_count: c.clause_count,
          quotes: c.quotes,
          insight_draft: c.insight,
        })))}`;
      }
      return;
    }

    if (q.clauses.length > 0) {
      await tx`insert into clauses ${tx(q.clauses.map((c) => ({
        question_id: questionId,
        respondent_id: c.respondent_id,
        clause: c.clause,
        raw_clause: c.raw_clause,
        polarity: c.polarity,
        rationale: c.rationale,
        confidence: c.confidence,
      })))}`;
    }
    const categoryRows = (Object.keys(q.stage2ByPolarity) as Polarity[]).flatMap((polarity) => {
      const stage2 = q.stage2ByPolarity[polarity];
      if (!stage2) return [];
      return stage2.categories.map((c) => ({
        question_id: questionId,
        polarity,
        label: c.label,
        clause_count: c.clause_count,
        quotes: c.quotes,
        insight_draft: c.insight,
      }));
    });
    if (categoryRows.length > 0) await tx`insert into categories ${tx(categoryRows)}`;
  });
}

export interface ClauseRow {
  id: string;
  question_id: string;
  respondent_id: number;
  clause: string;
  raw_clause: string | null;
  polarity: Polarity;
  rationale: string;
  confidence: "high" | "medium" | "low";
  reviewed: boolean;
  overridden_polarity: Polarity | null;
}

/** 체크포인트 A(7.1절) 대상: 신뢰도 낮음으로 플래그되고 아직 검수 안 된 clause만. */
export async function getPendingPolarityReviews(
  reportId: string,
): Promise<(ClauseRow & { question_label: string })[]> {
  return sql<(ClauseRow & { question_label: string })[]>`
    select c.*, q.label as question_label
    from clauses c
    join questions q on q.id = c.question_id
    where q.report_id = ${reportId} and c.confidence = 'low' and c.reviewed = false
    order by q.created_at, c.respondent_id
  `;
}

export async function reviewClausePolarity(
  clauseId: string,
  overriddenPolarity: Polarity | null,
): Promise<void> {
  await sql`
    update clauses
    set reviewed = true, overridden_polarity = ${overriddenPolarity}
    where id = ${clauseId}
  `;
}

export interface CategoryRow {
  id: string;
  question_id: string;
  polarity: Polarity | null;
  label: string;
  clause_count: number;
  quotes: string[];
  insight_draft: string;
  insight_final: string | null;
  insight_approved: boolean;
}

/** 체크포인트 B(7.2절) 대상: 아직 인사이트가 승인되지 않은 카테고리. */
export async function getPendingInsightReviews(
  reportId: string,
): Promise<(CategoryRow & { question_label: string })[]> {
  return sql<(CategoryRow & { question_label: string })[]>`
    select cat.*, q.label as question_label
    from categories cat
    join questions q on q.id = cat.question_id
    where q.report_id = ${reportId} and cat.insight_approved = false
    order by q.created_at, cat.label
  `;
}

/** 특정 문항(question_key)의 카테고리 전체를 조회한다 — 기능개선제안(As-is→To-be) 생성 시
 * 부정 카테고리를 참고하기 위해 쓴다. */
export async function getCategoriesForQuestion(
  reportId: string,
  questionKey: string,
): Promise<CategoryRow[]> {
  return sql<CategoryRow[]>`
    select cat.* from categories cat
    join questions q on q.id = cat.question_id
    where q.report_id = ${reportId} and q.question_key = ${questionKey}
    order by cat.polarity, cat.label
  `;
}

export async function approveInsight(categoryId: string, finalText: string): Promise<void> {
  await sql`
    update categories
    set insight_final = ${finalText}, insight_approved = true
    where id = ${categoryId}
  `;
}

export interface RecommendationRow {
  id: string;
  report_id: string;
  section: string;
  draft: string;
  final: string | null;
  approved: boolean;
}

/** 제언 초안 저장 (PRD 6.5절). 같은 section으로 재생성하면 이전 draft를 대체한다. */
export async function saveRecommendation(params: {
  reportId: string;
  section: string;
  draft: string;
}): Promise<string> {
  await sql`delete from recommendations where report_id = ${params.reportId} and section = ${params.section}`;
  const [row] = await sql<{ id: string }[]>`
    insert into recommendations (report_id, section, draft)
    values (${params.reportId}, ${params.section}, ${params.draft})
    returning id
  `;
  return row.id;
}

/** 승인 여부와 무관하게 이 report의 제언 초안을 전부 가져온다 — 정성 카테고리와 같은 패턴
 * (getQuestionsWithAllCategories)으로, 웹 작업공간은 체크포인트 승인 전에도 초안을 보여줘야
 * 한다(최종 PDF만 승인된 것만 반영). */
export async function getAllRecommendations(reportId: string): Promise<RecommendationRow[]> {
  return sql<RecommendationRow[]>`
    select * from recommendations where report_id = ${reportId} order by created_at
  `;
}

/** 체크포인트 B(7.2절) 대상②: 아직 승인되지 않은 제언 문단. */
export async function getPendingRecommendationReviews(
  reportId: string,
): Promise<RecommendationRow[]> {
  return sql<RecommendationRow[]>`
    select * from recommendations where report_id = ${reportId} and approved = false
    order by created_at
  `;
}

export async function approveRecommendation(id: string, finalText: string): Promise<void> {
  await sql`
    update recommendations set final = ${finalText}, approved = true where id = ${id}
  `;
}

export interface StrategicInputRow {
  report_id: string;
  customer_request: string | null;
  priority_metric: string | null;
  draft: string | null;
}

/** 종합 전략 제언 (7.3절) — AI가 생성하지 않고 담당자가 채팅으로 전달한 내용을 그대로 저장한다. */
export async function saveStrategicInput(params: {
  reportId: string;
  customerRequest?: string;
  priorityMetric?: string;
  draft?: string;
}): Promise<void> {
  await sql`
    insert into strategic_inputs (report_id, customer_request, priority_metric, draft, updated_at)
    values (
      ${params.reportId},
      ${params.customerRequest ?? null},
      ${params.priorityMetric ?? null},
      ${params.draft ?? null},
      now()
    )
    on conflict (report_id) do update set
      customer_request = coalesce(excluded.customer_request, strategic_inputs.customer_request),
      priority_metric = coalesce(excluded.priority_metric, strategic_inputs.priority_metric),
      draft = coalesce(excluded.draft, strategic_inputs.draft),
      updated_at = now()
  `;
}

export async function getStrategicInput(reportId: string): Promise<StrategicInputRow | null> {
  const [row] = await sql<StrategicInputRow[]>`
    select * from strategic_inputs where report_id = ${reportId}
  `;
  return row ?? null;
}

export interface QuestionRow {
  id: string;
  question_key: string;
  label: string;
  kind: "standard" | "improvement";
  // 극성별 짧은 개조식 총평(positive/negative/neutral) 또는 4대 가치용 한 단락 존댓말 요약
  // (combined) — 문항 종류에 따라 둘 중 하나를 채운다(2026-07-28).
  polarity_summaries: (Partial<Record<Polarity | "combined", string>> & {
    /** NPS 문항의 정량 근거 판단문. 기존 극성 요약과 충돌하지 않는 별도 키다. */
    nps_judgment?: { lines: string[] };
  }) | null;
}

export interface QuestionWithApprovedCategories extends QuestionRow {
  categories: CategoryRow[];
}

/**
 * PDF 조립용(8장): 문항별로 **승인된(insight_approved=true) 카테고리만** 묶어서 반환한다.
 * label·quotes가 확정돼도 insight 승인 전에는 문서에 실리지 않는다는 원칙을 여기서 강제한다.
 */
export async function getQuestionsWithApprovedCategories(
  reportId: string,
): Promise<QuestionWithApprovedCategories[]> {
  const questions = await sql<QuestionRow[]>`
    select id, question_key, label, kind, polarity_summaries from questions
    where report_id = ${reportId} order by created_at
  `;
  const categories = await sql<CategoryRow[]>`
    select cat.* from categories cat
    join questions q on q.id = cat.question_id
    where q.report_id = ${reportId} and cat.insight_approved = true
    order by cat.polarity, cat.label
  `;
  return questions.map((q) => ({
    ...q,
    categories: categories.filter((c) => c.question_id === q.id),
  }));
}

/** PDF 조립용: 승인된 제언만. */
export async function getApprovedRecommendations(reportId: string): Promise<RecommendationRow[]> {
  return sql<RecommendationRow[]>`
    select * from recommendations where report_id = ${reportId} and approved = true
  `;
}

/**
 * 극성 요약(2026-07-21, opt-in 기능) 생성용 — 문항 전부 + 카테고리 전부(승인 여부 무관)를
 * 가져온다. getQuestionsWithApprovedCategories와 달리 insight_approved 필터를 안 건다 —
 * 요약은 체크포인트 B 승인을 기다리지 않고도(결과요약처럼 Tier 1에 가깝게) 바로 만들 수 있어야
 * 사용자가 "지금 보여줘"라고 했을 때 빈 결과가 나오지 않는다.
 */
export async function getQuestionsWithAllCategories(
  reportId: string,
): Promise<QuestionWithApprovedCategories[]> {
  const questions = await sql<QuestionRow[]>`
    select id, question_key, label, kind, polarity_summaries from questions
    where report_id = ${reportId} order by created_at
  `;
  const categories = await sql<CategoryRow[]>`
    select cat.* from categories cat
    join questions q on q.id = cat.question_id
    where q.report_id = ${reportId}
    order by cat.polarity, cat.label
  `;
  return questions.map((q) => ({
    ...q,
    categories: categories.filter((c) => c.question_id === q.id),
  }));
}

/** 극성 요약 결과를 문항별로 저장한다 — 기존 요약이 있으면 병합(coalesce)하지 않고 덮어쓴다
 * (재생성 = 최신 카테고리 기준으로 새로 씀). */
export async function saveQuestionPolaritySummaries(
  questionId: string,
  summaries: Partial<Record<Polarity | "combined", string>>,
): Promise<void> {
  await sql`
    update questions set polarity_summaries = ${sql.json(summaries)} where id = ${questionId}
  `;
}
