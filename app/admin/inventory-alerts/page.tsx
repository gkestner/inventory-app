// app/admin/inventory-alerts/page.tsx
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import Link from "next/link";
import { InventoryAlertType, Permission, Prisma, Role } from "@prisma/client";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

type SearchParams = {
  status?: string; // open | resolved | all
  type?: string; // NEGATIVE_ON_HAND | BELOW_MIN | TECH_REQUEST_ORDER | all
  q?: string;
  page?: string; // 1-based
  perPage?: string; // 10/25/50/100
  err?: string;
  ok?: string;
};

type SessionUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  role?: Role | null;
};

type AppSession = {
  user?: SessionUser;
} | null;

type AuthSession = NonNullable<AppSession>;

async function requireInventoryAlertsView(): Promise<AuthSession> {
  const session = (await getServerSession(authOptions)) as AppSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return session;

  const canView = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!canView) redirect("/");

  return session;
}

async function requireInventoryAlertsResolve(): Promise<AuthSession> {
  const session = (await getServerSession(authOptions)) as AppSession;
  if (!session) throw new Error("Unauthorized");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return session;

  const canResolve = hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
  if (!canResolve) throw new Error("Forbidden");

  return session;
}

function toInt(v: string | undefined, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function clampPerPage(v: string | undefined) {
  const n = toInt(v, 25);
  if (n === 10 || n === 25 || n === 50 || n === 100) return n;
  return 25;
}

function normalizeStatus(v: string | undefined) {
  const s = (v || "open").toLowerCase();
  if (s === "resolved" || s === "all" || s === "open") return s;
  return "open";
}

function normalizeType(v: string | undefined) {
  const t = (v || "all").toUpperCase();
  if (t === "ALL") return "all";
  if (t in InventoryAlertType) return t as InventoryAlertType;
  return "all";
}

function buildQS(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    const trimmed = v.trim();
    if (trimmed.length) sp.set(k, trimmed);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function isoShort(d: Date) {
  try {
    return d.toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return String(d);
  }
}

export default async function InventoryAlertsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Auth gate
  await requireInventoryAlertsView();

  const sp = await searchParams;

  const status = normalizeStatus(sp.status);
  const type = normalizeType(sp.type);
  const q = (sp.q || "").trim();
  const page = Math.max(1, toInt(sp.page, 1));
  const perPage = clampPerPage(sp.perPage);

  const errMsg = (sp.err || "").trim();
  const okMsg = (sp.ok || "").trim();
  const bulkResolveFormId = "bulkResolveAlertsForm";

  async function resolveAlertAction(formData: FormData): Promise<void> {
    "use server";

    const s = await requireInventoryAlertsResolve();

    const alertId = String(formData.get("alertId") || "");
    const resolveNote = String(formData.get("note") || "").trim();

    // Preserve current filters/pagination on redirect back
    const back = String(formData.get("back") || "/admin/inventory-alerts");

    if (!alertId) redirect(back + (back.includes("?") ? "&" : "?") + "err=" + encodeURIComponent("Missing alertId"));

    const existing = await prisma.inventoryAlert.findUnique({
      where: { id: alertId },
      select: { note: true, resolvedAt: true, type: true },
    });

    if (!existing) redirect(back + (back.includes("?") ? "&" : "?") + "err=" + encodeURIComponent("Alert not found"));

    // Prevent double-resolve races
    if (existing.resolvedAt) {
      revalidatePath("/admin/inventory-alerts");
      redirect(back + (back.includes("?") ? "&" : "?") + "ok=" + encodeURIComponent("Alert already resolved"));
    }

    // REQUIRED NOTE RULE: TECH_REQUEST_ORDER must have a resolve note (auditability)
    if (existing.type === "TECH_REQUEST_ORDER" && !resolveNote) {
      redirect(
        back +
          (back.includes("?") ? "&" : "?") +
          "err=" +
          encodeURIComponent("Resolve note is required for TECH_REQUEST_ORDER")
      );
    }

    const resolverName = s.user?.name ?? "ADMIN";
    const resolverId = s.user?.id ?? null;

    let nextNote: string | undefined = undefined;
    if (resolveNote) {
      const stamp = `[RESOLVED ${isoShort(new Date())} by ${resolverName}] ${resolveNote}`;
      nextNote = existing.note ? `${existing.note}\n${stamp}` : stamp;
    }

    await prisma.inventoryAlert.update({
      where: { id: alertId },
      data: {
        resolvedAt: new Date(),
        resolvedByUserId: resolverId,
        resolvedByName: resolverName,
        ...(nextNote !== undefined ? { note: nextNote } : {}),
      },
    });

    revalidatePath("/admin/inventory-alerts");
    redirect(back + (back.includes("?") ? "&" : "?") + "ok=" + encodeURIComponent("Resolved"));
  }

  async function bulkResolveAlertsAction(formData: FormData): Promise<void> {
    "use server";

    const s = await requireInventoryAlertsResolve();
    const back = String(formData.get("back") || "/admin/inventory-alerts");
    const note = String(formData.get("note") || "").trim();

    const ids = Array.from(
      new Set(
        formData
          .getAll("alertIds")
          .map((v) => String(v || "").trim())
          .filter(Boolean)
      )
    );

    if (ids.length === 0) {
      redirect(back + (back.includes("?") ? "&" : "?") + "err=" + encodeURIComponent("Select one or more alerts."));
    }

    const selected = await prisma.inventoryAlert.findMany({
      where: { id: { in: ids } },
      select: { id: true, type: true, note: true, resolvedAt: true },
    });

    if (selected.length === 0) {
      redirect(back + (back.includes("?") ? "&" : "?") + "err=" + encodeURIComponent("Selected alerts not found."));
    }

    const unresolved = selected.filter((a) => !a.resolvedAt);
    if (unresolved.length === 0) {
      revalidatePath("/admin/inventory-alerts");
      redirect(back + (back.includes("?") ? "&" : "?") + "ok=" + encodeURIComponent("Selected alerts were already resolved."));
    }

    const hasTechRequestOrder = unresolved.some((a) => a.type === "TECH_REQUEST_ORDER");
    if (hasTechRequestOrder && !note) {
      redirect(
        back +
          (back.includes("?") ? "&" : "?") +
          "err=" +
          encodeURIComponent("Resolve note is required when selection includes TECH_REQUEST_ORDER alerts.")
      );
    }

    const resolverName = s.user?.name ?? "ADMIN";
    const resolverId = s.user?.id ?? null;
    const now = new Date();

    if (note) {
      const stamp = `[RESOLVED ${isoShort(now)} by ${resolverName}] ${note}`;

      await prisma.$transaction(
        unresolved.map((a) =>
          prisma.inventoryAlert.update({
            where: { id: a.id },
            data: {
              resolvedAt: now,
              resolvedByUserId: resolverId,
              resolvedByName: resolverName,
              note: a.note ? `${a.note}\n${stamp}` : stamp,
            },
          })
        )
      );
    } else {
      await prisma.inventoryAlert.updateMany({
        where: { id: { in: unresolved.map((a) => a.id) }, resolvedAt: null },
        data: {
          resolvedAt: now,
          resolvedByUserId: resolverId,
          resolvedByName: resolverName,
        },
      });
    }

    revalidatePath("/admin/inventory-alerts");
    redirect(
      back +
        (back.includes("?") ? "&" : "?") +
        "ok=" +
        encodeURIComponent(`Resolved ${unresolved.length} alert(s).`)
    );
  }

  const where: Prisma.InventoryAlertWhereInput = {
    ...(status === "open"
      ? { resolvedAt: null }
      : status === "resolved"
        ? { resolvedAt: { not: null } }
        : {}),
    ...(type === "all" ? {} : { type }),
    ...(q
      ? {
          OR: [
            { id: { contains: q, mode: "insensitive" } },
            { storeName: { contains: q, mode: "insensitive" } },
            { createdByName: { contains: q, mode: "insensitive" } },
            { resolvedByName: { contains: q, mode: "insensitive" } },
            { note: { contains: q, mode: "insensitive" } },
            { checkoutId: { contains: q, mode: "insensitive" } },
            { item: { id: { contains: q, mode: "insensitive" } } },
            { item: { sku: { contains: q, mode: "insensitive" } } },
            { item: { name: { contains: q, mode: "insensitive" } } },
            { item: { partNumber: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.inventoryAlert.count({ where }),
    prisma.inventoryAlert.findMany({
      where,
      orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        type: true,
        createdAt: true,
        note: true,

        storeId: true,
        storeName: true,

        checkoutId: true,

        createdByUserId: true,
        createdByName: true,

        qtyDelta: true,
        onHandAfter: true,
        orderedAfter: true,
        availableAfter: true,
        minQtyAtTime: true,

        resolvedAt: true,
        resolvedByUserId: true,
        resolvedByName: true,

        item: {
          select: {
            id: true,
            sku: true,
            partNumber: true,
            name: true,
          },
        },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, totalPages);

  const baseParams = {
    status,
    type: type === "all" ? "all" : type,
    q: q || undefined,
    perPage: String(perPage),
  };

  const backUrl = "/admin/inventory-alerts" + buildQS({ ...baseParams, page: String(safePage) });

  return (
    <div style={{ padding: 16, width: "100%", maxWidth: "100%", minWidth: 0 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Inventory Alerts</h1>

      {errMsg ? (
        <div style={{ padding: 10, marginBottom: 10, border: "1px solid rgba(255,0,0,0.35)", borderRadius: 8 }}>
          ❌ {errMsg}
        </div>
      ) : null}

      {okMsg ? (
        <div style={{ padding: 10, marginBottom: 10, border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8 }}>
          ✅ {okMsg}
        </div>
      ) : null}

      <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ opacity: 0.8 }}>Status</span>
          <select name="status" defaultValue={status} style={{ padding: "6px 8px" }}>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
            <option value="all">All</option>
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ opacity: 0.8 }}>Type</span>
          <select name="type" defaultValue={type === "all" ? "all" : type} style={{ padding: "6px 8px" }}>
            <option value="all">All</option>
            <option value="NEGATIVE_ON_HAND">NEGATIVE_ON_HAND</option>
            <option value="BELOW_MIN">BELOW_MIN</option>
            <option value="TECH_REQUEST_ORDER">TECH_REQUEST_ORDER</option>
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ opacity: 0.8 }}>Search</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="sku, item name, store, tech, ticket id…"
            style={{ padding: "6px 8px", width: "min(320px, 100%)" }}
          />
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ opacity: 0.8 }}>Per page</span>
          <select name="perPage" defaultValue={String(perPage)} style={{ padding: "6px 8px" }}>
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>

        <button type="submit" style={{ padding: "6px 10px", fontWeight: 600 }}>
          Apply
        </button>

        <Link href="/admin/inventory-alerts" style={{ padding: "6px 10px", textDecoration: "underline" }}>
          Reset
        </Link>
      </form>

      <div style={{ opacity: 0.8, marginBottom: 10 }}>
        {total === 0
          ? "Showing 0 of 0"
          : `Showing ${(safePage - 1) * perPage + 1}-${Math.min(safePage * perPage, total)} of ${total}`}
      </div>

      <div
        style={{
          marginBottom: 10,
          padding: 10,
          border: "1px solid rgba(128,128,128,0.25)",
          borderRadius: 8,
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ opacity: 0.85, fontSize: 12 }}>
          Bulk resolve selected open alerts. Note is required when any selected alert is <code>TECH_REQUEST_ORDER</code>.
        </span>
        <form
          id={bulkResolveFormId}
          action={bulkResolveAlertsAction}
          style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        >
          <input type="hidden" name="back" value={backUrl} />
          <input name="note" placeholder="resolve note (optional unless TECH_REQUEST_ORDER selected)" style={{ padding: "6px 8px", width: 340 }} />
          <button type="submit" style={{ padding: "6px 10px", fontWeight: 700 }}>
            Resolve Selected
          </button>
        </form>
      </div>

      <div style={{ overflowX: "hidden", maxWidth: "100%", border: "1px solid rgba(128,128,128,0.25)", borderRadius: 8 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <thead>
            <tr>
              {["Select", "Created", "Type", "Item", "Store", "Ticket", "Delta", "OnHand/Ordered/Avail/Min", "Status", "Resolve"].map(
                (h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "10px 10px",
                      borderBottom: "1px solid rgba(128,128,128,0.25)",
                      fontSize: 12,
                      opacity: 0.85,
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const resolved = !!r.resolvedAt;
              const ticketLink = r.checkoutId ? `/admin/maintenance-tickets/${r.checkoutId}/invoice` : null;
              const noteRequired = r.type === "TECH_REQUEST_ORDER";

              return (
                <tr key={r.id} style={{ borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                  <td style={{ padding: 10 }}>
                    {resolved ? (
                      <span style={{ opacity: 0.45 }}>—</span>
                    ) : (
                      <input type="checkbox" name="alertIds" value={r.id} form={bulkResolveFormId} aria-label={`Select alert ${r.id}`} />
                    )}
                  </td>
                  <td style={{ padding: 10 }}>{new Date(r.createdAt).toLocaleString()}</td>
                  <td style={{ padding: 10, fontFamily: "monospace" }}>{r.type}</td>

                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 700 }}>{r.item?.sku}</div>
                    <div style={{ opacity: 0.85, fontSize: 12 }}>
                      {r.item?.name}
                      {r.item?.partNumber ? ` • ${r.item.partNumber}` : ""}
                    </div>
                    {r.note ? (
                      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85, maxWidth: 520, whiteSpace: "pre-wrap" }}>
                        {r.note}
                      </div>
                    ) : null}
                  </td>

                  <td style={{ padding: 10 }}>
                    <div style={{ fontWeight: 600 }}>{r.storeName || "-"}</div>
                    <div style={{ opacity: 0.75, fontSize: 12 }}>{r.createdByName ? `By: ${r.createdByName}` : ""}</div>
                  </td>

                  <td style={{ padding: 10 }}>
                    {r.checkoutId && ticketLink ? (
                      <Link href={ticketLink} style={{ textDecoration: "underline", fontFamily: "monospace", overflowWrap: "anywhere" }}>
                        {r.checkoutId.slice(0, 10)}…
                      </Link>
                    ) : (
                      <span style={{ opacity: 0.6 }}>—</span>
                    )}
                  </td>

                  <td style={{ padding: 10 }}>{r.qtyDelta ?? "-"}</td>

                  <td style={{ padding: 10, fontFamily: "monospace", fontSize: 12 }}>
                    {[r.onHandAfter ?? "-", r.orderedAfter ?? "-", r.availableAfter ?? "-", r.minQtyAtTime ?? "-"].join(" / ")}
                  </td>

                  <td style={{ padding: 10 }}>
                    {resolved ? (
                      <div>
                        <div style={{ fontWeight: 700 }}>Resolved</div>
                        <div style={{ fontSize: 12, opacity: 0.85 }}>{r.resolvedByName ? `by ${r.resolvedByName}` : ""}</div>
                      </div>
                    ) : (
                      <span style={{ fontWeight: 700 }}>Open</span>
                    )}
                  </td>

                  <td style={{ padding: 10 }}>
                    {resolved ? (
                      <span style={{ opacity: 0.6 }}>—</span>
                    ) : (
                      <form action={resolveAlertAction} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <input type="hidden" name="alertId" value={r.id} />
                        <input type="hidden" name="back" value={backUrl} />
                        <input
                          name="note"
                          placeholder={noteRequired ? "required for TECH_REQUEST_ORDER" : "resolve note (optional)"}
                          required={noteRequired}
                          style={{ padding: "6px 8px", width: "min(220px, 100%)" }}
                        />
                        <button type="submit" style={{ padding: "6px 10px", fontWeight: 700 }}>
                          Resolve
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}

            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ padding: 14, opacity: 0.8 }}>
                  No alerts match your filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <Link
          href={"/admin/inventory-alerts" + buildQS({ ...baseParams, page: String(Math.max(1, safePage - 1)) })}
          style={{
            pointerEvents: safePage <= 1 ? "none" : "auto",
            opacity: safePage <= 1 ? 0.5 : 1,
            textDecoration: "underline",
          }}
        >
          Prev
        </Link>

        <div style={{ opacity: 0.85 }}>
          Page {safePage} / {totalPages}
        </div>

        <Link
          href={"/admin/inventory-alerts" + buildQS({ ...baseParams, page: String(Math.min(totalPages, safePage + 1)) })}
          style={{
            pointerEvents: safePage >= totalPages ? "none" : "auto",
            opacity: safePage >= totalPages ? 0.5 : 1,
            textDecoration: "underline",
          }}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
