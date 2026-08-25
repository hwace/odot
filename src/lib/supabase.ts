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

/**
 * 비밀번호 로그인·토큰 갱신 전용 클라이언트.
 *
 * **매번 새로 만든다.** signInWithPassword / refreshSession 은 호출한 클라이언트에
 * 그 사용자의 세션을 심어 놓는다. service role 클라이언트를 공유해서 쓰면
 * 로그인 직후의 DB 질의가 service role 이 아니라 그 사용자 권한으로 나가
 * RLS 에 막히고, 동시에 두 사람이 로그인하면 세션이 섞이기까지 한다.
 *
 * 그래서 DB 접근용 db() 와 완전히 분리하고, 요청마다 일회용으로 쓴다.
 */
export function authClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_ANON_KEY 환경변수가 필요합니다. .env.local 을 확인하세요.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
