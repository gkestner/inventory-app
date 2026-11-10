import { PDFDocument, StandardFonts, rgb } from "pdf-lib/dist/pdf-lib.esm.js";
import type { ComplianceHistoryRecord } from "@/app/lib/compliance-history-fields";
import { historySourceLabel, type ComplianceHistoryFilters } from "./report-data";

type Font = { widthOfTextAtSize(text: string, size: number): number };

/** Keep unsupported characters explicit, rather than dropping source content. */
function printableText(value: string) {
  return value.replaceAll("\t", "    ").replace(/[^\x20-\x7E\xA0-\xFF]/gu, (character) =>
    `[U+${character.codePointAt(0)!.toString(16).toUpperCase()}]`,
  );
}

/** Wrap complete paragraphs, including long words/IDs, without ellipses or clipping. */
function wrapText(value: string, font: Font, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n")) {
    let line = "";
    for (const word of printableText(paragraph).split(/ +/)) {
      if (!word) continue;
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) { lines.push(line); line = ""; }
      let remainder = word;
      while (font.widthOfTextAtSize(remainder, size) > width) {
        let take = 1;
        while (take < remainder.length && font.widthOfTextAtSize(remainder.slice(0, take + 1), size) <= width) take++;
        lines.push(remainder.slice(0, take));
        remainder = remainder.slice(take);
      }
      line = remainder;
    }
    lines.push(line);
  }
  return lines;
}

function entryFields(record: ComplianceHistoryRecord): Array<[string, string]> {
  const fields: Array<[string, string]> = [
    ["Location", `${record.locationNumber ? `${record.locationNumber} - ` : ""}${record.locationName}`],
    ["Compliance section", record.sectionName],
    ["Service date", record.serviceDate],
    ["Repeat every (months)", String(record.intervalText || record.intervalMonths)],
    ["Service company", record.companyName],
  ];
  if (record.complianceKind || record.cost) fields.push([
    record.complianceKind === "BACKFLOW" ? "Testing cost" : record.complianceKind === "BOILER" ? "Inspection cost" : "Service cost",
    record.cost ?? "",
  ]);
  if (record.complianceKind === "GREASE_TRAP") fields.push(["Tank size", record.tankSize ?? ""], ["Gallons / PM notes", record.gallons ?? ""]);
  if (record.complianceKind === "BOILER") fields.push(["Additional inspection date", record.additionalDate ?? ""]);
  fields.push(
    ["Notes", record.notes ?? ""],
    ["Record year", String(record.recordYear)],
    ["Recorded at (Eastern)", new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(record.recordedAt)],
    ["Recorded by", record.recordedByName ?? ""],
    ["Source", historySourceLabel(record.source)],
    ["Entry ID", record.id],
  );
  return fields;
}

/** A dedicated readable PDF: each full field can flow across as many pages as needed. */
export async function createComplianceHistoryPdf(
  records: ComplianceHistoryRecord[],
  filters: ComplianceHistoryFilters,
  context: { location: string; section: string },
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const [regular, bold] = await Promise.all([
    document.embedFont(StandardFonts.Helvetica), document.embedFont(StandardFonts.HelveticaBold),
  ]);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 44;
  const bottom = 52;
  const width = pageWidth - margin * 2;
  const bodySize = 11;
  const lineHeight = 15;
  const dark = rgb(.12, .17, .25);
  const muted = rgb(.36, .42, .49);
  const pages: ReturnType<typeof document.addPage>[] = [];
  let page = document.addPage([pageWidth, pageHeight]);
  pages.push(page);
  let y = pageHeight - margin;
  let currentEntry = 0;

  function line(text: string, size = bodySize, font = regular, color = dark) {
    page.drawText(text, { x: margin, y, size, font, color });
    y -= lineHeight;
  }
  function heading() {
    line("Compliance history", 20, bold);
    y -= 10;
  }
  function cardHeading(continued = false) {
    page.drawRectangle({ x: margin - 7, y: y - 7, width: width + 14, height: 25, color: rgb(.93, .95, .97) });
    line(`Entry ${currentEntry} of ${records.length}${continued ? " (continued)" : ""}`, 12, bold);
    y -= 15;
  }
  function nextPage(continued = true) {
    page = document.addPage([pageWidth, pageHeight]);
    pages.push(page);
    y = pageHeight - margin;
    heading();
    if (continued && currentEntry) cardHeading(true);
  }
  function field(label: string, value: string) {
    if (y < bottom + lineHeight * 3) nextPage();
    line(label, 9, bold, muted);
    for (const text of wrapText(value || "Not recorded", regular, bodySize, width)) {
      if (y < bottom + lineHeight) { nextPage(); line(`${label} (continued)`, 9, bold, muted); }
      line(text);
    }
    y -= 9;
  }

  heading();
  field("Location filter", context.location);
  field("Section filter", context.section);
  field("Record year", String(filters.year ?? "All years"));
  line(`${records.length} matching ${records.length === 1 ? "entry" : "entries"}`, 10, bold);
  y -= 18;
  for (const record of records) {
    currentEntry++;
    if (y < bottom + 90) nextPage(false);
    cardHeading();
    for (const [label, value] of entryFields(record)) field(label, value);
    y -= 15;
  }
  if (!records.length) line("No saved entries match these filters.");
  pages.forEach((item, index) => item.drawText(`Page ${index + 1} of ${pages.length}`, {
    x: margin, y: 25, size: 9, font: regular, color: muted,
  }));
  return document.save();
}

export async function complianceHistoryPdfResponse(
  records: ComplianceHistoryRecord[],
  filters: ComplianceHistoryFilters,
  context: { location: string; section: string },
) {
  const bytes = await createComplianceHistoryPdf(records, filters, context);
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": 'attachment; filename="compliance-history.pdf"',
    "Cache-Control": "no-store",
  } });
}
