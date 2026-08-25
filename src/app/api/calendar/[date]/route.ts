import { ok, withRoute, ApiError } from "@/lib/http";
import { db } from "@/lib/supabase";
import { requireUser } from "@/lib/auth";
import { dayRange, isValidDate } from "@/lib/date";
import { toTodo, type TodoRow } from "@/lib/mappers";
import type { CalendarDayDetail } from "@/types/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ date: string }> };

/**
 * GET /api/calendar/:date  (date = YYYY-MM-DD)
 * 캘린더에서 날짜를 눌렀을 때 보여줄 그 날의 완료 내역. (F-IYXFDA 표시 규칙)
 */
export const GET = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { date } = await ctx.params;
  if (!isValidDate(date)) {
    throw new ApiError("BAD_REQUEST", "날짜는 YYYY-MM-DD 형식이어야 합니다.");
  }

  const { startIso, endIso } = dayRange(date);
  const { data, error } = await db()
    .from("todos")
    .select("id, project_id, content, category, order_index, recommended_at, is_completed, completed_at")
    .eq("user_id", user.id)
    .eq("is_completed", true)
    .gte("completed_at", startIso)
    .lt("completed_at", endIso)
    .order("completed_at", { ascending: true });
  if (error) throw error;

  const rows = (data ?? []) as TodoRow[];
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.category, (counts.get(row.category) ?? 0) + 1);

  const detail: CalendarDayDetail = {
    date,
    doneCount: rows.length,
    breakdown: [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    todos: rows.map(toTodo),
  };
  return ok(detail);
});
