import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { ApiErrorCode, ApiResponse } from "@/types/api";

/** 코드별 기본 HTTP 상태 */
const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  USER_NOT_FOUND: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  ALREADY_REACTED: 409,
  NOT_ENOUGH_SIGNAL: 409,
  AGE_RESTRICTED: 422,
  AI_FAILED: 502,
  INTERNAL: 500,
};

/** 라우트 안에서 던지면 아래 withRoute 가 알아서 ApiFailure 로 바꿔준다. */
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiResponse<T>>({ ok: true, data }, { status: 200, ...init });
}

export function fail(code: ApiErrorCode, message: string, details?: unknown) {
  return NextResponse.json<ApiResponse<never>>(
    { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status: STATUS[code] },
  );
}

/**
 * 모든 라우트 핸들러를 감싼다. 던져진 예외를 일관된 ApiFailure 로 변환해서
 * 프론트가 항상 { ok: boolean } 한 가지 모양만 처리하면 되게 만든다.
 */
export function withRoute<Args extends unknown[]>(
  handler: (req: Request, ...args: Args) => Promise<Response>,
) {
  return async (req: Request, ...args: Args): Promise<Response> => {
    try {
      return await handler(req, ...args);
    } catch (err) {
      if (err instanceof ApiError) {
        return fail(err.code, err.message, err.details);
      }
      if (err instanceof ZodError) {
        return fail("BAD_REQUEST", "요청 형식이 올바르지 않습니다.", err.issues);
      }
      console.error("[odot] unhandled route error", err);
      return fail("INTERNAL", "서버에서 문제가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
  };
}

/** JSON 본문을 안전하게 읽는다. 본문이 없으면 빈 객체. */
export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("BAD_REQUEST", "요청 본문이 올바른 JSON이 아닙니다.");
  }
}

/** 브라우저 프리플라이트 대응 (다른 오리진에서 붙일 때만 의미 있음) */
export function preflight() {
  return new Response(null, { status: 204 });
}
