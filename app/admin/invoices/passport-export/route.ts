import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Permission } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

export const dynamic = "force-dynamic";

function csvEscape(v: string): string {
  const needs = /[",\n\r]/.test(v);
  const s = v.replace(/"/g, '""');
  return needs ? `"${s}"` : s;
}

function fmtDateIso(d: Date | null): string {
  if (!d) return "";
  try {
    return new Date(d).toISOString();
  } catch {
    return "";
  }
}

function to2(n: unknown): string {
  const x = Number(n ?? 0);
  if (!Number.isFinite(x)) return "0.00";
  return (Math.round(x * 100) / 100).toFixed(2);
}

function decodeOnce(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

function parseIds(raw: string | null): string[] {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  const d = decodeOnce(s);
  return d
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 300);
}

async function requireAdminInvoiceExport() {
  const session = await getServerSession(authOptions);
  if (!session) return false;

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return true;
  return hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
}

export async function GET(req: Request) {
  const ok = await requireAdminInvoiceExport();
  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const ids = parseIds(url.searchParams.get("ids"));

  if (ids.length === 0) {
    return NextResponse.json({ error: "Missing ids" }, { status: 400 });
  }

  const invoices = await prisma.invoice.findMany({
    where: { id: { in: ids } },
    include: {
      lines: { orderBy: [{ submittedAt: "asc" }, { id: "asc" }] },
    },
  });

  const byId = new Map(invoices.map((x) => [x.id, x]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as typeof invoices;

  const header = [
    "recordType",
    "invoiceId",
    "invoiceDate",
    "vendor",
    "vendorNumber",
    "billedTo",
    "storeNumber",
    "storeName",
    "periodStart",
    "periodEnd",
    "lineSubmittedAt",
    "sku",
    "partNumber",
    "itemName",
    "quantity",
    "unitPrice",
    "lineSubtotal",
    "lineTax",
    "lineTotal",
    "invoiceSubtotal",
    "invoiceTaxTotal",
    "invoiceTotal",
  ];

  const lines: string[] = [header.join(",")];

  for (const inv of ordered) {
    for (const ln of inv.lines) {
      lines.push(
        [
          "INVOICE_LINE",
          csvEscape(inv.id),
          csvEscape(fmtDateIso(inv.invoiceDate)),
          csvEscape(String(inv.vendor)),
          csvEscape(inv.vendorNumber ?? ""),
          csvEscape(inv.billedTo ?? ""),
          csvEscape(inv.storeNumber ?? ""),
          csvEscape(inv.storeName ?? ""),
          csvEscape(fmtDateIso(inv.periodStart)),
          csvEscape(fmtDateIso(inv.periodEnd)),
          csvEscape(fmtDateIso(ln.submittedAt)),
          csvEscape(ln.sku ?? ""),
          csvEscape(ln.partNumber ?? ""),
          csvEscape(ln.name ?? ""),
          String(ln.quantity ?? 0),
          to2(ln.unitPrice),
          to2(ln.lineSubtotal),
          to2(ln.lineTax),
          to2(ln.lineTotal),
          to2(inv.subtotal),
          to2(inv.taxTotal),
          to2(inv.total),
        ].join(",")
      );
    }
  }

  const csv = lines.join("\n");
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const file = `passport-invoices-${y}${m}${d}-${hh}${mm}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
