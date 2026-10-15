import { PDFDocument, StandardFonts, rgb } from "pdf-lib/dist/pdf-lib.esm.js";

import { excelResponse } from "@/app/lib/excel-export";

export type ReportValue = string | number | boolean | Date | null | undefined;
export type ReportRow = Record<string, ReportValue>;
export type ReportColumn = {
  key: string;
  header: string;
  kind?: "text" | "number" | "currency" | "date" | "datetime" | "boolean";
  width?: number;
};
export type ReportWorkbook = {
  filename: string;
  title: string;
  rows: ReportRow[];
  columns: ReportColumn[];
  metadata?: Array<[string, ReportValue]>;
  totals?: Partial<Record<string, ReportValue>>;
};

function formatValue(value: ReportValue, kind?: ReportColumn["kind"]): string {
  if (value === null || value === undefined) return "";
  if (kind === "boolean") return value ? "Yes" : "No";
  if (kind === "currency") {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount.toFixed(2) : "";
  }
  if (kind === "date" || kind === "datetime" || value instanceof Date) {
    const date = value instanceof Date ? value : new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric", month: "2-digit", day: "2-digit",
        ...(kind === "datetime" ? { hour: "numeric", minute: "2-digit" } : {}),
      }).format(date);
    }
  }
  return String(value);
}

function safeSpreadsheetText(value: string): string {
  return /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  const safe = safeSpreadsheetText(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

function csvResponse(workbook: ReportWorkbook): Response {
  const lines = [
    workbook.columns.map((column) => csvCell(column.header)).join(","),
    ...workbook.rows.map((row) => workbook.columns.map((column) => csvCell(formatValue(row[column.key], column.kind))).join(",")),
  ];
  if (workbook.totals) {
    lines.push(workbook.columns.map((column, index) => csvCell(
      workbook.totals?.[column.key] === undefined && index === 0
        ? "Totals"
        : formatValue(workbook.totals?.[column.key], column.kind),
    )).join(","));
  }
  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${workbook.filename}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

function pdfText(value: string): string {
  // Standard PDF fonts use WinAnsi; replace characters they cannot encode.
  return value.replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

async function pdfResponse(workbook: ReportWorkbook): Promise<Response> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 1190;
  const pageHeight = 842;
  const margin = 32;
  const tableWidth = pageWidth - 2 * margin;
  const headerHeight = 19;
  const rowHeight = 17;
  const fontSize = workbook.columns.length > 12 ? 6 : 7.5;
  const desiredWidths = workbook.columns.map((column) => Math.max(65, column.width ?? 120));
  const totalDesired = desiredWidths.reduce((sum, width) => sum + width, 0) || 1;
  const widths = desiredWidths.map((width) => width / totalDesired * tableWidth);
  const dark = rgb(0.12, 0.17, 0.25);
  const muted = rgb(0.37, 0.43, 0.52);
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  let pageNumber = 1;

  function fit(value: string, width: number, size: number, font = regular): string {
    const text = pdfText(value).replace(/\s+/g, " ").trim();
    if (font.widthOfTextAtSize(text, size) <= width) return text;
    let clipped = text;
    while (clipped && font.widthOfTextAtSize(`${clipped}...`, size) > width) clipped = clipped.slice(0, -1);
    return `${clipped}...`;
  }

  function drawPageHeader() {
    page.drawText(fit(workbook.title, tableWidth, 18, bold), { x: margin, y, size: 18, font: bold, color: dark });
    y -= 23;
    if (pageNumber === 1) {
      for (const [label, value] of workbook.metadata ?? []) {
        page.drawText(fit(`${label}: ${formatValue(value)}`, tableWidth, 9), { x: margin, y, size: 9, font: regular, color: muted });
        y -= 13;
      }
    }
    y -= 10;
    page.drawRectangle({ x: margin, y: y - headerHeight + 5, width: tableWidth, height: headerHeight, color: dark });
    let x = margin;
    workbook.columns.forEach((column, index) => {
      page.drawText(fit(column.header, widths[index] - 8, fontSize, bold), {
        x: x + 4, y: y - 7, size: fontSize, font: bold, color: rgb(1, 1, 1),
      });
      x += widths[index];
    });
    y -= headerHeight;
  }

  function drawRow(row: ReportRow, index: number) {
    if (y < margin + rowHeight + 16) {
      page.drawText(`Page ${pageNumber}`, { x: pageWidth - margin - 48, y: margin - 8, size: 8, font: regular, color: muted });
      page = pdf.addPage([pageWidth, pageHeight]);
      pageNumber += 1;
      y = pageHeight - margin;
      drawPageHeader();
    }
    if (index % 2 === 0) page.drawRectangle({ x: margin, y: y - rowHeight + 4, width: tableWidth, height: rowHeight, color: rgb(0.96, 0.97, 0.98) });
    let x = margin;
    workbook.columns.forEach((column, columnIndex) => {
      page.drawText(fit(formatValue(row[column.key], column.kind), widths[columnIndex] - 8, fontSize), {
        x: x + 4, y: y - 7, size: fontSize, font: regular, color: dark,
      });
      x += widths[columnIndex];
    });
    y -= rowHeight;
  }

  drawPageHeader();
  workbook.rows.forEach(drawRow);
  if (workbook.totals) drawRow(workbook.totals, workbook.rows.length);
  page.drawText(`Page ${pageNumber}`, { x: pageWidth - margin - 48, y: margin - 8, size: 8, font: regular, color: muted });
  const bytes = await pdf.save();
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${workbook.filename}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

export function renderReportExport(workbook: ReportWorkbook, format: string): Response | Promise<Response> {
  if (format === "csv") return csvResponse(workbook);
  if (format === "pdf") return pdfResponse(workbook);
  return excelResponse({
    filename: workbook.filename,
    sheets: [{
      name: workbook.title, title: workbook.title, rows: workbook.rows,
      columns: workbook.columns, metadata: workbook.metadata, totals: workbook.totals,
    }],
  });
}
