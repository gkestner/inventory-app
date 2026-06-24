type ExcelValue = string | number | boolean | Date | null | undefined;

type ExcelColumn<T> = {
  key: keyof T & string;
  header: string;
  width?: number;
  kind?: "text" | "number" | "currency" | "date" | "datetime" | "boolean";
};

type ExcelSheet<T extends Record<string, ExcelValue>> = {
  name: string;
  title: string;
  columns: Array<ExcelColumn<T>>;
  rows: T[];
  metadata?: Array<[string, ExcelValue]>;
  totals?: Partial<Record<keyof T & string, ExcelValue>>;
};

function escapeHtml(value: ExcelValue): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dateValue(value: ExcelValue, includeTime: boolean): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(d);
}

function formatCell(value: ExcelValue, kind: ExcelColumn<Record<string, ExcelValue>>["kind"]): string {
  if (kind === "date") return escapeHtml(dateValue(value, false));
  if (kind === "datetime") return escapeHtml(dateValue(value, true));
  if (kind === "currency") {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n.toFixed(2) : "";
  }
  if (kind === "boolean") return value ? "Yes" : "No";
  return escapeHtml(value);
}

function cellClass(kind: ExcelColumn<Record<string, ExcelValue>>["kind"]): string {
  if (kind === "number") return "number";
  if (kind === "currency") return "currency";
  if (kind === "date" || kind === "datetime") return "date";
  return "text";
}

export function excelResponse<T extends Record<string, ExcelValue>>(options: {
  filename: string;
  sheets: Array<ExcelSheet<T>>;
}) {
  const generatedAt = new Date();
  const body = options.sheets
    .map((sheet, sheetIndex) => {
      const meta = [["Generated", generatedAt], ...(sheet.metadata ?? [])] as Array<[string, ExcelValue]>;
      const cols = sheet.columns;
      return `
        ${sheetIndex > 0 ? '<br style="mso-special-character:line-break;page-break-before:always">' : ""}
        <table>
          <tr><th class="title" colspan="${Math.max(cols.length, 1)}">${escapeHtml(sheet.title)}</th></tr>
          ${meta
            .map(
              ([label, value]) =>
                `<tr><td class="meta-label">${escapeHtml(label)}</td><td class="meta-value" colspan="${Math.max(cols.length - 1, 1)}">${formatCell(value, value instanceof Date ? "datetime" : "text")}</td></tr>`
            )
            .join("")}
          <tr>${cols.map((c) => `<th class="header" style="width:${c.width ?? 120}px">${escapeHtml(c.header)}</th>`).join("")}</tr>
          ${sheet.rows
            .map(
              (row) =>
                `<tr>${cols
                  .map((c) => `<td class="${cellClass(c.kind)}">${formatCell(row[c.key], c.kind)}</td>`)
                  .join("")}</tr>`
            )
            .join("")}
          ${
            sheet.totals
              ? `<tr>${cols
                  .map((c, index) => {
                    const value = sheet.totals?.[c.key];
                    const label = index === 0 && (value === null || value === undefined) ? "Totals" : value;
                    return `<td class="total ${cellClass(c.kind)}">${formatCell(label, c.kind)}</td>`;
                  })
                  .join("")}</tr>`
              : ""
          }
        </table>`;
    })
    .join("");

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Calibri, Arial, sans-serif; color: #111827; }
    table { border-collapse: collapse; margin-bottom: 24px; }
    th.title { background: #111827; color: #ffffff; font-size: 18px; font-weight: 700; text-align: left; padding: 12px; }
    td.meta-label { background: #f3f4f6; color: #374151; font-weight: 700; border: 1px solid #d1d5db; padding: 6px 8px; }
    td.meta-value { border: 1px solid #d1d5db; padding: 6px 8px; }
    th.header { background: #2563eb; color: #ffffff; font-weight: 700; border: 1px solid #1d4ed8; padding: 8px; text-align: left; }
    td { border: 1px solid #d1d5db; padding: 6px 8px; vertical-align: top; }
    tr:nth-child(even) td { background: #f9fafb; }
    td.number, td.currency { mso-number-format:"0"; text-align: right; }
    td.currency { mso-number-format:"$#,##0.00"; }
    td.date { mso-number-format:"mm/dd/yyyy"; }
    td.total { background: #e0f2fe; font-weight: 700; border-top: 2px solid #2563eb; }
  </style>
</head>
<body>${body}</body>
</html>`;

  const filename = options.filename.endsWith(".xls") ? options.filename : `${options.filename}.xls`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.ms-excel; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
