-- 프로젝트를 '세션'으로 바꾼다.
--
-- 카드 덱과 반응이 사용자가 아니라 프로젝트에 묶이고, 초기 관심사도 프로젝트가 갖는다.
-- 다른 프로젝트로 들어가면 완전히 새 데이터에서 시작한다. (클로드 대화창과 같은 모델)
--
-- 개발 중 테스트 데이터만 있던 시점에 적용해서 기존 행은 비우고 시작했다.
-- 운영 데이터가 있는 환경에 올릴 때는 truncate 를 빼고 백필 전략을 따로 세워야 한다.

truncate table public.card_reactions,
               public.keyword_cards,
               public.todos,
               public.project_sessions,
               public.project_requests,
               public.monthly_reports,
               public.share_logs,
               public.projects
  restart identity cascade;

-- 관심사가 프로젝트로 옮겨가면서 사용자 단위 온보딩 테이블은 필요 없어졌다.
drop table if exists public.onboarding;

-- 프로젝트: 기간은 나중에 정하므로 nullable, 카드 모으는 중 상태 추가
alter table public.projects alter column duration drop not null;
alter table public.projects drop constraint if exists projects_status_check;
alter table public.projects
  add constraint projects_status_check
  check (status in ('collecting','generating','ready','failed'));
alter table public.projects alter column status set default 'collecting';

-- 프로젝트별 초기 관심사 (F-YNUHQI 를 프로젝트 단위로)
alter table public.projects add column if not exists topic text
  check (topic in ('exercise','study','reading','music','culture','career','etc'));
alter table public.projects add column if not exists custom_topic text;

-- 카드와 반응을 프로젝트에 묶는다
alter table public.keyword_cards add column if not exists project_id uuid
  references public.projects(id) on delete cascade;
alter table public.card_reactions add column if not exists project_id uuid
  references public.projects(id) on delete cascade;

alter table public.keyword_cards alter column project_id set not null;
alter table public.card_reactions alter column project_id set not null;

-- 같은 프로젝트 안에서는 같은 키워드가 두 번 나오지 않는다
create unique index if not exists keyword_cards_project_keyword_idx
  on public.keyword_cards(project_id, keyword);
create index if not exists keyword_cards_project_created_idx
  on public.keyword_cards(project_id, created_at);
create index if not exists card_reactions_project_idx
  on public.card_reactions(project_id, reacted_at desc);

-- 카드는 이제 짧은 '키워드'다. 긴 행동 문구가 아니라 주제어.
comment on column public.keyword_cards.keyword is '짧은 주제 키워드 (예: 수학, 클라이밍). 행동 문구가 아니다.';
comment on column public.keyword_cards.intro is '키워드가 무엇인지 한 줄 설명';

-- 네이버 데이터랩 조회 결과 캐시
alter table public.seed_keywords add column if not exists trend_ratio numeric;
alter table public.seed_keywords add column if not exists trend_checked_at timestamptz;

-- 시드도 '행동 문구' → '주제 키워드' 로 교체했다.
-- 전체 목록은 마이그레이션 odot_reseed_topic_keywords 참고 (카테고리당 10개, 총 70개).
