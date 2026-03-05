// app/admin/locations/page.tsx
import type { CSSProperties } from "react";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { prisma } from "@/app/lib/prisma";
import { authOptions } from "@/app/lib/auth";

import { Prisma, Role } from "@prisma/client";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  ok?: string;
  err?: string;
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

async function requireAdmin(): Promise<AppSession> {
  const session = (await getServerSession(authOptions)) as AppSession;
  if (!session) redirect("/login");

  const sessionRole = session.user?.role ?? null;
  const email = (session.user?.email ?? "").trim().toLowerCase();

  const dbRole = email
    ? (
        await prisma.user.findUnique({
          where: { email },
          select: { role: true },
        })
      )?.role ?? null
    : null;

  const effectiveRole = sessionRole ?? dbRole;
  if (effectiveRole !== Role.ADMIN) redirect("/");

  return session;
}

function norm(v: string | undefined) {
  return (v ?? "").trim();
}

function normalizeLocationName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toUpperCase();
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function parseBulkNames(raw: string): string[] {
  // Split on newlines and commas; trim; normalize; remove empties; de-dupe preserving order
  const parts = raw
    .split(/[\n,]+/g)
    .map((s) => normalizeLocationName(s))
    .filter((s) => s.length > 0);

  return dedupePreserveOrder(parts);
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

// Minimal CSV parsing (no quoted-field support by design; stable + predictable)
function splitCsvLine(line: string): string[] {
  return line
    .split(",")
    .map((c) => c.trim().replace(/^"(.+)"$/, "$1").trim());
}

function parseNamesFromCsvText(csvText: string): string[] {
  const text = stripBom(csvText).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  // If it's effectively a simple list (no commas), treat as newline list
  const hasComma = lines.some((l) => l.includes(","));
  if (!hasComma) {
    return dedupePreserveOrder(lines.map((l) => normalizeLocationName(l)).filter(Boolean));
  }

  // Parse header
  const headerCells = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const nameIdx = headerCells.indexOf("name");

  // If no "name" header, assume first column is name (skip header if it looks like header-ish)
  const assumeFirstCol = nameIdx === -1;

  const names: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length === 0) continue;

    if (i === 0) {
      // Header row handling
      if (!assumeFirstCol) continue; // has "name" header, skip row 0
      // assume first col: if first cell looks like "name", skip it
      const first = (cells[0] ?? "").trim().toLowerCase();
      if (first === "name" || first === "location" || first === "locationname") continue;
      // otherwise treat row0 as data
    }

    const rawName = assumeFirstCol ? (cells[0] ?? "") : (cells[nameIdx] ?? "");
    const n = normalizeLocationName(rawName);
    if (n) names.push(n);
  }

  return dedupePreserveOrder(names);
}

function safeIdsFromFormData(fd: FormData, key: string): string[] {
  const vals = fd.getAll(key);
  const ids = vals
    .map((x) => String(x).trim())
    .filter((x) => x.length > 0);

  // de-dupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeLocationNumber(raw: string): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;

  // Keep as string (preserve leading zeros like "01")
  // Allow digits-only by default; if you truly need letters later, remove this.
  if (!/^\d+$/.test(v)) return null;

  return v;
}

function normalizeCorporationNumber(raw: string): string | null {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  if (!/^[A-Za-z0-9-]+$/.test(v)) return null;
  return v;
}

