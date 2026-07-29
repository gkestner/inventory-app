import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/lib/auth";
import { ADMIN_EDIT_SUPPLIERS, ADMIN_VIEW_SUPPLIERS } from "@/app/lib/permission-constants";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import {
  filterSupplierDirectory,
  loadSupplierDirectory,
  parseSupplierDirection,
  parseSupplierSort,
  sortSupplierDirectory,
} from "@/app/lib/supplier-directory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvCell(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadUserPermissions(session);
  if (!perms.allowAll && !hasAnyPermission(perms, [ADMIN_VIEW_SUPPLIERS, ADMIN_EDIT_SUPPLIERS])) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const sort = parseSupplierSort(url.searchParams.get("sort"));
  const direction = parseSupplierDirection(url.searchParams.get("dir"));
  const suppliers = sortSupplierDirectory(filterSupplierDirectory(await loadSupplierDirectory(prisma), query), sort, direction);

  const rows = [
    csvRow([
      "Supplier",
      "Profile saved",
      "Payment type",
      "Terms",
      "Account number",
      "Phone",
      "Extension",
      "Email",
      "Order count",
      "Latest order",
      "Aliases",
      "Parts",
      "Parts summary",
      "Notes",
    ]),
    ...suppliers.map((supplier) =>
      csvRow([
        supplier.displayName,
        supplier.hasProfile ? "Yes" : "No",
        supplier.paymentMethod,
        supplier.terms,
        supplier.accountNumber,
        supplier.phone,
        supplier.extension,
        supplier.email,
        supplier.orderCount,
        supplier.latestOrderAt,
        supplier.aliases.join("; "),
        supplier.partLabels.join("; "),
        supplier.partsSummary,
        supplier.notes,
      ]),
    ),
  ];

  const csv = `${rows.join("\r\n")}\r\n`;
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="suppliers-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
