import { z } from "zod";
import { ok, readJson, withRoute, preflight } from "@/lib/http";
import { logIn } from "@/lib/accounts";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.email("이메일 형식이 올바르지 않습니다."),
  password: z.string().min(1, "비밀번호를 입력해주세요.").max(72),
});

/**
 * POST /api/auth/login
 *
 * 성공하면 { user, session } 이 온다. session.accessToken 을 이후 모든 요청에
 * Authorization: Bearer 헤더로 실으면 된다.
 * 이메일이 없든 비밀번호가 틀리든 똑같이 INVALID_CREDENTIALS 로 답한다 —
 * 어느 이메일이 가입돼 있는지 알려주지 않기 위해서다.
 */
export const POST = withRoute(async (req) => {
  const body = BodySchema.parse(await readJson(req));
  const result = await logIn(body);
  void logEvent(result.user.id, "login", {});
  return ok(result);
});

export const OPTIONS = preflight;
