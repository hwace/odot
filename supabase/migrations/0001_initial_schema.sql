-- odot 초기 스키마
-- Supabase 프로젝트 odot (ref: dkuwhglayyzawmetbkbh) 에 적용됨.
-- 새 환경에 올릴 때는 이 파일 전체를 SQL Editor 에 붙여넣으면 된다.

create extension if not exists pgcrypto;

-- 익명 사용자 (디바이스 단위) + 나이
-- age_group / is_minor 는 age 에서 파생되는 값이라 생성 컬럼으로 둔다.
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  age smallint not null check (age between 5 and 120),
  age_group text generated always as (
    case
      when age < 13 then 'child'
      when age < 16 then 'middle'
      when age < 19 then 'high'
      else 'adult'
    end
  ) stored,
  is_minor boolean generated always as (age < 19) stored,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

-- 초기 관심사 탐색 설문 (F-YNUHQI) — 7개 카드 중 정확히 하나
create table if not exists public.onboarding (
  user_id uuid primary key references public.users(id) on delete cascade,
  topic text check (topic in ('exercise','study','reading','music','culture','career','etc')),
  custom_topic text,
  is_completed boolean not null default false,
  completed_at timestamptz,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 추천 키워드 카드 (F-OVNIBD)
create table if not exists public.keyword_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  keyword text not null,
  intro text not null default '',
  reason text not null default '',
  easy_summary text,
  category text,
  source text not null default 'ai' check (source in ('ai','trend','default','similar_user')),
  min_age smallint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists keyword_cards_user_created_idx on public.keyword_cards(user_id, created_at desc);

-- 카드 반응 (F-ZSDXRA) : 사용자-카드 당 1회만 확정, 재노출 금지
create table if not exists public.card_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  card_id uuid not null references public.keyword_cards(id) on delete cascade,
  keyword text not null,
  category text,
  reaction text not null check (reaction in ('like','pass','detail')),
  reacted_at timestamptz not null default now(),
  unique (user_id, card_id)
);
create index if not exists card_reactions_user_time_idx on public.card_reactions(user_id, reacted_at desc);

-- 트렌드 / 기본 키워드 풀 (트렌드 API 실패 시 fallback)
create table if not exists public.seed_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  category text not null,
  intro text not null default '',
  source text not null default 'default' check (source in ('trend','default')),
  min_age smallint not null default 0,
  score numeric not null default 0,
  collected_at timestamptz not null default now(),
  unique (keyword, source)
);

-- 프로젝트 추천 요청 (F-URTMLV)
create table if not exists public.project_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid,
  duration text not null check (duration in ('1d','1w','1m','3m','6m')),
  representative_category text,
  requested_at timestamptz not null default now()
);

-- AI 프로젝트 (F-PEBLKV)
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null default '',
  description text,
  keywords text[] not null default '{}',
  duration text not null check (duration in ('1d','1w','1m','3m','6m')),
  status text not null default 'generating' check (status in ('generating','ready','failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_user_created_idx on public.projects(user_id, created_at desc);

alter table public.project_requests
  drop constraint if exists project_requests_project_id_fkey;
alter table public.project_requests
  add constraint project_requests_project_id_fkey
  foreign key (project_id) references public.projects(id) on delete set null;

-- 프로젝트 전용 세션 — 프로젝트 간 생성 맥락을 섞지 않기 위한 격리 키
create table if not exists public.project_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  session_key text not null unique,
  turn_count int not null default 0,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

-- 할 일 (F-PEBLKV 생성 / F-IYXFDA 완료 기록)
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  content text not null,
  category text not null default '기타',
  order_index int not null default 0,
  recommended_at text,
  is_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists todos_project_order_idx on public.todos(project_id, order_index);
create index if not exists todos_user_completed_idx on public.todos(user_id, completed_at desc);

-- 월간 관심 키워드 정산 (F-NYHVHG)
create table if not exists public.monthly_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  year_month text not null,
  top_keywords jsonb not null default '[]'::jsonb,
  total_reactions int not null default 0,
  like_count int not null default 0,
  generated_at timestamptz not null default now(),
  unique (user_id, year_month)
);

-- 인스타그램 공유 기록 (F-ZVJSOW)
create table if not exists public.share_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  year_month text not null,
  channel text not null default 'instagram',
  result text not null default 'requested' check (result in ('requested','success','failed','no_app')),
  shared_at timestamptz not null default now()
);

-- KPI 이벤트 로그
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists events_user_time_idx on public.events(user_id, created_at desc);
create index if not exists events_type_time_idx on public.events(type, created_at desc);

-- 연령 검열 차단 기록 — 나중에 기준을 조정하기 위한 근거 데이터
create table if not exists public.moderation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  age smallint,
  age_group text,
  source text not null,
  content text not null,
  reason text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists moderation_logs_time_idx on public.moderation_logs(created_at desc);

-- 서버(service role)에서만 접근한다. 정책을 하나도 만들지 않아서
-- anon / publishable 키로는 어떤 테이블도 읽거나 쓸 수 없다.
alter table public.users enable row level security;
alter table public.onboarding enable row level security;
alter table public.keyword_cards enable row level security;
alter table public.card_reactions enable row level security;
alter table public.seed_keywords enable row level security;
alter table public.project_requests enable row level security;
alter table public.projects enable row level security;
alter table public.project_sessions enable row level security;
alter table public.todos enable row level security;
alter table public.monthly_reports enable row level security;
alter table public.share_logs enable row level security;
alter table public.events enable row level security;
alter table public.moderation_logs enable row level security;
