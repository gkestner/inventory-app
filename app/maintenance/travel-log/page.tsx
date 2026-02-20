// app/maintenance/travel-log/page.tsx
import type { CSSProperties } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { Permission } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

function requireSession(session: SessionShape) {
  if (!session) redirect("/login");
  const email = session.user?.email ?? null;
  if (!email) redirect("/login");
}

function fmtLocalTime(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

function fmtLocalDateOnly(d: Date | null): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York" }).format(d);
}

function isYYYYMMDD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseYMD(s: string | null): { y: number; m: number; d: number; raw: string } | null {
  if (!s) return null;
  const t = s.trim();
  if (!isYYYYMMDD(t)) return null;
  const [yy, mm, dd] = t.split("-").map((x) => Number(x));
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  return { y: yy, m: mm, d: dd, raw: t };
}

function getNYOffsetMinutes(atUtc: Date): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = fmt.formatToParts(atUtc);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = tz.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!m) return 0;

  const sign = m[1] === "-" ? -1 : 1;
  const hh = Number(m[2] ?? 0);
  const mm = Number(m[3] ?? 0);
  return sign * (hh * 60 + mm);
}

function nyMidnightUtc(ymd: { y: number; m: number; d: number }): Date {
  // Sample at noon UTC to get the offset for that NY calendar day.
  const sampleNoonUtc = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d, 12, 0, 0));
  const offsetMin = getNYOffsetMinutes(sampleNoonUtc);
  const utcMillis = Date.UTC(ymd.y, ymd.m - 1, ymd.d, 0, 0, 0) - offsetMin * 60_000;
  return new Date(utcMillis);
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

function getNYTodayYMD(): { y: number; m: number; d: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = Number(parts.find((p) => p.type === "year")?.value ?? NaN);
  const m = Number(parts.find((p) => p.type === "month")?.value ?? NaN);
  const d = Number(parts.find((p) => p.type === "day")?.value ?? NaN);

  return { y, m, d };
}

function getNYDayOfWeekMon0(dUtc: Date): number {
  // 0=Mon ... 6=Sun using NY local weekday
  const dow = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(dUtc);

  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[dow] ?? 0;
}

function fmtISODateNY(dUtc: Date): string {
  // YYYY-MM-DD in America/New_York (stable for date inputs + query params)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(dUtc);
}

function hoursBetween(start: Date | null, end: Date | null): string {
  if (!start || !end) return "—";
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const hrs = ms / (1000 * 60 * 60);
  return (Math.round(hrs * 100) / 100).toFixed(2);
}

function hoursBetweenNumber(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms / (1000 * 60 * 60);
}

