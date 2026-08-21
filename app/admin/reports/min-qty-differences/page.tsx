import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { authOptions } from "@/app/lib/auth";
import { formatMinQtyForecastWindow, loadAppConfig, saveAppConfig } from "@/app/lib/app-config";
import { getInventoryDemandRecommendations, recalculateItemMinQuantitiesFromFullHistory } from "@/app/lib/inventory-demand";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import { prisma } from "@/app/lib/prisma";
import { InvoiceVendor, Permission, Role } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
    role?: Role | null;
  } | null;
} | null;

type SearchParams = {
  q?: string;
  ok?: string;
  error?: string;
};

function qs(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) continue;
    search.set(key, trimmed);
  }
  const out = search.toString();
  return out ? `?${out}` : "";
}

function isNextRedirectError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT");
}

function normalizeExternalUrl(value: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function vendorLabel(vendor: InvoiceVendor) {
  return vendor === "AMERICAN_PLUS" ? "American Plus" : "Success Plus";
}

function matchesQuery(query: string, ...parts: Array<unknown>) {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = parts
    .map((part) => String(part ?? "").toLowerCase())
    .join(" ");
  return tokens.every((token) => haystack.includes(token));
}

async function requireReportView() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) redirect("/login");

  const perms = await loadUserPermissions(session);
  if (perms.allowAll) return { perms };

  const ok = hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!ok) redirect("/");

  return { perms };
}

