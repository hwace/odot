-- 프론트 프로필 화면(이름 · 알림 받기)이 실제 값을 읽고 쓰도록 프로필 컬럼을 추가한다.
-- 지금까지는 localStorage 에만 있어서 기기를 바꾸면 사라졌다.

alter table public.users add column if not exists display_name text;
alter table public.users add column if not exists notifications boolean not null default true;

comment on column public.users.display_name is '프로필 화면에서 보여주는 이름. 없으면 이메일 앞부분을 쓴다.';
comment on column public.users.notifications is '알림 받기 설정. 실제 발송은 아직 구현하지 않았다.';
