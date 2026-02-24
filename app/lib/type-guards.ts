// app/lib/type-guards.ts
export type JsonRecord = Record<string, unknown>;

export function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null;
}

export function hasFn<T extends string>(obj: unknown, name: T): obj is JsonRecord & Record<T, (...args: unknown[]) => unknown> {
  return isRecord(obj) && typeof (obj as JsonRecord)[name] === "function";
}

export function getString(obj: unknown, key: string): string | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

export function getNumber(obj: unknown, key: string): number | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function getBoolean(obj: unknown, key: string): boolean | null {
  if (!isRecord(obj)) return null;
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}
