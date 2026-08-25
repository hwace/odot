import { ok, withRoute, preflight, ApiError } from "@/lib/http";
import { bearerToken } from "@/lib/auth";
import { logOut } from "@/lib/accounts";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout — 이 세션을 무효화한다.
 * 프론트는 저장해 둔 토큰도 함께 지우면 된다.
 */
export const POST = withRoute(async (req) => {
  const token = bearerToken(req);
  if (!token) throw new ApiError("UNAUTHENTICATED", "로그인 상태가 아닙니다.");
  await logOut(token);
  return ok({ loggedOut: true });
});

export const OPTIONS = preflight;
