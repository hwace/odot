import { ok, withRoute, ApiError } from "@/lib/http";
import { db } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { currentMonth, formatKst, isValidMonth, monthRange } from "@/lib/date";
import { logEvent } from "@/lib/events";
import type { CalendarDay, CalendarMonth } from "@/types/api";

export const dynamic = "force-dynamic";

/**
 * GET /api/calendar?month=YYYY-MM
 * 날짜별로 '가장 많이 완료한 카테고리'를 돌려준다. (F-IYXFDA)
 *
 * 완료한 할 일이 하나도 없는 날짜는 응답 배열에 아예 들어가지 않는다.
 * 완료 수가 같은 날은 가장 최근에 완료한 할 일의 카테고리를 대표로 쓴다.
 * 날짜 경계는 한국 시간(Asia/Seoul) 기준이다.
 */
export const GET = withRoute(async (req) => {
  const user = await requireUser(req);

  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isValidMonth(month)) {
    throw new ApiError("BAD_REQUEST", "month 는 YYYY-MM 형식이어야 합니다.");
  }

  const { startIso, endIso } = monthRange(month);
  const { data, error } = await db()
    .from("todos")
    .select("category, completed_at")
    .eq("user_id", user.id)
    .eq("is_completed", true)
    .gte("completed_at", startIso)
    .lt("completed_at", endIso)
    .order("completed_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as Array<{ category: string; completed_at: string }>;
  void logEvent(user.id, "calendar_view", { month, doneCount: rows.length });

  return ok(aggregate(month, rows));
});

function aggregate(
  month: string,
  rows: Array<{ category: string; completed_at: string }>,
): CalendarMonth {
  /** 날짜 → 카테고리 → { count, lastAt } */
  const byDate = new Map<string, Map<string, { count: number; lastAt: string }>>();

  for (const row of rows) {
    const date = formatKst(new Date(row.completed_at));
    const perCategory = byDate.get(date) ?? new Map();
    const prev = perCategory.get(row.category);
    perCategory.set(row.category, {
      count: (prev?.count ?? 0) + 1,
      // rows 가 완료 시각 오름차순이므로 뒤에 오는 값이 항상 더 최근이다.
      lastAt: row.completed_at,
    });
    byDate.set(date, perCategory);
  }

  const days: CalendarDay[] = [];
  for (const [date, perCategory] of byDate) {
    const entries = [...perCategory.entries()];
    // 완료 수 내림차순 → 동률이면 가장 최근 완료가 앞
    entries.sort((a, b) => b[1].count - a[1].count || b[1].lastAt.localeCompare(a[1].lastAt));

    days.push({
      date,
      topCategory: entries[0][0],
      doneCount: entries.reduce((sum, [, v]) => sum + v.count, 0),
      breakdown: entries.map(([category, v]) => ({ category, count: v.count })),
    });
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  return { month, days };
}