export default async function MinQtyDifferencesReportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { perms } = await requireReportView();
  const canEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);

  const sp = await searchParams;
  const query = String(sp.q ?? "").trim();
  const okMsg = String(sp.ok ?? "").trim();
  const errorMsg = String(sp.error ?? "").trim();
  const exportHref = `/api/admin/reports/excel${qs({ report: "min-qty-differences", q: query || undefined })}`;
  const { config: appConfig } = await loadAppConfig();
  const forecastLabel = formatMinQtyForecastWindow(appConfig.minQtyForecastMonths);

  async function applySuggestedMinAction(formData: FormData) {
    "use server";

    const qBack = String(formData.get("q") ?? "").trim();
    const itemId = String(formData.get("itemId") ?? "").trim();

    try {
      const { perms } = await requireReportView();
      const canEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
      if (!canEdit) throw new Error("Forbidden");
      if (!itemId) throw new Error("Missing item id.");

      const result = await recalculateItemMinQuantitiesFromFullHistory({ itemIds: [itemId] });

      revalidatePath("/admin/reports/min-qty-differences");
      revalidatePath("/admin/items");
      revalidatePath(`/admin/items/${itemId}/inventory`);

      const message =
        result.updatedCount > 0
          ? `${result.recommendations[0]?.forecastLabel ?? forecastLabel} suggested min qty copied to min qty.`
          : `This item already matches the ${result.recommendations[0]?.forecastLabel ?? forecastLabel} suggested min qty.`;

      redirect(
        `/admin/reports/min-qty-differences${qs({
          q: qBack || undefined,
          ok: message,
        })}`
      );
    } catch (error: unknown) {
      if (isNextRedirectError(error)) throw error;
      const message = error instanceof Error ? error.message : "Failed to copy suggested min qty.";
      redirect(
        `/admin/reports/min-qty-differences${qs({
          q: qBack || undefined,
          error: message,
        })}`
      );
    }
  }

  async function applyAllSuggestedMinAction(formData: FormData) {
    "use server";

    const qBack = String(formData.get("q") ?? "").trim();
    const itemIds = Array.from(
      new Set(
        formData
          .getAll("itemIds")
          .map((value) => String(value ?? "").trim())
          .filter(Boolean)
      )
    );

    try {
      const { perms } = await requireReportView();
      const canEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
      if (!canEdit) throw new Error("Forbidden");
      if (itemIds.length === 0) throw new Error("No items in the current report to update.");

      const result = await recalculateItemMinQuantitiesFromFullHistory({ itemIds });

      revalidatePath("/admin/reports/min-qty-differences");
      revalidatePath("/admin/items");
      for (const itemId of itemIds) {
        revalidatePath(`/admin/items/${itemId}/inventory`);
      }

      const message =
        result.updatedCount > 0
          ? `Copied ${result.recommendations[0]?.forecastLabel ?? forecastLabel} suggested min qty for ${result.updatedCount} item${result.updatedCount === 1 ? "" : "s"}.`
          : `All items in this report already match the ${result.recommendations[0]?.forecastLabel ?? forecastLabel} suggested min qty.`;

      redirect(
        `/admin/reports/min-qty-differences${qs({
          q: qBack || undefined,
          ok: message,
        })}`
      );
    } catch (error: unknown) {
      if (isNextRedirectError(error)) throw error;
      const message = error instanceof Error ? error.message : "Failed to copy suggested min qty for this report.";
      redirect(
        `/admin/reports/min-qty-differences${qs({
          q: qBack || undefined,
          error: message,
        })}`
      );
    }
  }

  async function updateSuggestedMinAction(formData: FormData) {
    "use server";

    const qBack = String(formData.get("q") ?? "").trim();
    const itemId = String(formData.get("itemId") ?? "").trim();

    try {
      const { perms } = await requireReportView();
      const canEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
      if (!canEdit) throw new Error("Forbidden");
      if (!itemId) throw new Error("Missing item id.");

      const useAutomatic = String(formData.get("mode") ?? "") === "automatic";
      let suggestedMinQtyOverride: number | null = null;

      if (!useAutomatic) {
        const rawValue = String(formData.get("suggestedMinQty") ?? "").trim();
        const parsedValue = Number(rawValue);
        if (!rawValue || !Number.isInteger(parsedValue) || parsedValue < 0 || parsedValue > 2_147_483_647) {
          throw new Error("Suggested min qty must be a whole number greater than or equal to 0.");
        }
        suggestedMinQtyOverride = parsedValue;
      }

      await prisma.item.update({
        where: { id: itemId },
        data: { suggestedMinQtyOverride },
      });

      revalidatePath("/admin/reports/min-qty-differences");
      revalidatePath("/admin/items");
      revalidatePath("/inventory");
      revalidatePath(`/admin/items/${itemId}/inventory`);

      redirect(
        `/admin/reports/min-qty-differences${qs({
          q: qBack || undefined,
          ok: useAutomatic ? "Suggested min qty returned to automatic calculation." : "Suggested min qty override saved.",
        })}`
      );
    } catch (error: unknown) {
      if (isNextRedirectError(error)) throw error;
      const message = error instanceof Error ? error.message : "Failed to update suggested min qty.";
      redirect(
        `/admin/reports/min-qty-differences${qs({
          q: qBack || undefined,
          error: message,
        })}`
      );
    }
  }

  async function updateForecastMonthsAction(formData: FormData) {
    "use server";

    const qBack = String(formData.get("q") ?? "").trim();

    try {
      const { perms } = await requireReportView();
      const canEdit = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_EDIT_ITEMS]);
      if (!canEdit) throw new Error("Forbidden");

      const rawMonths = String(formData.get("forecastMonths") ?? "").trim();
      const forecastMonths = Number(rawMonths);
      if (!rawMonths || !Number.isInteger(forecastMonths) || forecastMonths < 1 || forecastMonths > 1200) {
        throw new Error("Forecast months must be a whole number from 1 to 1200.");
      }

      const { config } = await loadAppConfig();
      const result = await saveAppConfig({ ...config, minQtyForecastMonths: forecastMonths });
      if (!result.saved) throw new Error(result.error ?? "Failed to save forecast months.");

      revalidatePath("/admin/reports/min-qty-differences");
      revalidatePath("/admin/items");
      revalidatePath("/inventory");
      revalidatePath("/admin/inventory-orders");

      redirect(
        `/admin/reports/min-qty-differences${qs({
          q: qBack || undefined,
          ok: `Suggested Min Qty forecast changed to ${formatMinQtyForecastWindow(forecastMonths)}.`,
        })}`
      );
    } catch (error: unknown) {
      if (isNextRedirectError(error)) throw error;
      const message = error instanceof Error ? error.message : "Failed to update forecast months.";
      redirect(`/admin/reports/min-qty-differences${qs({ q: qBack || undefined, error: message })}`);
    }
  }

  const items = await prisma.item.findMany({
    where: { active: true },
    select: {
      id: true,
      name: true,
      partNumber: true,
      sku: true,
      vendor: true,
      orderFrom: true,
      webUrl: true,
      onHandQty: true,
      minQty: true,
    },
    orderBy: [{ name: "asc" }, { sku: "asc" }],
  });

  const recommendations = await getInventoryDemandRecommendations({
    itemIds: items.map((item) => item.id),
  });
  const recommendationMap = new Map(recommendations.map((entry) => [entry.itemId, entry]));

  const rows = items
    .map((item) => {
      const recommendation = recommendationMap.get(item.id);
      if (!recommendation) return null;
      if (!recommendation.compareMinQty) return null;
      if (item.minQty === recommendation.suggestedMinQty90Day) return null;

      const displayVendor = vendorLabel(item.vendor);
      return {
        id: item.id,
        name: item.name,
        partNumber: item.partNumber,
        sku: item.sku,
        vendor: displayVendor,
        supplier: item.orderFrom,
        webUrl: item.webUrl,
        onHandQty: item.onHandQty,
        minQty: item.minQty,
        suggestedMinQty: recommendation.suggestedMinQty90Day,
        calculatedSuggestedMinQty: recommendation.calculatedSuggestedMinQty90Day,
        isSuggestedMinQtyOverridden: recommendation.isSuggestedMinQtyOverridden,
        delta: recommendation.suggestedMinQty90Day - item.minQty,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter((row) =>
      matchesQuery(query, row.name, row.partNumber, row.sku, row.vendor, row.supplier, row.webUrl, row.minQty, row.suggestedMinQty)
    )
    .sort((left, right) => {
      const deltaDiff = Math.abs(right.delta) - Math.abs(left.delta);
      if (deltaDiff !== 0) return deltaDiff;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });

  const totalDiff = rows.reduce((sum, row) => sum + Math.abs(row.delta), 0);
  const border = "1px solid var(--border)";
  const cardBg = "var(--surface)";
  const panelBg = "var(--surface-2)";
  const shellWidth = "min(100%, 1800px)";

  return (
    <main>
      <div style={{ width: shellWidth, margin: "0 auto", color: "var(--foreground)" }}>
        <section
          style={{
            border,
            borderRadius: 16,
            background: "linear-gradient(150deg, color-mix(in srgb, var(--brand) 12%, var(--surface)) 0%, var(--surface) 72%)",
            boxShadow: "var(--shadow)",
            padding: 18,
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <h1 style={{ fontSize: 30, fontWeight: 900, margin: 0 }}>Min Qty Differences</h1>
            <Link
              href="/admin/reports"
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border,
                background: panelBg,
                color: "var(--foreground)",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              ← Report Hub
            </Link>
            <Link
              href={exportHref}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border,
                background: panelBg,
                color: "var(--foreground)",
                textDecoration: "none",
                fontWeight: 900,
              }}
            >
              Export Excel
            </Link>
          </div>

          <p style={{ margin: "10px 0 0", color: "var(--muted)", maxWidth: 880, lineHeight: 1.5 }}>
            Active items where the current minimum quantity does not match the suggested stock for the next {forecastLabel}, based on full usage history.
          </p>

          <form
            action={updateForecastMonthsAction}
            style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}
          >
            <input type="hidden" name="q" value={query} />
            <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 900 }}>
              Suggested Min Qty forecast months
              <input
                type="number"
                name="forecastMonths"
                min={1}
                max={1200}
                step={1}
                required
                defaultValue={appConfig.minQtyForecastMonths}
                disabled={!canEdit}
                style={{
                  width: 150,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border,
                  background: panelBg,
                  color: "var(--foreground)",
                  fontWeight: 900,
                }}
              />
            </label>
            {canEdit ? (
              <button
                type="submit"
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border,
                  background: panelBg,
                  color: "var(--foreground)",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Apply Timeframe
              </button>
            ) : null}
            <span style={{ paddingBottom: 10, fontSize: 12, opacity: 0.72 }}>Applies app-wide</span>
          </form>

          <form method="get" style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search item, part number, SKU, vendor, supplier"
              aria-label="Search min qty differences"
              style={{
                minWidth: 280,
                flex: "1 1 360px",
                padding: "10px 12px",
                borderRadius: 12,
                border,
                background: panelBg,
                color: "var(--foreground)",
              }}
            />
            <button
              type="submit"
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border,
                background: panelBg,
                color: "var(--foreground)",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Search
            </button>
            {query ? (
              <Link
                href="/admin/reports/min-qty-differences"
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border,
                  background: panelBg,
                  color: "var(--foreground)",
                  textDecoration: "none",
                  fontWeight: 900,
                }}
              >
                Clear
              </Link>
            ) : null}
          </form>
        </section>

        {okMsg ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(22, 163, 74, 0.35)",
              background: "rgba(22, 163, 74, 0.12)",
            }}
          >
            <strong>OK</strong> {okMsg}
          </div>
        ) : null}

        {errorMsg ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(220, 38, 38, 0.35)",
              background: "rgba(220, 38, 38, 0.12)",
            }}
          >
            <strong>Error</strong> {errorMsg}
          </div>
        ) : null}

        <section style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          <div style={{ border, borderRadius: 16, background: cardBg, boxShadow: "var(--shadow)", padding: 14 }}>
            <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 900 }}>MISMATCHED ITEMS</div>
            <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{rows.length}</div>
          </div>
          <div style={{ border, borderRadius: 16, background: cardBg, boxShadow: "var(--shadow)", padding: 14 }}>
            <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 900 }}>TOTAL QTY DIFFERENCE</div>
            <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>{totalDiff}</div>
          </div>
        </section>

        {canEdit && rows.length > 0 ? (
          <section
            style={{
              marginTop: 12,
              border,
              borderRadius: 12,
              background: cardBg,
              boxShadow: "var(--shadow)",
              padding: 12,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <form action={applyAllSuggestedMinAction} style={{ display: "contents" }}>
              <input type="hidden" name="q" value={query} />
              {rows.map((row) => (
                <input key={row.id} type="hidden" name="itemIds" value={row.id} />
              ))}
              <button
                type="submit"
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(22, 163, 74, 0.35)",
                  background: "rgba(22, 163, 74, 0.12)",
                  color: "var(--foreground)",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Copy {forecastLabel} Suggested Min Qty for All Report Items
              </button>
            </form>
          </section>
        ) : null}

        <section style={{ marginTop: 14, border, borderRadius: 16, background: cardBg, boxShadow: "var(--shadow)", overflow: "hidden" }}>
          {rows.length === 0 ? (
            <div style={{ padding: 18, lineHeight: 1.5, opacity: 0.88 }}>
              {query ? "No items match your search." : `All active items already match the ${forecastLabel} suggested minimum.`}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "auto", minWidth: 1320 }}>
                <thead>
                  <tr>
                    {[
                      ["Item Name", "auto"],
                      ["Part Number", "auto"],
                      ["SKU", "auto"],
                      ["Vendor", "auto"],
                      ["On Hand", 90],
                      ["Min Qty", 90],
                      [`Suggested Min Qty (Next ${forecastLabel})`, 210],
                      ["Web Link", 110],
                      ["Action", 220],
                    ].map(([labelText, width]) => (
                      <th
                        key={labelText}
                        style={{
                          textAlign: "left",
                          padding: "12px 10px",
                          borderBottom: border,
                          fontSize: 12,
                          opacity: 0.8,
                          width,
                          minWidth: typeof width === "number" ? width : undefined,
                          whiteSpace: typeof width === "number" ? "nowrap" : undefined,
                        }}
                      >
                        {labelText}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const itemUrl = normalizeExternalUrl(row.webUrl);
                    return (
                      <tr key={row.id} style={{ borderBottom: border }}>
                        <td style={{ padding: 10, verticalAlign: "top" }}>
                          <div style={{ fontWeight: 800 }}>{row.name}</div>
                          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.78 }}>
                            <Link
                              href={`/admin/items/${row.id}/inventory`}
                              style={{ color: "var(--foreground)", textDecoration: "none" }}
                            >
                              Open inventory
                            </Link>
                          </div>
                        </td>
                        <td style={{ padding: 10, verticalAlign: "top", whiteSpace: "nowrap" }}>{row.partNumber || "—"}</td>
                        <td style={{ padding: 10, verticalAlign: "top", fontWeight: 700, whiteSpace: "nowrap" }}>{row.sku}</td>
                        <td style={{ padding: 10, verticalAlign: "top" }}>
                          <div>{row.vendor}</div>
                          <div style={{ marginTop: 4, fontSize: 12, opacity: 0.78 }}>{row.supplier || "—"}</div>
                        </td>
                        <td style={{ padding: 10, verticalAlign: "top" }}>{row.onHandQty}</td>
                        <td style={{ padding: 10, verticalAlign: "top" }}>{row.minQty}</td>
                        <td style={{ padding: 10, verticalAlign: "top" }}>
                          {canEdit ? (
                            <form action={updateSuggestedMinAction} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                              <input type="hidden" name="itemId" value={row.id} />
                              <input type="hidden" name="q" value={query} />
                              <input
                                type="number"
                                name="suggestedMinQty"
                                min={0}
                                max={2_147_483_647}
                                step={1}
                                required
                                defaultValue={row.suggestedMinQty}
                                aria-label={`Suggested min qty for ${row.name}`}
                                style={{
                                  width: 82,
                                  padding: "8px 9px",
                                  borderRadius: 9,
                                  border,
                                  background: panelBg,
                                  color: "var(--foreground)",
                                  fontWeight: 900,
                                }}
                              />
                              <button
                                type="submit"
                                style={{
                                  padding: "8px 10px",
                                  borderRadius: 9,
                                  border,
                                  background: panelBg,
                                  color: "var(--foreground)",
                                  fontWeight: 900,
                                  cursor: "pointer",
                                }}
                              >
                                Save
                              </button>
                              {row.isSuggestedMinQtyOverridden ? (
                                <button
                                  type="submit"
                                  name="mode"
                                  value="automatic"
                                  formNoValidate
                                  style={{
                                    padding: "8px 10px",
                                    borderRadius: 9,
                                    border,
                                    background: "transparent",
                                    color: "var(--foreground)",
                                    fontWeight: 800,
                                    cursor: "pointer",
                                  }}
                                >
                                  Use Auto
                                </button>
                              ) : null}
                              <span style={{ flexBasis: "100%", fontSize: 11, opacity: 0.7 }}>
                                {row.isSuggestedMinQtyOverridden
                                  ? `Manual override · Automatic: ${row.calculatedSuggestedMinQty}`
                                  : "Automatic calculation"}
                              </span>
                            </form>
                          ) : (
                            <>
                              <strong>{row.suggestedMinQty}</strong>
                              {row.isSuggestedMinQtyOverridden ? (
                                <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>Manual override</div>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td style={{ padding: 10, verticalAlign: "top" }}>
                          {itemUrl ? (
                            <a
                              href={itemUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: "inline-block",
                                padding: "8px 10px",
                                borderRadius: 10,
                                border,
                                background: panelBg,
                                color: "var(--foreground)",
                                fontWeight: 800,
                                textDecoration: "none",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Open
                            </a>
                          ) : (
                            <span style={{ opacity: 0.6 }}>—</span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: 10,
                            verticalAlign: "top",
                            whiteSpace: "nowrap",
                            wordBreak: "normal",
                            overflowWrap: "normal",
                          }}
                        >
                          {canEdit ? (
                            <form action={applySuggestedMinAction}>
                              <input type="hidden" name="itemId" value={row.id} />
                              <input type="hidden" name="q" value={query} />
                              <button
                                type="submit"
                                style={{
                                  padding: "8px 10px",
                                  borderRadius: 10,
                                  border: "1px solid rgba(22, 163, 74, 0.35)",
                                  background: "rgba(22, 163, 74, 0.12)",
                                  color: "var(--foreground)",
                                  fontWeight: 900,
                                  cursor: "pointer",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                Copy {forecastLabel} Suggested Min Qty
                              </button>
                            </form>
                          ) : (
                            <span style={{ opacity: 0.65 }}>View only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
