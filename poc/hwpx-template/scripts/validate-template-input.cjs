/* 새 raw data 분석 결과가 HWPX 양식에 안전하게 매핑될 수 있는지 검사한다. */
const fs = require("node:fs/promises");
const path = require("node:path");

const [inputPath, specPath, outputPath, identityPath] = process.argv.slice(2);
if (!inputPath || !specPath || !outputPath) {
  throw new Error("사용법: node validate-template-input.cjs <db-export.json> <template-spec.json> <output.json> [identity.json]");
}

function requireValue(errors, key, value) {
  if (value === null || value === undefined || value === "") errors.push(`${key} 값이 없습니다.`);
}

async function main() {
  const [input, spec, identity] = await Promise.all([
    fs.readFile(inputPath, "utf8").then(JSON.parse),
    fs.readFile(specPath, "utf8").then(JSON.parse),
    identityPath ? fs.readFile(identityPath, "utf8").then(JSON.parse) : Promise.resolve({})
  ]);
  const errors = [];
  const warnings = [];
  const report = input.report || {};
  requireValue(errors, "companyName", identity.companyName || report.product_info?.companyName);
  requireValue(errors, "serviceOrProductName", identity.serviceOrProductName || report.product_info?.serviceName);
  requireValue(errors, "productType", identity.productType || report.product_type);
  const productType = identity.productType || report.product_type;
  if (productType && !["sw", "physical"].includes(productType)) {
    errors.push("productType은 sw 또는 physical이어야 합니다.");
  }
  const variant = identity.templateVariant || productType;
  if (variant && !Object.hasOwn(spec.variants || {}, variant)) {
    errors.push(`templateVariant '${variant}'에 해당하는 템플릿이 없습니다.`);
  }
  if (variant === "unified" && !identity.templateVariant) {
    errors.push("통합 양식은 productType과 별도로 templateVariant: 'unified'를 명시해야 합니다.");
  }
  const features = report.quant_stats?.featureSatisfaction || [];
  if (!features.length) errors.push("정량 기능 만족도 결과가 없습니다.");
  const questions = input.questions || [];
  for (const feature of features) {
    const qualitative = questions.find((question) => question.question_key === `feature:${feature.name}`);
    if (!qualitative) {
      warnings.push(`${feature.name}: 정성 분석 결과가 없어 정량 전용 블록으로 생성됩니다.`);
      continue;
    }
    const categories = qualitative.categories || [];
    if (!categories.length) warnings.push(`${feature.name}: 정성 카테고리가 없습니다.`);
    for (const category of categories) {
      if (!category.label || !category.polarity || !Number.isFinite(Number(category.clauseCount))) {
        errors.push(`${feature.name}: 정성 카테고리 필수값이 누락되었습니다.`);
      }
      if (!(category.quotes || []).length) warnings.push(`${feature.name} / ${category.label}: 대표 인용문이 없습니다.`);
    }
  }
  const manifest = {
    valid: errors.length === 0,
    variant,
    productType,
    reference: spec.variants[variant]?.reference || null,
    featureCount: features.length,
    recommendationCount: (input.recommendations || []).length,
    errors,
    warnings,
    next: errors.length
      ? "필수 입력값을 보완한 뒤 컴파일합니다."
      : variant === "unified"
        ? "통합 템플릿의 공통·SW·실제품 블록 매핑을 모두 확인한 뒤 컴파일합니다."
        : "선택된 HWPX 템플릿의 슬롯/반복 블록에 컴파일할 수 있습니다."
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(manifest, null, 2));
  if (errors.length) process.exitCode = 2;
}

main();
