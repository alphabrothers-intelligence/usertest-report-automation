// DOCX 버전 최종 보고서(2026-07-23 추가, 도표 이미지 삽입은 2026-07-23 같은 날 재작업).
// PDF(lib/pdf/ReportDocument.tsx)와 완전히 같은 데이터 소스(QuantStats·
// QuestionWithApprovedCategories[]·RecommendationRow[]·StrategicInputRow·resultSummary·
// productInfo)를 받아 같은 Ⅰ~Ⅸ 섹션 순서로 구성한다.
//
// **도표 처리 방식**: 처음엔 PDF의 커스텀 차트를 표(Table)로만 대체했는데("PDF에 있는 도표가
// DOCX엔 다 빠져있다" — 2026-07-23 재지적), docx 패키지 자체가 벡터 드로잉이나 워드 네이티브
// 차트(c:chart)를 지원하지 않아 순수 표 텍스트로는 시각적 도표를 만들 방법이 없다. 처음엔 SVG
// 문자열 + sharp 래스터화로 만들었는데, SVG 텍스트는 실제 폭을 측정할 방법이 없어(추측식
// estimateTextWidth 필요) 라벨이 계속 삐져나오는 문제가 있었다("칸 안에 텍스트가 절대 제대로
// 들어가지 않는다" — 2026-07-23 재지적). **lib/charts/canvasCharts.ts**(@napi-rs/canvas 기반)로
// 교체해서, 실제 캔버스 폰트로 ctx.measureText()가 주는 정확한 텍스트 폭을 쓴다 — 이 파일은
// 그 PNG를 이미지 단락으로 배치만 한다. 표는 그대로 유지해서(정확한 수치를 읽기엔 표가 낫다)
// 도표+표 둘 다 PDF와 같은 구성으로 들어간다.
import {
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableOfContents,
  TextRun,
  AlignmentType,
} from "docx";
import path from "node:path";
import { readFileSync } from "node:fs";
import type { QuantStats } from "@/lib/quant/compute";
import type { QuestionWithApprovedCategories, RecommendationRow } from "@/lib/db/reports";
import type { ProductInfo } from "@/lib/productInfo/types";
import { shortenLabel, zoomedRange } from "@/lib/pdf/sectionsQuant";
import { polarityPct, npsJudgmentLines, splitOverallDirection, parseCustomerRecommendations } from "@/lib/pdf/sectionsQualitative";
import { decodeImprovementLabel } from "@/lib/pipeline/stage2";
import { computeNiceRadarRange, computeBarWithAverageRange } from "@/lib/pdf/charts";
import { colors, FONT } from "./theme";
import { h1, h2, h3, body, markdownLite, placeholder, fieldRow, dataTable, spacer } from "./helpers";
import { parseRichRuns } from "@/lib/report/richText";
import { chartParagraph } from "./chartImage";
import {
  renderVerticalBarChart,
  renderVerticalBarChartWithAverage,
  renderRadarChart,
  renderRadarOverlay,
  renderGroupedBarChart,
  renderRankComposition,
  renderCrossTabStackedBar,
  renderQuadrantChart,
  GROUP_SERIES_PALETTE,
} from "@/lib/charts/canvasCharts";

type Block = Paragraph | Table | TableOfContents;

const NPS_SCALE_PATH = path.join(process.cwd(), "public", "images", "nps-scale.png");

function findQuestion(questions: QuestionWithApprovedCategories[], key: string) {
  return questions.find((q) => q.question_key === key);
}

function findRecommendation(recs: RecommendationRow[], section: string) {
  const r = recs.find((r) => r.section === section);
  return r ? (r.final ?? r.draft) : null;
}

/** 인용문(따옴표로 감싼)을 근거 구간 볼드+밑줄 강조 포함해 TextRun 배열로 만든다.
 * display(quotes_display 항목)가 있으면 그 안의 **__..__** 마킹만 강조로 splice하고,
 * 없으면 원문 quote를 강조 없이 그대로 쓴다. */
function quoteRuns(display: string, color: string): TextRun[] {
  return [
    new TextRun({ text: '"', color }),
    ...parseRichRuns(display).map((run) => new TextRun({ text: run.text, bold: run.bold, underline: run.underline ? {} : undefined, color })),
    new TextRun({ text: '"', color }),
  ];
}

/** Ⅲ/Ⅴ/Ⅷ의 "3종세트"(카테고리+대표인용+인사이트) — PDF의 QuestionQualitativeBlock과
 * 동일한 구조·순서(긍정→부정→중립, improvement 문항은 극성 구분 없이 나열)를 그대로 따른다. */
