import { NextRequest, NextResponse } from "next/server";

import { performMocreoPollSync } from "@/app/lib/mocreo-poll-sync";

export const dynamic = "force-dynamic";

function resolveSyncAuth(req: NextRequest): boolean {
  const expected = process.env.MOCREO_SYNC_TOKEN?.trim();
  if (!expected) return true;

  const tokenFromHeader = req.headers.get("x-mocreo-sync-token")?.trim();
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

async function runSync(req: NextRequest) {
  if (!resolveSyncAuth(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const payload = await performMocreoPollSync({
    minutes: req.nextUrl.searchParams.get("minutes"),
    beginTimeSec: req.nextUrl.searchParams.get("beginTime"),
    endTimeSec: req.nextUrl.searchParams.get("endTime"),
  });

  return NextResponse.json(payload);
}

export async function POST(req: NextRequest) {
  try {
    return await runSync(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    return await runSync(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
