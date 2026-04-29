import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { parseSkuRoomParts } from "@/app/lib/item-sku";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import SignOutButton from "@/app/components/SignOutButton";
import ScannerCountClient from "@/app/maintenance/scanner-count/ScannerCountClient";

type SessionShape = {
  user?: {
    email?: string | null;
  } | null;
} | null;

type SearchItem = {
  id: string;
  labelNumber: number | null;
  sku: string;
  partNumber: string | null;
  name: string;
  category: string | null;
  manufacturer: string | null;
  orderFrom: string | null;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function prettyCode(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

export default async function ScannerCountPage() {
  const session = (await getServerSession(authOptions)) as SessionShape;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  const canUseScannerCount =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
    ]);

  if (!canUseScannerCount) redirect("/maintenance");

  const items = await prisma.item.findMany({
    where: { active: true },
    orderBy: [{ sku: "asc" }, { name: "asc" }],
    select: {
      id: true,
      labelNumber: true,
      sku: true,
      partNumber: true,
      name: true,
      category: true,
      manufacturer: true,
      orderFrom: true,
    },
  });

  const searchItems: SearchItem[] = items.map((item) => ({
    id: item.id,
    labelNumber: item.labelNumber,
    sku: item.sku,
    partNumber: item.partNumber,
    name: item.name,
    category: item.category,
    manufacturer: item.manufacturer,
    orderFrom: item.orderFrom,
  }));

  const availableLocations = Array.from(
    new Set(
      items
        .map((item) => parseSkuRoomParts(item.sku)?.location ?? null)
        .filter((value): value is string => Boolean(value))
        .concat("vault")
    )
  ).sort((a, b) => {
    if (a === "vault" && b !== "vault") return 1;
    if (a !== "vault" && b === "vault") return -1;
    if (a === "vault" && b === "vault") return 0;
    return Number(a) - Number(b);
  });

  const compactNavLinks = [
    { href: "/admin", label: "Admin Home" },
    { href: "/maintenance/checkout", label: "Checkout" },
    { href: "/admin/items", label: "Items" },
    { href: "/notifications", label: "Notifications" },
    { href: "/admin/inventory-orders", label: "Order History" },
    { href: "/maintenance/room-diagrams/quick-count", label: "Quick Count Editor" },
    { href: "/admin/reports", label: "Reports" },
    { href: "/maintenance/room-diagrams", label: "Room Diagrams" },
    { href: "/maintenance/scanner-count", label: "Scanner Count" },
    { href: "/settings", label: "Settings" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/work-orders", label: "Work Orders" },
  ].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <main>
      <div style={{ maxWidth: 1040, margin: "0 auto", display: "grid", gap: 14 }}>
        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: 16,
            padding: 12,
            background: "var(--surface)",
            boxShadow: "var(--shadow)",
          }}
        >
          <details>
            <summary
              style={{
                listStyle: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                fontWeight: 900,
                fontSize: 16,
              }}
            >
              <span>Menu</span>
              <span style={{ fontSize: 12, color: "var(--muted)" }}>Tap to open</span>
            </summary>
            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 8,
              }}
            >
              {compactNavLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  style={{
                    textDecoration: "none",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: link.href === "/maintenance/scanner-count" ? "var(--surface-2)" : "var(--surface)",
                    color: "var(--foreground)",
                    fontWeight: 800,
                  }}
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
              <SignOutButton
                label="Logout"
                callbackUrl="/login"
                style={{
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "1px solid color-mix(in srgb, var(--brand) 55%, var(--border))",
                  background: "linear-gradient(160deg, var(--brand-2) 0%, var(--brand) 100%)",
                  color: "var(--brand-contrast)",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              />
            </div>
          </details>
        </section>

        <section
          style={{
            border: "1px solid var(--border)",
            borderRadius: 18,
            padding: 18,
            background:
              "linear-gradient(155deg, color-mix(in srgb, var(--brand) 10%, var(--surface)) 0%, var(--surface) 66%)",
            boxShadow: "var(--shadow)",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <h1 style={{ margin: 0, fontSize: 30, fontWeight: 950 }}>Scanner Count</h1>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5, maxWidth: 760 }}>
                Scan a label, review the current stock, update the part name or room location inline, and save without leaving the screen.
              </p>
            </div>
          </div>
          <div style={{ marginTop: 14, fontSize: 13, color: "var(--muted)", lineHeight: 1.45 }}>
            Available room locations: {availableLocations.map((location) => (location === "vault" ? "Vault" : `Loc ${prettyCode(location)}`)).join(", ")}
          </div>
        </section>

        <ScannerCountClient items={searchItems} availableLocations={availableLocations} />
      </div>
    </main>
  );
}