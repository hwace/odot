import { db } from "@/lib/supabase";
import type { EventType } from "@/types/api";

/**
 * KPI 이벤트를 남긴다. 실패해도 사용자 요청은 그대로 진행되어야 하므로
 * 절대 예외를 밖으로 던지지 않는다. 호출부에서는 await 없이 void 로 써도 된다.
 */
export async function logEvent(
  userId: string | null,
  type: EventType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db().from("events").insert({ user_id: userId, type, payload });
  } catch (err) {
    console.error("[odot] event log failed", type, err);
  }
}
