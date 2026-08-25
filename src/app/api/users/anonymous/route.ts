import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ok, readJson, withRoute, preflight } from "@/lib/http";
import { db } from "@/lib/supabase";
import { toUser, USER_COLUMNS, type UserRow } from "@/lib/auth";
import { MAX_AGE, MIN_AGE } from "@/lib/age";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  /** 프론트가 기기에 저장해 둔 값. 없으면 서버가 새로 발급한다. */
  deviceId: z.string().min(8).max(128).optional(),
  age: z.number().int().min(MIN_AGE).max(MAX_AGE),
});

/**
 * POST /api/users/anonymous
 * 익명 사용자를 만들거나(신규) 기존 사용자를 그대로 돌려준다(재실행).
 *
 * 같은 deviceId 로 여러 번 불러도 안전하다. 나이가 달라지면 갱신된다.
 * 응답의 deviceId 를 기기에 저장해두고, 이후 모든 요청에 x-device-id 헤더로 보낸다.
 *
 * 관심사는 여기서 받지 않는다 — 프로젝트를 만들 때 프로젝트마다 고른다.
 */
export const POST = withRoute(async (req) => {
  const { deviceId, age } = BodySchema.parse(await readJson(req));
  const id = deviceId ?? randomUUID();

  const { data, error } = await db()
    .from("users")
    .upsert(
      { device_id: id, age, last_active_at: new Date().toISOString() },
      { onConflict: "device_id" },
    )
    .select(USER_COLUMNS)
    .single();
  if (error) throw error;

  return ok({ user: toUser(data as UserRow), isNew: !deviceId });
});

export const OPTIONS = preflight;