function questionQualitativeBlock(question: QuestionWithApprovedCategories): Block[] {
  if (question.categories.length === 0) return [];
  const blocks: Block[] = [h3(question.label)];
  const polarityOrder = ["positive", "negative", "neutral"] as const;
  const polarityLabel = { positive: "긍정", negative: "부정", neutral: "중립" };
  const pct = polarityPct(question.categories);
  const pctByPolarity = { positive: pct.positivePct, negative: pct.negativePct, neutral: pct.neutralPct };

  if (question.kind === "standard") {
    blocks.push(body(`긍정 ${pct.positivePct}% · 부정 ${pct.negativePct}% · 중립 ${pct.neutralPct}%`, { color: colors.subtext }));
    let bannerIndex = 0;
    for (const p of polarityOrder) {
      const inPolarity = question.categories.filter((c) => c.polarity === p);
      if (inPolarity.length === 0) continue;
      bannerIndex += 1;
      blocks.push(
        new Paragraph({
          spacing: { before: 120, after: 60 },
          children: [
            new TextRun({
              text: `${bannerIndex}. ${polarityLabel[p]} 의견 (${pctByPolarity[p]}%)`,
              bold: true,
              color: p === "positive" ? colors.navyLight : p === "negative" ? colors.negativeText : colors.subtext,
            }),
          ],
        }),
      );
      if (question.polarity_summaries?.[p]) {
        blocks.push(body(question.polarity_summaries[p] as string));
      }
      for (const c of inPolarity) {
        blocks.push(
          new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `[${c.label}] (${c.clause_count}건)`, bold: true })] }),
        );
        c.quotes.slice(0, 3).forEach((q, qi) => {
          blocks.push(
            new Paragraph({
              indent: { left: 200 },
              spacing: { after: 20 },
              children: quoteRuns(c.quotes_display?.[qi] ?? q, colors.subtext),
            }),
          );
        });
        blocks.push(
          new Paragraph({
            spacing: { after: 100 },
            children: [new TextRun({ text: `→ ${c.insight_final ?? c.insight_draft}`, bold: true, color: colors.insight })],
          }),
        );
      }
    }
  } else {
    // 개선아이디어(kind="improvement")는 인사이트 없이 [대분류]+<소분류>+원문 인용만 나열하는
    // 원본 45~49쪽 2단 계층이다(PDF의 ImprovementCategoryBlocks와 동일 로직 — 라벨이
    // "대분류"+IMPROVEMENT_LABEL_SEP+"소분류"로 인코딩돼 있어 디코딩 없이 그대로 쓰면
    // 제어문자가 섞인 원문이 노출되고, insight 자리엔 존재하지 않는 값이 찍힌다).
    const byMajor = new Map<string, typeof question.categories>();
    for (const c of question.categories) {
      const { major } = decodeImprovementLabel(c.label);
      const key = major || "기타";
      (byMajor.get(key) ?? byMajor.set(key, []).get(key)!).push(c);
    }
    for (const [major, subs] of byMajor) {
      blocks.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: `[${major}]`, bold: true })] }));
      for (const c of subs) {
        const { sub } = decodeImprovementLabel(c.label);
        blocks.push(
          new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `<${sub}>`, bold: true })] }),
        );
        c.quotes.forEach((q, qi) => {
          blocks.push(
            new Paragraph({
              indent: { left: 200 },
              spacing: { after: 20 },
              children: quoteRuns(c.quotes_display?.[qi] ?? q, colors.subtext),
            }),
          );
        });
      }
    }
  }
  return blocks;
}

// ── Ⅰ 개요 (PDF도 이 장은 차트가 없다 — 표만) ────────────────────────────
function sectionOverview(productInfo: ProductInfo | undefined, stats: QuantStats): Block[] {
  // 설문 문항은 실제 raw data 헤더에서 도출한 stats.surveyQuestions를 그대로 쓴다(2026-07-23).
  const surveyRows = stats.surveyQuestions;
  return [
    h1("Ⅰ. 개요"),
    h2("1. 제품 소개"),
    body("기업 개요", { bold: true }),
    fieldRow("기업명", productInfo?.companyName),
    fieldRow("홈페이지", productInfo?.homepage),
    fieldRow("대표자", productInfo?.representative),
    fieldRow("업무담당자", productInfo?.contactPerson),
    body("제품·서비스 개요", { bold: true }),
    fieldRow("서비스명", productInfo?.serviceName),
    fieldRow("서비스 요약", productInfo?.serviceSummary),
    fieldRow("사업영역", productInfo?.businessArea),
    fieldRow("산업분야", productInfo?.industry),
    fieldRow("운영환경", productInfo?.operatingEnvironment),
    fieldRow("사업화단계", productInfo?.businessStage),
    h2("2. 사용성 테스트 진행 일정"),
    fieldRow("테스트 진행 기간", productInfo?.testPeriod),
    fieldRow("테스트 대상", productInfo?.testTarget),
    fieldRow("담당자", productInfo?.testManager),
    h2("3. 사용성 테스트 설문 항목"),
    dataTable(["단계", "주요 활동"], surveyRows.map((r) => [r.stage, r.question]), [25, 75]),
  ];
}

