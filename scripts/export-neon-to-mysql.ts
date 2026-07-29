import { PrismaClient } from "@prisma/client";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type TableInfo = {
  table_name: string;
};

type ColumnInfo = {
  table_name: string;
  column_name: string;
  ordinal_position: number;
};

const workspaceRoot = process.cwd();
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join(workspaceRoot, "exports", `neon-to-mysql-${timestamp}`);

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

function quoteIdent(identifier: string) {
  return `\`${identifier.replace(/`/g, "``")}\``;
}

function quotePgIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function isDecimalLike(value: unknown): value is { toString(): string } {
  return (
    typeof value === "object" &&
    value !== null &&
    value.constructor?.name === "Decimal" &&
    typeof (value as { toString?: unknown }).toString === "function"
  );
}

function formatDateForMysql(value: Date) {
  return value.toISOString().replace("T", " ").replace("Z", "");
}

function sqlString(value: string) {
  return `'${value
    .replace(/\\/g, "\\\\")
    .replace(/\0/g, "\\0")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\u001a/g, "\\Z")
    .replace(/'/g, "''")}'`;
}

function mysqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return sqlString(formatDateForMysql(value));
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return `X'${value.toString("hex")}'`;
  if (isDecimalLike(value)) return value.toString();
  if (typeof value === "object") return sqlString(JSON.stringify(value));
  return sqlString(String(value));
}

function toMysqlPrismaSchema(schema: string) {
  return schema
    .replace(/provider\s*=\s*"postgresql"/, 'provider = "mysql"')
    .replace(/\n\s*directUrl\s*=\s*env\("DIRECT_URL"\)/, "");
}

async function main() {
  await loadEnv();
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in .env.local or .env.");
  }

  await mkdir(outputDir, { recursive: true });

  const postgresSchema = await readFile(path.join(workspaceRoot, "prisma", "schema.prisma"), "utf8");
  await writeFile(path.join(outputDir, "schema.postgres.prisma"), postgresSchema);
  await writeFile(path.join(outputDir, "schema.mysql.prisma"), toMysqlPrismaSchema(postgresSchema));

  const prisma = new PrismaClient();
  const manifest: Array<{ table: string; rows: number }> = [];
  const data: Record<string, Array<Record<string, unknown>>> = {};
  const sqlLines: string[] = [
    "-- Generated from Neon Postgres for MySQL import.",
    "-- Load schema first, then run this data import.",
    "SET FOREIGN_KEY_CHECKS=0;",
    "SET SQL_MODE='NO_AUTO_VALUE_ON_ZERO';",
    "",
  ];

  try {
    const tables = await prisma.$queryRaw<TableInfo[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name <> '_prisma_migrations'
      ORDER BY table_name
    `;

    const columns = await prisma.$queryRaw<ColumnInfo[]>`
      SELECT table_name, column_name, ordinal_position
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `;

    const columnsByTable = new Map<string, string[]>();
    for (const column of columns) {
      const tableColumns = columnsByTable.get(column.table_name) ?? [];
      tableColumns.push(column.column_name);
      columnsByTable.set(column.table_name, tableColumns);
    }

    for (const table of tables) {
      const tableName = table.table_name;
      const tableColumns = columnsByTable.get(tableName) ?? [];
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT * FROM public.${quotePgIdent(tableName)}`
      );

      data[tableName] = rows;
      manifest.push({ table: tableName, rows: rows.length });

      if (rows.length === 0 || tableColumns.length === 0) continue;

      sqlLines.push(`-- ${tableName}: ${rows.length} row(s)`);
      const columnSql = tableColumns.map(quoteIdent).join(", ");

      for (let index = 0; index < rows.length; index += 200) {
        const chunk = rows.slice(index, index + 200);
        const valuesSql = chunk
          .map((row) => `(${tableColumns.map((column) => mysqlValue(row[column])).join(", ")})`)
          .join(",\n");
        sqlLines.push(`INSERT INTO ${quoteIdent(tableName)} (${columnSql}) VALUES\n${valuesSql};`);
      }

      sqlLines.push("");
    }

    sqlLines.push("SET FOREIGN_KEY_CHECKS=1;", "");

    await writeFile(path.join(outputDir, "data.json"), JSON.stringify(data, null, 2));
    await writeFile(path.join(outputDir, "mysql-data.sql"), sqlLines.join("\n"));
    await writeFile(path.join(outputDir, "manifest.json"), JSON.stringify({ exportedAt: new Date().toISOString(), tables: manifest }, null, 2));

    const totalRows = manifest.reduce((sum, table) => sum + table.rows, 0);
    console.log(`Exported ${manifest.length} tables and ${totalRows} rows to ${outputDir}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
