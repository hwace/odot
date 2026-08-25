import { z } from "zod";
import { ok, readJson, withRoute, preflight } from "@/lib/http";
import { signUp } from "@/lib/accounts";
import { MAX_AGE, MIN_AGE } from "@/lib/age";
import { logEvent } from "@/lib/events";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.email("이메일 형식이 올바르지 않습니다."),
  password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다.").max(72),
  age: z.number().int().min(MIN_AGE).max(MAX_AGE),
});

/**
 * POST /api/auth/signup — 이메일 계정 만들기
 *
 * 가입과 동시에 로그인된 세션을 돌려주므로 곧바로 앱을 쓸 수 있다.
 * 비밀번호는 우리 DB에 저장되지 않는다 (Supabase Auth 가 해싱해서 보관).
 * 나이는 연령별 콘텐츠 검열 기준값이라 가입 때 함께 받는다.
 */
export const POST = withRoute(async (req) => {
  const body = BodySchema.parse(await readJson(req));
  const result = await signUp(body);
  void logEvent(result.user.id, "signup", { ageGroup: result.user.ageGroup });
  return ok(result);
});

export const OPTIONS = preflight;
