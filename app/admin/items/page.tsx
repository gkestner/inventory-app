// app/admin/items/page.tsx
import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  active?: string; // all | true | false
  error?: string;
  ping?: string;
  job?: string;
};

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (session.user?.role !== "ADMIN") redirect("/");
}

/** Normalize header keys like "Part #", "Part_Number", "part number" -> "partnumber" */
function normHeader(h: string) {
  return h
    .trim()
    .toLowerCase()
    .replace(/\ufeff/g, "") // BOM
    .replace(/[\s#_\-\/]+/g, "");
}

/** Minimal CSV parser supporting quoted fields and escaped quotes. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    cur.push(field);
    field = "";
  };
  const pushRow = () => {
    // skip pure-empty final row
    rows.push(cur);
    cur = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      continue;
    }

    if (c === ",") {
      pushField();
      continue;
    }

    if (c === "\r") continue;

    if (c === "\n") {
      pushField();
      pushRow();
      continue;
    }

    field += c;
  }

  pushField();
  if (cur.length) pushRow();

  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = (rows.shift() ?? []).map((h) => (h ?? "").trim());
  const dataRows = rows.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  return { headers, rows: dataRows };
}

function indexHeaders(headers: string[]) {
  const map = new Map<string, number>();
  headers.forEach((h, i) => map.set(normHeader(h), i));

  const alias = (from: string, to: string) => {
    if (!map.has(to) && map.has(from)) map.set(to, map.get(from)!);
  };

  // Common aliases
  alias("itemname", "name");
  alias("productname", "name");

  alias("part", "partnumber");
  alias("partno", "partnumber");
  alias("partnum", "partnumber");
  alias("pn", "partnumber");

  alias("uom", "unit");
  alias("unitofmeasure", "unit");

  alias("sellprice", "price");
  alias("retailprice", "price");

  alias("buycost", "cost");
  alias("unitcost", "cost");

  return map;
}

function cell(row: string[], idx?: number) {
  if (idx === undefined) return "";
  return (row[idx] ?? "").trim();
}

function upper(v: string) {
  const s = (v ?? "").trim();
  return s ? s.toUpperCase() : "";
}

function text(v: string) {
  const s = (v ?? "").trim();
  return s || "";
}

function parseBool(v: string, defaultValue: boolean) {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return defaultValue;
  if (["true", "1", "yes", "y", "on", "t"].includes(s)) return true;
  if (["false", "0", "no", "n", "off", "f"].includes(s)) return false;
  return defaultValue;
}

function parseDecimal(v: string): Prisma.Decimal | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return new Prisma.Decimal(s);
}

export default async function AdminItemsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Next 16: unwrap promise searchParams
  searchParams = await searchParams;

  await requireAdmin();

  const q = (searchParams.q ?? "").trim();
  const activeParam = (searchParams.active ?? "all").toLowerCase();

  // Never show NEXT_REDIRECT to the user
  const error =
    searchParams.error && String(searchParams.error) !== "NEXT_REDIRECT"
      ? String(searchParams.error)
      : "";

  const ping = searchParams.ping ? String(searchParams.ping) : "";
  const jobId = searchParams.job ? String(searchParams.job) : "";

  const where: Prisma.ItemWhereInput = {};
  if (q) {
    where.OR = [
      { sku: { contains: q, mode: "insensitive" } },
      { partNumber: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
      { unit: { contains: q, mode: "insensitive" } },
    ];
  }
  if (activeParam === "true") where.active = true;
  if (activeParam === "false") where.active = false;

  const items = await prisma.item.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  // These assume you already created ImportJob / ImportRowError tables.
  const job = jobId ? await prisma.importJob.findUnique({ where: { id: jobId } }) : null;
  const jobErrors = jobId
    ? await prisma.importRowError.findMany({
        where: { jobId },
        orderBy: { rowNumber: "asc" },
        take: 200,
      })
    : [];

  // -----------------------
  // Server Actions
  // -----------------------

  async function pingAction() {
    "use server";
    // no auth check here — we only want to prove actions fire
    redirect("/admin/items?ping=PING_WORKED");
  }

  async function importItems(formData: FormData) {
    "use server";
    await requireAdmin();

    try {
      const file = formData.get("file");
      if (!(file instanceof File)) {
        redirect(`/admin/items?error=${encodeURIComponent("No file received. Choose a CSV and try again.")}`);
      }

      const csvText = await file.text();
      if (!csvText.trim()) {
        redirect(`/admin/items?error=${encodeURIComponent("CSV file was empty.")}`);
      }

      const { headers, rows } = parseCsv(csvText);
      if (!headers.length) {
        redirect(`/admin/items?error=${encodeURIComponent("CSV missing header row.")}`);
      }

      const h = indexHeaders(headers);

      const skuIdx = h.get("sku");
      const nameIdx = h.get("name");
      if (skuIdx === undefined || nameIdx === undefined) {
        redirect(
          `/admin/items?error=${encodeURIComponent(
            "CSV must include headers: sku, name. (Rename columns or use common variants like SKU / Item Name)."
          )}`
        );
      }

      const job = await prisma.importJob.create({ data: { type: "ITEMS" } });

      let total = 0;
      let created = 0;
      let updated = 0;
      let failed = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNumber = i + 2; // header = row 1

        if (!row || row.every((c) => !String(c ?? "").trim())) continue;

        total++;

        const sku = upper(cell(row, skuIdx));
        const name = text(cell(row, nameIdx));

        if (!sku || !name) {
          failed++;
          await prisma.importRowError.create({
            data: { jobId: job.id, rowNumber, sku: sku || null, message: "Missing required fields: sku and/or name" },
          });
          continue;
        }

        const partNumber = upper(cell(row, h.get("partnumber")));
        const description = text(cell(row, h.get("description")));
        const category = text(cell(row, h.get("category")));
        const unit = text(cell(row, h.get("unit")));
        const cost = parseDecimal(cell(row, h.get("cost")));
        const price = parseDecimal(cell(row, h.get("price")));
        const taxable = parseBool(cell(row, h.get("taxable")), true);
        const active = parseBool(cell(row, h.get("active")), true);

        try {
          const existing = await prisma.item.findUnique({ where: { sku } });

          if (!existing) {
            await prisma.item.create({
              data: {
                sku,
                partNumber: partNumber || null,
                name,
                description: description || null,
                category: category || null,
                unit: unit || null,
                cost,
                price,
                taxable,
                active,
              },
            });
            created++;
            continue;
          }

          // Snapshot previous values into ItemVersion before updating
          const last = await prisma.itemVersion.aggregate({
            where: { itemId: existing.id },
            _max: { version: true },
          });
          const nextVersion = (last._max.version ?? 0) + 1;

          await prisma.$transaction([
            prisma.itemVersion.create({
              data: {
                itemId: existing.id,
                sku: existing.sku,
                partNumber: existing.partNumber,
                name: existing.name,
                description: existing.description,
                category: existing.category,
                unit: existing.unit,
                cost: existing.cost,
                price: existing.price,
                taxable: existing.taxable,
                active: existing.active,
                version: nextVersion,
              },
            }),
            prisma.item.update({
              where: { id: existing.id },
              data: {
                sku, // normalized to uppercase
                partNumber: partNumber || null,
                name,
                description: description || null,
                category: category || null,
                unit: unit || null,
                cost,
                price,
                taxable,
                active,
              },
            }),
          ]);

          updated++;
        } catch (e: any) {
          failed++;
          await prisma.importRowError.create({
            data: {
              jobId: job.id,
              rowNumber,
              sku,
              message: String(e?.message ?? e).slice(0, 500),
            },
          });
        }
      }

      await prisma.importJob.update({
        where: { id: job.id },
        data: { total, created, updated, failed },
      });

      revalidatePath("/admin/items");
      redirect(`/admin/items?job=${encodeURIComponent(job.id)}`);
    } catch (e: any) {
      redirect(`/admin/items?error=${encodeURIComponent(String(e?.message ?? e))}`);
    }
  }

  // -----------------------
  // UI
  // -----------------------

  return (
    <div style={{ padding: 24, display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "end" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Admin → Items</h1>

        <form method="GET" style={{ display: "flex", gap: 10, alignItems: "end" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12 }}>Search</label>
            <input
              name="q"
              defaultValue={q}
              placeholder="SKU, Part #, name, category..."
              style={{ padding: "8px 10px", minWidth: 260 }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12 }}>Active</label>
            <select name="active" defaultValue={activeParam} style={{ padding: "8px 10px" }}>
              <option value="all">All</option>
              <option value="true">Active</option>
              <option value="false">Disabled</option>
            </select>
          </div>

          <button type="submit" style={{ padding: "8px 12px" }}>
            Filter
          </button>
        </form>
      </div>

      {ping ? (
        <div style={{ border: "1px solid #2a7", padding: 10, borderRadius: 8 }}>
          Ping OK: {ping}
        </div>
      ) : null}

      {error ? (
        <div style={{ border: "1px solid #a33", padding: 10, borderRadius: 8, color: "#f66" }}>
          {error}
        </div>
      ) : null}

      {/* IMPORT */}
      <section style={{ border: "1px solid #444", borderRadius: 10, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Import Items (CSV)</h2>

          <form action={pingAction}>
            <button type="submit" style={{ padding: "8px 10px" }}>
              Test Import Action (Ping)
            </button>
          </form>
        </div>

        <form action={importItems} style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontSize: 12 }}>CSV File</label>
            <input type="file" name="file" accept=".csv,text/csv" required />
          </div>

          <button type="submit" style={{ padding: "10px 12px", justifySelf: "start" }}>
            Import CSV (Upsert by SKU)
          </button>

          <div style={{ fontSize: 12, color: "#aaa" }}>
            Required headers: <strong>sku</strong>, <strong>name</strong>. Supported: partNumber/Part #/PN, description,
            category, unit/UOM, cost, price, taxable, active.
          </div>
        </form>
      </section>

      {/* IMPORT RESULTS */}
      {job ? (
        <section style={{ border: "1px solid #444", borderRadius: 10, padding: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Last Import Results</h2>

          <div style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
            <div>
              <strong>Job:</strong> {job.id}
            </div>
            <div>
              <strong>Total:</strong> {job.total}
            </div>
            <div>
              <strong>Created:</strong> {job.created}
            </div>
            <div>
              <strong>Updated:</strong> {job.updated}
            </div>
            <div>
              <strong>Failed:</strong> {job.failed}
            </div>
          </div>

          {jobErrors.length ? (
            <div style={{ marginTop: 12 }}>
              <h3 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700 }}>Errors (first 200)</h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>
                      {["Row", "SKU", "Message"].map((hh) => (
                        <th key={hh} style={{ textAlign: "left", borderBottom: "1px solid #666", padding: "8px 6px" }}>
                          {hh}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {jobErrors.map((e) => (
                      <tr key={e.id}>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #333" }}>{e.rowNumber}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #333" }}>{e.sku ?? ""}</td>
                        <td style={{ padding: "8px 6px", borderBottom: "1px solid #333" }}>{e.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ITEMS */}
      <section style={{ border: "1px solid #444", borderRadius: 10, padding: 14 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Items ({items.length})</h2>

        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["SKU", "Part #", "Name", "Category", "Unit", "Cost", "Price", "Taxable", "Active"].map((hh) => (
                  <th key={hh} style={{ textAlign: "left", borderBottom: "1px solid #666", padding: "10px 8px" }}>
                    {hh}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #333" }}>
                    <strong>{it.sku}</strong>
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #333" }}>{it.partNumber ?? ""}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #333" }}>{it.name}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #333" }}>{it.category ?? ""}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #333" }}>{it.unit ?? ""}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #333" }}>
                    {it.cost ? it.cost.toString() : ""}
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #333" }}>
                    {it.price ? it.price.toString() : ""}
                  </td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #333" }}>{it.taxable ? "Yes" : "No"}</td>
                  <td style={{ padding: "10px 8px", borderBottom: "1px solid #333" }}>{it.active ? "Active" : "Disabled"}</td>
                </tr>
              ))}

              {items.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ padding: "14px 8px", color: "#aaa" }}>
                    No items found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