// ── Ⅱ 인적사항 및 특성조사 ──────────────────────────────────────────────
async function sectionDemographics(stats: QuantStats): Promise<Block[]> {
  const d = stats.demographics;
  const blocks: Block[] = [
    h1("Ⅱ. 인적사항 및 특성조사"),
    body(`전체 응답자 ${stats.respondentCount}명 (평균 연령 ${d.age.mean}세, SD ${d.age.sd})`),
    h2("Q1. 나이를 입력해주세요"),
    await chartParagraph(renderVerticalBarChart(d.ageDistribution.map((g) => ({ label: g.label, value: g.percentage })), 100, "%")),
    dataTable(["구간", "비율"], d.ageDistribution.map((g) => [g.label, `${g.percentage}%`])),
    h2("Q2. 성별을 선택해주세요"),
    await chartParagraph(renderVerticalBarChart(d.gender.map((g) => ({ label: g.label, value: g.percentage })), 100, "%")),
    dataTable(["성별", "비율"], d.gender.map((g) => [g.label, `${g.percentage}%`])),
    h3("성별 × 연령대"),
    await chartParagraph(
      renderCrossTabStackedBar(
        d.genderByAgeBracket.map((r) => ({ label: r.label, segments: r.segments })),
        d.genderByAgeBracket[0]?.segments.map((s) => s.name) ?? [],
        Math.max(1, ...d.genderByAgeBracket.map((r) => r.segments.reduce((sum, s) => sum + s.count, 0))),
      ),
    ),
    dataTable(
      ["성별", ...(d.genderByAgeBracket[0]?.segments.map((s) => s.name) ?? [])],
      d.genderByAgeBracket.map((r) => [r.label, ...r.segments.map((s) => s.count)]),
    ),
    h2("Q3. 현재 사용하시는 스마트폰 운영체제를 선택해주세요"),
    await chartParagraph(renderVerticalBarChart(d.os.map((g) => ({ label: g.label, value: g.percentage })), 100, "%")),
    dataTable(["운영체제", "비율"], d.os.map((g) => [g.label, `${g.percentage}%`])),
    h2("Q4. 하루 평균 걷는 시간은 어느 정도인가요?"),
    await chartParagraph(renderVerticalBarChart(d.avgWalkTime.map((g) => ({ label: g.label, value: g.percentage })), 100, "%")),
    dataTable(["구간", "비율"], d.avgWalkTime.map((g) => [g.label, `${g.percentage}%`])),
    h2("Q5. 일주일에 몇 일 정도 산책을 하시나요?"),
    await chartParagraph(renderVerticalBarChart(d.walkFrequencyPerWeek.map((g) => ({ label: g.label, value: g.percentage })), 100, "%")),
    dataTable(["구간", "비율"], d.walkFrequencyPerWeek.map((g) => [g.label, `${g.percentage}%`])),
    h2("유사 서비스 이용 경험"),
    body(
      `경험 있음 ${d.priorServiceExperienceRate}% · 해당 서비스 평균 만족도 ${d.priorServiceSatisfaction.mean}점(SD ${d.priorServiceSatisfaction.sd})`,
    ),
  ];
  return blocks;
}

// ── Ⅲ 기능별 고객경험평가 ───────────────────────────────────────────────
async function sectionFeatureExperience(
  stats: QuantStats,
  featureQuestions: QuestionWithApprovedCategories[],
): Promise<Block[]> {
  const ranked = [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean);
  const overallAverage = Math.round((ranked.reduce((sum, f) => sum + f.mean, 0) / ranked.length) * 100) / 100;
  const [chartMin, chartMax] = computeBarWithAverageRange(ranked.map((f) => f.mean), overallAverage);
  const blocks: Block[] = [
    h1("Ⅲ. 기능별 고객경험평가"),
    h2("기능별 만족도"),
    await chartParagraph(
      renderVerticalBarChartWithAverage(
        ranked.map((f) => ({ label: f.name, value: f.mean })),
        chartMin,
        chartMax,
        "점",
        "[ 기능별 만족도 조사 결과 ]",
        overallAverage,
        "만족도 평균",
      ),
    ),
    dataTable(["기능", "평균 만족도", "표준편차"], ranked.map((f) => [f.name, f.mean, f.sd])),
    h2("문항별 정성 분석"),
  ];
  for (const q of featureQuestions) blocks.push(...questionQualitativeBlock(q));
  return blocks;
}

