import { createAnthropic } from "@ai-sdk/anthropic";

// @ai-sdk/anthropic의 기본 `anthropic` export는 baseURL을 지정하지 않으면 ANTHROPIC_BASE_URL
// 환경변수를 그대로 읽는다. 개발자 로컬 셸(.zshrc 등)에 Claude Code CLI용 프록시가 전역으로
// export돼 있으면 이 앱도 그 프록시로 요청을 보내 404가 나므로, baseURL을 실제 Anthropic API로
// 명시해 셸 환경과 무관하게 항상 정확한 엔드포인트를 쓰게 고정한다(2026-08-12 실측).
export const anthropic = createAnthropic({ baseURL: "https://api.anthropic.com/v1" });
