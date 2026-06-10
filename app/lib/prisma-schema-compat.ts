function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (error && typeof error === "object") {
    const maybeMsg = (error as Record<string, unknown>).message;
    if (typeof maybeMsg === "string") return maybeMsg;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function getPrismaErrorCode(error: unknown): string | null {
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === "string") return code;
  }
  return null;
}

export function isSchemaOrDbNotReadyError(error: unknown): boolean {
  const code = getPrismaErrorCode(error);
  if (code === "P2021" || code === "P2022") return true;

  const msg = getErrorMessage(error).toLowerCase();
  return (
    msg.includes("does not exist") ||
    msg.includes("unknown column") ||
    msg.includes("unknown field") ||
    msg.includes("invalid `prisma.") ||
    msg.includes("cannot read properties of undefined") ||
    msg.includes("is not a function")
  );
}