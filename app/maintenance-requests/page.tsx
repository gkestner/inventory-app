import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { canAccessAdmin } from "@/app/lib/admin-access";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { createNotification, createNotificationForUsers } from "@/app/lib/workflow-foundations";
import {
  loadMaintenanceRequestAssignees,
  normalizeMaintenanceRequestStatus,
  type MaintenanceRequestStatusValue,
} from "@/app/lib/maintenance-requests";
import {
  ADMIN_VIEW_MAINTENANCE_REQUESTS,
  RECEIVE_NOTIFICATION_MAINTENANCE_REQUESTS,
  VIEW_MAINTENANCE_REQUESTS,
} from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type LocationOption = { id: string; name: string };

type EquipmentArea =
  | "DOUGH_ROLLER"
  | "MAKETABLE"
  | "DOUGH_COOLER"
  | "MIXER"
  | "OVEN"
  | "WALK_IN"
  | "FREEZER"
  | "BUILDING_STRUCTURE"
  | "LIGHTING"
  | "PARKING_LOT"
  | "OFFICE"
  | "HVAC_GAME_ROOM"
  | "HVAC_KITCHEN"
  | "HVAC_DINING_ROOM"
  | "OTHER";

const EQUIPMENT_AREAS: EquipmentArea[] = [
  "DOUGH_ROLLER",
  "MAKETABLE",
  "DOUGH_COOLER",
  "MIXER",
  "OVEN",
  "WALK_IN",
  "FREEZER",
  "BUILDING_STRUCTURE",
  "LIGHTING",
  "PARKING_LOT",
  "OFFICE",
  "HVAC_GAME_ROOM",
  "HVAC_KITCHEN",
  "HVAC_DINING_ROOM",
  "OTHER",
];

type MeRow = {
  id: string;
  name: string | null;
  email: string | null;
  active: boolean;
  location: LocationOption | null;
  allowedLocations: Array<{ isPrimary: boolean; location: LocationOption | null }>;
};

type RequestRow = {
  id: string;
  status: MaintenanceRequestStatusValue;
  title: string;
  description: string;
  resolutionNotes: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  archivedAt: Date | null;
  location: LocationOption;
  requestedByUser: { id: string; name: string | null; email: string | null };
  assignedMaintenanceUser: { id: string; name: string | null; email: string | null } | null;
  resolvedByUser: { id: string; name: string | null; email: string | null } | null;
};

type Db = {
  user: {
    findUnique: (args: unknown) => Promise<MeRow | null>;
  };
  location: {
    findUnique: (args: unknown) => Promise<LocationOption | null>;
  };
  maintenanceRequest: {
    create: (args: unknown) => Promise<{ id: string }>;
    findUnique: (args: unknown) => Promise<
      | {
          id: string;
          status: MaintenanceRequestStatusValue;
          title: string;
          location: LocationOption;
          requestedByUserId: string;
          assignedMaintenanceUserId: string | null;
        }
      | null
    >;
    findMany: (args: unknown) => Promise<RequestRow[]>;
    update: (args: unknown) => Promise<{ id: string }>;
  };
  auditLog: {
    create: (args: unknown) => Promise<unknown>;
  };
};

const db = prisma as unknown as Db;

function personLabel(person: { name: string | null; email: string | null } | null | undefined): string {
  if (!person) return "Unassigned";
  const byName = String(person.name ?? "").trim();
  if (byName) return byName;
  const byEmail = String(person.email ?? "").trim();
  return byEmail || "Unknown";
}

