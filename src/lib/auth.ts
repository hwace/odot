import { ApiError } from "@/lib/http";
import { db } from "@/lib/supabase";
import type { AgeGroup, User } from "@/types/api";

export const DEVICE_HEADER = "x-device-id";

export interface UserRow {
  id: string;
  device_id: string;
  age: number;
  age_group: AgeGroup;
  is_minor: boolean;
  created_at: string;
  last_active_at: string;
}

export const USER_COLUMNS =
  "id, device_id, age, age_group, is_minor, created_at, last_active_at";

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    deviceId: row.device_id,
    age: row.age,
    ageGroup: row.age_group,
    isMinor: row.is_minor,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  };
}

/**
 * x-device-id 헤더로 사용자를 찾는다.
 *
 * 익명 방식이라 별도 로그인은 없다. 프론트는 첫 실행 때
 * POST /api/users/anonymous 로 사용자를 만들고, 받은 deviceId 를 로컬에 저장한 뒤
 * 이후 모든 요청에 이 헤더로 실어 보내면 된다.
 *
 * 관심사는 사용자가 아니라 프로젝트가 갖는다 — 온보딩 검사는 여기 없다.
 */
export async function requireUser(req: Request): Promise<UserRow> {
  const deviceId = req.headers.get(DEVICE_HEADER)?.trim();
  if (!deviceId) {
    throw new ApiError(
      "UNAUTHENTICATED",
      "사용자 정보가 없습니다. 앱을 다시 시작해주세요.",
      { hint: `${DEVICE_HEADER} 헤더가 필요합니다.` },
    );
  }

  const { data, error } = await db()
    .from("users")
    .select(USER_COLUMNS)
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new ApiError(
      "USER_NOT_FOUND",
      "등록되지 않은 기기입니다. 처음부터 다시 시작해주세요.",
    );
  }

  void touch(data.id);
  return data as UserRow;
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
