import { z } from "zod";
import { ok, readJson, withRoute, preflight } from "@/lib/http";
import { refreshSession } from "@/lib/accounts";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  refreshToken: z.string().min(1),
});

/**
 * POST /api/auth/refresh — 액세스 토큰 갱신
 *
 * 액세스 토큰은 한 시간쯤이면 만료된다. 401 UNAUTHENTICATED 를 받으면
 * 저장해 둔 refreshToken 으로 여기를 호출해 새 세션을 받고 원래 요청을 다시 보내면 된다.
 * (클라이언트가 알아서 처리하므로 직접 부를 일은 거의 없다)
 */
export const POST = withRoute(async (req) => {
  const { refreshToken } = BodySchema.parse(await readJson(req));
  return ok({ session: await refreshSession(refreshToken) });
});

export const OPTIONS = preflight;
