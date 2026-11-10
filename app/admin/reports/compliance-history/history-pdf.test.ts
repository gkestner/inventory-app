import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib/dist/pdf-lib.esm.js";
import type { ComplianceHistoryRecord } from "@/app/lib/compliance-history-fields";
import { createComplianceHistoryPdf } from "./history-pdf";

const base: ComplianceHistoryRecord = {
  id: "entry-boiler", reminderLocationId: "row-1", sectionId: "boiler", sectionName: "Boiler", complianceKind: "BOILER",
  locationId: "location-1", locationName: "Store One", locationNumber: "01", recordYear: 2026, serviceDate: "2026-11-10",
  intervalMonths: 11, intervalOverrideMonths: null, intervalText: null, companyName: "Service Company",
  cost: "$123.45", tankSize: null, gallons: null, additionalDate: "2026-11-11", notes: null,
  recordedAt: new Date("2026-11-10T18:00:00Z"), recordedByName: "Maintenance", source: "DASHBOARD",
};

/** Extract the text actually encoded in PDF content streams, not the layout inputs. */
function contentStreams(bytes: Uint8Array) {
  const raw = Buffer.from(bytes).toString("latin1");
  const streams: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try { streams.push(inflateSync(Buffer.from(match[1], "latin1")).toString("latin1")); } catch { /* Font/object streams are not report text. */ }
  }
  return streams;
}
function extractedText(streams: string[]) {
  return streams.flatMap((stream) => [...stream.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((match) => Buffer.from(match[1], "hex").toString("latin1"))).join("\n");
}

test("history PDF retains every long note/company/gallons token through page breaks", async () => {
  const notes = Array.from({ length: 650 }, (_, index) => `NOTE_${String(index).padStart(4, "0")}`).join(" ");
  const company = Array.from({ length: 60 }, (_, index) => `COMPANY_${index}`).join(" ");
  const gallons = Array.from({ length: 80 }, (_, index) => `GALLONS_${index}`).join(" ");
  const bytes = await createComplianceHistoryPdf([
    { ...base, notes, companyName: company },
    { ...base, id: "entry-grease", complianceKind: "GREASE_TRAP", sectionName: "Grease Trap", tankSize: "1,000", gallons, additionalDate: null },
  ], { page: 1 }, { location: "All locations", section: "All sections" });
  const pdf = await PDFDocument.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.ok(pdf.getPageCount() >= 4, "Long entries should flow onto additional readable pages");
  const streams = contentStreams(bytes);
  const text = extractedText(streams);
  for (const token of [...notes.split(" "), ...company.split(" "), ...gallons.split(" ")]) assert.ok(text.includes(token), `PDF lost ${token}`);
  for (const value of ["Inspection cost", "$123.45", "Additional inspection date", "2026-11-11", "Tank size", "1,000", "entry-boiler", "entry-grease", "Entry 1 of 2 (continued)"]) assert.ok(text.includes(value), `PDF lost ${value}`);
  for (const stream of streams) {
    for (const match of stream.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)) {
      assert.ok(Number(match[1]) >= 37 && Number(match[1]) <= 568);
      assert.ok(Number(match[2]) >= 25 && Number(match[2]) <= 748, "Text must stay within page margins");
    }
  }
});

test("history PDF wraps unbroken values and preserves unsupported Unicode explicitly", async () => {
  const token = `START_${"X".repeat(1800)}_END`;
  const bytes = await createComplianceHistoryPdf([{ ...base, notes: token + "\nUnicode rocket: 🚀" }], { page: 1 }, { location: "Store One", section: "Boiler" });
  const text = extractedText(contentStreams(bytes));
  assert.ok(text.includes("START_"));
  assert.ok(text.includes("_END"), "Long unbroken input must not be ellipsized");
  assert.ok(text.includes("[U+1F680]"));
  assert.equal([...text].filter((character) => character === "X").length, 1800);
});
