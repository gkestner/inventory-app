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
  return `https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=0&data=${encodeURIComponent(sku)}`;
}

export default async function ItemLabelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const role = (session.user as unknown as { role?: Role | null } | null)?.role ?? null;
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
  const orderedItems = items.slice().sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  return (
    <main className="labels-print-root">
      <style>{`
        @page {
          size: 3.5in 1.125in;
          margin: 0;
        }

        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            color: #000 !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          body * {
            visibility: hidden !important;
          }

          .labels-print-root,
          .labels-print-root * {
            visibility: visible !important;
          }

          .labels-print-root {
            position: fixed;
            inset: 0;
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            z-index: 2147483647;
          }

          .no-print {
            display: none !important;
          }

          .sheet {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
        }

        body {
          font-family: Arial, Helvetica, sans-serif;
          background: #f5f5f5;
          color: #000;
        }

        main {
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
          width: 3.5in;
          height: 1.125in;
          box-sizing: border-box;
          background: #fff !important;
          color: #000 !important;
          border: 1px solid #000;
          display: grid;
          grid-template-rows: auto 1fr auto;
          page-break-after: always;
          overflow: hidden;
          forced-color-adjust: none;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .label * {
          color: #000 !important;
          border-color: #000 !important;
        }

        .label:last-child {
          page-break-after: auto;
        }

        .sku {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 5px 1px;
        }

        .middle {
          border-top: 1px solid #000;
          border-bottom: 1px solid #000;
          display: grid;
          grid-template-columns: 0.95in 1fr;
          align-items: stretch;
          min-height: 0;
        }

        .qr {
          border-right: 1px solid #000;
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
          text-align: center;
          padding: 0 4px;
          line-height: 1.03;
        }

        .name {
          font-size: 9px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.2px;
        }

        .desc {
          margin-top: 1px;
          font-size: 7px;
          font-weight: 800;
          text-transform: uppercase;
        }

        .bottom {
          padding: 1px 5px;
          font-size: 7px;
          font-weight: 900;
          display: flex;
          align-items: center;
          justify-content: space-between;
          white-space: nowrap;
          gap: 6px;
        }

        .empty {
          border: 1px dashed #888;
          border-radius: 8px;
          padding: 16px;
          background: #fff !important;
          color: #111 !important;
          max-width: 520px;
          forced-color-adjust: none;
        }
      `}</style>

      <div className="no-print" style={{ padding: "12px 12px 0", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, opacity: 0.8 }}>Set printer to Dymo 3.5&quot; x 1 1/8&quot; label size.</span>
      </div>

      <div className="sheet">
        {orderedItems.length === 0 ? (
          <div className="empty">No items selected. Open Items and click “Print Label” or select rows and use “Print Selected Labels”. Use your browser print (Ctrl/Cmd+P).</div>
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
                  {item.description ? <div className="desc">({item.description})</div> : null}
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