// ── Ⅳ 핵심구매요소 ─────────────────────────────────────────────────────
async function sectionCorePurchaseFactor(stats: QuantStats, recommendation: string | null): Promise<Block[]> {
  const ranked = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const satisfactionByName = new Map(stats.featureSatisfaction.map((f) => [f.name, f.mean]));
  return [
    h1("Ⅳ. 핵심구매요소"),
    h2("가장 영향을 미치는 핵심 요인"),
    await chartParagraph(
      renderVerticalBarChart(
        stats.keyFactorDistribution.map((k) => ({ label: shortenLabel(k.label), value: k.percentage })),
        100,
        "%",
        "[ 핵심구매요소 조사 결과 ]",
      ),
    ),
    dataTable(
      ["No", "핵심 기능", "순위", "비율"],
      stats.keyFactorDistribution.map((k, i) => [i + 1, shortenLabel(k.label), `${i + 1}위`, `${k.percentage}%`]),
      [10, 50, 15, 25],
    ),
    h2("기능 중요도 순위 구성"),
    await chartParagraph(renderRankComposition(stats.rankPositionComposition, stats.featureSatisfaction.map((f) => f.name))),
    h2("기능별 상대중요도"),
    body("상대 중요도: 중요 순위 응답을 0점 기준 +5~-5점 점수로 환산한 값", { color: colors.subtext }),
    dataTable(["기능", "상대 중요도"], ranked.map((r) => [r.name, r.score])),
    h2("기능별 상대 중요도-만족도 그래프"),
    await chartParagraph(
      renderQuadrantChart(
        ranked.map((r) => ({ name: r.name, importance: r.score, satisfaction: satisfactionByName.get(r.name) ?? 0 })),
        560,
        520,
      ),
    ),
    h2("해석"),
    recommendation ? body(recommendation) : placeholder("제언이 아직 생성·승인되지 않았습니다."),
  ];
}

// ── Ⅴ 4대가치 만족도 ───────────────────────────────────────────────────
async function sectionFourValues(stats: QuantStats, valueQuestions: QuestionWithApprovedCategories[]): Promise<Block[]> {
  const rows = [
    { label: "기능적 가치", ...stats.fourValues.functional },
    { label: "심미적 가치", ...stats.fourValues.aesthetic },
    { label: "경제적 가치", ...stats.fourValues.economic },
    { label: "사회·공공적 가치", ...stats.fourValues.social },
  ];
  const average = Math.round((rows.reduce((a, r) => a + r.mean, 0) / rows.length) * 100) / 100;
  const [chartMin, chartMax] = computeBarWithAverageRange(rows.map((r) => r.mean), average);
  const blocks: Block[] = [
    h1("Ⅴ. 4대가치 만족도"),
    h2("가치 영역별 만족도"),
    await chartParagraph(
      renderVerticalBarChartWithAverage(
        rows.map((r) => ({ label: r.label, value: r.mean })),
        chartMin,
        chartMax,
        "점",
        "[ 4대 가치 만족도 종합 결과 ]",
        average,
        "만족도 평균",
      ),
    ),
    dataTable(["가치", "평균", "표준편차"], rows.map((r) => [r.label, r.mean, r.sd])),
    h2("문항별 정성 분석"),
  ];
  for (const q of valueQuestions) blocks.push(...questionQualitativeBlock(q));
  return blocks;
}

// ── Ⅵ 사용자 경험 품질 평가 ────────────────────────────────────────────
async function sectionUxQuality(stats: QuantStats): Promise<Block[]> {
  const uxGroups = [
    { name: "실용성", items: stats.uxQuality.usability, color: GROUP_SERIES_PALETTE[0] },
    { name: "즐거움", items: stats.uxQuality.fun, color: GROUP_SERIES_PALETTE[1] },
  ];
  const all = uxGroups.flatMap((g) => g.items);
  const { min, max, levels } = computeNiceRadarRange(all.map((u) => u.mean));
  return [
    h1("Ⅵ. 사용자 경험 품질 평가"),
    h2("전체"),
    await chartParagraph(renderRadarChart(all.map((u) => ({ label: u.name, value: u.mean })), min, max, levels, 240)),
    h2("실용성"),
    await chartParagraph(
      renderRadarChart(uxGroups[0].items.map((u) => ({ label: u.name, value: u.mean })), min, max, levels, 200, uxGroups[0].color),
    ),
    dataTable(["문항", "점수"], uxGroups[0].items.map((u) => [u.name, u.mean])),
    h2("즐거움"),
    await chartParagraph(
      renderRadarChart(uxGroups[1].items.map((u) => ({ label: u.name, value: u.mean })), min, max, levels, 200, uxGroups[1].color),
    ),
    dataTable(["문항", "점수"], uxGroups[1].items.map((u) => [u.name, u.mean])),
  ];
}

