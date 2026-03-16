import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Prisma, WorkOrderStatus } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SearchParams = {
  from?: string;
  to?: string;
  locationId?: string;
  userId?: string;
  q?: string;
};

type SessionShape = {
  user?: {
    role?: unknown;
  } | null;
} | null;

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

function fmtLocalDateOnly(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York" }).format(d);
}

function fmtLocalTime(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
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

function buildQS(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (!v) continue;
    const t = v.trim();
    if (t) sp.set(k, t);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

async function requireAdmin() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");
  if (!(await canAccessAdmin(session))) redirect("/");
}

export default async function AdminTravelLogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();

  const sp = await searchParams;

  const todayYMD = getNYTodayYMD();
  const todayMidnightUtc = nyMidnightUtc(todayYMD);
  const dowMon0 = getNYDayOfWeekMon0(todayMidnightUtc);
  const defaultFromUtc = addDaysUtc(todayMidnightUtc, -dowMon0);
  const defaultToUtc = addDaysUtc(defaultFromUtc, 6);

  const fromParam = parseYMD(typeof sp.from === "string" ? sp.from : null);
  const toParam = parseYMD(typeof sp.to === "string" ? sp.to : null);
  const fromUtc = fromParam ? nyMidnightUtc(fromParam) : defaultFromUtc;
  const toUtc = toParam ? nyMidnightUtc(toParam) : defaultToUtc;
  const toExclusiveUtc = addDaysUtc(toUtc, 1);

  const fromStr = fromParam?.raw ?? fmtISODateNY(fromUtc);
  const toStr = toParam?.raw ?? fmtISODateNY(toUtc);

  const locationIdRaw = typeof sp.locationId === "string" ? sp.locationId.trim() : "ALL";
  const userIdRaw = typeof sp.userId === "string" ? sp.userId.trim() : "ALL";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  const [locations, users] = await Promise.all([
    prisma.location.findMany({ where: { active: true, receiptEnabled: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { active: true, workOrdersCreated: { some: { status: WorkOrderStatus.SUBMITTED } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  const locationIds = new Set(locations.map((l) => l.id));
  const userIds = new Set(users.map((u) => u.id));

  const locationId = locationIdRaw === "ALL" || locationIds.has(locationIdRaw) ? locationIdRaw : "ALL";
  const userId = userIdRaw === "ALL" || userIds.has(userIdRaw) ? userIdRaw : "ALL";

  const where: Prisma.WorkOrderWhereInput = {
    status: WorkOrderStatus.SUBMITTED,
    startTime: { gte: fromUtc, lt: toExclusiveUtc },
    ...(locationId !== "ALL" ? { locationId } : {}),
    ...(userId !== "ALL" ? { createdByUserId: userId } : {}),
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { notes: { contains: q, mode: "insensitive" } },
            { location: { name: { contains: q, mode: "insensitive" } } },
            { createdByUser: { name: { contains: q, mode: "insensitive" } } },
            { createdByUser: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const rows = await prisma.workOrder.findMany({
    where,
    orderBy: [{ createdByUserId: "asc" }, { startTime: "desc" }],
    take: 3000,
    select: {
      id: true,
      startTime: true,
      endTime: true,
      startingMileage: true,
      endingMileage: true,
      notes: true,
      location: { select: { name: true } },
      createdByUser: { select: { id: true, name: true, email: true } },
    },
  });

  const grouped = new Map<
    string,
    {
      userId: string;
      userName: string;
      userEmail: string;
      rows: typeof rows;
      totalHours: number;
      totalMiles: number;
    }
  >();

  let grandHours = 0;
  let grandMiles = 0;

  for (const r of rows) {
    const userKey = r.createdByUser?.id ?? "unknown";
    const entry =
      grouped.get(userKey) ??
      {
        userId: userKey,
        userName: r.createdByUser?.name ?? "Unknown User",
        userEmail: r.createdByUser?.email ?? "",
        rows: [] as typeof rows,
        totalHours: 0,
        totalMiles: 0,
      };

    entry.rows.push(r);

    const h = hoursBetweenNumber(r.startTime, r.endTime);
    if (h !== null) {
      entry.totalHours += h;
      grandHours += h;
    }

    if (typeof r.startingMileage === "number" && typeof r.endingMileage === "number") {
      const delta = r.endingMileage - r.startingMileage;
      if (Number.isFinite(delta) && delta >= 0) {
        entry.totalMiles += delta;
        grandMiles += delta;
      }
    }

    grouped.set(userKey, entry);
  }

  const groups = Array.from(grouped.values()).sort((a, b) => a.userName.localeCompare(b.userName));

  const qs = buildQS({ from: fromStr, to: toStr, locationId, userId, q: q || undefined });
  const printUrl = `/admin/travel-log/print${qs}`;
  const exportUrl = `/admin/travel-log/export${qs}`;

  const card: CSSProperties = {
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 14,
    background: "var(--surface)",
    color: "var(--foreground)",
  };

  const th: CSSProperties = {
    textAlign: "left",
    padding: 8,
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
    fontSize: 12,
  };

  const td: CSSProperties = {
    padding: 8,
    borderBottom: "1px solid var(--border)",
    whiteSpace: "nowrap",
    fontSize: 13,
  };

  const filterField: CSSProperties = {
    display: "grid",
    gap: 6,
    minWidth: 0,
    width: "100%",
  };

  const filterControl: CSSProperties = {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
  };

  return (
    <main style={{ padding: 20, width: "100%", maxWidth: "100%", minWidth: 0 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900, marginBottom: 12 }}>Admin Travel Logs</h1>

      <div style={{ ...card, marginBottom: 12 }}>
        <form
          method="get"
          style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", width: "100%" }}
        >
          <label style={filterField}>
            <span style={{ fontWeight: 800 }}>From</span>
            <input type="date" name="from" defaultValue={fromStr} style={filterControl} />
          </label>

          <label style={filterField}>
            <span style={{ fontWeight: 800 }}>To</span>
            <input type="date" name="to" defaultValue={toStr} style={filterControl} />
          </label>

          <label style={filterField}>
            <span style={{ fontWeight: 800 }}>User</span>
            <select name="userId" defaultValue={userId} style={filterControl}>
              <option value="ALL">All users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </label>

          <label style={filterField}>
            <span style={{ fontWeight: 800 }}>Location</span>
            <select name="locationId" defaultValue={locationId} style={filterControl}>
              <option value="ALL">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>

          <label style={filterField}>
            <span style={{ fontWeight: 800 }}>Search</span>
            <input name="q" defaultValue={q} placeholder="user, location, notes, work order id" style={filterControl} />
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            <button type="submit" style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", fontWeight: 800 }}>
              Apply
            </button>
            <Link href="/admin/travel-log" style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", fontWeight: 800 }}>
              Reset
            </Link>
            <a href={printUrl} target="_blank" rel="noreferrer" style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", fontWeight: 800 }}>
              Print
            </a>
            <a href={exportUrl} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", fontWeight: 800 }}>
              Export CSV
            </a>
          </div>
        </form>
      </div>

      <div style={{ ...card, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Users</div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{groups.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Entries</div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{rows.length}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Total Hours</div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{fmtFixed2(grandHours)}</div>
          </div>
          <div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>Total Miles</div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>{fmtFixed2(grandMiles)}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {groups.map((g) => (
          <section key={g.userId} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{g.userName}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>{g.userEmail}</div>
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Entries: <b>{g.rows.length}</b></span>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Hours: <b>{fmtFixed2(g.totalHours)}</b></span>
                <span style={{ fontSize: 12, opacity: 0.8 }}>Miles: <b>{fmtFixed2(g.totalMiles)}</b></span>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {[
                      "Date",
                      "Location",
                      "Departure",
                      "Return",
                      "Hours",
                      "Start Mi",
                      "End Mi",
                      "Miles",
                      "Notes",
                    ].map((h) => (
                      <th key={h} style={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => {
                    const miles =
                      typeof r.startingMileage === "number" && typeof r.endingMileage === "number"
                        ? Math.max(0, r.endingMileage - r.startingMileage)
                        : null;
                    const hrs = hoursBetweenNumber(r.startTime, r.endTime);

                    return (
                      <tr key={r.id}>
                        <td style={td}>{fmtLocalDateOnly(r.startTime)}</td>
                        <td style={td}>{r.location?.name ?? "-"}</td>
                        <td style={td}>{fmtLocalTime(r.startTime)}</td>
                        <td style={td}>{fmtLocalTime(r.endTime)}</td>
                        <td style={td}>{hrs === null ? "-" : fmtFixed2(hrs)}</td>
                        <td style={td}>{r.startingMileage ?? "-"}</td>
                        <td style={td}>{r.endingMileage ?? "-"}</td>
                        <td style={td}>{miles ?? "-"}</td>
                        <td style={{ ...td, whiteSpace: "normal", minWidth: 240 }}>{r.notes?.trim() || "-"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        {groups.length === 0 ? (
          <div style={card}>No submitted travel log entries match this filter.</div>
        ) : null}
      </div>
    </main>
  );
}
