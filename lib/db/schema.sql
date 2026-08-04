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

-- PDF/DOCX를 다시 렌더링할 때 정량 결과 요약을 매번 Claude에 요청하지 않도록 보관한다.
-- raw data를 다시 정량 계산하면 reports.ts의 upsert가 이 값을 null로 돌려 최신 통계와만 연결한다.
alter table reports add column if not exists result_summary text;

-- 섹션 단위 정성 분석(Ⅲ.2 기능 분석·Ⅳ 핵심구매요소·Ⅴ.2 4대가치 종합·Ⅵ.2 UX 품질).
-- lib/pipeline/sectionAnalysis.ts가 저장된 카테고리를 재료로 생성한다. 정량 재계산 시 초기화된다.
alter table reports add column if not exists section_analyses jsonb;

-- 사용자가 직접 정하는 보고서 이름(2026-08-04 신규) — 좌측 "저장된 보고서" 목록에 회사명·
-- 파일명보다 우선 표시한다. null이면 기존처럼 회사명→파일명 순으로 폴백한다(app/api/reports).
alter table reports add column if not exists report_name text;

-- 웹 작업공간(스튜디오)에서 편집한 초안을 서버에 영속화한다(2026-08-04 신규 — 예전엔 브라우저
-- localStorage에만 저장돼 다른 기기·브라우저에서는 이어서 열 수 없었다). 편집된
-- ReportSectionContent[] 전체를 그대로 저장한다(lib/report/sections.ts, components/ReportStudio.tsx).
alter table reports add column if not exists workspace_draft jsonb;
alter table reports add column if not exists workspace_draft_saved_at timestamptz;

-- 마법사 1단계(제품유형 선택, 2026-08-03 신규)에서 사용자가 명시적으로 고른 값.
-- null이면 lib/report/productType.ts의 detectProductType() 자동추정으로 폴백한다
-- (레거시 report·마법사 이전에 만들어진 report 호환).
alter table reports add column if not exists product_type text check (product_type in ('sw', 'physical'));

-- 정성 처리 대상 14개 문항 (PRD 6.1절).
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  question_key text not null, -- 예: "feature:펫과의 산책", "improvementIdea"
  label text not null,
  kind text not null check (kind in ('standard', 'improvement')),
  -- 극성별(긍정/부정/중립) 한 단락 총평. 실제 발행 보고서의 "[긍정 의견 요약]" 박스 형식
  -- (2026-07-20 추가) — { positive?, negative?, neutral? } 형태의 jsonb.
  polarity_summaries jsonb,
  created_at timestamptz not null default now(),
  unique (report_id, question_key)
);
alter table questions add column if not exists polarity_summaries jsonb;

-- Stage1 출력 (문장/절 분리 + 극성 판정). kind='improvement' 문항은 사용하지 않는다(극성 없음).
create table if not exists clauses (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  respondent_id int not null,
  clause text not null,
  -- AI가 분석·군집화를 위해 맞춤법만 보정한 clause와, 보고서 직접 인용용 원문을 분리한다.
  -- 원문과 대조되지 않은 경우 raw_clause는 null이며 직접 인용 대상으로 쓰지 않는다.
  raw_clause text,
  polarity text not null check (polarity in ('positive', 'negative', 'neutral')),
  rationale text not null,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  -- 체크포인트 A(7.1절): 담당자가 검수해서 승인하거나 다른 극성으로 재배치한 상태.
  reviewed boolean not null default false,
  overridden_polarity text check (overridden_polarity in ('positive', 'negative', 'neutral')),
  created_at timestamptz not null default now()
);
alter table clauses add column if not exists raw_clause text;
alter table clauses add column if not exists needs_review boolean not null default false;

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

-- 정성 분석은 문항당 대형 스트리밍 호출을 포함하므로, 하나의 채팅/서버리스 요청에서
-- 14문항을 끝까지 기다리지 않는다. 작업과 각 문항의 현재 단계를 영속화해, 1개 요청은
-- Stage1 또는 Stage2 하나만 수행하고 다음 요청이 이어받는다.
create table if not exists qualitative_jobs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'completed', 'completed_with_failures', 'failed', 'cancelled')) default 'queued',
  total_items int not null,
  completed_items int not null default 0,
  failed_items int not null default 0,
  call_plan jsonb not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists qualitative_jobs_report_id_idx on qualitative_jobs(report_id, created_at desc);

