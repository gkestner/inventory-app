import { NextRequest, NextResponse } from "next/server";
import { runPmComplianceReminderScan } from "@/app/lib/pm-compliance-reminders";
import { runNotificationReminderScan } from "@/app/lib/notification-reminders";
import { reminderTokenMatches } from "@/app/lib/reminder-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !reminderTokenMatches(request.headers.get("authorization"), `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [compliance, lists] = await Promise.allSettled([
    runPmComplianceReminderScan(), runNotificationReminderScan(),
  ]);
  const ok = compliance.status === "fulfilled" && lists.status === "fulfilled";
  if (!ok) console.error("[notification-reminders] One or more scheduled reminder scans failed.");
  return NextResponse.json({
    ok,
    compliance: compliance.status === "fulfilled" ? compliance.value : { error: "Compliance reminders temporarily unavailable." },
    lists: lists.status === "fulfilled" ? lists.value : { error: "Reminder lists temporarily unavailable." },
  }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
