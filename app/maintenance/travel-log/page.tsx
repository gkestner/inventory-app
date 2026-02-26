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
  const dow = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(dUtc);

  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[dow] ?? 0;
}

function fmtISODateNY(dUtc: Date): string {
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
  return (Math.round(n * 100) / (100)).toFixed(2);
}

export default async function MaintenanceTravelLogPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; locationId?: string }>;
}) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  requireSession(session);

  // ✅ Permission gate (no EMPLOYEE bypass): require VIEW_WORK_ORDERS or allowAll
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

  const rawLocationId = typeof sp.locationId === "string" && sp.locationId.trim() ? sp.locationId.trim() : "ALL";
  const locationId = rawLocationId === "ALL" || seen.has(rawLocationId) ? rawLocationId : "ALL";

  const todayYMD = getNYTodayYMD();
  const todayMidnightUtc = nyMidnightUtc(todayYMD);
  const dowMon0 = getNYDayOfWeekMon0(todayMidnightUtc);

  const thisWeekFromUtc = addDaysUtc(todayMidnightUtc, -dowMon0);
  const thisWeekToUtc = addDaysUtc(thisWeekFromUtc, 6);
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

  const card: CSSProperties = {
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 12,
    padding: 16,
    background: "var(--background)",
    color: "var(--foreground)",
  };

  const buttonLike: CSSProperties = {
    display: "inline-block",
    textDecoration: "none",
    padding: "8px 12px",
    borderRadius: 10,
    border: "1px solid rgba(128,128,128,0.25)",
    color: "var(--foreground)",
    fontWeight: 800,
  };

  const thtd: CSSProperties = {
    textAlign: "left",
    padding: 8,
    borderBottom: "1px solid rgba(128,128,128,0.2)",
    whiteSpace: "nowrap",
  };

  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 10 }}>Travel Log</h1>

      <div style={{ ...card, marginBottom: 12 }}>
        <form method="get" style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 800 }}>From</span>
            <input type="date" name="from" defaultValue={fromStr} />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 800 }}>To</span>
            <input type="date" name="to" defaultValue={toStr} />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 800 }}>Location</span>
            <select name="locationId" defaultValue={locationId}>
              <option value="ALL">All allowed locations</option>
              {allowedLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.source === "PRIMARY" ? " (Primary)" : ""}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <button type="submit" style={{ ...buttonLike, background: "var(--background)", cursor: "pointer" }}>
              Apply
            </button>
            <a href={thisWeekUrl} style={buttonLike}>
              This Week
            </a>
            <a href={lastWeekUrl} style={buttonLike}>
              Last Week
            </a>
            <a href={printUrl} target="_blank" rel="noreferrer" style={buttonLike}>
              Print
            </a>
          </div>
        </form>

        <div style={{ marginTop: 10, opacity: 0.8 }}>
          Range: <b>{rangeLabel}</b>
        </div>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ opacity: 0.7, fontSize: 12 }}>Entries</div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>{rows.length}</div>
          </div>
          <div>
            <div style={{ opacity: 0.7, fontSize: 12 }}>Total Hours</div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>{fmtFixed2(totalHours)}</div>
          </div>
          <div>
            <div style={{ opacity: 0.7, fontSize: 12 }}>Total Miles</div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>{fmtFixed2(totalMiles)}</div>
          </div>
          <div>
            <div style={{ opacity: 0.7, fontSize: 12 }}>Mileage Entries Counted</div>
            <div style={{ fontWeight: 900, fontSize: 20 }}>{milesCounted}</div>
          </div>
        </div>
      </div>

      <div style={{ ...card, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Date", "Location", "Departure", "Return", "Hours", "Start Mi", "End Mi", "Miles", "Notes"].map((h) => (
                <th key={h} style={thtd}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const miles =
                typeof r.startingMileage === "number" && typeof r.endingMileage === "number"
                  ? Math.max(0, r.endingMileage - r.startingMileage)
                  : null;

              return (
                <tr key={r.id}>
                  <td style={thtd}>{fmtLocalDateOnly(r.startTime)}</td>
                  <td style={thtd}>{r.location?.name ?? "—"}</td>
                  <td style={thtd}>{fmtLocalTime(r.startTime)}</td>
                  <td style={thtd}>{fmtLocalTime(r.endTime)}</td>
                  <td style={thtd}>{hoursBetween(r.startTime, r.endTime)}</td>
                  <td style={thtd}>{r.startingMileage ?? "—"}</td>
                  <td style={thtd}>{r.endingMileage ?? "—"}</td>
                  <td style={thtd}>{miles ?? "—"}</td>
                  <td style={{ ...thtd, whiteSpace: "normal", minWidth: 260 }}>{r.notes?.trim() || "—"}</td>
                </tr>
              );
            })}

            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ ...thtd, opacity: 0.8 }}>
                  No submitted work orders found for this range/location.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}