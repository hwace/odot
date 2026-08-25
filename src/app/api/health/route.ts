import { ok, withRoute } from "@/lib/http";

export const dynamic = "force-dynamic";

/** GET /api/health — 배선 확인용. 환경변수가 채워졌는지도 같이 알려준다. */
export const GET = withRoute(async () =>
  ok({
    status: "ok",
    time: new Date().toISOString(),
    env: {
      supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      openai: Boolean(process.env.OPENAI_API_KEY),
    },
  }),
);