// ── Ⅶ 교차분석 ─────────────────────────────────────────────────────────
function fourValuesRow(g: QuantStats["crossAnalysis"]["byAgeGroup"][number]) {
  return [g.fourValues.functional, g.fourValues.aesthetic, g.fourValues.economic, g.fourValues.social];
}
const FOUR_VALUE_LABELS = ["기능적 가치", "심미적 가치", "경제적 가치", "사회·공공적 가치"];

async function crossGroupBlocks(
  groups: QuantStats["crossAnalysis"]["byAgeGroup"],
  featureOrder: string[],
  includeUx: boolean,
): Promise<Block[]> {
  if (groups.length === 0) return [placeholder("교차분석 대상 응답이 없습니다.")];
  const groupNames = groups.map((g) => g.group);
  const seriesColor = (i: number) => GROUP_SERIES_PALETTE[i % GROUP_SERIES_PALETTE.length];
  const featureByName = groups.map((g) => new Map(g.featureSatisfaction.map((f) => [f.name, f.mean])));
  const featureSeries = groups.map((g, i) => ({
    name: `${g.group}(n=${g.n})`,
    color: seriesColor(i),
    values: featureOrder.map((name) => featureByName[i].get(name) ?? 0),
  }));
  const [featureMin, featureMax] = zoomedRange(groups.flatMap((g) => g.featureSatisfaction.map((f) => f.mean)));
  const [valueMin, valueMax] = zoomedRange(groups.flatMap(fourValuesRow));

  const blocks: Block[] = [
    h3("기능별 만족도 차이"),
    await chartParagraph(renderGroupedBarChart(featureOrder, featureSeries, featureMin, featureMax, "점")),
    dataTable(
      ["기능", ...groupNames.map((n, i) => `${n} (n=${groups[i].n})`)],
      featureOrder.map((name) => [name, ...groups.map((g) => g.featureSatisfaction.find((f) => f.name === name)?.mean ?? "-")]),
    ),
    h3("4대가치 만족도 차이"),
    await chartParagraph(
      renderGroupedBarChart(
        FOUR_VALUE_LABELS,
        groups.map((g, i) => ({ name: `${g.group}(n=${g.n})`, color: seriesColor(i), values: fourValuesRow(g) })),
        valueMin,
        valueMax,
        "점",
      ),
    ),
    dataTable(
      ["가치", ...groupNames.map((n, i) => `${n} (n=${groups[i].n})`)],
      FOUR_VALUE_LABELS.map((label, i) => [label, ...groups.map((g) => fourValuesRow(g)[i])]),
    ),
  ];
  if (includeUx) {
    const uxAxes = [...groups[0].uxQuality.usability.map((u) => u.name), ...groups[0].uxQuality.fun.map((u) => u.name)];
    const uxValues = groups.flatMap((g) => [...g.uxQuality.usability, ...g.uxQuality.fun].map((u) => u.mean));
    const range = uxValues.length ? computeNiceRadarRange(uxValues) : { min: 0, max: 10, levels: 6 };
    blocks.push(
      h3("사용자 경험 품질 차이"),
      await chartParagraph(
        renderRadarOverlay(
          uxAxes,
          groups.map((g, i) => ({
            name: g.group,
            color: seriesColor(i),
            values: [...g.uxQuality.usability, ...g.uxQuality.fun].map((u) => u.mean),
          })),
          range.min,
          range.max,
          range.levels,
          220,
        ),
      ),
      dataTable(
        ["항목", ...groupNames.map((n, i) => `${n} (n=${groups[i].n})`)],
        uxAxes.map((name, i) => [name, ...groups.map((g) => [...g.uxQuality.usability, ...g.uxQuality.fun][i]?.mean ?? "-")]),
      ),
    );
  }
  return blocks;
}

async function sectionCrossAnalysis(stats: QuantStats): Promise<Block[]> {
  // 실제 발행 보고서는 Ⅲ장(기능별 만족도) 내림차순과 같은 순서로 항목을 배열한다(PDF
  // sectionsQuant.tsx SectionCrossAnalysis와 동일 원칙).
  const featureOrder = [...stats.featureSatisfaction].sort((a, b) => b.mean - a.mean).map((f) => f.name);
  return [
    h1("Ⅶ. 교차분석"),
    h2("연령대별 기능 만족도"),
    ...(await crossGroupBlocks(stats.crossAnalysis.byAgeGroup, featureOrder, false)),
    h2("성별 기능 만족도"),
    ...(await crossGroupBlocks(stats.crossAnalysis.byGender, featureOrder, true)),
  ];
}

