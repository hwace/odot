import { ImageResponse } from "next/og";
import { withRoute, fail, ApiError } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { isValidMonth } from "@/lib/date";
import { computeMonthlyReport } from "@/lib/reports";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ month: string }> };

const CATEGORY_COLOR: Record<string, string> = {
  exercise: "#F0554E",
  study: "#F2913D",
  reading: "#3FA96A",
  music: "#8C63D6",
  culture: "#E7C13B",
  career: "#3B7DD8",
  etc: "#8B8F98",
};

/**
 * GET /api/reports/monthly/:month/image
 * 인스타그램 공유용 1080x1080 PNG. (F-ZVJSOW)
 *
 * <img src> 로는 x-device-id 헤더를 실을 수 없으니 fetch 로 받아서 쓴다:
 *   const res  = await fetch(url, { headers: { "x-device-id": deviceId } });
 *   const blob = await res.blob();
 *   navigator.share({ files: [new File([blob], "odot.png", { type: "image/png" })] });
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

  const [year, mm] = month.split("-");

  return new ImageResponse(
    (
      <div
        style={{
          width: "1080px",
          height: "1080px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "88px 80px",
          background: "linear-gradient(150deg, #12131A 0%, #1E2030 55%, #2A1F3D 100%)",
          color: "#FFFFFF",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 34, letterSpacing: 8, color: "#9BA1B0" }}>
            {`${year}년 ${Number(mm)}월`}
          </div>
          <div style={{ fontSize: 76, fontWeight: 700, marginTop: 16 }}>
            내가 관심 있던 것들
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {report.topKeywords.map((k) => (
            <div
              key={k.keyword}
              style={{ display: "flex", alignItems: "center", gap: 28 }}
            >
              <div
                style={{
                  width: 76,
                  height: 76,
                  borderRadius: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 38,
                  fontWeight: 700,
                  background: CATEGORY_COLOR[k.category] ?? CATEGORY_COLOR.etc,
                }}
              >
                {k.rank}
              </div>
              <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                <div style={{ fontSize: 46, fontWeight: 600 }}>{k.keyword}</div>
                <div style={{ fontSize: 26, color: "#9BA1B0", marginTop: 6 }}>
                  {k.isNew
                    ? "이번 달에 새로 생긴 관심"
                    : `지난달보다 ${k.delta! >= 0 ? "+" : ""}${k.delta}`}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div style={{ fontSize: 28, color: "#9BA1B0" }}>
            {`이번 달 스와이프 ${report.totalReactions}번 · 관심 ${report.likeCount}개`}
          </div>
          <div style={{ fontSize: 26, color: "#6E7480", letterSpacing: 4 }}>odot</div>
        </div>
      </div>
    ),
    { width: 1080, height: 1080 },
  );
});
