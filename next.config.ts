import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 공유 이미지는 폰트와 그림 파일을 직접 읽는다. public/ 은 CDN 으로만 나가고
  // 서버리스 번들에는 들어가지 않아서, 쓰는 파일을 따로 챙겨 넣어야 한다.
  outputFileTracingIncludes: {
    "/api/reports/monthly/[month]/image": ["./src/og-assets/**"],
  },

  // 루트로 들어오면 앱 화면을 띄운다.
  // 앱은 팀원 프로토타입(public/app.html)이라 Next 페이지가 아니다.
  async redirects() {
    return [{ source: "/", destination: "/app.html", permanent: false }];
  },

  // 프론트엔드를 별도 오리진(예: Vite dev server)에서 띄울 경우를 대비한 CORS 허용.
  // 같은 Next 앱 안에서 쓸 때는 아무 영향이 없다.
  async headers() {
    const origin = process.env.CORS_ALLOW_ORIGIN;
    if (!origin) return [];
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: origin },
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, x-device-id" },
        ],
      },
    ];
  },
};

export default nextConfig;
