import postgres from "postgres";

// Supabase Transaction pooler(6543 포트)는 prepared statement를 지원하지 않으므로 끈다.
// (서버리스 함수는 매 호출마다 새 연결을 여는 경우가 많아 풀러 사용이 필수 — CLAUDE.md 참고)
export const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
