import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // DOCX 차트 이미지를 만들 때 쓰는 네이티브 N-API 모듈이다. Route Handler 안에서
  // 번들링하면 Turbopack이 바이너리를 ESM 청크로 넣으려다 실패하므로, Node 런타임에서
  // require하도록 외부 패키지로 유지한다.
  serverExternalPackages: ["@napi-rs/canvas"],
  // HWPX 다운로드 Route Handler가 한컴 호환 베이스 패키지를 런타임에 읽는다.
  outputFileTracingIncludes: {
    "/api/report-workspace/hwpx": ["./output/hwpx-templates/01_공통_기본_사용성테스트_보고서_양식.hwpx"],
  },
};

export default nextConfig;
