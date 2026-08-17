/* DB 결과 JSON을 HWPX 원본의 고정 지면에 넣기 위한 로컬 문서 계획으로 변환한다. */
const fs = require("node:fs/promises");
const path = require("node:path");

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("사용법: node build-content-plan.cjs <input.json> <output.json>");

const polarities = ["positive", "negative", "neutral"];
const labels = { positive: "긍정", negative: "부정", neutral: "중립" };

function pct(value, total) {
  return total ? Number(((value / total) * 100).toFixed(1)) : 0;
}

function selectCategories(categories, polarity) {
  return categories
    .filter((category) => category.polarity === polarity)
    .sort((a, b) => b.clauseCount - a.clauseCount || a.label.localeCompare(b.label, "ko"))
    .slice(0, 3)
    .map((category) => ({
      label: category.label,
      clauseCount: category.clauseCount,
      quotes: category.quotes.slice(0, 2),
      insight: category.insight
    }));
}

function polarityBlock(question) {
  const categories = question.categories || [];
  const counts = Object.fromEntries(polarities.map((polarity) => [
    polarity,
    categories.filter((category) => category.polarity === polarity)
      .reduce((sum, category) => sum + Number(category.clauseCount || 0), 0)
  ]));
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return {
    kind: "shared-polarity-analysis",
    title: "주관식 응답 감정 분석",
    chart: { type: "donut", values: polarities.map((polarity) => ({ label: labels[polarity], count: counts[polarity], percentage: pct(counts[polarity], total) })) },
    summaryTable: polarities.map((polarity) => ({ label: labels[polarity], count: counts[polarity], percentage: pct(counts[polarity], total) })),
    groups: polarities.map((polarity) => ({
      polarity,
      label: `${labels[polarity]} 의견`,
      categories: selectCategories(categories, polarity)
    }))
  };
}

async function main() {
  const data = JSON.parse(await fs.readFile(input, "utf8"));
  const featureQuestions = new Map(data.questions.filter((question) => question.question_key.startsWith("feature:")).map((question) => [question.question_key.slice(8), question]));
  const features = data.report.quant_stats.featureSatisfaction || [];
  const plan = {
    report: {
      id: data.report.id,
      name: data.report.report_name,
      productType: data.report.product_type || "sw",
      companyName: data.report.product_info?.companyName || null,
      serviceName: data.report.product_info?.serviceName || null
    },
    templates: {
      sw: "리바랩스 원본 구조",
      physical: "케어클 원본 구조",
      sharedPolarityAnalysis: "리바랩스 정성 분석 시각 구조"
    },
    featurePages: features.map((feature, index) => ({
      sequence: index + 1,
      feature: feature.name,
      quantitative: { mean: feature.mean, sd: feature.sd, distribution: feature.scoreDistribution || [] },
      polarityAnalysis: featureQuestions.has(feature.name) ? polarityBlock(featureQuestions.get(feature.name)) : null
    })),
    conclusion: {
      resultSummary: data.report.result_summary,
      sectionAnalyses: data.report.section_analyses,
      recommendations: data.recommendations
    }
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(plan, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ featurePages: plan.featurePages.length, polarityModules: plan.featurePages.filter((page) => page.polarityAnalysis).length, output }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