function fmtFixed2(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

export default async function MaintenanceTravelLogPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; locationId?: string }>;
}) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  requireSession(session);

  // Permission gate (admin allowAll handled in loadUserPermissions)
  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [Permission.VIEW_WORK_ORDERS])) {
    redirect("/");
  }

  const email = (session?.user?.email ?? "").toLowerCase().trim();

  const me = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      active: true,
      locationId: true,
      location: { select: { id: true, name: true } },
      allowedLocations: {
        orderBy: { sortOrder: "asc" },
        select: { locationId: true, sortOrder: true, location: { select: { id: true, name: true } } },
      },
    },
  });

  if (!me || !me.active) redirect("/login");

  const sp = await searchParams;

  // Allowed locations (primary first, then optionals, dedup)
  const allowedLocations: Array<{ id: string; name: string; source: "PRIMARY" | "OPTIONAL" }> = [];
  const seen = new Set<string>();

  if (me.location) {
    seen.add(me.location.id);
    allowedLocations.push({ id: me.location.id, name: me.location.name, source: "PRIMARY" });
  }
  for (const ul of me.allowedLocations) {
    if (!ul.location) continue;
    if (seen.has(ul.location.id)) continue;
    seen.add(ul.location.id);
    allowedLocations.push({ id: ul.location.id, name: ul.location.name, source: "OPTIONAL" });
  }

  // Location filter
  const rawLocationId = typeof sp.locationId === "string" && sp.locationId.trim() ? sp.locationId.trim() : "ALL";
  const locationId = rawLocationId === "ALL" || seen.has(rawLocationId) ? rawLocationId : "ALL";

  // Default: This Week (Mon–Sun) in America/New_York
  const todayYMD = getNYTodayYMD();
  const todayMidnightUtc = nyMidnightUtc(todayYMD);
  const dowMon0 = getNYDayOfWeekMon0(todayMidnightUtc);

  const thisWeekFromUtc = addDaysUtc(todayMidnightUtc, -dowMon0); // Monday 00:00
  const thisWeekToUtc = addDaysUtc(thisWeekFromUtc, 6); // Sunday 00:00
  const lastWeekFromUtc = addDaysUtc(thisWeekFromUtc, -7);
  const lastWeekToUtc = addDaysUtc(thisWeekToUtc, -7);

  const fromParam = parseYMD(typeof sp.from === "string" ? sp.from : null);
  const toParam = parseYMD(typeof sp.to === "string" ? sp.to : null);

  const fromUtc = fromParam ? nyMidnightUtc(fromParam) : thisWeekFromUtc;
  const toUtc = toParam ? nyMidnightUtc(toParam) : thisWeekToUtc;
  const toExclusiveUtc = addDaysUtc(toUtc, 1);

  const fromStr = fromParam?.raw ?? fmtISODateNY(fromUtc);
  const toStr = toParam?.raw ?? fmtISODateNY(toUtc);
  const rangeLabel = `${fromStr} to ${toStr}`;

  // Travel Log is derived from SUBMITTED work orders only
  // Semantics: range is based on Departure (startTime), not createdAt.
  const where: {
    createdByUserId: string;
    status: "SUBMITTED";
    startTime: { gte: Date; lt: Date };
    locationId?: string;
  } = {
    createdByUserId: me.id,
    status: "SUBMITTED",
    startTime: { gte: fromUtc, lt: toExclusiveUtc },
  };

  if (locationId !== "ALL") where.locationId = locationId;

  const rows = await prisma.workOrder.findMany({
    where,
    orderBy: { startTime: "desc" },
    take: 250,
    select: {
      id: true,
      createdAt: true,
      locationId: true,
      location: { select: { name: true } },
      startTime: true,
      endTime: true,
      startingMileage: true,
      endingMileage: true,
      notes: true,
    },
  });

  // Totals (match print semantics)
  let totalHours = 0;
  let totalMiles = 0;
  let milesCounted = 0;

  for (const r of rows) {
    const h = hoursBetweenNumber(r.startTime, r.endTime);
    if (h !== null) totalHours += h;

    if (typeof r.startingMileage === "number" && typeof r.endingMileage === "number") {
      const delta = r.endingMileage - r.startingMileage;
      if (Number.isFinite(delta) && delta >= 0) {
        totalMiles += delta;
        milesCounted += 1;
      }
    }
  }

  const printUrl = `/maintenance/travel-log/print?from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(
    toStr
  )}&locationId=${encodeURIComponent(locationId)}`;

  const thisWeekUrl = `/maintenance/travel-log?from=${encodeURIComponent(fmtISODateNY(thisWeekFromUtc))}&to=${encodeURIComponent(
    fmtISODateNY(thisWeekToUtc)
  )}&locationId=${encodeURIComponent(locationId)}`;

  const lastWeekUrl = `/maintenance/travel-log?from=${encodeURIComponent(fmtISODateNY(lastWeekFromUtc))}&to=${encodeURIComponent(
    fmtISODateNY(lastWeekToUtc)
  )}&locationId=${encodeURIComponent(locationId)}`;

  // ===== Styles (keep current look; no redesign) =====
  const shell: CSSProperties = { padding: 16, maxWidth: 1200, margin: "0 auto" };

  const sheet: CSSProperties = {
    border: "1px solid rgba(128,128,128,0.35)",
    borderRadius: 0,
    padding: 0,
    background: "var(--background)",
    color: "var(--foreground)",
  };

  const titleBar: CSSProperties = {
    borderBottom: "1px solid rgba(128,128,128,0.35)",
    background: "rgba(128,128,128,0.10)",
    padding: "10px 12px",
    textAlign: "center",
    fontWeight: 900,
    fontSize: 28,
    letterSpacing: 0.2,
  };

  const headerBlock: CSSProperties = {
    padding: "10px 12px 12px 12px",
    borderBottom: "2px solid rgba(128,128,128,0.6)",
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 18,
  };

  const fieldRow: CSSProperties = {
    display: "flex",
    alignItems: "flex-end",
    gap: 10,
    width: "100%",
  };

  const fieldLabel: CSSProperties = {
    fontSize: 13,
    fontWeight: 900,
    width: 64,
    whiteSpace: "nowrap",
  };

  const fieldLine: CSSProperties = {
    borderBottom: "1px solid rgba(128,128,128,0.75)",
    height: 18,
    flex: 1,
    minWidth: 40,
  };

  const fieldValueRow: CSSProperties = {
    marginTop: 6,
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontSize: 12,
    opacity: 0.92,
    width: "100%",
  };

  const fieldValueSpacer: CSSProperties = { width: 64 };

  const filterCard: CSSProperties = {
    borderTop: "1px solid rgba(128,128,128,0.18)",
    borderBottom: "1px solid rgba(128,128,128,0.18)",
    padding: "10px 12px",
    display: "grid",
    gap: 10,
  };

  const label: CSSProperties = { display: "grid", gap: 4, fontSize: 12, opacity: 0.9, fontWeight: 800 };
  const input: CSSProperties = {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
  };
  const btn: CSSProperties = {
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontWeight: 900,
    cursor: "pointer",
    width: 140,
  };

  const tableWrap: CSSProperties = { overflowX: "auto" };

  const th: CSSProperties = {
    textAlign: "center",
    padding: 8,
    border: "1px solid rgba(128,128,128,0.55)",
    fontSize: 12,
    fontWeight: 900,
    background: "rgba(128,128,128,0.10)",
    whiteSpace: "nowrap",
  };

  const td: CSSProperties = {
    padding: 8,
    border: "1px solid rgba(128,128,128,0.35)",
    fontSize: 12,
    verticalAlign: "top",
    whiteSpace: "nowrap",
  };

  const tdNotes: CSSProperties = {
    ...td,
    whiteSpace: "normal",
    minWidth: 220,
    maxWidth: 420,
  };

  return (
    <main>
      <div style={shell}>
        <div style={sheet}>
          <div style={titleBar}>Travel Logs</div>

          {/* Name / Date header */}
          <div style={headerBlock}>
            {/* Name */}
            <div style={{ width: "100%" }}>
              <div style={fieldRow}>
                <div style={fieldLabel}>Name</div>
                <div style={fieldLine} />
              </div>
              <div style={fieldValueRow}>
                <div style={fieldValueSpacer} />
                <div style={{ fontWeight: 900 }}>{me.name}</div>
              </div>
            </div>

            {/* Date */}
            <div style={{ width: "100%", justifySelf: "end" }}>
              <div style={{ ...fieldRow, justifyContent: "flex-end" }}>
                <div style={{ ...fieldLabel, textAlign: "right" }}>Date</div>
                <div style={fieldLine} />
              </div>
              <div style={{ ...fieldValueRow, justifyContent: "flex-end" }}>
                <div style={fieldValueSpacer} />
                <div style={{ fontWeight: 900 }}>{rangeLabel}</div>
              </div>
            </div>
          </div>

          <div style={filterCard}>
            <form method="get" style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto auto", gap: 10 }}>
                <label style={label}>
                  From
                  <input name="from" type="date" defaultValue={fromStr} style={input} />
                </label>

                <label style={label}>
                  To
                  <input name="to" type="date" defaultValue={toStr} style={input} />
                </label>

                <label style={label}>
                  Location
                  <select name="locationId" defaultValue={locationId} style={input}>
                    <option value="ALL">All locations</option>
                    {allowedLocations.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                        {l.source === "PRIMARY" ? " (Primary)" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <div style={{ display: "flex", alignItems: "end" }}>
                  <button type="submit" style={btn}>
                    Apply
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "end" }}>
                  <a
                    href={printUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      ...btn,
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    Print
                  </a>
                </div>
              </div>

              {/* Weekly presets (Mon–Sun) */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <a
                  href={thisWeekUrl}
                  style={{
                    ...btn,
                    width: 160,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  This Week (Mon–Sun)
                </a>
                <a
                  href={lastWeekUrl}
                  style={{
                    ...btn,
                    width: 160,
                    textDecoration: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  Last Week (Mon–Sun)
                </a>
              </div>

              <div style={{ fontSize: 12, opacity: 0.85 }}>
                Showing <b>{rows.length}</b> submitted entries. &nbsp; Totals: <b>{fmtFixed2(totalHours)}</b> hours{" "}
                {milesCounted > 0 ? (
                  <>
                    • <b>{totalMiles}</b> miles
                  </>
                ) : (
                  <>• miles: —</>
                )}
              </div>
            </form>
          </div>

          <div style={tableWrap}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Date</th>
                  <th style={th}>Location</th>
                  <th style={th}>Departure Mileage</th>
                  <th style={th}>Arrival Mileage</th>
                  <th style={th}>Arrival Time</th>
                  <th style={th}>Departure Time</th>
                  <th style={th}>Hours</th>
                  <th style={th}>Notes</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((wo) => {
                  // Semantics: Departure = startTime + startingMileage; Arrival = endTime + endingMileage
                  const date = wo.startTime ?? wo.createdAt;

                  return (
                    <tr key={wo.id}>
                      <td style={td}>{fmtLocalDateOnly(date)}</td>
                      <td style={td}>{wo.location?.name ?? "—"}</td>
                      <td style={td}>{wo.startingMileage ?? "—"}</td>
                      <td style={td}>{wo.endingMileage ?? "—"}</td>
                      <td style={td}>{fmtLocalTime(wo.endTime)}</td>
                      <td style={td}>{fmtLocalTime(wo.startTime)}</td>
                      <td style={td}>{hoursBetween(wo.startTime, wo.endTime)}</td>
                      <td style={tdNotes}>{wo.notes?.trim() ? wo.notes.trim() : "—"}</td>
                    </tr>
                  );
                })}

                {rows.length === 0 ? (
                  <tr>
                    <td style={{ ...td, textAlign: "left" }} colSpan={8}>
                      No entries in this date range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div style={{ padding: "10px 12px", fontSize: 12, opacity: 0.8 }}>
            This report is derived from <b>SUBMITTED</b> Work Orders only. Date filtering is based on <b>Departure
            (Start)</b>.
          </div>
        </div>
      </div>
    </main>
  );
}
