import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

type SearchParams = {
  ids?: string | string[];
  autoprint?: string;
  autoclose?: string;
  copies?: string;
  debug?: string | string[];
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

function qrImageUrl(data: string, size = 160): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(
    data,
  )}`;
}

export default async function ItemLabelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const debug = first(sp.debug) === "1";

  const session = await getServerSession(authOptions);
  if (!session && !debug) redirect("/login");

  const role =
    (session?.user as unknown as { role?: Role | null } | null)?.role ?? null;
  if (role !== Role.ADMIN && !debug) redirect("/");

  const ids = parseIds(first(sp.ids));
  const autoprint = first(sp.autoprint) === "1";
  const autoclose = first(sp.autoclose) === "1";
  const copiesRaw = parseInt(first(sp.copies) || "1", 10);
  const copies = Number.isFinite(copiesRaw) ? Math.max(1, Math.min(50, copiesRaw)) : 1;

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
      }).catch((err) => {
        console.error("Prisma error:", err);
        return [];
      })
    : [];

  console.log("Labels page", { ids, debug, itemsCount: items.length });

  // Preserve incoming order
  const idOrder = new Map(ids.map((id, idx) => [id, idx]));
  const orderedItems = items
    .slice()
    .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  // Expand copies on the server so print pagination is simple
  const printable = orderedItems.flatMap((it) =>
    Array.from({ length: copies }, (_, i) => ({ ...it, __copy: i + 1 })),
  );

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>Print Labels</title>

        <style>{`
          /* hide admin sidebar/nav added by parent layout */
          aside { display: none !important; }

          @page { margin: 0; }

          :root {
            --w: 3.5in;
            --h: 1.125in;
            --b: 2px;
          }

          html, body {
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
            font-family: Arial, Helvetica, sans-serif;
          }

          /* Each .label is exactly one "page" worth of content */
          .label-wrap {
            width: calc(var(--w) + 12px);
            height: calc(var(--h) + 12px);
            display: grid;
            place-items: center;
            padding: 6px;
            box-sizing: border-box;
          }

          .label {
            width: var(--w);
            height: var(--h);
            box-sizing: border-box;
            border: var(--b) solid #000;
            display: grid;
            grid-template-rows: auto 1fr auto;
            overflow: hidden;
            border-radius: 8px;
            background: #fff;

            page-break-after: always;
            break-after: page;
          }

          .label:last-child {
            page-break-after: auto;
            break-after: auto;
          }

          .sku {
            font-weight: 700;
            font-size: 11px;
            padding: 6px 8px 0 8px;
            align-self: start;
            justify-self: start;
            color: #222;
          }

          .mid {
            display: grid;
            grid-template-columns: 1.05in 1fr;
            min-height: 0;
            gap: 8px;
            padding: 6px 8px;
          }

          .qr {
            border-right: var(--b) solid #000;
            display: grid;
            place-items: center;
            padding: 4px;
          }

          .qr img {
            width: 0.9in;
            height: 0.9in;
            display: block;
          }

          .nameblock {
            display: grid;
            align-content: center;
            justify-items: center;
            text-align: center;
            padding: 0 10px;
            line-height: 1.05;
          }

          .name {
            font-weight: 900;
            font-size: 22px;
            text-transform: uppercase;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .desc {
            margin-top: 2px;
            font-weight: 800;
            font-size: 10px;
            text-transform: uppercase;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .bottom {
            border-top: var(--b) solid #000;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-weight: 900;
            font-size: 13px;
            padding: 6px 8px;
            white-space: nowrap;
            gap: 10px;
          }

          .idbox {
            border: 2px solid #000;
            padding: 2px 6px;
            font-weight: 900;
            display: inline-block;
          }

          /* Screen-only helper bar (hidden during print) */
          .bar {
            padding: 10px;
            border-bottom: 1px solid #eee;
            font-size: 13px;
            display: ${autoprint ? "none" : "block"};
          }

          @media print {
            .bar { display: none !important; }
          }
        `}</style>

        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                const AUTOPRINT = ${autoprint ? "true" : "false"};
                const AUTOCLOSE = ${autoclose ? "true" : "false"};

                // debug logging
                console.log("Label page debug", {
                  ids: ${JSON.stringify(ids)},
                  printable: ${printable.length},
                  autoprint: AUTOPRINT,
                  autoclose: AUTOCLOSE,
                  copies: ${copies},
                });

                function doPrint() {
                  // Small delay helps images (QR) settle
                  setTimeout(() => window.print(), 150);
                }

                // Press "P" to print again (warehouse muscle memory)
                window.addEventListener("keydown", (e) => {
                  if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    e.preventDefault();
                    doPrint();
                  }
                  if (e.key === "Escape" && AUTOCLOSE) {
                    window.close();
                  }
                });

                if (AUTOCLOSE) {
                  window.addEventListener("afterprint", () => {
                    setTimeout(() => window.close(), 200);
                  });
                }

                if (AUTOPRINT) {
                  // Wait for images before printing; fallback after 1200ms
                  const imgs = Array.from(document.images || []);
                  let done = false;

                  const finish = () => {
                    if (done) return;
                    done = true;
                    doPrint();
                  };

                  if (imgs.length === 0) {
                    finish();
                  } else {
                    let remaining = imgs.length;
                    const tick = () => {
                      remaining--;
                      if (remaining <= 0) finish();
                    };
                    imgs.forEach((img) => {
                      if (img.complete) return tick();
                      img.addEventListener("load", tick, { once: true });
                      img.addEventListener("error", tick, { once: true });
                    });
                    setTimeout(finish, 1200);
                  }
                }
              })();
            `,
          }}
        />
      </head>

      <body>
        {debug ? (
          <>
            <div style={{ padding: 8, background: "#ffeeda", color: "#000", fontSize: 13, border: '1px solid #000' }}>
              <strong>DEBUG MODE</strong> ids={JSON.stringify(ids)} printable={printable.length} autoprint={String(autoprint)} autoclose={String(autoclose)} copies={copies}
            </div>
            <div style={{color: 'red', fontSize: '20px', padding: '10px'}}>DEBUG: Labels page loaded successfully</div>
          </>
        ) : null}
        <div className="bar">
          Tip: press <b>P</b> to print. Press <b>Esc</b> to close.
        </div>

        {printable.length === 0 ? (
          <div style={{ padding: 14, fontSize: 14 }}>No items selected.</div>
        ) : (
          printable.map((item) => {
            const labelId = deriveLabelIdFromSku(item.sku);
            return (
              <div className="label-wrap" key={`${item.id}-${(item as any).__copy}`}>
                <div className="label">
                  <div className="sku">SKU: {item.sku}</div>

                  <div className="mid">
                    <div className="qr">
                      <img src={qrImageUrl(`Item ID: ${item.id}`)} alt={`Item ID: ${item.id}`} onError={(e) => {
                        const img = e.target as HTMLImageElement;
                        img.style.display = 'none';
                        const fallback = document.createElement('div');
                        fallback.textContent = `ID: ${labelId}`;
                        fallback.style.fontSize = '12px';
                        fallback.style.fontWeight = 'bold';
                        img.parentNode?.appendChild(fallback);
                      }} />
                    </div>

                    <div className="nameblock">
                      <div className="name">{item.name}</div>
                      {item.description ? (
                        <div className="desc">({item.description})</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="bottom">
                    <span className="idbox">ID# {labelId}</span>
                    <span>PART# {item.partNumber ?? "—"}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </body>
    </html>
  );
}