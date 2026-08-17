import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // 로컬 HWPX POC 도구는 Node CommonJS로 실행되며 Next.js 번들에 포함되지 않는다.
    files: ["poc/hwpx-template/scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    // 외부 PDF 재현 스냅샷을 읽는 독립 CLI. 앱 소스와 분리된 동적 입력 어댑터라
    // 타입 정리 전까지 해당 파일에만 기존 런타임 계약을 허용한다.
    files: ["scripts/render-reference-v2.tsx"],
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