// ── Ⅷ NPS 종합만족도 및 개선아이디어 ───────────────────────────────────
async function sectionNpsAndImprovement(
  stats: QuantStats,
  overallQuestion: QuestionWithApprovedCategories | undefined,
  npsQuestion: QuestionWithApprovedCategories | undefined,
  improvementQuestion: QuestionWithApprovedCategories | undefined,
): Promise<Block[]> {
  const nps = stats.nps;
  // 사용자가 준 원본 NPS 척도 이미지(public/images/nps-scale.png)를 그대로 삽입한다 — PDF와
  // 같은 원칙(코드로 새로 그리지 않는다, 6차 대조 참고).
  const npsImageBuffer = readFileSync(NPS_SCALE_PATH);
  const npsImageParagraph = new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160 },
    children: [new ImageRun({ type: "png", data: npsImageBuffer, transformation: { width: 460, height: 205 } })],
  });

  const blocks: Block[] = [
    h1("Ⅷ. NPS 종합만족도 및 개선아이디어"),
    h2("종합 만족도 및 NPS 지수"),
    body(`전반적 만족도 평균 ${stats.overallSatisfaction.mean}점(SD ${stats.overallSatisfaction.sd})`),
    npsImageParagraph,
    body(
      "NPS(Net Promoter Score, 순수 고객추천/구매 지수)는 글로벌 자문업체 Bain & Company가 실제 고객 충성도를 " +
        "측정하기 위해 제시한 지표다. 구매/추천고객(PROMOTER, 9~10점), 중립 고객(PASSIVE, 7~8점), " +
        "비구매/비추천 고객(DETRACTOR, 0~6점) 비율로 산출한다.",
      { color: colors.subtext },
    ),
    dataTable(
      ["평균 구매 의향", "NPS 지수", "구매 고객(%)", "중립 고객(%)", "비구매 고객(%)"],
      [[nps.rawMean, nps.npsScore, nps.promoterPct, nps.passivePct, nps.detractorPct]],
    ),
    spacer(),
  ];
  for (const line of npsJudgmentLines(nps, npsQuestion?.polarity_summaries?.nps_judgment)) {
    blocks.push(
      new Paragraph({
        spacing: { after: 60 },
        bullet: { level: 0 },
        children: line.map((seg) => new TextRun({ text: seg.text, bold: seg.bold, underline: seg.underline ? {} : undefined })),
      }),
    );
  }
  if (overallQuestion) blocks.push(...questionQualitativeBlock(overallQuestion));
  if (npsQuestion) blocks.push(...questionQualitativeBlock(npsQuestion));
  blocks.push(h2("개선 아이디어"));
  blocks.push(
    ...(improvementQuestion ? questionQualitativeBlock(improvementQuestion) : [placeholder("정성 분석 결과가 아직 없습니다.")]),
  );
  return blocks;
}

