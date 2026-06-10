import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Permission, Prisma, Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import {
  WORK_ORDER_EQUIPMENT_AREAS,
  formatWorkOrderEquipmentAreaLabel,
  groupChecklistItemsByArea,
  listChecklistItems,
  type EquipmentAreaChecklistItemRow,
  type WorkOrderEquipmentArea,
} from "@/app/lib/work-order-equipment";

export const dynamic = "force-dynamic";

type SessionShape = {
  user?: {
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

type SearchParams = {
  ok?: string;
  err?: string;
};

type ChecklistItemDelegate = {
  create: (args: unknown) => Promise<unknown>;
  update: (args: unknown) => Promise<unknown>;
  delete: (args: unknown) => Promise<unknown>;
};

const db = prisma as unknown as {
  equipmentAreaChecklistItem: ChecklistItemDelegate;
};

async function requireChecklistAdmin(session: SessionShape) {
  if (!session) redirect("/login");
  if (session.user?.role === Role.ADMIN) return;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return;

  const allowed = hasAnyPermission(perms, [Permission.ADMIN_VIEW_WORK_ORDERS, Permission.ADMIN_EDIT_WORK_ORDERS]);
  if (!allowed) redirect("/");
}

function toArea(raw: FormDataEntryValue | null): WorkOrderEquipmentArea {
  const value = String(raw ?? "").trim();
  if (!(WORK_ORDER_EQUIPMENT_AREAS as readonly string[]).includes(value)) {
    throw new Error("Invalid equipment area.");
  }
  return value as WorkOrderEquipmentArea;
}

function normalizeLabel(raw: FormDataEntryValue | null): string {
  const label = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!label) throw new Error("Checklist label is required.");
  return label;
}

function buildRedirect(ok?: string, err?: string): never {
  const params = new URLSearchParams();
  if (ok) params.set("ok", ok);
  if (err) params.set("err", err);
  const qs = params.toString();
  redirect(qs ? `/admin/work-orders/checklists?${qs}` : "/admin/work-orders/checklists");
}

export default async function AdminWorkOrderChecklistsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  await requireChecklistAdmin(session);

  async function createChecklistItemAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    await requireChecklistAdmin(session);

    try {
      const area = toArea(formData.get("area"));
      const label = normalizeLabel(formData.get("label"));

      await db.equipmentAreaChecklistItem.create({
        data: {
          area,
          label,
          sortOrder: 0,
          active: true,
        },
      } as unknown);

      revalidatePath("/admin/work-orders/checklists");
      revalidatePath("/maintenance/work-orders");
      revalidatePath("/maintenance/work-orders/[id]");
      revalidatePath("/admin/work-orders/[id]");
      buildRedirect("Checklist item added.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add checklist item.";
      buildRedirect(undefined, message);
    }
  }

  async function updateChecklistItemAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    await requireChecklistAdmin(session);

    try {
      const id = String(formData.get("id") ?? "").trim();
      if (!id) throw new Error("Missing checklist item id.");

      const area = toArea(formData.get("area"));
      const label = normalizeLabel(formData.get("label"));
      const active = String(formData.get("active") ?? "").trim() === "on";

      await db.equipmentAreaChecklistItem.update({
        where: { id },
        data: {
          area,
          label,
          active,
        },
      } as unknown);

      revalidatePath("/admin/work-orders/checklists");
      revalidatePath("/maintenance/work-orders");
      revalidatePath("/maintenance/work-orders/[id]");
      revalidatePath("/admin/work-orders/[id]");
      buildRedirect("Checklist item saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save checklist item.";
      buildRedirect(undefined, message);
    }
  }

  async function deleteChecklistItemAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    await requireChecklistAdmin(session);

    try {
      const id = String(formData.get("id") ?? "").trim();
      if (!id) throw new Error("Missing checklist item id.");

      await db.equipmentAreaChecklistItem.delete({ where: { id } } as unknown);

      revalidatePath("/admin/work-orders/checklists");
      revalidatePath("/maintenance/work-orders");
      revalidatePath("/maintenance/work-orders/[id]");
      revalidatePath("/admin/work-orders/[id]");
      buildRedirect("Checklist item deleted.");
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        buildRedirect(undefined, "Delete blocked: this checklist item is already used on saved work orders. Turn off Active to hide it from future work orders.");
      }

      const message = error instanceof Error ? error.message : "Failed to delete checklist item.";
      buildRedirect(undefined, message);
    }
  }

  const sp = (await searchParams) ?? {};
  const ok = String(sp.ok ?? "").trim();
  const err = String(sp.err ?? "").trim();

  const items = await listChecklistItems({ includeInactive: true });
  const itemsByArea = groupChecklistItemsByArea(items);

  const shell: CSSProperties = { padding: 20, display: "grid", gap: 14 };
  const card: CSSProperties = {
    border: "1px solid rgba(128,128,128,0.25)",
    borderRadius: 14,
    padding: 14,
    background: "var(--background)",
    color: "var(--foreground)",
  };
  const label: CSSProperties = { display: "grid", gap: 6, fontSize: 13, fontWeight: 800 };
  const input: CSSProperties = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    outline: "none",
  };
  const btn: CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(128,128,128,0.25)",
    background: "var(--background)",
    color: "var(--foreground)",
    fontWeight: 900,
    cursor: "pointer",
    textDecoration: "none",
  };
  const deleteBtn: CSSProperties = {
    ...btn,
    border: "1px solid rgba(220,60,60,0.35)",
    background: "rgba(220,60,60,0.12)",
  };
  const areaGrid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 14 };
  const rowGrid: CSSProperties = { display: "grid", gridTemplateColumns: "1.9fr 1fr auto", gap: 10, alignItems: "end" };

  return (
    <main style={shell}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Work Order Checklists</h1>
        <Link href="/admin/work-orders" style={btn}>Back to Work Orders</Link>
      </div>

      <section style={card}>
        <div style={{ fontSize: 14, opacity: 0.88 }}>
          Create and maintain the detailed checklist items shown under each work-order equipment area. Technicians can select multiple checklist items per area, and items are shown alphabetically.
        </div>
        <div style={{ marginTop: 8, fontSize: 13, opacity: 0.74 }}>
          Delete permanently removes unused checklist items. If an item is already saved on a work order, use <b>Active</b> to hide it from future work orders instead.
        </div>
        {ok ? <div style={{ marginTop: 10, padding: 10, border: "1px solid rgba(0,160,90,0.35)", borderRadius: 10 }}>{ok}</div> : null}
        {err ? <div style={{ marginTop: 10, padding: 10, border: "1px solid rgba(220,60,60,0.35)", borderRadius: 10 }}>{err}</div> : null}
      </section>

      <section style={areaGrid}>
        {WORK_ORDER_EQUIPMENT_AREAS.map((area) => {
          const rows = itemsByArea[area] ?? [];
          return (
            <section key={area} style={card}>
              <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18, fontWeight: 900 }}>
                {formatWorkOrderEquipmentAreaLabel(area)}
              </h2>

              <form action={createChecklistItemAction} style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                <input type="hidden" name="area" value={area} />
                <div style={rowGrid}>
                  <label style={label}>
                    New Checklist Item
                    <input name="label" placeholder="Example: Check trap lid seal" style={input} required />
                  </label>
                  <div />
                  <button type="submit" style={btn}>Add</button>
                </div>
              </form>

              <div style={{ display: "grid", gap: 10 }}>
                {rows.map((row: EquipmentAreaChecklistItemRow) => (
                  <form key={row.id} action={updateChecklistItemAction} style={{ ...rowGrid, padding: 10, border: "1px solid rgba(128,128,128,0.18)", borderRadius: 12 }}>
                    <input type="hidden" name="id" value={row.id} />
                    <label style={label}>
                      Label
                      <input name="label" defaultValue={row.label} style={input} required />
                    </label>
                    <label style={{ ...label, alignSelf: "center" }}>
                      Area
                      <select name="area" defaultValue={row.area} style={input}>
                        {WORK_ORDER_EQUIPMENT_AREAS.map((option) => (
                          <option key={`${row.id}-${option}`} value={option}>{formatWorkOrderEquipmentAreaLabel(option)}</option>
                        ))}
                      </select>
                    </label>
                    <div style={{ display: "grid", gap: 10 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800 }}>
                        <input type="checkbox" name="active" defaultChecked={row.active} />
                        Active
                      </label>
                      <div style={{ display: "grid", gap: 8 }}>
                        <button type="submit" style={btn}>Save</button>
                        <button type="submit" formAction={deleteChecklistItemAction} formNoValidate style={deleteBtn}>Delete</button>
                      </div>
                    </div>
                  </form>
                ))}
                {rows.length === 0 ? <div style={{ fontSize: 13, opacity: 0.78 }}>No checklist items for this area yet.</div> : null}
              </div>
            </section>
          );
        })}
      </section>
    </main>
  );
}