function fmtDateTime(value: Date | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function formatAreaLabel(area: string): string {
  const parts = area.split("_").filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const up = p.toUpperCase();
    if (up === "HVAC") {
      out.push("HVAC");
      continue;
    }
    if (up === "DOUGH") {
      out.push("Dough");
      continue;
    }
    out.push(p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
  }
  return out.join(" ");
}

function parseAreas(formData: FormData): EquipmentArea[] {
  const raw = formData.getAll("areas");
  const allowed = new Set<string>(EQUIPMENT_AREAS);

  const out: EquipmentArea[] = [];
  for (const v of raw) {
    const s = String(v ?? "").trim();
    if (!s || !allowed.has(s)) continue;
    out.push(s as EquipmentArea);
  }

  const seen = new Set<EquipmentArea>();
  const uniq: EquipmentArea[] = [];
  for (const a of out) {
    if (seen.has(a)) continue;
    seen.add(a);
    uniq.push(a);
  }
  return uniq;
}

function buildRequestTitle(areas: EquipmentArea[]): string {
  if (areas.length === 0) return "General Maintenance Request";
  const label = areas.slice(0, 2).map((a) => formatAreaLabel(a)).join(" / ");
  const out = `Maintenance Request: ${label}`;
  return out.length > 140 ? out.slice(0, 140) : out;
}

function mergeLocationOptions(me: MeRow): LocationOption[] {
  const primary: LocationOption[] = [];
  const optional: LocationOption[] = [];
  const seen = new Set<string>();

  if (me.location) {
    seen.add(me.location.id);
    primary.push(me.location);
  }

  for (const row of me.allowedLocations) {
    if (!row.location) continue;
    if (seen.has(row.location.id)) continue;
    seen.add(row.location.id);
    if (row.isPrimary) primary.push(row.location);
    else optional.push(row.location);
  }

  return [...primary, ...optional];
}

export default async function MaintenanceRequestsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const email = String(session.user?.email ?? "").trim().toLowerCase();
  if (!email) redirect("/login");

  const me = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      location: { select: { id: true, name: true } },
      allowedLocations: {
        select: { isPrimary: true, location: { select: { id: true, name: true } } },
        orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { location: { name: "asc" } }],
      },
    },
  });

  if (!me || !me.active) redirect("/login");

  const isAdmin = await canAccessAdmin(session);
  const perms = await loadUserPermissions(session);
  const canUseRequests =
    perms.allowAll || hasAnyPermission(perms, [VIEW_MAINTENANCE_REQUESTS, ADMIN_VIEW_MAINTENANCE_REQUESTS]) || isAdmin;
  if (!canUseRequests) redirect("/");

  async function createRequestAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");

    const email = String(session.user?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");

    const me = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        location: { select: { id: true, name: true } },
        allowedLocations: {
          select: { isPrimary: true, location: { select: { id: true, name: true } } },
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { location: { name: "asc" } }],
        },
      },
    });
    if (!me || !me.active) redirect("/login");

    const isAdmin = await canAccessAdmin(session);
    const perms = await loadUserPermissions(session);
    const canUseRequests =
      perms.allowAll || hasAnyPermission(perms, [VIEW_MAINTENANCE_REQUESTS, ADMIN_VIEW_MAINTENANCE_REQUESTS]) || isAdmin;
    if (!canUseRequests) redirect("/");
    const locationOptions = mergeLocationOptions(me);
    const locationIds = new Set(locationOptions.map((l) => l.id));

    const locationId = String(formData.get("locationId") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    const areas = parseAreas(formData);

    const title = buildRequestTitle(areas);
    const areaLine = areas.length > 0 ? `Equipment Areas: ${areas.map((a) => formatAreaLabel(a)).join(", ")}\n\n` : "";
    const description = `${areaLine}${notes}`.trim();

    if (!locationId || !notes) {
      redirect("/maintenance-requests?error=missing");
    }

    if (!isAdmin && !locationIds.has(locationId)) {
      redirect("/maintenance-requests?error=location");
    }

    const location = await db.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true },
    });
    if (!location) {
      redirect("/maintenance-requests?error=location");
    }

    const assignees = await loadMaintenanceRequestAssignees();
    const assigneesForLocation = assignees.filter((a) => a.locationId === locationId);
    const assigned = assigneesForLocation[0] ?? null;

    const created = await db.maintenanceRequest.create({
      data: {
        locationId,
        title,
        description,
        requestedByUserId: me.id,
        assignedMaintenanceUserId: assigned?.userId ?? null,
      },
      select: { id: true },
    });

    await db.auditLog.create({
      data: {
        actorUserId: me.id,
        module: "MAINTENANCE_REQUESTS",
        action: "CREATE_REQUEST",
        entityType: "MaintenanceRequest",
        entityId: created.id,
        message: `Created maintenance request: ${title}`,
        metadata: {
          locationId,
          locationName: location.name,
          assignedMaintenanceUserId: assigned?.userId ?? null,
          assignedMaintenanceUserName: assigned?.userName ?? null,
          notificationRecipientIds: Array.from(new Set(assigneesForLocation.map((a) => a.userId))),
        },
      },
    });

    const recipientIds = Array.from(new Set(assigneesForLocation.map((a) => a.userId))).filter((id) => id !== me.id);
    await createNotificationForUsers({
      userIds: recipientIds,
      type: "SYSTEM",
      title: `New maintenance request - ${location.name}`,
      body: `${personLabel(me)} requested: ${title}`,
      href: "/maintenance-requests",
      requiredPermission: RECEIVE_NOTIFICATION_MAINTENANCE_REQUESTS,
    });

    revalidatePath("/maintenance-requests");
    revalidatePath("/admin/maintenance-requests");
    revalidatePath("/admin/reports/maintenance-requests");
    revalidatePath("/notifications");
    redirect("/maintenance-requests?created=1");
  }

  async function resolveAndArchiveAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    if (!session) redirect("/login");

    const email = String(session.user?.email ?? "").trim().toLowerCase();
    if (!email) redirect("/login");

    const actor = await db.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        location: { select: { id: true, name: true } },
        allowedLocations: {
          select: { isPrimary: true, location: { select: { id: true, name: true } } },
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }, { location: { name: "asc" } }],
        },
      },
    });
    if (!actor || !actor.active) redirect("/login");

    const isAdmin = await canAccessAdmin(session);
    const perms = await loadUserPermissions(session);
    const canUseRequests =
      perms.allowAll || hasAnyPermission(perms, [VIEW_MAINTENANCE_REQUESTS, ADMIN_VIEW_MAINTENANCE_REQUESTS]) || isAdmin;
    if (!canUseRequests) redirect("/");

    const requestId = String(formData.get("requestId") ?? "").trim();
    const resolutionNotes = String(formData.get("resolutionNotes") ?? "").trim() || null;
    if (!requestId) redirect("/maintenance-requests");

    const existing = await db.maintenanceRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        title: true,
        location: { select: { id: true, name: true } },
        requestedByUserId: true,
        assignedMaintenanceUserId: true,
      },
    });

    if (!existing) redirect("/maintenance-requests?error=notfound");

    const canResolve = isAdmin || (existing.assignedMaintenanceUserId && existing.assignedMaintenanceUserId === actor.id);
    if (!canResolve) redirect("/maintenance-requests?error=forbidden");

    if (normalizeMaintenanceRequestStatus(existing.status) !== "OPEN") {
      redirect("/maintenance-requests?error=state");
    }

    const now = new Date();

    await db.maintenanceRequest.update({
      where: { id: existing.id },
      data: {
        status: "ARCHIVED",
        resolvedAt: now,
        archivedAt: now,
        resolvedByUserId: actor.id,
        resolutionNotes,
      },
      select: { id: true },
    });

    await db.auditLog.create({
      data: {
        actorUserId: actor.id,
        module: "MAINTENANCE_REQUESTS",
        action: "RESOLVE_ARCHIVE_REQUEST",
        entityType: "MaintenanceRequest",
        entityId: existing.id,
        message: `Resolved and archived maintenance request: ${existing.title}`,
        metadata: {
          locationId: existing.location.id,
          locationName: existing.location.name,
          resolutionNotes,
        },
      },
    });

    if (existing.requestedByUserId !== actor.id) {
      await createNotification({
        userId: existing.requestedByUserId,
        type: "SYSTEM",
        title: `Maintenance request resolved - ${existing.location.name}`,
        body: `${existing.title} has been resolved and archived.`,
        href: "/maintenance-requests",
        requiredPermission: RECEIVE_NOTIFICATION_MAINTENANCE_REQUESTS,
      });
    }

    revalidatePath("/maintenance-requests");
    revalidatePath("/admin/maintenance-requests");
    revalidatePath("/admin/reports/maintenance-requests");
    revalidatePath("/notifications");
    redirect("/maintenance-requests?resolved=1");
  }

  const [assignees, paramsRaw] = await Promise.all([
    loadMaintenanceRequestAssignees(),
    searchParams ?? Promise.resolve({}),
  ]);
  const params = paramsRaw as Record<string, string | string[] | undefined>;

  const locationOptions = mergeLocationOptions(me);
  const maintenanceUserIds = new Set(assignees.map((a) => a.userId));
  const isMaintenanceMan = maintenanceUserIds.has(me.id);

  const statusFilterRaw = Array.isArray(params.status) ? params.status[0] : params.status;
  const statusFilter = normalizeMaintenanceRequestStatus(String(statusFilterRaw ?? "OPEN"));

  const whereForList = isAdmin
    ? statusFilter === "OPEN"
      ? { status: "OPEN" }
      : statusFilter === "RESOLVED"
      ? { status: "RESOLVED" }
      : { status: "ARCHIVED" }
    : isMaintenanceMan
    ? {
        OR: [{ assignedMaintenanceUserId: me.id }, { requestedByUserId: me.id }],
      }
    : { requestedByUserId: me.id };

  const requests = await db.maintenanceRequest.findMany({
    where: whereForList,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 300,
    select: {
      id: true,
      status: true,
      title: true,
      description: true,
      resolutionNotes: true,
      createdAt: true,
      resolvedAt: true,
      archivedAt: true,
      location: { select: { id: true, name: true } },
      requestedByUser: { select: { id: true, name: true, email: true } },
      assignedMaintenanceUser: { select: { id: true, name: true, email: true } },
      resolvedByUser: { select: { id: true, name: true, email: true } },
    },
  });

  const headerBorder = "1px solid var(--border)";
  const alertText =
    params.error === "location"
      ? "Request was not saved. Select one of your assigned locations."
      : params.error === "missing"
      ? "Request was not saved. Notes are required."
      : params.error === "forbidden"
      ? "You are not allowed to resolve that request."
      : params.error === "state"
      ? "That request is already resolved or archived."
      : params.error === "notfound"
      ? "Request not found."
      : null;

  const statusBadgeStyle: Record<MaintenanceRequestStatusValue, CSSProperties> = {
    OPEN: {
      border: "1px solid color-mix(in srgb, #d38b00 55%, var(--border))",
      background: "color-mix(in srgb, #d38b00 18%, var(--surface))",
      color: "color-mix(in srgb, #000 25%, var(--foreground))",
      borderRadius: 999,
      padding: "2px 8px",
      fontWeight: 900,
      fontSize: 11,
    },
    RESOLVED: {
      border: "1px solid color-mix(in srgb, #087c3e 55%, var(--border))",
      background: "color-mix(in srgb, #087c3e 15%, var(--surface))",
      color: "var(--foreground)",
      borderRadius: 999,
      padding: "2px 8px",
      fontWeight: 900,
      fontSize: 11,
    },
    ARCHIVED: {
      border: "1px solid var(--border)",
      background: "var(--surface-2)",
      color: "var(--foreground)",
      borderRadius: 999,
      padding: "2px 8px",
      fontWeight: 900,
      fontSize: 11,
    },
  };

  const checkboxStyle: CSSProperties = {
    width: 16,
    height: 16,
    margin: 0,
  };

  const gridWrap: CSSProperties = {
    marginTop: 8,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 8,
  };

  const gridItem: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 10,
    padding: "8px 10px",
    background: "var(--surface-2)",
    minWidth: 0,
  };

  return (
    <main>
      <div style={{ maxWidth: 1220, margin: "0 auto", display: "grid", gap: 12, width: "100%", overflowX: "hidden", paddingInline: 12 }}>
        <section
          style={{
            border: headerBorder,
            borderRadius: 16,
            background: "linear-gradient(145deg, color-mix(in srgb, var(--brand) 14%, var(--surface)) 0%, var(--surface) 68%)",
            boxShadow: "var(--shadow)",
            padding: 18,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 950 }}>Maintenance Requests</h1>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.5 }}>
            Submit maintenance requests by store. Requests auto-route to the assigned maintenance technician and notify all primary technicians for that store.
          </p>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            {isAdmin ? (
              <>
                <Link href="/admin/maintenance-requests" style={{ textDecoration: "none", fontWeight: 800 }}>
                  {"Admin Queue ->"}
                </Link>
                <Link href="/admin/reports/maintenance-requests" style={{ textDecoration: "none", fontWeight: 800 }}>
                  {"Maintenance Request Reports ->"}
                </Link>
              </>
            ) : null}
          </div>
        </section>

        {params.created ? (
          <div style={{ border: headerBorder, borderRadius: 12, background: "color-mix(in srgb, #087c3e 14%, var(--surface))", padding: 10, fontWeight: 700 }}>
            Request submitted.
          </div>
        ) : null}
        {params.resolved ? (
          <div style={{ border: headerBorder, borderRadius: 12, background: "color-mix(in srgb, #087c3e 14%, var(--surface))", padding: 10, fontWeight: 700 }}>
            Request resolved and archived.
          </div>
        ) : null}
        {alertText ? (
          <div style={{ border: headerBorder, borderRadius: 12, background: "color-mix(in srgb, #b00020 12%, var(--surface))", padding: 10, fontWeight: 700 }}>
            {alertText}
          </div>
        ) : null}

        <section style={{ border: headerBorder, borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", padding: 14 }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 900 }}>Create Request</h2>
          <form action={createRequestAction} style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="locationId" style={{ fontWeight: 800 }}>
                Store
              </label>
              <select id="locationId" name="locationId" required defaultValue={locationOptions[0]?.id ?? ""} style={{ padding: "10px 12px", borderRadius: 10, border: headerBorder }}>
                {locationOptions.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor="notes" style={{ fontWeight: 800 }}>
                Notes (required)
              </label>
              <textarea id="notes" name="notes" required rows={4} placeholder="Describe issue, urgency, and context." style={{ padding: "10px 12px", borderRadius: 10, border: headerBorder, resize: "vertical" }} />
            </div>

            <div>
              <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.95 }}>Equipment Areas (check what needs work)</div>
              <div style={gridWrap}>
                {EQUIPMENT_AREAS.map((area) => (
                  <label key={`request-area-${area}`} style={gridItem}>
                    <input type="checkbox" name="areas" value={area} style={checkboxStyle} />
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {formatAreaLabel(area)}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <button type="submit" style={{ width: "fit-content", padding: "10px 14px", borderRadius: 10, border: headerBorder, fontWeight: 900, background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)", color: "var(--brand-contrast)", cursor: "pointer" }}>
              Submit Request
            </button>
          </form>
        </section>

        <section style={{ border: headerBorder, borderRadius: 14, background: "var(--surface)", boxShadow: "var(--shadow)", overflow: "hidden" }}>
          <div style={{ padding: 14, display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", borderBottom: headerBorder }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 900 }}>
              {isAdmin ? "Running Log" : isMaintenanceMan ? "Assigned + My Requests" : "My Request Log"}
            </h2>
            {isAdmin ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link href="/maintenance-requests?status=OPEN" style={{ textDecoration: "none", fontWeight: statusFilter === "OPEN" ? 900 : 700 }}>
                  Open
                </Link>
                <Link href="/maintenance-requests?status=RESOLVED" style={{ textDecoration: "none", fontWeight: statusFilter === "RESOLVED" ? 900 : 700 }}>
                  Resolved
                </Link>
                <Link href="/maintenance-requests?status=ARCHIVED" style={{ textDecoration: "none", fontWeight: statusFilter === "ARCHIVED" ? 900 : 700 }}>
                  Archived
                </Link>
              </div>
            ) : null}
          </div>

          {requests.length === 0 ? (
            <div style={{ padding: 14, opacity: 0.8 }}>No requests found.</div>
          ) : (
            <div style={{ display: "grid", gap: 10, padding: 12 }}>
              {requests.map((row) => {
                const canResolve = row.status === "OPEN" && (isAdmin || row.assignedMaintenanceUser?.id === me.id);
                return (
                  <article
                    key={row.id}
                    style={{
                      border: headerBorder,
                      borderRadius: 12,
                      background: "var(--surface-2)",
                      padding: 12,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                      <span style={statusBadgeStyle[row.status]}>{row.status}</span>
                      <div style={{ fontSize: 13, opacity: 0.85 }}>Requested: {fmtDateTime(row.createdAt)}</div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>Store</div>
                        <div>{row.location.name}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>Requested By</div>
                        <div>{personLabel(row.requestedByUser)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>Assigned Tech</div>
                        <div>{personLabel(row.assignedMaintenanceUser)}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>Resolved</div>
                        <div>{fmtDateTime(row.resolvedAt)}</div>
                        {row.resolvedByUser ? <div style={{ opacity: 0.8, fontSize: 12 }}>by {personLabel(row.resolvedByUser)}</div> : null}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontWeight: 900 }}>{row.title}</div>
                      <div style={{ marginTop: 4, opacity: 0.9, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{row.description}</div>
                      {row.resolutionNotes ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>Resolution: {row.resolutionNotes}</div> : null}
                    </div>

                    <div>
                      {canResolve ? (
                        <form action={resolveAndArchiveAction} style={{ display: "grid", gap: 6 }}>
                          <input type="hidden" name="requestId" value={row.id} />
                          <input
                            name="resolutionNotes"
                            placeholder="Resolution notes (optional)"
                            style={{ padding: "8px 10px", borderRadius: 8, border: headerBorder, width: "100%", maxWidth: 420 }}
                          />
                          <button
                            type="submit"
                            style={{ width: "fit-content", padding: "7px 10px", borderRadius: 8, border: headerBorder, background: "var(--surface)", fontWeight: 800, cursor: "pointer" }}
                          >
                            Resolve & Archive
                          </button>
                        </form>
                      ) : (
                        <span style={{ opacity: 0.7, fontSize: 12 }}>No action</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
