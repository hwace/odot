/** 서비스 기준 시간대. 캘린더/월간 정산의 '하루'와 '한 달'을 이 기준으로 자른다. */
export const TIME_ZONE = "Asia/Seoul";

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidMonth(month: string): boolean {
  return MONTH_RE.test(month);
}

export function isValidDate(date: string): boolean {
  return DATE_RE.test(date);
}

/** 현재 KST 기준 YYYY-MM */
export function currentMonth(): string {
  return formatKst(new Date()).slice(0, 7);
}

/** UTC 타임스탬프를 KST 기준 YYYY-MM-DD 로 바꾼다. */
export function formatKst(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** YYYY-MM → 그 달의 KST 시작/끝 UTC ISO 문자열 (끝은 배타적) */
export function monthRange(month: string): { startIso: string; endIso: string } {
  const [y, m] = month.split("-").map(Number);
  // KST = UTC+9 이므로 KST 자정은 UTC 전날 15:00
  const start = Date.UTC(y, m - 1, 1, 0, 0, 0) - 9 * 3600_000;
  const end = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 0, 0, 0) - 9 * 3600_000;
  return { startIso: new Date(start).toISOString(), endIso: new Date(end).toISOString() };
}

/** YYYY-MM 에서 한 달 뺀 값 */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return `${py}-${String(pm).padStart(2, "0")}`;
}

/** YYYY-MM-DD → 그 날의 KST 시작/끝 UTC ISO 문자열 (끝은 배타적) */
export function dayRange(date: string): { startIso: string; endIso: string } {
  const [y, m, d] = date.split("-").map(Number);
  const start = Date.UTC(y, m - 1, d, 0, 0, 0) - 9 * 3600_000;
  return {
    startIso: new Date(start).toISOString(),
    endIso: new Date(start + 24 * 3600_000).toISOString(),
  };
}
