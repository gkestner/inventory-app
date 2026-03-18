import type { CSSProperties } from "react";
import { del } from "@vercel/blob";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { getCompatDb } from "@/app/lib/workflow-foundations";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { CREATE_RECEIPTS, VIEW_RECEIPTS } from "@/app/lib/permission-constants";
import ReceiptRowFileUploader from "../ReceiptRowFileUploader";

export const dynamic = "force-dynamic";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type RequiredEquipmentArea =
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

function requireSession(session: SessionShape) {
  if (!session) redirect("/login");
  if (!session.user?.email) redirect("/login");
}

function formatAreaLabel(area: string): string {
  const parts = area.split("_").filter(Boolean);
  return parts
    .map((p) => {
      const up = p.toUpperCase();
      if (up === "HVAC") return "HVAC";
      if (up === "DOUGH") return "Dough";
      return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
    })
    .join(" ");
}

function moneyFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function fmtDate(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function fmtDateTime(d: Date | null): string {
  if (!d) return "-";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export default async function ReceiptEntryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = (await getServerSession(authOptions)) as SessionShape;
  requireSession(session);

  const routeParams = await params;
  const receiptEntryId = String(routeParams.id ?? "").trim();
  if (!receiptEntryId) notFound();

  const perms = await loadUserPermissions(session);
  const canViewReceipts = perms.allowAll || hasAnyPermission(perms, [VIEW_RECEIPTS, CREATE_RECEIPTS]);
  if (!canViewReceipts) {
    redirect("/maintenance");
  }

  const email = String(session?.user?.email ?? "").trim().toLowerCase();
  const [me, activeLocations] = await Promise.all([
    prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        active: true,
        locationId: true,
        location: { select: { id: true, active: true } },
        allowedLocations: {
          select: { locationId: true, location: { select: { id: true, active: true } } },
        },
      },
    }),
    perms.allowAll
      ? prisma.location.findMany({ where: { active: true }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  if (!me || !me.active) redirect("/login");

  const allowedLocationIds = new Set<string>();
  if (perms.allowAll) {
    for (const location of activeLocations) allowedLocationIds.add(location.id);
  } else {
    if (me.locationId && me.location?.active) allowedLocationIds.add(me.locationId);
    for (const ul of me.allowedLocations) {
      if (ul.location?.active) allowedLocationIds.add(ul.locationId);
    }
  }

  const db = getCompatDb() as any;
  if (!db.receiptEntry?.findUnique) notFound();

  const receipt = await db.receiptEntry.findUnique({
    where: { id: receiptEntryId },
    select: {
      id: true,
      receiptDate: true,
      amountCents: true,
      billedBackVendor: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      locationId: true,
      location: { select: { name: true, locationNumber: true } },
      createdByUser: { select: { name: true, email: true } },
      areas: { select: { area: true }, orderBy: { area: "asc" } },
      files: {
        select: {
          id: true,
          fileName: true,
          url: true,
          contentType: true,
          byteSize: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!receipt) notFound();
  if (!allowedLocationIds.has(receipt.locationId)) notFound();

  const canDeleteReceipts = perms.allowAll || hasAnyPermission(perms, [CREATE_RECEIPTS]);

  async function deleteReceiptFromDetailAction(formData: FormData) {
    "use server";

    const session = (await getServerSession(authOptions)) as SessionShape;
    requireSession(session);

    const receiptEntryId = String(formData.get("receiptEntryId") ?? "").trim();
    if (!receiptEntryId) throw new Error("Receipt entry id is required.");

    const perms = await loadUserPermissions(session);
    const canDeleteReceipts = perms.allowAll || hasAnyPermission(perms, [CREATE_RECEIPTS]);
    if (!canDeleteReceipts) {
      throw new Error("You do not have permission to delete receipt entries.");
    }

    const email = String(session?.user?.email ?? "").trim().toLowerCase();
    const me = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        active: true,
        locationId: true,
        allowedLocations: { select: { locationId: true } },
      },
    });
    if (!me || !me.active) redirect("/login");

    const db = getCompatDb() as any;
    if (!db.receiptEntry?.findUnique || !db.receiptEntry?.delete) {
      throw new Error("Receipt tables are not available. Run latest migrations.");
    }

    const receipt = await db.receiptEntry.findUnique({
      where: { id: receiptEntryId },
      select: {
        id: true,
        locationId: true,
        files: { select: { storageKey: true } },
      },
    });
    if (!receipt) throw new Error("Receipt entry not found.");

    if (!perms.allowAll) {
      const allowed = new Set<string>();
      if (me.locationId) allowed.add(me.locationId);
      for (const ul of me.allowedLocations) allowed.add(ul.locationId);
      if (!allowed.has(receipt.locationId)) {
        throw new Error("You are not allowed to delete receipt entries for this location.");
      }
    }

    await db.$transaction(async (tx: any) => {
      if (tx.receiptFile?.deleteMany) {
        await tx.receiptFile.deleteMany({ where: { receiptEntryId } });
      }
      if (tx.receiptEntryArea?.deleteMany) {
        await tx.receiptEntryArea.deleteMany({ where: { receiptEntryId } });
      }
      await tx.receiptEntry.delete({ where: { id: receiptEntryId } });
    });

    const storageKeys = (receipt.files ?? [])
      .map((f: { storageKey?: string | null }) => String(f.storageKey ?? "").trim())
      .filter(Boolean);
    if (storageKeys.length > 0) {
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim() || process.env.Inventory_READ_WRITE_TOKEN?.trim() || "";
      if (blobToken) {
        await Promise.allSettled(storageKeys.map((key: string) => del(key, { token: blobToken })));
      }
    }

    revalidatePath("/maintenance/receipts");
    revalidatePath("/maintenance");
    redirect("/maintenance/receipts");
  }

  const border = "1px solid rgba(128,128,128,0.25)";

  const card: CSSProperties = {
    border,
    borderRadius: 14,
    background: "var(--surface)",
    boxShadow: "var(--shadow)",
    padding: 14,
    display: "grid",
    gap: 10,
  };

  const metaRowStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    gap: 8,
    padding: "8px 0",
    borderBottom: border,
  };

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto", display: "grid", gap: 14 }}>
      <section style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900 }}>Receipt Entry</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {canDeleteReceipts ? (
              <form action={deleteReceiptFromDetailAction}>
                <input type="hidden" name="receiptEntryId" value={receipt.id} />
                <button
                  type="submit"
                  style={{
                    border,
                    borderRadius: 10,
                    padding: "8px 12px",
                    background: "#fee2e2",
                    color: "#7f1d1d",
                    cursor: "pointer",
                    fontWeight: 800,
                  }}
                  title="Delete this receipt entry and all attached files"
                >
                  Delete Entry
                </button>
              </form>
            ) : null}
            <Link
              href="/maintenance/receipts"
              style={{
                border,
                borderRadius: 10,
                padding: "8px 12px",
                textDecoration: "none",
                color: "var(--foreground)",
                fontWeight: 800,
              }}
            >
              Back to Receipt Entries
            </Link>
          </div>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>Entry ID: {receipt.id}</div>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Details</h2>

        <div style={metaRowStyle}>
          <div style={{ fontWeight: 800 }}>Receipt Date</div>
          <div>{fmtDate(receipt.receiptDate)}</div>
        </div>
        <div style={metaRowStyle}>
          <div style={{ fontWeight: 800 }}>Location</div>
          <div>{receipt.location?.name ?? "-"}</div>
        </div>
        <div style={metaRowStyle}>
          <div style={{ fontWeight: 800 }}>User</div>
          <div>{(receipt.createdByUser?.name?.trim() || "(No Name)") + " (" + (receipt.createdByUser?.email || "-") + ")"}</div>
        </div>
        <div style={metaRowStyle}>
          <div style={{ fontWeight: 800 }}>Amount</div>
          <div style={{ fontWeight: 900 }}>{moneyFromCents(receipt.amountCents)}</div>
        </div>
        <div style={metaRowStyle}>
          <div style={{ fontWeight: 800 }}>Billed-Back Vendor</div>
          <div>{receipt.billedBackVendor || "-"}</div>
        </div>
        <div style={metaRowStyle}>
          <div style={{ fontWeight: 800 }}>Areas</div>
          <div>
            {Array.isArray(receipt.areas) && receipt.areas.length > 0
              ? receipt.areas
                  .map((a: { area: RequiredEquipmentArea }) => formatAreaLabel(a.area))
                  .join(", ")
              : "-"}
          </div>
        </div>
        <div style={metaRowStyle}>
          <div style={{ fontWeight: 800 }}>Notes</div>
          <div>{receipt.notes?.trim() || "-"}</div>
        </div>
        <div style={metaRowStyle}>
          <div style={{ fontWeight: 800 }}>Created</div>
          <div>{fmtDateTime(receipt.createdAt)}</div>
        </div>
        <div style={{ ...metaRowStyle, borderBottom: "none" }}>
          <div style={{ fontWeight: 800 }}>Last Updated</div>
          <div>{fmtDateTime(receipt.updatedAt)}</div>
        </div>
      </section>

      <section style={card}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Uploaded Documents</h2>

        {Array.isArray(receipt.files) && receipt.files.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {receipt.files.map((file: { id: string; fileName: string; url: string; contentType: string | null; byteSize: number | null; createdAt: Date }) => (
              <div
                key={file.id}
                style={{
                  border,
                  borderRadius: 10,
                  padding: 10,
                  display: "grid",
                  gap: 6,
                }}
              >
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--brand)", textDecoration: "underline", fontWeight: 800, wordBreak: "break-word" }}
                >
                  {file.fileName}
                </a>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  {file.contentType || "Unknown type"}
                  {typeof file.byteSize === "number" ? ` • ${Math.max(1, Math.round(file.byteSize / 1024))} KB` : ""}
                  {` • Uploaded ${fmtDateTime(file.createdAt)}`}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 14, opacity: 0.85 }}>No files uploaded yet for this receipt entry.</div>
        )}

        <div style={{ marginTop: 8 }}>
          <ReceiptRowFileUploader receiptEntryId={receipt.id} />
        </div>
      </section>
    </main>
  );
}
