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
        :root {
          --label-w: 3.5in;
          --label-h: 1.125in;
        }

        @page {
          margin: 0;
        }

        body {
          font-family: Arial, Helvetica, sans-serif;
          background: #f5f5f5;
        }

        .page {
          width: var(--label-w);
          height: var(--label-h);
          margin: 20px;
          background: white;
          border: 1px solid black;
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto 1fr auto;
        }

        .sku {
          font-size: 11px;
          font-weight: 800;
          padding: 2px 6px;
        }

        .middle {
          border-top: 1px solid black;
          border-bottom: 1px solid black;
          display: grid;
          grid-template-columns: .95in 1fr;
        }

        .qr {
          border-right: 1px solid black;
          display: grid;
          place-items: center;
        }

        .qr img {
          width: .8in;
          height: .8in;
        }

        .name-block {
          display: grid;
          align-content: center;
          justify-items: center;
          text-align: center;
        }

        .name {
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
        }

        .desc {
          font-size: 8px;
          font-weight: 800;
          text-transform: uppercase;
        }

        .bottom {
          display: flex;
          justify-content: space-between;
          padding: 2px 6px;
          font-size: 9px;
          font-weight: 900;
        }

        @media print {

          body * {
            visibility: hidden;
          }

          .labels-print-root,
          .labels-print-root * {
            visibility: visible;
          }

          .labels-print-root {
            position: absolute;
            left: 0;
            top: 0;
          }

          .page {
            margin: 0;
            border: none;
            width: var(--label-w);
            height: var(--label-h);

            page-break-after: always;
            break-after: page;
          }

          .page:last-child {
            page-break-after: auto;
          }
        }
      `}</style>

      {orderedItems.map((item) => (
        <div className="page" key={item.id}>
          <div className="sku">SKU: {item.sku}</div>

          <div className="middle">
            <div className="qr">
              <img src={qrImageUrl(item.sku)} alt="" />
            </div>

            <div className="name-block">
              <div className="name">{item.name}</div>
              {item.description && (
                <div className="desc">({item.description})</div>
              )}
            </div>
          </div>

          <div className="bottom">
            <span>ID# {deriveLabelIdFromSku(item.sku)}</span>
            <span>PART# {item.partNumber ?? "—"}</span>
          </div>
        </div>
      ))}
    </main>
  );
}