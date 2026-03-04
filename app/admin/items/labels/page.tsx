import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Script from "next/script";
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
  if (!sku) return "0";
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

  // Preserve incoming order
  const idOrder = new Map(ids.map((id, idx) => [id, idx]));
  const orderedItems = items
    .slice()
    .sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

  // Expand copies on the server so print pagination is simple
  const printable = orderedItems.flatMap((it) =>
    Array.from({ length: copies }, (_, i) => ({ ...it, __copy: i + 1 })),
  );

  // Short debug during development
  if (debug) {
    console.log("[labels page] ids:", ids, "printable:", printable.length);
  }

  return (
    <div className="labels-page">
      {debug ? (
        <div className="debug-bar">
          <strong>DEBUG</strong> ids={JSON.stringify(ids).slice(0, 50)} printable={printable.length} autoprint={String(autoprint)}
        </div>
      ) : null}
      <div className="bar" data-autoprint={autoprint}>
        Tip: press <b>P</b> to print. Press <b>Esc</b> to close.
      </div>

      {printable.length === 0 ? (
        <div style={{ padding: 14, fontSize: 14 }}>No items selected.</div>
      ) : (
        printable.map((item) => {
          const labelId = deriveLabelIdFromSku(item.sku);
          return (
            <div className="label" key={`${item.id}-${(item as any).__copy}`}>
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
          );
        })
      )}

      <Script
        id="labels-autoprint-script"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              const AUTOPRINT = ${autoprint ? "true" : "false"};
              const AUTOCLOSE = ${autoclose ? "true" : "false"};

              console.log("Label page debug", {
                ids: ${JSON.stringify(ids)},
                printable: ${printable.length},
                autoprint: AUTOPRINT,
                autoclose: AUTOCLOSE,
                copies: ${copies},
              });

              function doPrint() {
                setTimeout(() => window.print(), 150);
              }

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
    </div>
  );
}