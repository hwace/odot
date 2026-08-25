import { ApiError } from "@/lib/http";
import { db } from "@/lib/supabase";
import type { AgeGroup, User } from "@/types/api";

/**
 * 신원 확인.
 *
 * 기본은 이메일 계정이다 — `Authorization: Bearer <accessToken>`.
 * 비밀번호 해싱과 세션 발급은 직접 만들지 않고 Supabase Auth 에 맡긴다.
 * public.users 는 프로필(나이 등)만 들고 auth.users 를 참조한다.
 *
 * `x-device-id` 는 로그인 화면이 붙기 전까지만 남겨 둔 과도기 경로다.
 * 같은 브라우저를 쓰면 같은 사용자가 되므로, 로그인이 준비되면
 * REQUIRE_AUTH=true 로 막고 그다음 배포에서 코드를 지우면 된다.
 */

export const DEVICE_HEADER = "x-device-id";

/** 로그인 없이 x-device-id 로 들어오는 요청을 막을지 */
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === "true";

export interface UserRow {
  id: string;
  device_id: string | null;
  auth_user_id: string | null;
  email: string | null;
  age: number;
  age_group: AgeGroup;
  is_minor: boolean;
  created_at: string;
  last_active_at: string;
}

export const USER_COLUMNS =
  "id, device_id, auth_user_id, email, age, age_group, is_minor, created_at, last_active_at";

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    age: row.age,
    ageGroup: row.age_group,
    isMinor: row.is_minor,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    // 익명 과도기 경로에서만 채워진다.
    deviceId: row.device_id,
  };
}

/** 요청에서 현재 사용자를 찾는다. */
export async function requireUser(req: Request): Promise<UserRow> {
  const token = bearerToken(req);
  if (token) return userFromToken(token);

  if (REQUIRE_AUTH) {
    throw new ApiError("UNAUTHENTICATED", "로그인이 필요합니다.", {
      hint: "Authorization: Bearer <accessToken> 헤더가 필요합니다.",
    });
  }
  return userFromDevice(req);
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !value?.trim()) return null;
  return value.trim();
}

/** 액세스 토큰 → 프로필 */
export async function userFromToken(accessToken: string): Promise<UserRow> {
  const { data, error } = await db().auth.getUser(accessToken);
  if (error || !data?.user) {
    throw new ApiError("UNAUTHENTICATED", "로그인이 만료되었습니다. 다시 로그인해주세요.");
  }

  const profile = await db()
    .from("users")
    .select(USER_COLUMNS)
    .eq("auth_user_id", data.user.id)
    .maybeSingle();

  if (profile.error) throw profile.error;
  if (!profile.data) {
    // auth 사용자는 있는데 프로필이 없다 — 가입이 중간에 끊긴 경우다.
    throw new ApiError("USER_NOT_FOUND", "계정 정보를 찾을 수 없습니다. 다시 로그인해주세요.");
  }

  const row = profile.data as UserRow;
  void touch(row.id);
  return row;
}

/** 과도기: x-device-id → 프로필 */
async function userFromDevice(req: Request): Promise<UserRow> {
  const deviceId = req.headers.get(DEVICE_HEADER)?.trim();
  if (!deviceId) {
    throw new ApiError("UNAUTHENTICATED", "로그인이 필요합니다.", {
      hint: `Authorization: Bearer <accessToken> 또는 ${DEVICE_HEADER} 헤더가 필요합니다.`,
    });
  }

  const { data, error } = await db()
    .from("users")
    .select(USER_COLUMNS)
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new ApiError("USER_NOT_FOUND", "등록되지 않은 기기입니다. 다시 시작해주세요.");
  }

  const row = data as UserRow;
  void touch(row.id);
  return row;
}

async function touch(userId: string) {
  try {
    await db()
      .from("users")
      .update({ last_active_at: new Date().toISOString() })
      .eq("id", userId);
  } catch {
    // 활동 시각 갱신 실패는 무시한다.
  }
}
