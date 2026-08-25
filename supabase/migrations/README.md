# 마이그레이션

이 프로젝트의 스키마는 Supabase 프로젝트 `odot`(ref: `dkuwhglayyzawmetbkbh`)에
아래 두 마이그레이션으로 이미 적용되어 있습니다.

- `odot_initial_schema` — 전체 테이블 + RLS 활성화
- `odot_seed_default_keywords` — 트렌드 API 실패 시 쓰는 기본 키워드 30개 시드

전체 DDL은 `supabase/migrations/0001_initial_schema.sql` 에 그대로 보관되어 있습니다.
새 환경에 올릴 때는 이 파일을 SQL Editor에 붙여넣거나 `supabase db push` 로 적용하세요.
