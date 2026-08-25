import { ImageResponse } from "next/og";
import { withRoute, fail, ApiError } from "@/lib/http";
import { requireUser } from "@/lib/auth";
import { isValidMonth } from "@/lib/date";
import { computeMonthlyReport } from "@/lib/reports";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ month: string }> };

/**
 * 인스타그램 **스토리** 규격. 정사각형이 아니라 9:16 이다.
 * 스토리에 올리면 위아래가 잘리지 않도록 안전 여백을 크게 잡는다.
 */
const WIDTH = 1080;
const HEIGHT = 1920;

/** 디자인 시안의 파스텔 원 색 */
const BLOB = {
  green: "#93BE9C",
  yellow: "#FBE08A",
  purple: "#C4A2E8",
  blue: "#A9C3E8",
};

/**
 * GET /api/reports/monthly/:month/image
 * 인스타그램 스토리 공유용 1080x1920 PNG. (F-ZVJSOW)
 *
 * <img src> 로는 x-device-id / Authorization 헤더를 실을 수 없으니 fetch 로 받는다.
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
  const top = report.topKeywords.slice(0, 3);

  return new ImageResponse(
    (
      <div
        style={{
          width: `${WIDTH}px`,
          height: `${HEIGHT}px`,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          background: "#FFFFFF",
          fontFamily: "sans-serif",
          overflow: "hidden",
        }}
      >
        {/* 배경 원 — 시안의 네 귀퉁이 */}
        <div
          style={{
            position: "absolute",
            left: "-190px",
            top: "180px",
            width: "480px",
            height: "480px",
            borderRadius: "50%",
            background: BLOB.green,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: "-110px",
            top: "-90px",
            width: "440px",
            height: "440px",
            borderRadius: "50%",
            background: BLOB.yellow,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: "-150px",
            bottom: "180px",
            width: "620px",
            height: "620px",
            borderRadius: "50%",
            background: BLOB.purple,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "-170px",
            bottom: "-190px",
            width: "460px",
            height: "460px",
            borderRadius: "50%",
            background: BLOB.blue,
            display: "flex",
          }}
        />

        {/* 로고 */}
        <div
          style={{
            position: "absolute",
            left: "72px",
            top: "62px",
            display: "flex",
            alignItems: "center",
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: "-3px",
            color: "#24221E",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "44px",
              marginRight: "6px",
              borderRadius: "50%",
              background: "#F08A80",
              display: "flex",
            }}
          />
          <div style={{ display: "flex" }}>d</div>
          <div
            style={{
              width: "44px",
              height: "44px",
              margin: "0 4px",
              borderRadius: "50%",
              background: "#6E34CC",
              display: "flex",
            }}
          />
          <div style={{ display: "flex" }}>t</div>
        </div>

        {/* 본문 */}
        <div
          style={{
            position: "absolute",
            left: "210px",
            top: "480px",
            right: "90px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 108,
              fontWeight: 800,
              letterSpacing: "-5px",
              color: "#161513",
            }}
          >
            이달의 관심
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: "70px" }}>
            {top.map((k, i) => (
              <div
                key={k.keyword}
                style={{ display: "flex", flexDirection: "column", marginTop: i === 0 ? 0 : 96 }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: 72,
                    fontWeight: 800,
                    letterSpacing: "-3px",
                    color: "#161513",
                  }}
                >
                  {`${k.rank}. ${k.keyword}`}
                </div>
                {k.isNew ? (
                  <div
                    style={{
                      display: "flex",
                      marginTop: "14px",
                      fontSize: 34,
                      fontWeight: 800,
                      color: "#9A958E",
                    }}
                  >
                    이번 달 신규 관심사
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      marginTop: "14px",
                      fontSize: 34,
                      fontWeight: 800,
                      color: "#9A958E",
                    }}
                  >
                    {`지난달보다 ${(k.delta ?? 0) >= 0 ? "+" : ""}${k.delta ?? 0}`}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 하단 요약 */}
        <div
          style={{
            position: "absolute",
            left: "72px",
            bottom: "70px",
            display: "flex",
            fontSize: 32,
            fontWeight: 800,
            color: "#6E6862",
          }}
        >
          {`${month.replace("-", "년 ")}월 · 스와이프 ${report.totalReactions}번 · 관심 ${report.likeCount}개`}
        </div>
      </div>
    ),
    { width: WIDTH, height: HEIGHT },
  );
});
