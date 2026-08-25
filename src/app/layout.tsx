import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "odot",
  description: "지금 해볼 만한 일을 찾아주는 리버스 투두 앱",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#12131A",
};

// 프론트엔드 담당자가 이 파일을 자유롭게 교체하면 된다.
// 백엔드는 src/app/api/** 와 src/lib/** 만 쓰므로 서로 겹치지 않는다.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
