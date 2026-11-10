import { timingSafeEqual } from "node:crypto";

export function reminderTokenMatches(incoming: string | null | undefined, expected: string | null | undefined): boolean {
  if (!incoming || !expected) return false;
  const actualBytes = Buffer.from(incoming);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** Retain established integration token/header aliases while requiring an actual configured secret. */
export function authorizePmReminderRequest(request: Request, secrets: Record<string, string | undefined> = process.env): boolean {
  const expected = [secrets.PM_COMPLIANCE_REMINDER_TOKEN, secrets.PM_REMINDER_SYNC_TOKEN,
    secrets.MOCREO_SYNC_TOKEN, secrets.CRON_SECRET].map((value) => value?.trim()).filter(Boolean);
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const incoming = [
    request.headers.get("x-pm-reminder-token")?.trim(),
    /^bearer /i.test(authorization) ? authorization.slice(7).trim() : null,
    new URL(request.url).searchParams.get("token")?.trim(),
  ];
  return incoming.some((token) => expected.some((secret) => reminderTokenMatches(token, secret)));
}
