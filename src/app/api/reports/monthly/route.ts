import { ok, withRoute, ApiError } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { currentMonth, isValidMonth } from "@/lib/date";
import { computeMonthlyReport } from "@/lib/reports";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

/**
 * GET /api/reports/monthly?month=YYYY-MM
 * 그 달의 관심 키워드 정산. month 를 생략하면 이번 달. (F-NYHVHG)
 *
 * 반응이 하나도 없으면 isEmpty:true 가 오므로, 프론트는 "관심사를 더 탐색해보세요"
 * 빈 상태 화면을 띄우면 된다.
 */
export const GET = withRoute(async (req) => {
  const user = await requireUser(req);

  const month = new URL(req.url).searchParams.get("month") ?? currentMonth();
  if (!isValidMonth(month)) {
    throw new ApiError("BAD_REQUEST", "month 는 YYYY-MM 형식이어야 합니다.");
  }

  const report = await computeMonthlyReport(user.id, month);
  void logEvent(user.id, "report_view", { month, isEmpty: report.isEmpty });
  return ok({ report });
});
