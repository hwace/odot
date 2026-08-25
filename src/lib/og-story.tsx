import { ImageResponse } from "next/og";
import { ogAssets } from "@/lib/og-assets";
import type { ReportKeyword } from "@/types/api";

/**
 * 월간 정산을 인스타그램 스토리 한 장으로 그린다.
 *
 * 라우트에서 떼어 둔 이유는 두 가지다. 하나는 로그인·집계와 그림 그리기가
 * 서로 다른 일이라서, 다른 하나는 데이터를 손으로 넣어 그림만 따로
 * 확인할 수 있어서다.
 */
/** 인스타그램 **스토리** 규격. 정사각형이 아니라 9:16 이다. */
const WIDTH = 1080;
const HEIGHT = 1920;

const INK = "#161513";
const MUTED = "#B0ABA4";

/** 시안의 파스텔 원 — 네 귀퉁이에서 화면 밖으로 흘러나간다. */
const BLOBS = [
  { color: "#93BE9C", left: -45, top: 150, size: 335 },
  { color: "#FBE08A", left: 725, top: -25, size: 360 },
  { color: "#C4A2E8", left: 600, top: 960, size: 740 },
  { color: "#A9C3E8", left: -135, top: 1558, size: 360 },
];

/** 키워드 한 칸의 높이. 부제가 있든 없든 자리를 같게 잡아 줄이 흔들리지 않는다. */
const SLOT = 272;

/**
 * 키워드 글자 크기. 시안은 두 글자짜리라 큼직하지만, 긴 키워드가 오면
 * 오른쪽으로 삐져나간다. 길이에 따라 한 단계씩 줄여 한 줄에 담는다.
 */
function keywordSize(text: string): number {
  if (text.length <= 5) return 82;
  if (text.length <= 8) return 66;
  if (text.length <= 11) return 52;
  return 44;
}

/**
 * 순위 아래에 붙는 한 줄. 할 말이 없으면 비운다.
 * 시안에서 2·3위에 아무 글도 없는 건 견줄 지난달 기록이 없어서다.
 */
function subtitleOf(item: { isNew: boolean; delta: number | null }): string | null {
  if (item.isNew) return "이번 달 신규 관심사";
  if (item.delta === null || item.delta === 0) return null;
  return `지난달보다 ${item.delta > 0 ? "+" : ""}${item.delta}`;
}

export function storyImage(top: ReportKeyword[]): ImageResponse {
  const { font, logo, character } = ogAssets();

  return new ImageResponse(
    (
      <div
        style={{
          width: `${WIDTH}px`,
          height: `${HEIGHT}px`,
          display: "flex",
          position: "relative",
          background: "#FFFFFF",
          fontFamily: "Pretendard",
          overflow: "hidden",
        }}
      >
        {BLOBS.map((b) => (
          <div
            key={b.color}
            style={{
              position: "absolute",
              display: "flex",
              left: `${b.left}px`,
              top: `${b.top}px`,
              width: `${b.size}px`,
              height: `${b.size}px`,
              borderRadius: "50%",
              background: b.color,
            }}
          />
        ))}

        {/* 돋보기 캐릭터 — 보라 원에 걸쳐 앉는다 */}
        <img
          src={character}
          width={350}
          height={448}
          style={{ position: "absolute", left: "608px", top: "1320px" }}
        />

        {/* 로고 — app.html 의 브랜드 표기를 그대로 옮겼다 */}
        <div
          style={{
            position: "absolute",
            left: "56px",
            top: "38px",
            display: "flex",
            alignItems: "center",
            fontSize: 78,
            fontWeight: 800,
            letterSpacing: "-6px",
            color: "#24221E",
          }}
        >
          <img
            src={logo}
            width={62}
            height={56}
            style={{ borderRadius: "46% 54% 50% 45%", marginRight: "2px" }}
          />
          <div style={{ display: "flex" }}>d</div>
          <div
            style={{
              display: "flex",
              width: "52px",
              height: "52px",
              margin: "0 3px",
              borderRadius: "50%",
              background: "#80AD99",
            }}
          />
          <div style={{ display: "flex" }}>t</div>
        </div>

        {/* 본문 */}
        <div
          style={{
            position: "absolute",
            left: "212px",
            top: "484px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 112,
              fontWeight: 800,
              letterSpacing: "-6px",
              color: INK,
            }}
          >
            이달의 관심
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: "96px" }}>
            {top.map((k, i) => {
              const sub = subtitleOf(k);
              return (
                <div
                  key={k.keyword}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    height: `${SLOT}px`,
                    paddingLeft: i === 0 ? "0px" : "8px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      fontSize: keywordSize(k.keyword),
                      fontWeight: 800,
                      letterSpacing: "-3px",
                      color: INK,
                    }}
                  >
                    {`${k.rank}. ${k.keyword}`}
                  </div>
                  {sub ? (
                    <div
                      style={{
                        display: "flex",
                        marginTop: "20px",
                        fontSize: 46,
                        fontWeight: 800,
                        letterSpacing: "-1px",
                        color: MUTED,
                      }}
                    >
                      {sub}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [{ name: "Pretendard", data: font, weight: 800, style: "normal" }],
    },
  );
}
