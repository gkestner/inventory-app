import { NextRequest, NextResponse } from "next/server";

import { runPmComplianceReminderScan } from "@/app/lib/pm-compliance-reminders";

export const dynamic = "force-dynamic";

function resolveSyncAuth(req: NextRequest): boolean {
  const expected =
    process.env.PM_COMPLIANCE_REMINDER_TOKEN?.trim() ||
    process.env.PM_REMINDER_SYNC_TOKEN?.trim() ||
    process.env.MOCREO_SYNC_TOKEN?.trim();

  if (!expected) return true;

  const tokenFromHeader = req.headers.get("x-pm-reminder-token")?.trim();
  if (tokenFromHeader && tokenFromHeader === expected) return true;

  const bearer = req.headers.get("authorization")?.trim() ?? "";
  if (bearer.toLowerCase().startsWith("bearer ")) {
    const incoming = bearer.slice(7).trim();
    if (incoming && incoming === expected) return true;
  }

  const tokenFromQuery = req.nextUrl.searchParams.get("token")?.trim();
  if (tokenFromQuery && tokenFromQuery === expected) return true;

  return false;
}

async function run(req: NextRequest) {
  if (!resolveSyncAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const dueSoonDaysRaw = Number(req.nextUrl.searchParams.get("dueSoonDays") ?? "30");
  const payload = await runPmComplianceReminderScan({
    dueSoonDays: Number.isFinite(dueSoonDaysRaw) ? dueSoonDaysRaw : 30,
  });

  return NextResponse.json(payload);
}

export async function GET(req: NextRequest) {
  try {
    return await run(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    return await run(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
