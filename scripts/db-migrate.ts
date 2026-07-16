// lib/db/schema.sql을 DATABASE_URL에 적용한다. 스키마는 `create table if not exists`로
// 작성되어 있어 여러 번 실행해도 안전하다(idempotent). 별도 마이그레이션 프레임워크는 아직
// 도입하지 않았다 — 스키마가 더 커지기 전에 drizzle-kit 등 도입을 검토할 것(CLAUDE.md 참고).
// 사용법: npm run db:migrate
import { readFileSync } from "node:fs";
import { sql } from "../lib/db/client";

async function main() {
  const schemaPath = new URL("../lib/db/schema.sql", import.meta.url);
  const schema = readFileSync(schemaPath, "utf-8");
  await sql.unsafe(schema);
  console.log("스키마 적용 완료.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
