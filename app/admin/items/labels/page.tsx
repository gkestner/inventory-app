import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Script from "next/script";
import { authOptions } from "@/app/lib/auth";
import { canAccessAdmin } from "@/app/lib/admin-access";

export const dynamic = "force-dynamic";

type SearchParams = {
  ids?: string | string[];
  autoprint?: string;
  autoclose?: string;
  copies?: string;
  debug?: string | string[];
};

declare global {
  interface Window {
    __labelsAutoprintInit?: boolean;
    __labelsAutoprintDone?: boolean;
  }
}

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

function nameFontSizePx(name: string): number {
  const len = name.length;
  if (len <= 10) return 16;
  if (len <= 14) return 15;
  if (len <= 18) return 14;
  if (len <= 22) return 13;
  if (len <= 28) return 12;
  if (len <= 34) return 11;
  return 10;
}

export default async function ItemLabelsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  try {
    const sp = await searchParams;
    const debug = first(sp.debug) === "1";

    // Always enforce auth; debug mode must never bypass security.
    let session: any = null;
    try {
      session = await getServerSession(authOptions);
    } catch (authErr) {
      console.error("Session error:", authErr);
    }

    if (!session) {
      redirect("/login");
    }

    if (!(await canAccessAdmin(session))) {
      redirect("/");
    }

    const ids = parseIds(first(sp.ids));
    const autoprint = first(sp.autoprint) === "1";
    const autoclose = first(sp.autoclose) === "1";
    const copiesRaw = parseInt(first(sp.copies) || "1", 10);
    const copies = Number.isFinite(copiesRaw) ? Math.max(1, Math.min(50, copiesRaw)) : 1;

    let items: any[] = [];
    if (ids.length) {
      try {
        const prismaModule = await import("@/app/lib/prisma");
        const prisma = prismaModule.prisma;
        
        items = await prisma.item.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            labelNumber: true,
            sku: true,
            name: true,
            description: true,
            partNumber: true,
          },
        }).catch((err: any) => {
          console.error("Prisma error:", err);
          return [];
        });
      } catch (err) {
        console.error("Failed to load Prisma:", err);
        items = [];
      }
    }

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
            <strong>DEBUG</strong> ids={ids.length} printable={printable.length} autoprint={String(autoprint)}
          </div>
        ) : null}
        <div className="bar" data-autoprint={autoprint}>
          Tip: press <b>P</b> to print. Press <b>Esc</b> to close.
        </div>

        {printable.length === 0 ? (
          <div style={{ padding: 14, fontSize: 14 }}>No items selected.</div>
        ) : (
          printable.map((item) => {
            const labelId =
              typeof item.labelNumber === "number" && Number.isFinite(item.labelNumber)
                ? String(item.labelNumber)
                : deriveLabelIdFromSku(item.sku);
            const nameText = String(item.name ?? "")
              .toUpperCase()
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 40);
            const nameSize = nameFontSizePx(nameText);
            const partText = String(item.partNumber ?? "—").slice(0, 16);
            return (
              <div className="label" key={`${item.id}-${(item as any).__copy}`}>
                <div className="sku">SKU: {item.sku}</div>

                <div className="mid">
                  <div className="qr">
                    <img src={qrImageUrl(item.id)} alt={`Item ID: ${item.id}`} />
                  </div>

                  <div className="nameblock">
                    <div className="name" style={{ fontSize: `${nameSize}px` }}>
                      {nameText}
                    </div>
                    {item.description ? (
                      <div className="desc">({item.description})</div>
                    ) : null}
                  </div>
                </div>

                <div className="bottom">
                  <span className="idbox">ID# {labelId}</span>
                  <span className="part">PART# {partText}</span>
                </div>
              </div>
            );
          })
        )}

        <Script
          id="labels-body-mode-script"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                document.body.classList.add("labels-print-mode");
                window.addEventListener("beforeunload", function () {
                  document.body.classList.remove("labels-print-mode");
                });
              })();
            `,
          }}
        />

        <Script
          id="labels-autoprint-script"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                if (window.__labelsAutoprintInit) return;
                window.__labelsAutoprintInit = true;

                const AUTOPRINT = ${autoprint ? "true" : "false"};
                const AUTOCLOSE = ${autoclose ? "true" : "false"};
                const IS_LABELS_POPUP = window.name === "labels-print-popup";
                const SHOULD_AUTOCLOSE = AUTOCLOSE && IS_LABELS_POPUP;
                const AUTOPRINT_LOCK_KEY = "__labels_autoprint_lock_until";

                console.log("Label page debug", {
                  idsCount: ${ids.length},
                  printableCount: ${printable.length},
                  autoprint: AUTOPRINT,
                  autoclose: AUTOCLOSE,
                  copies: ${copies},
                });

                function doPrint() {
                  if (window.__labelsAutoprintDone) return;
                  window.__labelsAutoprintDone = true;
                  setTimeout(() => window.print(), 150);
                }

                function acquireAutoprintLock() {
                  try {
                    const now = Date.now();
                    const current = Number(window.localStorage.getItem(AUTOPRINT_LOCK_KEY) || 0);
                    if (now < current) return false;
                    window.localStorage.setItem(AUTOPRINT_LOCK_KEY, String(now + 5000));
                    return true;
                  } catch {
                    // If storage is unavailable, fail open so printing still works.
                    return true;
                  }
                }

                window.addEventListener("keydown", (e) => {
                  if ((e.key === "p" || e.key === "P") && !e.ctrlKey && !e.metaKey && !e.altKey) {
                    e.preventDefault();
                    doPrint();
                  }
                  if (e.key === "Escape" && SHOULD_AUTOCLOSE) {
                    window.close();
                  }
                });

                if (SHOULD_AUTOCLOSE) {
                  window.addEventListener("afterprint", () => {
                    setTimeout(() => window.close(), 200);
                  });
                }

                if (AUTOPRINT) {
                  if (!acquireAutoprintLock()) {
                    console.log("Duplicate autoprint suppressed.");
                    if (SHOULD_AUTOCLOSE) {
                      setTimeout(() => window.close(), 80);
                    }
                    return;
                  }

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
  } catch (error) {
    console.error("Labels page error:", error);
    return (
      <div className="labels-page" style={{ padding: 20 }}>
        <div style={{ color: "red", fontSize: 14 }}>
          <strong>Error loading labels page.</strong>
          <p style={{ fontSize: 12, marginTop: 8 }}>
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </div>
      </div>
    );
  }
}