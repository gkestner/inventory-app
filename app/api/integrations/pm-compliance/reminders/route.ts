import { NextRequest, NextResponse } from "next/server";

import { runPmComplianceReminderScan } from "@/app/lib/pm-compliance-reminders";
import { authorizePmReminderRequest } from "@/app/lib/reminder-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

async function run(req: NextRequest) {
  if (!authorizePmReminderRequest(req)) {
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
