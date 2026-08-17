/*
 * 분석 DB export를 웹뷰/HWPX가 공유하는 문서 모델로 변환한다.
 * 이 스크립트는 LLM 호출, DB 갱신, 기존 서비스 변경을 하지 않는다.
 */
const fs = require("node:fs/promises");
const path = require("node:path");

const args = process.argv.slice(2);
const [dbPath, identityPath, familyContractPath, fourthPath, fifthPath] = args;
const [dataBindingsPath, outputPath] = fifthPath ? [fourthPath, fifthPath] : [null, fourthPath];
if (!dbPath || !identityPath || !familyContractPath || !outputPath) {
  throw new Error("사용법: node build-document-model.cjs <db.json> <identity.json> <family-contract.json> [template-data-bindings.json] <output.json>");
}

const polarityLabels = { positive: "긍정", negative: "부정", neutral: "중립" };

function analysis(question) {
  const categories = question.categories || [];
  const groups = Object.fromEntries(Object.keys(polarityLabels).map((polarity) => {
    const items = categories.filter((item) => item.polarity === polarity)
      .sort((a, b) => Number(b.clauseCount || 0) - Number(a.clauseCount || 0));
    return [polarity, { count: items.reduce((sum, item) => sum + Number(item.clauseCount || 0), 0), categories: items }];
  }));
  const total = Object.values(groups).reduce((sum, group) => sum + group.count, 0);
  return {
    source: "stored qualitative categories[].clauseCount",
    donut: Object.entries(groups).map(([polarity, group]) => ({
      polarity,
      label: polarityLabels[polarity],
      count: group.count,
      percentage: total ? Number((group.count * 100 / total).toFixed(1)) : 0
    })),
    summaries: Object.entries(groups).map(([polarity, group]) => ({
      polarity,
      label: polarityLabels[polarity],
      text: group.categories.slice(0, 3).map((item) => item.label).join(", ")
    })),
    evidenceGroups: Object.entries(groups).map(([polarity, group]) => ({
      polarity,
      label: polarityLabels[polarity],
      categories: group.categories.map((item) => ({
        label: item.label,
        clauseCount: Number(item.clauseCount || 0),
        quotes: item.quotes || [],
        insight: item.insight || ""
      }))
    }))
  };
}

async function main() {
  const [db, identity, contract, bindingDocument] = await Promise.all([
    fs.readFile(dbPath, "utf8").then(JSON.parse),
    fs.readFile(identityPath, "utf8").then(JSON.parse),
    fs.readFile(familyContractPath, "utf8").then(JSON.parse),
    dataBindingsPath ? fs.readFile(dataBindingsPath, "utf8").then(JSON.parse) : Promise.resolve(null)
  ]);
  const family = identity.templateVariant || identity.productType;
  const template = contract.templateFamilies[family];
  if (!template) throw new Error(`템플릿 패밀리 '${family}'를 찾지 못했습니다.`);
  const bindings = bindingDocument?.families?.[family] || null;
  const sectionXml = (anchor) => anchor?.match(/^(Contents\/section\d+\.xml):/)?.[1] || "Contents/section1.xml";
  const sectionAnchor = (key) => bindings?.sections?.[key] || `${family}:${key}`;
  const featureAnchor = (index) => bindings?.featurePrototype?.featureBlocks?.[index] || `${family}:feature:${index + 1}`;
  const questions = new Map((db.questions || []).map((question) => [question.question_key, question]));
  const stats = db.report?.quant_stats?.featureSatisfaction || [];
  const featureBlocks = stats.map((stat, index) => {
    const question = questions.get(`feature:${stat.name}`);
    return {
      id: `feature-${index + 1}`,
      kind: "feature-analysis",
      templateRef: { sectionXml: sectionXml(featureAnchor(index)), anchor: featureAnchor(index), repeatPrototypeAnchor: featureAnchor(0) },
      overflowPolicy: "repeat-next-page",
      content: {
        featureName: stat.name,
        quantitative: { mean: stat.mean, standardDeviation: stat.sd, distribution: stat.scoreDistribution || [] },
        polarityAnalysis: question ? analysis(question) : null
      }
    };
  });
  const isPhysical = identity.productType === "physical";
  const sections = [
    { id: "overview", title: "개요", enabled: true, pageBlocks: [{ id: "identity", kind: "table", templateRef: { sectionXml: "Contents/section0.xml", anchor: bindings ? Object.values(bindings.identity).join(" | ") : `${family}:identity` }, content: identity }] },
    { id: "feature-analysis", title: "기능별 고객 경험 평가", enabled: true, pageBlocks: featureBlocks },
    { id: "four-values", title: "4대 가치 만족도", enabled: true, pageBlocks: [{ id: "four-values-analysis", kind: "paragraph", templateRef: { sectionXml: sectionXml(sectionAnchor("fourValues")), anchor: sectionAnchor("fourValues") }, content: { text: db.report?.section_analyses?.fourValues || "" } }] },
    { id: "purchase-factor", title: "핵심 구매요소", enabled: true, pageBlocks: [{ id: "purchase-factor-analysis", kind: "paragraph", templateRef: { sectionXml: sectionXml(sectionAnchor("purchaseFactor")), anchor: sectionAnchor("purchaseFactor") }, content: { text: db.report?.section_analyses?.corePurchaseFactor || "" } }] },
    { id: "nps", title: "NPS 및 종합 만족도", enabled: true, pageBlocks: [{ id: "nps-analysis", kind: "paragraph", templateRef: { sectionXml: sectionXml(sectionAnchor("nps")), anchor: sectionAnchor("nps") }, content: { text: db.report?.section_analyses?.nps || "", stats: db.report?.quant_stats?.nps || null } }] },
    { id: "recommendations", title: "종합 결과 및 제언", enabled: true, pageBlocks: (db.recommendations || []).map((item, index) => ({ id: `recommendation-${index + 1}`, kind: "repeat-block", templateRef: { sectionXml: sectionXml(sectionAnchor("recommendations")), anchor: sectionAnchor("recommendations"), repeatPrototypeAnchor: sectionAnchor("recommendations") }, overflowPolicy: "repeat-next-page", content: item })) }
  ];
  if (family === "sw" || family === "unified") {
    sections.splice(2, 0, { id: "sw-analysis", title: "사용자 경험 품질 및 교차 분석", enabled: family === "sw" || !isPhysical, pageBlocks: [
      { id: "ux-quality", kind: "paragraph", templateRef: { sectionXml: sectionXml(sectionAnchor("uxQuality")), anchor: sectionAnchor("uxQuality") }, content: { text: db.report?.section_analyses?.uxQuality || "" } },
      { id: "cross-analysis", kind: "paragraph", templateRef: { sectionXml: sectionXml(sectionAnchor("crossAnalysis")), anchor: sectionAnchor("crossAnalysis") }, content: { text: db.report?.section_analyses?.crossAnalysis || "" } }
    ] });
  }
  if (family === "physical" || family === "unified") {
    sections.splice(2, 0, { id: "journey", title: "고객 여정 기반 경험 평가", enabled: family === "physical" || Boolean(db.report?.journey_stats), pageBlocks: [] });
  }
  const model = {
    version: 1,
    templateFamily: family,
    artifactVersion: `draft-${db.report?.id || "local"}-v1`,
    identity: { companyName: identity.companyName, serviceOrProductName: identity.serviceOrProductName, productType: identity.productType },
    sections,
    reviewAnnotations: []
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(model, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ templateFamily: family, features: featureBlocks.length, sections: sections.filter((section) => section.enabled).length, output: outputPath }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