// ── Ⅸ 종합결과 및 제언 ─────────────────────────────────────────────────
async function sectionConclusion(
  stats: QuantStats,
  featureQuestions: QuestionWithApprovedCategories[],
  resultSummary: string,
  devPriorityRecommendation: string | null,
  featureRecommendations: RecommendationRow[],
  customerRecommendations: RecommendationRow | null,
  strategicInput: { customerRequest: string | null; priorityMetric: string | null; draft: string | null } | null,
): Promise<Block[]> {
  const ranked = [...stats.relativeImportance].sort((a, b) => b.score - a.score);
  const satisfactionByName = new Map(stats.featureSatisfaction.map((f) => [f.name, f.mean]));
  const questionByName = new Map(featureQuestions.map((q) => [q.question_key.replace(/^feature:/, ""), q]));
  const summaryRows = ranked.map((r) => {
    const q = questionByName.get(r.name);
    const pct = q ? polarityPct(q.categories) : { positivePct: 0, negativePct: 0, neutralPct: 0 };
    return { name: r.name, satisfaction: satisfactionByName.get(r.name) ?? 0, importance: r.score, ...pct };
  });

  const blocks: Block[] = [
    h1("Ⅸ. 종합결과 및 제언"),
    h2("1. 사용성테스트 결과 요약"),
    ...markdownLite(resultSummary),
  ];
  if (summaryRows.length > 0) {
    blocks.push(
      body("기능별 고객 경험 평가", { bold: true }),
      await chartParagraph(
        renderQuadrantChart(
          summaryRows.map((r) => ({ name: r.name, importance: r.importance, satisfaction: r.satisfaction })),
          520,
          320,
        ),
      ),
      dataTable(
        ["기능명", "평균 만족도(점)", "상대 중요도", "긍정 비율(%)", "중립 비율(%)", "부정 비율(%)"],
        summaryRows.map((r) => [r.name, r.satisfaction, r.importance, r.positivePct, r.neutralPct, r.negativePct]),
      ),
    );
  }
  // 원본 53쪽 "2. 개선 전략 제언"은 전반적 방향성/개발 우선순위 제언/기능 개선 제안 3블록이다
  // (PDF의 SectionConclusion과 동일 구조로 맞췄다 — 예전엔 "2. 개발 우선순위 제언" 헤딩 하나에
  // 전반적 방향성까지 뭉쳐 있었고 3번 자리엔 As-is/To-be가 잘못 들어가 있었다).
  const { overall, rest: devPriorityRest } = splitOverallDirection(devPriorityRecommendation);
  blocks.push(
    h2("2. 개선 전략 제언"),
    body("전반적 방향성", { bold: true }),
    overall ? body(overall) : body("핵심구매요소, 만족도·상대 중요도, NPS 지수를 함께 참조하여 우선 개선 항목을 검토할 필요가 있습니다."),
    body("개발 우선순위 제언", { bold: true }),
    devPriorityRest ? body(devPriorityRest) : placeholder("제언이 아직 생성·승인되지 않았습니다."),
    body("기능 개선 제안", { bold: true }),
  );
  if (featureRecommendations.length === 0) {
    blocks.push(placeholder("승인된 기능개선제안이 아직 없습니다."));
  } else {
    for (const r of featureRecommendations) {
      blocks.push(
        new Paragraph({ spacing: { before: 100, after: 20 }, children: [new TextRun({ text: `[${r.section.replace("feature_improvement:", "")}]`, bold: true })] }),
        body(r.final ?? r.draft),
      );
    }
  }
  blocks.push(h2("3. 기능별 고객 제언 종합"));
  const customerFeatures = parseCustomerRecommendations(customerRecommendations);
  if (!customerFeatures || customerFeatures.length === 0) {
    blocks.push(placeholder("기능별 고객 제언은 정성 분석 승인 후 표시됩니다."));
  } else {
    customerFeatures.forEach((f, i) => {
      blocks.push(
        new Paragraph({ spacing: { before: 100, after: 20 }, children: [new TextRun({ text: `[기능 ${i + 1}] ${f.featureName}`, bold: true })] }),
      );
      f.actions.forEach((action, j) => {
        blocks.push(body(`고객 제언 ${j + 1}. ${action}`));
      });
    });
  }
  blocks.push(h2("4. 종합 전략 제언"));
  if (strategicInput?.draft) {
    blocks.push(body(strategicInput.draft));
  } else {
    blocks.push(placeholder("담당자 입력 대기 중 (AI가 임의로 작성하지 않음)"));
    if (strategicInput?.customerRequest) blocks.push(body(`고객사 요청사항: ${strategicInput.customerRequest}`, { color: colors.subtext }));
    if (strategicInput?.priorityMetric) blocks.push(body(`우선 고려 지표: ${strategicInput.priorityMetric}`, { color: colors.subtext }));
  }
  return blocks;
}

export interface ReportDocxProps {
  fileName: string | null;
  generatedAt: string;
  quantStats: QuantStats;
  questions: QuestionWithApprovedCategories[];
  recommendations: RecommendationRow[];
  strategicInput: { customer_request: string | null; priority_metric: string | null; draft: string | null } | null;
  resultSummary: string;
  productInfo?: ProductInfo;
}

