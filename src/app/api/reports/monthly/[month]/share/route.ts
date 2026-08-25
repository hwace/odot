import { z } from "zod";
import { ok, readJson, withRoute, preflight, ApiError } from "@/lib/http";
import { db } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { isValidMonth } from "@/lib/date";
import { computeMonthlyReport } from "@/lib/reports";
import { logEvent } from "@/lib/events";
import type { ShareLog } from "@/types/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ month: string }> };

const BodySchema = z.object({
  /** 기기 공유 시트의 결과를 그대로 알려준다. 생략하면 requested. */
  result: z.enum(["requested", "success", "failed", "no_app"]).optional(),
});

/**
 * POST /api/reports/monthly/:month/share
 * 인스타그램 공유 시도를 기록한다. (F-ZVJSOW)
 *
 * 프론트 흐름:
 *   1. GET /api/reports/monthly/:month/image 로 PNG(1080x1080)를 blob 으로 받는다
 *   2. navigator.share({ files: [new File([blob], "odot.png", { type: "image/png" })] })
 *   3. 그 결과를 이 엔드포인트로 보낸다 (성공 success / 취소·실패 failed / 앱 없음 no_app)
 */
export const POST = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { month } = await ctx.params;
  if (!isValidMonth(month)) {
    throw new ApiError("BAD_REQUEST", "month 는 YYYY-MM 형식이어야 합니다.");
  }

  const { result = "requested" } = BodySchema.parse(await readJson(req));

  const report = await computeMonthlyReport(user.id, month);
  if (report.isEmpty) {
    throw new ApiError("NOT_FOUND", "공유할 정산 결과가 아직 없습니다.");
  }

  const { data, error } = await db()
    .from("share_logs")
    .insert({ user_id: user.id, year_month: month, channel: "instagram", result })
    .select("id, year_month, channel, result, shared_at")
    .single();
  if (error) throw error;

  const row = data as {
    id: string;
    year_month: string;
    channel: string;
    result: ShareLog["result"];
    shared_at: string;
  };

  void logEvent(user.id, "share_attempt", { month, result });

  return ok({
    log: {
      id: row.id,
      month: row.year_month,
      channel: "instagram",
      result: row.result,
      sharedAt: row.shared_at,
    } satisfies ShareLog,
    shareImageUrl: report.shareImageUrl,
  });
});

export const OPTIONS = preflight;
