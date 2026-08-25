import { z } from "zod";
import { ok, readJson, withRoute, preflight } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { logEvent } from "@/lib/events";
import type { EventType } from "@/types/api";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  type: z.string().min(1).max(60),
  payload: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/events — 프론트에서 KPI 이벤트를 남긴다.
 * (카드 노출, 캘린더 조회처럼 서버가 직접 알 수 없는 화면 이벤트용)
 */
export const POST = withRoute(async (req) => {
  const user = await requireUser(req);
  const body = BodySchema.parse(await readJson(req));
  await logEvent(user.id, body.type as EventType, body.payload ?? {});
  return ok({ recorded: true });
});

export const OPTIONS = preflight;
