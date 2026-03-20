"use client";

import Script from "next/script";
import { useEffect, useMemo, useState } from "react";

type LabelItem = {
  id: string;
  labelNumber?: number | null;
  sku: string;
  name: string;
  description: string;
  partNumber: string;
};

declare global {
  interface Window {
    dymo?: any;
  }
}

/**
 * DYMO Label XML template (designed to fit 30252 Address, Landscape)
 * - SKU (top)
 * - QR (left)
 * - NAME (center)
 * - ID + PART (bottom)
 *
 * NOTE: DYMO templates are picky; this template is intentionally simple and stable.
 */
function buildLabelXml(): string {
  // This XML works well as a baseline for LabelWriter series.
  // Keep generous safe margins because the effective printable area can vary
  // slightly by printer, label roll, and alignment.
  return `<?xml version="1.0" encoding="utf-8"?>
<DieCutLabel Version="8.0" Units="twips">
  <PaperOrientation>Landscape</PaperOrientation>
  <Id>Address</Id>
  <PaperName>30252 Address</PaperName>

  <!-- SKU -->
  <TextObject>
    <Name>SKU</Name>
    <Brushes>
      <SolidBrush Color="Black"/>
    </Brushes>
    <Bounds X="320" Y="170" Width="4300" Height="180" />
    <Text>SKU:</Text>
    <Font Family="Arial" Size="11" Bold="True"/>
    <HorizontalAlignment>Left</HorizontalAlignment>
    <VerticalAlignment>Top</VerticalAlignment>
  </TextObject>

  <!-- QR -->
  <BarcodeObject>
    <Name>QR</Name>
    <Brushes>
      <SolidBrush Color="Black"/>
    </Brushes>
    <Bounds X="320" Y="360" Width="760" Height="760" />
    <BarcodeType>QRCode</BarcodeType>
    <QuietZonesPadding Left="0" Top="0" Right="0" Bottom="0"/>
    <Text>QRDATA</Text>
  </BarcodeObject>

  <!-- NAME -->
  <TextObject>
    <Name>NAME</Name>
    <Brushes>
      <SolidBrush Color="Black"/>
    </Brushes>
    <Bounds X="1160" Y="430" Width="3460" Height="560" />
    <Text>NAME</Text>
    <Font Family="Arial" Size="15" Bold="True"/>
    <HorizontalAlignment>Center</HorizontalAlignment>
    <VerticalAlignment>Middle</VerticalAlignment>
  </TextObject>

  <!-- BOTTOM -->
  <TextObject>
    <Name>BOTTOM</Name>
    <Brushes>
      <SolidBrush Color="Black"/>
    </Brushes>
    <Bounds X="320" Y="1220" Width="4300" Height="170" />
    <Text>BOTTOM</Text>
    <Font Family="Arial" Size="10" Bold="True"/>
    <HorizontalAlignment>Left</HorizontalAlignment>
    <VerticalAlignment>Bottom</VerticalAlignment>
  </TextObject>
</DieCutLabel>`;
}

function deriveShortItemCode(labelNumber: number | null | undefined, itemId: string): string {
  if (typeof labelNumber === "number" && Number.isFinite(labelNumber) && labelNumber >= 0) {
    return `I${Math.trunc(labelNumber).toString(36).toUpperCase()}`;
  }
  return itemId;
}

