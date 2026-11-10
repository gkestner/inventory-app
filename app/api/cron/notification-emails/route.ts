import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { processNotificationEmails } from "@/app/lib/notification-email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const incoming = request.headers.get("authorization") ?? "";
  const expected = secret ? `Bearer ${secret}` : "";
  const incomingBytes = Buffer.from(incoming);
  const expectedBytes = Buffer.from(expected);
  if (!secret || incomingBytes.length !== expectedBytes.length || !timingSafeEqual(incomingBytes, expectedBytes)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await processNotificationEmails();
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("[notification-email] Scheduled processing failed.");
    return NextResponse.json({ error: "Email processing is temporarily unavailable." }, { status: 503 });
  }
}