export async function buildReportDocx(props: ReportDocxProps): Promise<Document> {
  const { fileName, generatedAt, quantStats, questions, recommendations, strategicInput, resultSummary, productInfo } = props;
  const featureQuestions = questions.filter((q) => q.question_key.startsWith("feature:"));
  const valueQuestions = questions.filter((q) => q.question_key.startsWith("values:"));
  const featureRecommendations = recommendations.filter((r) => r.section.startsWith("feature_improvement:"));

  // 표지 — PDF 표지와 같은 원칙: fileName(raw data 파일명)은 표지에 노출하지 않는다
  // (2026-07-23 명시적 요청 — "raw data.xlsx가 표지에 절대 같이 생성되면 안 된다"). fileName
  // 인자 자체는 남겨두는데, 이후 다운로드 파일명(예: "리바랩스_결과보고서.docx")을 만들 때는
  // 필요하기 때문이다 — 표지 "본문"에만 안 쓴다는 뜻이다.
  void fileName;
  const coverChildren: Paragraph[] = [
    spacer(2000),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: "사용성 테스트 결과보고서", bold: true, size: 56, color: colors.navy })],
    }),
    new Paragraph({
      spacing: { before: 200 },
      children: [new TextRun({ text: productInfo?.companyName ?? "기업명 입력 필요", bold: true, size: 36, color: colors.navyLight })],
    }),
    new Paragraph({
      spacing: { before: 120 },
      children: [
        new TextRun({
          text: `Usability Test Proposal for '${productInfo?.serviceName ?? "서비스명 입력 필요"}'`,
          size: 22,
          color: colors.subtext,
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 400 },
      children: [new TextRun({ text: generatedAt.replace(/-/g, "."), size: 19, color: colors.subtext })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const tocChildren: Block[] = [
    new Paragraph({ text: "목차", heading: HeadingLevel.TITLE }),
    // Word 네이티브 TOC 필드 — 문서를 열면(또는 F9로 갱신하면) Heading1/2로 태그된 제목들의
    // 실제 쪽수가 자동으로 채워진다. PDF 쪽은 react-pdf가 선언적 1회 렌더라 실제 페이지 번호를
    // 미리 계산할 방법이 없어 클릭 링크로 대체했지만(ReportDocument.tsx 주석 참고), Word는
    // 필드 갱신이 기본 지원되므로 여기서는 오히려 더 정확한(실제 쪽수 포함) 목차를 만들 수 있다.
    // 다음 Paragraph(Ⅰ장 h1)가 helpers.ts의 h1()에서 문단 단위 pageBreakBefore를 이미 주므로,
    // 여기 별도 PageBreak을 또 넣으면 목차 뒤에 빈 페이지가 하나 더 생긴다 — 넣지 않는다.
    new TableOfContents("목차", { hyperlink: true, headingStyleRange: "1-2" }),
  ];

  // 차트 이미지 래스터화(sharp)가 섞여 있어 섹션 함수 대부분이 비동기다 — 순서를 보장해야
  // 하는 문서 조립이라 Promise.all(병렬)이 아니라 순차 await로 만든다(속도보다 코드 단순함).
  const contentChildren: Block[] = [
    ...sectionOverview(productInfo, quantStats),
    ...(await sectionDemographics(quantStats)),
    ...(await sectionFeatureExperience(quantStats, featureQuestions)),
    ...(await sectionCorePurchaseFactor(quantStats, findRecommendation(recommendations, "core_purchase_factor"))),
    ...(await sectionFourValues(quantStats, valueQuestions)),
    ...(await sectionUxQuality(quantStats)),
    ...(await sectionCrossAnalysis(quantStats)),
    ...(await sectionNpsAndImprovement(
      quantStats,
      findQuestion(questions, "overallSatisfaction"),
      findQuestion(questions, "nps"),
      findQuestion(questions, "improvementIdea"),
    )),
    ...(await sectionConclusion(
      quantStats,
      featureQuestions,
      resultSummary,
      findRecommendation(recommendations, "dev_priority"),
      featureRecommendations,
      recommendations.find((r) => r.section === "feature_customer_recommendations") ?? null,
      strategicInput
        ? {
            customerRequest: strategicInput.customer_request,
            priorityMetric: strategicInput.priority_metric,
            draft: strategicInput.draft,
          }
        : null,
    )),
  ];

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: `- `, size: 16, color: colors.subtext }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: colors.subtext }),
          new TextRun({ text: ` -`, size: 16, color: colors.subtext }),
        ],
      }),
    ],
  });

  return new Document({
    creator: "Alphabrothers",
    title: "사용성 테스트 결과보고서",
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: FONT, size: 20 } },
        heading1: { run: { font: FONT, size: 32, bold: true, color: colors.navy }, paragraph: { spacing: { before: 320, after: 160 } } },
        heading2: { run: { font: FONT, size: 24, bold: true, color: colors.navy } },
        heading3: { run: { font: FONT, size: 21, bold: true } },
      },
    },
    sections: [
      // 표지 섹션(2026-07-23) — PDF와 같은 이유로 별도 섹션으로 분리해 푸터(쪽수)가 표지에는
      // 안 나오게 한다.
      {
        properties: { page: { margin: { top: 1200, bottom: 1200, left: 1100, right: 1100 } } },
        children: coverChildren,
      },
      {
        properties: { page: { margin: { top: 900, bottom: 1100, left: 1100, right: 1100 } } },
        footers: { default: footer },
        children: [...tocChildren, ...contentChildren],
      },
    ],
  });
}