create table if not exists qualitative_job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references qualitative_jobs(id) on delete cascade,
  question_key text not null,
  label text not null,
  kind text not null check (kind in ('standard', 'improvement')),
  phase text not null check (phase in ('stage1', 'stage2')) default 'stage1',
  status text not null check (status in ('queued', 'running', 'completed', 'failed')) default 'queued',
  attempts int not null default 0,
  checkpoint jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (job_id, question_key)
);
create index if not exists qualitative_job_items_claim_idx on qualitative_job_items(job_id, status, phase, created_at);

-- Claude가 응답에서 반환한 실제 토큰 사용량을 작업 단위로 보관한다.
-- 실패·중단 요청은 제공자가 사용량을 반환하지 않을 수 있어, 성공 응답에서 확인된 값만 저장한다.
create table if not exists qualitative_job_usage (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references qualitative_jobs(id) on delete cascade,
  item_id uuid references qualitative_job_items(id) on delete set null,
  phase text not null check (phase in ('stage1', 'stage2', 'section_analysis')),
  label text not null,
  attempt int not null default 1,
  input_tokens int,
  output_tokens int,
  total_tokens int,
  no_cache_tokens int,
  cache_read_tokens int,
  cache_write_tokens int,
  elapsed_ms int not null,
  input_usd_per_mtokens numeric(12,6) not null,
  output_usd_per_mtokens numeric(12,6) not null,
  cache_read_usd_per_mtokens numeric(12,6) not null,
  cache_write_usd_per_mtokens numeric(12,6) not null,
  calculated_cost_usd numeric(14,8) not null,
  created_at timestamptz not null default now()
);
create index if not exists qualitative_job_usage_job_id_idx on qualitative_job_usage(job_id, created_at);
create unique index if not exists qualitative_job_usage_call_unique_idx
  on qualitative_job_usage(job_id, coalesce(item_id, '00000000-0000-0000-0000-000000000000'::uuid), phase, label, attempt);

-- 14개 문항 Stage1·Stage2가 끝난 뒤 이어지는 섹션 단위 분석의 운영 이력.
-- 사용자 화면에는 노출하지 않는다. 각 분석의 성공/실패·실행 시간만 내부 검증에 사용한다.
-- 동일 작업을 재실행하는 경우도 비교할 수 있도록 attempt별 행을 분리한다.
create table if not exists qualitative_section_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references qualitative_jobs(id) on delete cascade,
  report_id uuid not null references reports(id) on delete cascade,
  section_key text not null check (section_key in ('featureExperience', 'corePurchaseFactor', 'fourValues', 'uxQuality', 'crossAnalysis')),
  attempt int not null default 1,
  status text not null check (status in ('running', 'completed', 'failed')) default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  elapsed_ms int,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, section_key, attempt)
);
create index if not exists qualitative_section_analysis_runs_job_id_idx
  on qualitative_section_analysis_runs(job_id, created_at);
create index if not exists qualitative_section_analysis_runs_report_id_idx
  on qualitative_section_analysis_runs(report_id, created_at);

-- 2026-07-30: Ⅶ 교차분석 텍스트 해석(crossAnalysis)이 섹션 분석 5번째 종류로 추가되어
-- section_key 체크 제약을 넓힌다. create table if not exists는 기존 테이블에 재적용되지
-- 않으므로, 이미 배포된 환경에서도 idempotent하게 갱신되도록 별도 alter로 둔다.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'qualitative_section_analysis_runs_section_key_check'
  ) then
    alter table qualitative_section_analysis_runs
      drop constraint qualitative_section_analysis_runs_section_key_check;
  end if;
  alter table qualitative_section_analysis_runs
    add constraint qualitative_section_analysis_runs_section_key_check
    check (section_key in ('featureExperience', 'corePurchaseFactor', 'fourValues', 'uxQuality', 'crossAnalysis'));
end $$;
