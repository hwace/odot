-- 기기 단위 익명 신원 → 이메일 계정 단위로 바꾼다.
--
-- 기존 방식은 deviceId 를 브라우저 localStorage 에 저장해서, 같은 브라우저를
-- 쓰는 사람은 전부 같은 사용자로 취급됐다. 비밀번호 해싱과 세션은 직접 만들지
-- 않고 Supabase Auth(auth.users)에 맡기고, public.users 는 프로필 테이블로 둔다.

alter table public.users add column if not exists auth_user_id uuid
  references auth.users(id) on delete cascade;
alter table public.users add column if not exists email text;

create unique index if not exists users_auth_user_id_idx
  on public.users(auth_user_id) where auth_user_id is not null;
create unique index if not exists users_email_idx
  on public.users(lower(email)) where email is not null;

-- 로그인 사용자는 device_id 가 없다. 익명 경로는 로그인 화면이 붙을 때까지만 남긴다.
alter table public.users alter column device_id drop not null;

-- device_id 유니크 제약은 값이 있을 때만 적용되도록 부분 인덱스로 바꾼다.
alter table public.users drop constraint if exists users_device_id_key;
create unique index if not exists users_device_id_idx
  on public.users(device_id) where device_id is not null;

comment on column public.users.auth_user_id is 'Supabase Auth 사용자. 이메일 계정으로 가입한 경우 채워진다.';
comment on column public.users.device_id is '기기 단위 익명 신원. 로그인 화면이 붙기 전까지의 과도기 경로.';
