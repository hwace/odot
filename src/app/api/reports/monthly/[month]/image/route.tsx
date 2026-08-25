import { withRoute, fail, ApiError } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { isValidMonth } from "@/lib/date";
import { computeMonthlyReport } from "@/lib/reports";
import { storyImage } from "@/lib/og-story";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ month: string }> };

/**
 * GET /api/reports/monthly/:month/image
 * 인스타그램 스토리 공유용 1080x1920 PNG. (F-ZVJSOW)
 *
 * <img src> 로는 Authorization 헤더를 실을 수 없으니 fetch 로 받는다.
 * 클라이언트의 shareToInstagram() 이 그 과정을 대신한다.
 */
export const GET = withRoute(async (req, ctx: Ctx) => {
  const user = await requireUser(req);
  const { month } = await ctx.params;
  if (!isValidMonth(month)) {
    throw new ApiError("BAD_REQUEST", "month 는 YYYY-MM 형식이어야 합니다.");
  }

  const report = await computeMonthlyReport(user.id, month);
  if (report.isEmpty) {
    return fail("NOT_FOUND", "공유할 정산 결과가 아직 없습니다.");
  }

  // 스토리 한 장에는 세 개까지가 읽기 좋다.
  return storyImage(report.topKeywords.slice(0, 3));
});
