/*
 * DB에 이미 저장된 제언을 다시 생성하지 않고, 어떤 저장 결과를 근거로
 * 문서에 배치했는지 추적 가능한 manifest를 만든다. 이 파일은 웹 UI나
 * 분석 파이프라인을 수정하지 않는 로컬 HWPX 컴파일용 산출물이다.
 */
const fs = require("node:fs/promises");
const path = require("node:path");

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  throw new Error("사용법: node build-recommendation-rationale.cjs <db-export.json> <output.json>");
}

const featurePrefix = "feature_improvement:";

function quote(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function featureEvidence(question) {
  const categories = Array.isArray(question?.categories) ? question.categories : [];
  return categories
    .slice()
    .sort((left, right) => Number(right.clauseCount || 0) - Number(left.clauseCount || 0))
    .slice(0, 5)
    .map((category) => ({
      type: "qualitative_category",
      label: category.label,
      polarity: category.polarity,
      responseCount: Number(category.clauseCount || 0),
      quoteSamples: (category.quotes || []).slice(0, 2).map(quote).filter(Boolean)
    }));
}

function findFeatureStat(data, featureName) {
  return (data.report?.quant_stats?.featureSatisfaction || [])
    .find((feature) => feature.name === featureName) || null;
}

async function main() {
  const data = JSON.parse(await fs.readFile(input, "utf8"));
  const questions = new Map((data.questions || []).map((question) => [question.question_key, question]));
  const recommendations = (data.recommendations || []).map((recommendation, index) => {
    const section = String(recommendation.section || "");
    const featureName = section.startsWith(featurePrefix) ? section.slice(featurePrefix.length) : null;

    if (featureName) {
      const question = questions.get(`feature:${featureName}`);
      const stat = findFeatureStat(data, featureName);
      return {
        id: `recommendation-${index + 1}`,
        documentSection: "기능별 개선 제언",
        featureName,
        recommendationText: quote(recommendation.text),
        source: { type: "stored_db_recommendation", section },
        evidence: {
          quantitative: stat ? { mean: stat.mean, sd: stat.sd } : null,
          qualitativeCategories: featureEvidence(question)
        },
        note: "AI를 다시 호출하거나 근거를 새로 추론하지 않았습니다. 저장된 제언과 해당 기능의 저장된 정량·정성 결과를 함께 배치하기 위한 추적 정보입니다."
      };
    }

    const sectionAnalyses = data.report?.section_analyses || {};
    return {
      id: `recommendation-${index + 1}`,
      documentSection: section === "dev_priority" ? "종합 결과 및 제언" : "기능별 고객 제언",
      featureName: null,
      recommendationText: quote(recommendation.text),
      source: { type: "stored_db_recommendation", section },
      evidence: {
        quantitative: (data.report?.quant_stats?.featureSatisfaction || []).map((feature) => ({
          feature: feature.name,
          mean: feature.mean,
          sd: feature.sd
        })),
        sectionAnalysisKeys: Object.keys(sectionAnalyses)
      },
      note: "종합 제언은 단일 인용문이 아니라 저장된 정량 결과와 종합 분석을 바탕으로 생성된 내용입니다. 문서 UI에서는 이 목록을 '분석 근거'로 표시할 수 있습니다."
    };
  });

  const manifest = {
    version: 1,
    purpose: "HWPX 제언 섹션과 DB 분석 근거를 안전하게 연결하는 읽기 전용 로컬 manifest",
    report: { id: data.report?.id, name: data.report?.report_name },
    recommendations,
    integrity: {
      regeneratesAnalysis: false,
      callsAI: false,
      modifiesDatabase: false,
      requiresHumanReviewBeforeExport: true
    }
  };

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ recommendations: recommendations.length, featureRecommendations: recommendations.filter((item) => item.featureName).length, output }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