export default async function AdminLocationsPage({ searchParams }: { searchParams?: SearchParams }) {
  await requireAdmin();

  const sp = searchParams ?? {};
  const q = norm(sp.q);
  const okMsg = norm(sp.ok);
  const errMsg = norm(sp.err);

  const bulkFormId = "bulkDeleteLocations";

  async function createLocationAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const raw = String(formData.get("name") ?? "");
    const name = normalizeLocationName(raw);
    const locationNumber = normalizeLocationNumber(String(formData.get("locationNumber") ?? ""));
    const corporationNumber = normalizeCorporationNumber(String(formData.get("corporationNumber") ?? ""));

    if (!name) redirect("/admin/locations?err=" + encodeURIComponent("Name is required"));

    try {
      await prisma.location.create({
        data: { name, active: true, locationNumber, corporationNumber },
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        redirect("/admin/locations?err=" + encodeURIComponent("That Location # is already in use."));
      }

      const msg = e instanceof Error ? e.message : "Create failed";
      const friendly =
        msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("constraint")
          ? "That location name (or number) already exists."
          : msg;

      redirect("/admin/locations?err=" + encodeURIComponent(friendly));
    }

    revalidatePath("/admin/locations");
    revalidatePath("/admin/users");
    revalidatePath("/maintenance/checkout");
    redirect("/admin/locations?ok=" + encodeURIComponent("Created"));
  }

  async function bulkAddLocationsAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const raw = String(formData.get("bulk") ?? "");
    const names = parseBulkNames(raw);

    if (names.length === 0) {
      redirect("/admin/locations?err=" + encodeURIComponent("Paste one or more location names."));
    }
    if (names.length > 500) {
      redirect("/admin/locations?err=" + encodeURIComponent("Too many locations at once (max 500)."));
    }

    let createdCount = 0;
    let reactivatedCount = 0;

    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.location.findMany({
          where: { name: { in: names } },
          select: { name: true, active: true },
        });

        const existingByName = new Map(existing.map((l) => [l.name, l] as const));

        const toCreate = names
          .filter((n) => !existingByName.has(n))
          .map((n) => ({ name: n, active: true }));

        const toReactivate = existing.filter((l) => !l.active).map((l) => l.name);

        if (toReactivate.length > 0) {
          const res = await tx.location.updateMany({
            where: { name: { in: toReactivate }, active: false },
            data: { active: true },
          });
          reactivatedCount = res.count;
        }

        if (toCreate.length > 0) {
          const res = await tx.location.createMany({
            data: toCreate,
            skipDuplicates: true,
          });
          createdCount = res.count;
        }
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Bulk add failed";
      redirect("/admin/locations?err=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/locations");
    revalidatePath("/admin/users");
    revalidatePath("/maintenance/checkout");

    const summary = `Bulk add complete. Created: ${createdCount}. Reactivated: ${reactivatedCount}.`;
    redirect("/admin/locations?ok=" + encodeURIComponent(summary));
  }

  async function importLocationsCsvAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const file = formData.get("file");
    if (!(file instanceof File)) {
      redirect("/admin/locations?err=" + encodeURIComponent("Missing file."));
    }
    if (file.size === 0) {
      redirect("/admin/locations?err=" + encodeURIComponent("Empty file."));
    }
    if (file.size > 2_000_000) {
      redirect("/admin/locations?err=" + encodeURIComponent("File too large (max 2MB)."));
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      redirect("/admin/locations?err=" + encodeURIComponent("Could not read file."));
    }

    const names = parseNamesFromCsvText(text);
    if (names.length === 0) {
      redirect("/admin/locations?err=" + encodeURIComponent("No location names found in file."));
    }
    if (names.length > 2000) {
      redirect("/admin/locations?err=" + encodeURIComponent("Too many rows (max 2000)."));
    }

    let createdCount = 0;
    let reactivatedCount = 0;

    try {
      await prisma.$transaction(async (tx) => {
        const existing = await tx.location.findMany({
          where: { name: { in: names } },
          select: { name: true, active: true },
        });

        const existingByName = new Map(existing.map((l) => [l.name, l] as const));

        const toCreate = names
          .filter((n) => !existingByName.has(n))
          .map((n) => ({ name: n, active: true }));

        const toReactivate = existing.filter((l) => !l.active).map((l) => l.name);

        if (toReactivate.length > 0) {
          const res = await tx.location.updateMany({
            where: { name: { in: toReactivate }, active: false },
            data: { active: true },
          });
          reactivatedCount = res.count;
        }

        if (toCreate.length > 0) {
          const res = await tx.location.createMany({
            data: toCreate,
            skipDuplicates: true,
          });
          createdCount = res.count;
        }
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "CSV import failed";
      redirect("/admin/locations?err=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/locations");
    revalidatePath("/admin/users");
    revalidatePath("/maintenance/checkout");

    const summary = `CSV import complete. Created: ${createdCount}. Reactivated: ${reactivatedCount}.`;
    redirect("/admin/locations?ok=" + encodeURIComponent(summary));
  }

  async function renameLocationAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = String(formData.get("id") ?? "").trim();
    const raw = String(formData.get("name") ?? "");
    const name = normalizeLocationName(raw);

    if (!id) redirect("/admin/locations?err=" + encodeURIComponent("Missing id"));
    if (!name) redirect("/admin/locations?err=" + encodeURIComponent("Name is required"));

    try {
      await prisma.location.update({
        where: { id },
        data: { name },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Update failed";
      const friendly =
        msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("constraint")
          ? "That location name already exists."
          : msg;
      redirect("/admin/locations?err=" + encodeURIComponent(friendly));
    }

    revalidatePath("/admin/locations");
    revalidatePath("/admin/users");
    revalidatePath("/maintenance/checkout");
    redirect("/admin/locations?ok=" + encodeURIComponent("Saved"));
  }

  async function setLocationNumberAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) redirect("/admin/locations?err=" + encodeURIComponent("Missing id"));

    const numRaw = String(formData.get("locationNumber") ?? "");
    const locationNumber = normalizeLocationNumber(numRaw);

    // If user typed non-digits, treat as error (don’t silently wipe)
    const trimmed = numRaw.trim();
    if (trimmed && locationNumber === null) {
      redirect("/admin/locations?err=" + encodeURIComponent("Location # must be digits only (e.g. 01)."));
    }

    try {
      await prisma.location.update({
        where: { id },
        data: { locationNumber },
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        redirect("/admin/locations?err=" + encodeURIComponent("That Location # is already in use."));
      }
      const msg = e instanceof Error ? e.message : "Update failed";
      redirect("/admin/locations?err=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/locations");
    revalidatePath("/admin/users");
    revalidatePath("/maintenance/checkout");
    redirect("/admin/locations?ok=" + encodeURIComponent("Saved"));
  }

  async function setCorporationNumberAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = String(formData.get("id") ?? "").trim();
    if (!id) redirect("/admin/locations?err=" + encodeURIComponent("Missing id"));

    const corpRaw = String(formData.get("corporationNumber") ?? "");
    const corporationNumber = normalizeCorporationNumber(corpRaw);
    const trimmed = corpRaw.trim();
    if (trimmed && corporationNumber === null) {
      redirect("/admin/locations?err=" + encodeURIComponent("Corporation # must be letters/numbers/hyphen only."));
    }

    try {
      await prisma.location.update({
        where: { id },
        data: { corporationNumber },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Update failed";
      redirect("/admin/locations?err=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/locations");
    revalidatePath("/admin/users");
    revalidatePath("/maintenance/checkout");
    redirect("/admin/locations?ok=" + encodeURIComponent("Saved"));
  }

  async function toggleActiveAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = String(formData.get("id") ?? "").trim();
    const nextActive = String(formData.get("nextActive") ?? "").trim() === "true";

    if (!id) redirect("/admin/locations?err=" + encodeURIComponent("Missing id"));

    try {
      await prisma.location.update({
        where: { id },
        data: { active: nextActive },
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Update failed";
      redirect("/admin/locations?err=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/locations");
    revalidatePath("/admin/users");
    revalidatePath("/maintenance/checkout");
    redirect("/admin/locations?ok=" + encodeURIComponent("Saved"));
  }

  async function deleteLocationAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const id = String(formData.get("id") ?? "").trim();
    const confirm = String(formData.get("confirm") ?? "").trim().toUpperCase();
    if (!id) redirect("/admin/locations?err=" + encodeURIComponent("Missing id"));
    if (confirm !== "DELETE") redirect("/admin/locations?err=" + encodeURIComponent('Type "DELETE" to confirm.'));

    try {
      await prisma.location.delete({ where: { id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Delete failed";
      redirect("/admin/locations?err=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/locations");
    revalidatePath("/admin/users");
    revalidatePath("/maintenance/checkout");
    redirect("/admin/locations?ok=" + encodeURIComponent("Deleted"));
  }

  async function deleteSelectedLocationsAction(formData: FormData) {
    "use server";
    await requireAdmin();

    const confirm = String(formData.get("confirmBulk") ?? "").trim().toUpperCase();
    if (confirm !== "DELETE") {
      redirect("/admin/locations?err=" + encodeURIComponent('Type "DELETE" to confirm bulk deletion.'));
    }

    const ids = safeIdsFromFormData(formData, "deleteIds");
    if (ids.length === 0) {
      redirect("/admin/locations?err=" + encodeURIComponent("No locations selected."));
    }
    if (ids.length > 2000) {
      redirect("/admin/locations?err=" + encodeURIComponent("Too many selected locations (max 2000)."));
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Delete will fail if restricted by FK (WorkOrders / Checkouts etc). Transaction ensures atomicity.
        await tx.location.deleteMany({ where: { id: { in: ids } } });
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Bulk delete failed";
      redirect("/admin/locations?err=" + encodeURIComponent(msg));
    }

    revalidatePath("/admin/locations");
    revalidatePath("/admin/users");
    revalidatePath("/maintenance/checkout");
    redirect("/admin/locations?ok=" + encodeURIComponent(`Deleted ${ids.length} location(s).`));
  }

  const where = q
    ? {
        name: { contains: q, mode: "insensitive" as const },
      }
    : {};

  const locations = await prisma.location.findMany({
    where,
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, locationNumber: true, corporationNumber: true, createdAt: true, active: true },
  });

  const thStyle: CSSProperties = {
    textAlign: "left",
    padding: 10,
    borderBottom: "1px solid rgba(128,128,128,0.25)",
    fontSize: 12,
    opacity: 0.85,
    whiteSpace: "nowrap",
  };

  const tdStyle: CSSProperties = { padding: 10, whiteSpace: "nowrap" };

  return (
    <div style={{ padding: 16, width: "100%", margin: "0 auto" }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 10 }}>Admin: Locations</h1>

      {errMsg ? (
        <div style={{ padding: 10, marginBottom: 10, border: "1px solid rgba(255,0,0,0.35)", borderRadius: 10 }}>
          ❌ {errMsg}
        </div>
      ) : null}

      {okMsg ? (
        <div style={{ padding: 10, marginBottom: 10, border: "1px solid rgba(128,128,128,0.25)", borderRadius: 10 }}>
          ✅ {okMsg}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <form method="get" action="/admin/locations" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search locations..."
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
              minWidth: 260,
            }}
          />
          <button type="submit" style={{ padding: "8px 10px", fontWeight: 900 }}>
            Search
          </button>

          <Link href="/admin/locations" style={{ padding: "8px 10px", textDecoration: "underline" }}>
            Reset
          </Link>
        </form>

        <a
          href="/api/admin/locations/export"
          target="_blank"
          rel="noreferrer"
          style={{
            marginLeft: "auto",
            padding: "8px 10px",
            fontWeight: 900,
            borderRadius: 10,
            border: "1px solid rgba(128,128,128,0.25)",
            textDecoration: "none",
            color: "var(--foreground)",
            background: "var(--background)",
            whiteSpace: "nowrap",
          }}
          title="Download locations CSV"
        >
          Export CSV
        </a>
      </div>

      {/* BULK DELETE BAR */}
      <div
        style={{
          padding: 12,
          border: "1px solid rgba(128,128,128,0.25)",
          borderRadius: 12,
          background: "var(--background)",
          color: "var(--foreground)",
          marginBottom: 14,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 12, opacity: 0.8 }}>
          Bulk delete: select locations in the table, then type <code>DELETE</code>.
        </div>

        <form id={bulkFormId} action={deleteSelectedLocationsAction} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            name="confirmBulk"
            placeholder="DELETE"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
              width: 140,
            }}
          />
          <button
            type="submit"
            style={{
              padding: "8px 10px",
              fontWeight: 900,
              borderRadius: 10,
              border: "1px solid rgba(220,60,60,0.45)",
              background: "rgba(220,60,60,0.16)",
              color: "var(--foreground)",
              cursor: "pointer",
            }}
          >
            Delete Selected
          </button>
        </form>
      </div>

      {/* Create single */}
      <div
        style={{
          padding: 12,
          border: "1px solid rgba(128,128,128,0.25)",
          borderRadius: 12,
          background: "var(--background)",
          color: "var(--foreground)",
          marginBottom: 14,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>Create Location</h2>

        <form action={createLocationAction} style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            name="locationNumber"
            placeholder="Loc # (e.g. 01)"
            inputMode="numeric"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
              width: 140,
            }}
          />
          <input
            name="corporationNumber"
            placeholder="Corp #"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
              width: 140,
            }}
          />
          <input
            name="name"
            placeholder="Location name (e.g. KINGSPORT)"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
              minWidth: 280,
            }}
            required
          />
          <button type="submit" style={{ padding: "8px 10px", fontWeight: 900 }}>
            Create
          </button>
        </form>

        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
          Names are normalized to uppercase and single-spaced. Location # is digits-only and preserves leading zeros.
        </div>
      </div>

      {/* Bulk add */}
      <div
        style={{
          padding: 12,
          border: "1px solid rgba(128,128,128,0.25)",
          borderRadius: 12,
          background: "var(--background)",
          color: "var(--foreground)",
          marginBottom: 14,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>Bulk Add Locations</h2>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
          Paste names separated by new lines or commas. Existing inactive matches will be reactivated.
        </div>

        <form action={bulkAddLocationsAction} style={{ marginTop: 10, display: "grid", gap: 10 }}>
          <textarea
            name="bulk"
            rows={8}
            placeholder={"KINGSPORT\nLEE HWY\nABINGDON\n..."}
            style={{
              padding: "10px 10px",
              borderRadius: 10,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
              width: "100%",
              resize: "vertical",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
              fontSize: 13,
            }}
          />
          <button type="submit" style={{ padding: "8px 10px", fontWeight: 900, width: 220 }}>
            Bulk Add
          </button>
        </form>
      </div>

      {/* CSV import */}
      <div
        style={{
          padding: 12,
          border: "1px solid rgba(128,128,128,0.25)",
          borderRadius: 12,
          background: "var(--background)",
          color: "var(--foreground)",
          marginBottom: 14,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 900, margin: 0 }}>Import Locations (CSV)</h2>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
          CSV should include a <code>name</code> column. Existing inactive matches will be reactivated.
        </div>

        <form action={importLocationsCsvAction} style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            style={{
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(128,128,128,0.25)",
              background: "var(--background)",
              color: "var(--foreground)",
            }}
            required
          />
          <button type="submit" style={{ padding: "8px 10px", fontWeight: 900 }}>
            Import CSV
          </button>
        </form>

        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
          Supported formats:
          <ul style={{ marginTop: 6, marginBottom: 0, paddingLeft: 18 }}>
            <li>
              Header CSV: <code>name</code>
            </li>
            <li>Single column CSV</li>
            <li>Newline list (no commas)</li>
          </ul>
        </div>
      </div>

      {/* Table */}
      <div
        style={{
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          border: "1px solid rgba(128,128,128,0.25)",
          borderRadius: 12,
          paddingBottom: 4, // helps make the horizontal scrollbar easier to grab
        }}
      >
        <table style={{ width: "100%", minWidth: 1180, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Select", "Loc #", "Corp #", "Name", "Active", "Created", "Rename", "Set #", "Set Corp #", "Toggle", "Delete"].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid rgba(128,128,128,0.15)" }}>
                {/* BULK SELECT (attached to bulk form via form=) */}
                <td style={tdStyle}>
                  <input type="checkbox" name="deleteIds" value={l.id} form={bulkFormId} />
                </td>

                <td style={{ ...tdStyle, fontWeight: 900, width: 90 }}>{l.locationNumber ? l.locationNumber : "—"}</td>

                <td style={{ ...tdStyle, fontWeight: 900, width: 110 }}>{l.corporationNumber ? l.corporationNumber : "—"}</td>

                <td style={{ ...tdStyle, fontWeight: 800, minWidth: 180 }}>{l.name}</td>

                <td style={tdStyle}>
                  <span style={{ fontWeight: 900 }}>{l.active ? "YES" : "NO"}</span>
                </td>

                <td style={tdStyle}>{new Date(l.createdAt).toLocaleString()}</td>

                <td style={{ padding: 10, minWidth: 320 }}>
                  <form action={renameLocationAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input type="hidden" name="id" value={l.id} />
                    <input
                      name="name"
                      defaultValue={l.name}
                      style={{
                        padding: "6px 8px",
                        borderRadius: 10,
                        border: "1px solid rgba(128,128,128,0.25)",
                        background: "var(--background)",
                        color: "var(--foreground)",
                        minWidth: 220,
                      }}
                    />
                    <button type="submit" style={{ padding: "6px 10px", fontWeight: 900 }}>
                      Save
                    </button>
                  </form>
                </td>

                <td style={{ padding: 10, minWidth: 240 }}>
                  <form
                    action={setLocationNumberAction}
                    style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
                  >
                    <input type="hidden" name="id" value={l.id} />
                    <input
                      name="locationNumber"
                      defaultValue={l.locationNumber ?? ""}
                      placeholder="e.g. 01"
                      inputMode="numeric"
                      style={{
                        padding: "6px 8px",
                        borderRadius: 10,
                        border: "1px solid rgba(128,128,128,0.25)",
                        background: "var(--background)",
                        color: "var(--foreground)",
                        width: 120,
                      }}
                    />
                    <button type="submit" style={{ padding: "6px 10px", fontWeight: 900 }}>
                      Save
                    </button>
                  </form>
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>Used for invoicing. Blank = not ready.</div>
                </td>

                <td style={{ padding: 10, minWidth: 240 }}>
                  <form
                    action={setCorporationNumberAction}
                    style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}
                  >
                    <input type="hidden" name="id" value={l.id} />
                    <input
                      name="corporationNumber"
                      defaultValue={l.corporationNumber ?? ""}
                      placeholder="Corp #"
                      style={{
                        padding: "6px 8px",
                        borderRadius: 10,
                        border: "1px solid rgba(128,128,128,0.25)",
                        background: "var(--background)",
                        color: "var(--foreground)",
                        width: 120,
                      }}
                    />
                    <button type="submit" style={{ padding: "6px 10px", fontWeight: 900 }}>
                      Save
                    </button>
                  </form>
                </td>

                <td style={tdStyle}>
                  <form action={toggleActiveAction} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input type="hidden" name="id" value={l.id} />
                    <input type="hidden" name="nextActive" value={l.active ? "false" : "true"} />
                    <button type="submit" style={{ padding: "6px 10px", fontWeight: 900 }}>
                      {l.active ? "Make Inactive" : "Make Active"}
                    </button>
                  </form>
                </td>

                <td style={tdStyle}>
                  <details>
                    <summary style={{ cursor: "pointer", fontWeight: 900 }}>Delete</summary>
                    <form action={deleteLocationAction} style={{ marginTop: 8, display: "grid", gap: 8, maxWidth: 260 }}>
                      <input type="hidden" name="id" value={l.id} />
                      <div style={{ fontSize: 12, opacity: 0.85 }}>
                        Type <code>DELETE</code> to confirm.
                      </div>
                      <input
                        name="confirm"
                        placeholder="DELETE"
                        style={{
                          padding: "6px 8px",
                          borderRadius: 10,
                          border: "1px solid rgba(128,128,128,0.25)",
                          background: "var(--background)",
                          color: "var(--foreground)",
                        }}
                      />
                      <button type="submit" style={{ padding: "6px 10px", fontWeight: 900 }}>
                        Permanently Delete
                      </button>
                    </form>
                  </details>
                </td>
              </tr>
            ))}

            {locations.length === 0 ? (
              <tr>
                <td colSpan={11} style={{ padding: 14, opacity: 0.8 }}>
                  No locations found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 10 }}>
        Tip: if actions are off-screen, scroll horizontally inside the table area. Inactive locations are hidden from
        assignment pick-lists and maintenance checkout store selection.
      </div>
    </div>
    
  );
}