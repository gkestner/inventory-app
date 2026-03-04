import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

type SearchParams = {
  ids?: string | string[];
};

function first(v: string | string[] | undefined): string {
  if (!v) return "";
  return Array.isArray(v) ? v[0] ?? "" : v;
}

function parseIds(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    ),
  );
}

function deriveLabelIdFromSku(sku: string): string {
  const tail = sku.split("-").pop() ?? "";
  const digits = tail.replace(/\D+/g, "");
  if (!digits) return tail || sku;
  const trimmed = digits.replace(/^0+/, "");
  return trimmed || "0";
}

function qrImageUrl(sku: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=0&data=${encodeURIComponent(
    sku,
  )}`;
}

export default async function ItemLabelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role =
    (session.user as unknown as { role?: Role | null } | null)?.role ?? null;
  if (role !== Role.ADMIN) redirect("/");

  const sp = await searchParams;
  const ids = parseIds(first(sp.ids));

  const items = ids.length
    ? await prisma.item.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          partNumber: true,
        },
      })
    : [];

  const idOrder = new Map(ids.map((id, idx) => [id, idx]));
  const orderedItems = items
    .slice()
    .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  return (
    <main className="labels-print-root">
      <style>{`
        /* ============================
           DYMO 30252: 3.5" x 1.125"
           ============================ */
        :root {
          --label-w: 3.5in;
          --label-h: 1.125in;
          --border: 1px;
        }

        /* Page size hint (some drivers ignore; we still enforce exact block size) */
        @page {
          size: 3.5in 1.125in;
          margin: 0;
        }

        body {
          font-family: Arial, Helvetica, sans-serif;
          background: #f5f5f5;
          color: #000;
        }

        .sheet {
          display: grid;
          gap: 10px;
          padding: 12px;
          justify-content: start;
        }

        .label {
          width: var(--label-w);
          height: var(--label-h);
          box-sizing: border-box;
          background: #fff;
          color: #000;
          border: var(--border) solid #000;
          display: grid;
          grid-template-rows: auto 1fr auto;
          overflow: hidden;
        }

        .label * {
          color: #000;
          border-color: #000;
        }

        .sku {
          font-size: 11px;
          font-weight: 800;
          padding: 2px 6px 1px;
          line-height: 1.05;
        }

        .middle {
          border-top: var(--border) solid #000;
          border-bottom: var(--border) solid #000;
          display: grid;
          grid-template-columns: 0.95in 1fr;
          align-items: stretch;
          min-height: 0;
        }

        .qr {
          border-right: var(--border) solid #000;
          display: grid;
          place-items: center;
          overflow: hidden;
        }

        .qr img {
          width: 0.82in;
          height: 0.82in;
          display: block;
        }

        .name-block {
          display: grid;
          align-content: center;
          justify-items: center;
          text-align: center;
          padding: 0 6px;
          line-height: 1.05;
        }

        .name {
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.3px;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .desc {
          margin-top: 2px;
          font-size: 8px;
          font-weight: 800;
          text-transform: uppercase;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .bottom {
          padding: 1px 6px;
          font-size: 9px;
          font-weight: 900;
          display: flex;
          align-items: center;
          justify-content: space-between;
          white-space: nowrap;
          gap: 8px;
          line-height: 1.05;
        }

        .empty {
          border: 1px dashed #888;
          border-radius: 8px;
          padding: 16px;
          background: #fff;
          color: #111;
          max-width: 520px;
        }

        .no-print {
          display: block;
        }

        /* =========================
           PRINT: isolate + paginate
           ========================= */
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            color: #000 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* Hide everything, then show only our label root */
          body * {
            visibility: hidden !important;
          }

          .labels-print-root,
          .labels-print-root * {
            visibility: visible !important;
          }

          .labels-print-root {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }

          .no-print {
            display: none !important;
          }

          /* Remove screen padding/gaps so each label = each page */
          .sheet {
            padding: 0 !important;
            margin: 0 !important;
            gap: 0 !important;
          }

          /* Force each label to be a page-sized block */
          .label {
            width: var(--label-w) !important;
            height: var(--label-h) !important;

            margin: 0 !important;

            /* Hard page breaks so Chrome doesn't create blank pages */
            page-break-before: always !important;
            page-break-after: always !important;
            break-before: page !important;
            break-after: page !important;
            break-inside: avoid !important;

            overflow: hidden !important;
            forced-color-adjust: none;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .label:first-child {
            page-break-before: auto !important;
            break-before: auto !important;
          }

          .label:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
        }
      `}</style>

      <div
        className="no-print"
        style={{
          padding: "12px 12px 0",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, opacity: 0.85 }}>
          Print settings: <b>Scale 100</b>, <b>Margins None</b>, disable “Fit to
          page”. Paper: DYMO 30252 (3.5&quot; x 1 1/8&quot;).
        </span>
      </div>

      <div className="sheet">
        {orderedItems.length === 0 ? (
          <div className="empty">
            No items selected. Open Items and click “Print Label” or select rows
            and use “Print Selected Labels”. Use your browser print (Ctrl/Cmd+P).
          </div>
        ) : (
          orderedItems.map((item) => (
            <article className="label" key={item.id}>
              <div className="sku">SKU: {item.sku}</div>

              <div className="middle">
                <div className="qr">
                  <img src={qrImageUrl(item.sku)} alt={`QR for ${item.sku}`} />
                </div>

                <div className="name-block">
                  <div className="name">{item.name}</div>
                  {item.description ? (
                    <div className="desc">({item.description})</div>
                  ) : null}
                </div>
              </div>

              <div className="bottom">
                <span>ID# {deriveLabelIdFromSku(item.sku)}</span>
                <span>PART# {item.partNumber ?? "—"}</span>
              </div>
            </article>
          ))
        )}
      </div>
    </main>
  );
}