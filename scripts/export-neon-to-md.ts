import { PrismaClient } from "@prisma/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type ColumnInfo = {
  table_schema: string;
  table_name: string;
  column_name: string;
  ordinal_position: number;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
};

type TableInfo = {
  table_schema: string;
  table_name: string;
  table_type: string;
};

type ConstraintInfo = {
  table_schema: string;
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  definition: string;
};

type IndexInfo = {
  schemaname: string;
  tablename: string;
  indexname: string;
  indexdef: string;
};

const workspaceRoot = process.cwd();
const outputDir = path.join(workspaceRoot, "exports");

function parseEnvFile(contents: string) {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function loadEnv() {
  for (const fileName of [".env.local", ".env"]) {
    try {
      parseEnvFile(await readFile(path.join(workspaceRoot, fileName), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function escapeMarkdownCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const serialized = serializeValue(value);
  return serialized
    .replace(/\r?\n/g, "<br>")
    .replace(/\|/g, "\\|");
}

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${serializeValue(value).replace(/'/g, "''")}'`;
}

function quotedIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function markdownTable(headers: string[], rows: unknown[][]) {
  const lines = [
    `| ${headers.map(escapeMarkdownCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  ];

  for (const row of rows) {
    lines.push(`| ${row.map(escapeMarkdownCell).join(" | ")} |`);
  }

  return lines.join("\n");
}

function safeConnectionSummary(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname,
      database: url.pathname.replace(/^\//, ""),
      user: decodeURIComponent(url.username || ""),
    };
  } catch {
    return {
      host: "unknown",
      database: "unknown",
      user: "unknown",
    };
  }
}

async function main() {
  await loadEnv();

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in .env.local or .env.");
  }

  const prisma = new PrismaClient();
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(outputDir, `neon-export-${stamp}.md`);

  try {
    const tables = await prisma.$queryRaw<TableInfo[]>`
      SELECT table_schema, table_name, table_type
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `;

    const columns = await prisma.$queryRaw<ColumnInfo[]>`
      SELECT table_schema, table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `;

    const constraints = await prisma.$queryRaw<ConstraintInfo[]>`
      SELECT
        n.nspname AS table_schema,
        c.relname AS table_name,
        con.conname AS constraint_name,
        CASE con.contype
          WHEN 'p' THEN 'PRIMARY KEY'
          WHEN 'f' THEN 'FOREIGN KEY'
          WHEN 'u' THEN 'UNIQUE'
          WHEN 'c' THEN 'CHECK'
          WHEN 'x' THEN 'EXCLUDE'
          ELSE con.contype::text
        END AS constraint_type,
        pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
      ORDER BY c.relname, con.conname;
    `;

    const indexes = await prisma.$queryRaw<IndexInfo[]>`
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `;

    const parts: string[] = [];
    const summary = safeConnectionSummary(process.env.DATABASE_URL);

    parts.push("# Neon Database Export");
    parts.push("");
    parts.push(`Exported at: ${now.toISOString()}`);
    parts.push(`Source host: ${summary.host}`);
    parts.push(`Source database: ${summary.database}`);
    parts.push(`Source user: ${summary.user}`);
    parts.push("");
    parts.push("> Connection passwords and URLs are intentionally not included. This file may contain application data.");
    parts.push("");

    parts.push("## Tables");
    parts.push("");
    parts.push(markdownTable(["table", "columns", "rows"], []));

    const tableSummaries: unknown[][] = [];
    const tableRowsByName = new Map<string, Record<string, unknown>[]>();

    for (const table of tables) {
      const tableName = table.table_name;
      const tableColumns = columns.filter((column) => column.table_name === tableName);
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM ${quotedIdent(tableName)} ORDER BY 1`
      );
      tableRowsByName.set(tableName, rows);
      tableSummaries.push([tableName, tableColumns.length, rows.length]);
    }

    parts[parts.length - 1] = markdownTable(["table", "columns", "rows"], tableSummaries);
    parts.push("");

    parts.push("## Schema");
    parts.push("");
    for (const table of tables) {
      const tableName = table.table_name;
      const tableColumns = columns.filter((column) => column.table_name === tableName);
      const tableConstraints = constraints.filter((constraint) => constraint.table_name === tableName);
      const tableIndexes = indexes.filter((index) => index.tablename === tableName);

      parts.push(`### ${tableName}`);
      parts.push("");
      parts.push(
        markdownTable(
          ["column", "type", "nullable", "default"],
          tableColumns.map((column) => [
            column.column_name,
            column.data_type === "USER-DEFINED" ? column.udt_name : column.data_type,
            column.is_nullable,
            column.column_default ?? "",
          ])
        )
      );
      parts.push("");

      if (tableConstraints.length > 0) {
        parts.push("Constraints:");
        parts.push("");
        parts.push(
          markdownTable(
            ["name", "type", "definition"],
            tableConstraints.map((constraint) => [
              constraint.constraint_name,
              constraint.constraint_type,
              constraint.definition,
            ])
          )
        );
        parts.push("");
      }

      if (tableIndexes.length > 0) {
        parts.push("Indexes:");
        parts.push("");
        parts.push(
          markdownTable(
            ["name", "definition"],
            tableIndexes.map((index) => [index.indexname, index.indexdef])
          )
        );
        parts.push("");
      }
    }

    parts.push("## Data");
    parts.push("");
    for (const table of tables) {
      const tableName = table.table_name;
      const tableColumns = columns.filter((column) => column.table_name === tableName);
      const columnNames = tableColumns.map((column) => column.column_name);
      const rows = tableRowsByName.get(tableName) ?? [];

      parts.push(`### ${tableName}`);
      parts.push("");
      parts.push(`Rows: ${rows.length}`);
      parts.push("");

      if (rows.length === 0) {
        parts.push("_No rows._");
        parts.push("");
        continue;
      }

      parts.push(markdownTable(columnNames, rows.map((row) => columnNames.map((column) => row[column]))));
      parts.push("");

      parts.push("<details>");
      parts.push("<summary>SQL INSERT statements</summary>");
      parts.push("");
      parts.push("```sql");
      for (const row of rows) {
        const values = columnNames.map((column) => sqlLiteral(row[column]));
        parts.push(
          `INSERT INTO ${quotedIdent(tableName)} (${columnNames.map(quotedIdent).join(", ")}) VALUES (${values.join(", ")});`
        );
      }
      parts.push("```");
      parts.push("");
      parts.push("</details>");
      parts.push("");
    }

    await mkdir(outputDir, { recursive: true });
    await writeFile(outPath, parts.join("\n"), "utf8");
    console.log(outPath);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
