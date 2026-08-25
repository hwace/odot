import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 서버 전용 Supabase 클라이언트.
 *
 * 모든 테이블에 RLS가 켜져 있고 정책이 하나도 없어서, 클라이언트 키로는
 * 아무것도 읽거나 쓸 수 없다. 데이터 접근은 반드시 이 service role 클라이언트를
 * 쓰는 API 라우트를 통해서만 이뤄진다.
 */
let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다. .env.local 을 확인하세요.",
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
