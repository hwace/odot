import { db, authClient } from "@/lib/supabase";
import { ApiError } from "@/lib/http";
import { toUser, USER_COLUMNS, type UserRow } from "@/lib/auth";
import type { AuthResult, Session } from "@/types/api";

/**
 * 이메일 계정 가입/로그인.
 *
 * 비밀번호는 우리 DB에 저장하지 않는다 — Supabase Auth(auth.users)가 해싱해서
 * 보관하고, 우리는 세션 토큰만 프론트에 넘긴다. public.users 는 나이 같은
 * 프로필만 들고 auth_user_id 로 연결된다.
 */

/** 메일 발송 설정 없이 바로 쓰기 위해 가입 시 이메일을 확인 처리한다. */
const CONFIRM_EMAIL_ON_SIGNUP = true;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toSession(raw: {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}): Session {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    // Supabase 는 초 단위 epoch 를 준다. 프론트가 쓰기 쉽게 ISO 로 바꾼다.
    expiresAt: new Date((raw.expires_at ?? 0) * 1000).toISOString(),
  };
}

/** 회원가입 — 계정을 만들고 바로 로그인된 세션을 돌려준다. */
export async function signUp(input: {
  email: string;
  password: string;
  age: number;
  displayName?: string;
}): Promise<AuthResult> {
  const email = normalizeEmail(input.email);

  const created = await db().auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: CONFIRM_EMAIL_ON_SIGNUP,
  });

  if (created.error || !created.data?.user) {
    const message = created.error?.message ?? "";
    if (/already|registered|exists/i.test(message)) {
      throw new ApiError("EMAIL_TAKEN", "이미 가입된 이메일입니다. 로그인해주세요.");
    }
    if (/password/i.test(message)) {
      throw new ApiError("BAD_REQUEST", "비밀번호가 조건에 맞지 않습니다.");
    }
    console.error("[odot] 가입 실패", created.error);
    throw new ApiError("INTERNAL", "가입에 실패했습니다. 잠시 후 다시 시도해주세요.");
  }

  const authUserId = created.data.user.id;

  const profile = await db()
    .from("users")
    .insert({
      auth_user_id: authUserId,
      email,
      age: input.age,
      display_name: input.displayName?.trim() || null,
    })
    .select(USER_COLUMNS)
    .single();

  if (profile.error) {
    // 프로필을 못 만들면 계정만 붕 뜨므로 되돌린다.
    await db().auth.admin.deleteUser(authUserId).catch(() => undefined);
    console.error("[odot] 프로필 생성 실패", profile.error);
    throw new ApiError("INTERNAL", "가입에 실패했습니다. 잠시 후 다시 시도해주세요.");
  }

  const { session } = await createSession(email, input.password);
  return { user: toUser(profile.data as UserRow), session, isNew: true };
}

/** 로그인 */
export async function logIn(input: { email: string; password: string }): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  const { session, authUserId } = await createSession(email, input.password);

  const profile = await db()
    .from("users")
    .select(USER_COLUMNS)
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (profile.error) throw profile.error;
  if (!profile.data) {
    throw new ApiError("USER_NOT_FOUND", "계정 정보를 찾을 수 없습니다. 다시 가입해주세요.");
  }

  return { user: toUser(profile.data as UserRow), session, isNew: false };
}

/** 액세스 토큰이 만료됐을 때 리프레시 토큰으로 새 세션을 받는다. */
export async function refreshSession(refreshToken: string): Promise<Session> {
  const { data, error } = await authClient().auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data?.session) {
    throw new ApiError("UNAUTHENTICATED", "로그인이 만료되었습니다. 다시 로그인해주세요.");
  }
  return toSession(data.session);
}

/** 로그아웃 — 해당 리프레시 토큰을 무효화한다. */
export async function logOut(accessToken: string): Promise<void> {
  try {
    await db().auth.admin.signOut(accessToken);
  } catch (err) {
    // 이미 만료된 토큰이면 그대로 성공 처리한다.
    console.error("[odot] 로그아웃 처리 중 오류", err);
  }
}

async function createSession(
  email: string,
  password: string,
): Promise<{ session: Session; authUserId: string }> {
  // 공유 클라이언트가 아니라 일회용 클라이언트로 로그인한다 (위 authClient 주석 참고)
  const { data, error } = await authClient().auth.signInWithPassword({ email, password });
  if (error || !data?.session || !data.user) {
    throw new ApiError("INVALID_CREDENTIALS", "이메일 또는 비밀번호가 올바르지 않습니다.");
  }
  return { session: toSession(data.session), authUserId: data.user.id };
}