export default function DymoClient({ items }: { items: LabelItem[] }) {
  const [sdkReady, setSdkReady] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "checking" | "ready" | "no_service" | "no_printer" | "error"
  >("idle");
  const [statusDetail, setStatusDetail] = useState<string>("");
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
  const [copies, setCopies] = useState<number>(1);
  const [printing, setPrinting] = useState<boolean>(false);

  const labelXml = useMemo(() => buildLabelXml(), []);

  async function checkDymo(): Promise<void> {
    setStatus("checking");
    setStatusDetail("");

    try {
      // 1) quick check: DYMO SDK loaded?
      const fw = window.dymo?.label?.framework;
      if (!fw) {
        setStatus("no_service");
        setStatusDetail(
          "DYMO SDK not loaded. (If you just refreshed, wait 1–2 seconds and try again.)",
        );
        return;
      }

      // 2) web service check (DYMO Connect runs a local service)
      // If this fails, user likely doesn't have DYMO Connect installed/running.
      const resp = await fetch(
        "http://localhost:41951/DYMO/DLS/Printing/StatusConnected",
        { cache: "no-store" },
      ).catch(() => null);

      if (!resp) {
        setStatus("no_service");
        setStatusDetail(
          "DYMO Web Service not reachable. Install DYMO Connect and ensure the service is running on this computer.",
        );
        return;
      }

      const text = (await resp.text()).trim().toLowerCase();
      if (text !== "true") {
        setStatus("no_service");
        setStatusDetail(
          "DYMO Web Service responded but is not connected. Make sure DYMO Connect is open and your printer is connected.",
        );
        return;
      }

      // 3) printers list
      const printers = fw.getPrinters?.() ?? [];
      const dymoPrinters = printers.filter((p: any) => p?.printerType);

      if (!dymoPrinters.length) {
        setStatus("no_printer");
        setStatusDetail(
          "No DYMO printers found by the SDK. Make sure the LabelWriter 450 is installed and connected.",
        );
        return;
      }

      // Prefer a LabelWriter if present
      const preferred =
        dymoPrinters.find((p: any) =>
          String(p.name ?? "")
            .toLowerCase()
            .includes("labelwriter"),
        ) ?? dymoPrinters[0];

      setSelectedPrinter(preferred.name);
      setStatus("ready");
      setStatusDetail(`Ready: ${preferred.name}`);
    } catch (e: any) {
      setStatus("error");
      setStatusDetail(e?.message ? String(e.message) : "Unknown error");
    }
  }

  useEffect(() => {
    // Auto-check shortly after mount once script is loaded
    if (!sdkReady) return;
    void checkDymo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady]);

  function requireReady(): boolean {
    if (status !== "ready" || !selectedPrinter) {
      void checkDymo();
      return false;
    }
    return true;
  }

  function openLabelAndFill(item: LabelItem) {
    const fw = window.dymo!.label.framework;

    const label = fw.openLabelXml(labelXml);

    // Fill objects
    label.setObjectText("SKU", `SKU: ${item.sku}`);
    label.setObjectText("QR", item.sku);

    const name = (item.name || "").toUpperCase().slice(0, 22);
    label.setObjectText("NAME", name);

    const id = deriveShortItemCode(item.labelNumber, item.id);
    const part = item.partNumber ? item.partNumber.slice(0, 16) : "—";
    label.setObjectText("BOTTOM", `ITEM# ${id}     PART# ${part}`);

    return label;
  }

  async function printOne(item: LabelItem) {
    if (!requireReady()) return;
    setPrinting(true);
    setStatusDetail("Printing…");

    try {
      const label = openLabelAndFill(item);

      // Print copies by looping (most reliable across driver versions)
      const n = Math.max(1, Math.min(50, Number.isFinite(copies) ? copies : 1));
      for (let i = 0; i < n; i++) {
        label.print(selectedPrinter);
      }

      setStatusDetail(`Printed ${n} label(s): ${item.sku}`);
    } catch (e: any) {
      setStatus("error");
      setStatusDetail(
        e?.message ? String(e.message) : "Print failed (unknown error).",
      );
    } finally {
      setPrinting(false);
    }
  }

  async function printAll() {
    if (!requireReady()) return;
    if (items.length === 0) return;

    setPrinting(true);
    setStatusDetail(`Printing ${items.length} item(s)…`);

    try {
      const n = Math.max(1, Math.min(50, Number.isFinite(copies) ? copies : 1));
      for (const item of items) {
        const label = openLabelAndFill(item);
        for (let i = 0; i < n; i++) {
          label.print(selectedPrinter);
        }
      }
      setStatusDetail(`Printed ${items.length} item(s) × ${n} copies.`);
    } catch (e: any) {
      setStatus("error");
      setStatusDetail(
        e?.message ? String(e.message) : "Print failed (unknown error).",
      );
    } finally {
      setPrinting(false);
    }
  }

  const bannerStyle: React.CSSProperties = {
    border: "1px solid #ddd",
    borderRadius: 10,
    padding: 12,
    background: "#fff",
    display: "flex",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  };

  const btnStyle: React.CSSProperties = {
    border: "1px solid #111",
    borderRadius: 10,
    padding: "8px 12px",
    fontWeight: 800,
    background: "#fff",
    cursor: "pointer",
    opacity: printing ? 0.6 : 1,
  };

  return (
    <section style={{ display: "grid", gap: 12 }}>
      {/* DYMO SDK script */}
      <Script
  src="https://labelwriter.com/software/dls/sdk/js/DYMO.Label.Framework.3.0.js"
  strategy="afterInteractive"
  onLoad={() => {
    console.log("DYMO SDK loaded");
    setSdkReady(true);
  }}
  onError={() => {
    setStatus("no_service");
    setStatusDetail("Failed to load DYMO SDK.");
  }}
/>

      <div style={bannerStyle}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontWeight: 900 }}>
            DYMO Status:{" "}
            <span style={{ fontWeight: 800 }}>
              {status === "ready"
                ? "Ready"
                : status === "checking"
                  ? "Checking…"
                  : status === "no_service"
                    ? "No Service"
                    : status === "no_printer"
                      ? "No Printer"
                      : status === "error"
                        ? "Error"
                        : "Idle"}
            </span>
          </div>
          <div style={{ fontSize: 13, opacity: 0.85 }}>{statusDetail}</div>
          {selectedPrinter ? (
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Printer: <b>{selectedPrinter}</b>
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, opacity: 0.85 }}>Copies</span>
            <input
              type="number"
              min={1}
              max={50}
              value={copies}
              onChange={(e) => setCopies(parseInt(e.target.value || "1", 10))}
              style={{
                width: 80,
                border: "1px solid #ccc",
                borderRadius: 8,
                padding: "6px 8px",
              }}
            />
          </label>

          <button
            type="button"
            style={btnStyle}
            onClick={() => checkDymo()}
            disabled={printing}
          >
            Refresh DYMO
          </button>

          <button
            type="button"
            style={{ ...btnStyle, background: "#111", color: "#fff" }}
            onClick={() => printAll()}
            disabled={printing || items.length === 0}
          >
            Print All
          </button>
        </div>
      </div>

      {/* Items list */}
      {items.length ? (
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 10,
            background: "#fff",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 10,
              borderBottom: "1px solid #eee",
              fontWeight: 900,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>
              Items to print: <b>{items.length}</b>
            </span>
            <span style={{ fontSize: 13, opacity: 0.8 }}>
              Prints instantly on this computer only.
            </span>
          </div>

          <div style={{ display: "grid" }}>
            {items.map((it) => (
              <div
                key={it.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 10,
                  padding: 10,
                  borderTop: "1px solid #f0f0f0",
                  alignItems: "center",
                }}
              >
                <div style={{ display: "grid", gap: 2 }}>
                  <div style={{ fontWeight: 900 }}>
                    {it.name}{" "}
                    <span style={{ fontWeight: 700, opacity: 0.7 }}>
                      ({it.sku})
                    </span>
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.85 }}>
                    PART# {it.partNumber || "—"}
                    {it.description ? ` • ${it.description}` : ""}
                  </div>
                </div>

                <button
                  type="button"
                  style={btnStyle}
                  onClick={() => printOne(it)}
                  disabled={printing}
                >
                  Print
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {(status === "no_service" || status === "no_printer") && (
        <div
          style={{
            border: "1px solid #f0c36d",
            background: "#fff7e6",
            borderRadius: 10,
            padding: 12,
            fontSize: 13,
            lineHeight: 1.35,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 6 }}>
            Fix DYMO instant printing
          </div>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>Install DYMO Connect (official DYMO software).</li>
            <li>Plug in the LabelWriter 450 and confirm it prints from DYMO Connect.</li>
            <li>
              In a browser on this same PC, open:{" "}
              <b>http://localhost:41951/DYMO/DLS/Printing/StatusConnected</b>{" "}
              (should say <b>true</b>).
            </li>
            <li>Click “Refresh DYMO” above.</li>
          </ol>
        </div>
      )}
    </section>
  );
}