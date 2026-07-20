-- PRD 4.3절: 채팅은 턴 기반 서버리스 함수라 중간 상태를 메모리에 들고 있을 수 없다.
-- raw data 파싱 결과·정량 통계·정성 파이프라인 산출물·체크포인트 승인 상태를 여기에 영속화한다.
-- 적용: npm run db:migrate (idempotent — 여러 번 실행해도 안전)

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  file_url text not null,
  file_name text,
  respondent_count int,
  quant_stats jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- raw data 파일 하나당 하나의 report만 유지한다 (재검증 시 덮어씀).
create unique index if not exists reports_file_url_key on reports (file_url);

-- 제품 정보(PRD 5.0절, v1.4 신규)는 raw data 업로드보다 먼저 대화에서 나올 수 있다.
-- quant_stats와 마찬가지로 file_url에 upsert하므로, 둘 중 어느 쪽이 먼저 저장되든
-- reports 행이 생성되고 나머지 컬럼은 나중에 채워진다.
alter table reports add column if not exists product_info jsonb;

-- 정성 처리 대상 14개 문항 (PRD 6.1절).
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  question_key text not null, -- 예: "feature:펫과의 산책", "improvementIdea"
  label text not null,
  kind text not null check (kind in ('standard', 'improvement')),
  created_at timestamptz not null default now(),
  unique (report_id, question_key)
);

-- Stage1 출력 (문장/절 분리 + 극성 판정). kind='improvement' 문항은 사용하지 않는다(극성 없음).
create table if not exists clauses (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  respondent_id int not null,
  clause text not null,
  polarity text not null check (polarity in ('positive', 'negative', 'neutral')),
  rationale text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  -- 체크포인트 A(7.1절): 담당자가 검수해서 승인하거나 다른 극성으로 재배치한 상태.
  reviewed boolean not null default false,
  overridden_polarity text check (overridden_polarity in ('positive', 'negative', 'neutral')),
  created_at timestamptz not null default now()
);

create index if not exists clauses_question_id_idx on clauses (question_id);

-- Stage2 출력 (카테고리 + 대표인용 + 인사이트 초안). standard 문항은 극성별로 여러 행,
-- improvement 문항은 polarity=null로 한 세트만 존재한다.
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  polarity text check (polarity in ('positive', 'negative', 'neutral')),
  label text not null,
  clause_count int not null,
  quotes text[] not null,
  insight_draft text not null,
  -- 체크포인트 B(7.2절): 담당자가 수정한 최종 인사이트. null이면 아직 미승인 상태.
  insight_final text,
  insight_approved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists categories_question_id_idx on categories (question_id);

-- 제언 문단 (6.5절: 핵심구매요소 해석, 개발우선순위제언 등). 체크포인트 B 대상.
create table if not exists recommendations (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  section text not null,
  draft text not null,
  final text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists recommendations_report_id_idx on recommendations (report_id);

-- 종합 전략 제언 (7.3절) — AI가 생성하지 않고 담당자가 직접 입력하는 영역.
create table if not exists strategic_inputs (
  report_id uuid primary key references reports(id) on delete cascade,
  customer_request text,
  priority_metric text,
  draft text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
