# usertest-report-automation

[데솔] 사용성테스트 결과 보고서 생성 자동화

raw data(xlsx)를 업로드하면 채팅으로 대화하며 사용성테스트 결과보고서(PDF)를 자동 생성하는 챗봇형
솔루션입니다. 전체 요구사항은 [PRD.md](./PRD.md)를, 코드베이스 고유의 결정·주의사항은
[CLAUDE.md](./CLAUDE.md)를 참고하세요.

## 스택

Next.js(App Router) 단일 스택 · AI SDK + Claude(Sonnet 5) · Supabase(Postgres) · Vercel Blob ·
`@react-pdf/renderer`

## 시작하기

```bash
npm install
cp .env.local.example .env.local   # 아래 값을 채워넣으세요
npm run db:migrate                 # DB 스키마 적용
npm run dev
```

`.env.local`에 필요한 값 (`.env.local.example` 참고):

- `ANTHROPIC_API_KEY` — 채팅·정성 분석·제언 생성에 필요
- `BLOB_READ_WRITE_TOKEN` — raw data 업로드, 완성된 PDF 저장에 필요
- `DATABASE_URL` — Supabase Postgres 연결 문자열(Transaction pooler 권장). 비밀번호에 `#` 등
  URL 예약 문자가 있으면 percent-encoding할 것

## 스크립트

| 명령 | 설명 | 비용 |
|---|---|---|
| `npm run dev` / `build` / `start` | Next.js 개발/빌드/실행 | - |
| `npm run lint` | ESLint | - |
| `npm run db:migrate` | `lib/db/schema.sql` 적용 | - |
| `npm run check:golden` | 정량 통계 골든 회귀 테스트(리바랩스 raw data 기준 89개 값 대조) | 무료 |
| `npm run check:stage1` | Stage1 few-shot 재현 검증 | Claude API 과금 |
| `npm run check:qualitative` | 14문항 정성 파이프라인 전체 실행·검증 | Claude API 과금(수십 회 호출) |

## 골든 테스트셋

`data/` 폴더(gitignore 처리, 응답자 개인정보 포함이라 커밋되지 않음)에 리바랩스 raw data와 실제
발행된 결과보고서 PDF가 있어야 `check:golden` 등을 실행할 수 있습니다.
