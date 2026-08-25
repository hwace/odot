import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
