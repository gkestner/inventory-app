import { Prisma, WorkOrderStatus } from "@prisma/client";

const TZ = "America/New_York";

type WorkOrderNumberRecord = {
  id: string;
  createdAt: Date;
  startTime: Date | null;
  endTime: Date | null;
  workOrderNumber: string | null;
  createdByUser: {
    name: string | null;
    email: string;
  } | null;
  location: {
    name: string;
    locationNumber: string | null;
  } | null;
};

type FinalizePendingWorkOrdersParams = {
  actorUserId?: string | null;
  ids?: string[];
  where?: Prisma.WorkOrderWhereInput;
};

type WorkOrderNumberTx = {
  workOrder: {
    findMany: (args: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any | null>;
    update: (args: any) => Promise<any>;
  };
};

export type FinalizedWorkOrderRow = {
  id: string;
  workOrderNumber: string;
  createdByUser: {
    name: string | null;
    email: string;
  } | null;
  location: {
    name: string;
    locationNumber: string | null;
  } | null;
};

function getDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    month: get("month"),
    day: get("day"),
    year: get("year"),
  };
}

function effectiveWorkOrderDate(row: Pick<WorkOrderNumberRecord, "endTime" | "startTime" | "createdAt">): Date {
  return row.endTime ?? row.startTime ?? row.createdAt;
}

function toUserInitials(name: string | null | undefined, email: string | null | undefined): string {
  const rawName = String(name ?? "").trim();
  const tokens = rawName
    .split(/[^A-Za-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length >= 2) {
    return `${tokens[0].charAt(0)}${tokens[1].charAt(0)}`.toUpperCase();
  }

  if (tokens.length === 1) {
    const token = tokens[0].toUpperCase();
    return `${token.charAt(0)}${token.charAt(1) || token.charAt(0) || "X"}`;
  }

  const localPart = String(email ?? "")
    .split("@")[0]
    ?.replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase();

  if (localPart) {
    return `${localPart.charAt(0)}${localPart.charAt(1) || localPart.charAt(0) || "X"}`;
  }

  return "XX";
}

export function buildWorkOrderNumberBase(row: WorkOrderNumberRecord): string {
  const locationNumber = String(row.location?.locationNumber ?? "").trim();
  if (!locationNumber) {
    const locationLabel = row.location?.name?.trim() || row.id;
    throw new Error(`Location number is required before generating work order ${locationLabel}.`);
  }

  const date = effectiveWorkOrderDate(row);
  const { month, day, year } = getDateParts(date);
  const initials = toUserInitials(row.createdByUser?.name, row.createdByUser?.email);
  return `${month}${day}${year}${initials}-${locationNumber}`;
}

async function reserveWorkOrderNumbers(
  tx: WorkOrderNumberTx,
  rows: WorkOrderNumberRecord[]
): Promise<Map<string, string>> {
  const orderedRows = [...rows].sort((left, right) => {
    const leftUser = `${left.createdByUser?.name ?? ""}|${left.createdByUser?.email ?? ""}`.toLowerCase();
    const rightUser = `${right.createdByUser?.name ?? ""}|${right.createdByUser?.email ?? ""}`.toLowerCase();
    if (leftUser !== rightUser) return leftUser.localeCompare(rightUser);

    const leftDate = effectiveWorkOrderDate(left).getTime();
    const rightDate = effectiveWorkOrderDate(right).getTime();
    if (leftDate !== rightDate) return leftDate - rightDate;

    return left.id.localeCompare(right.id);
  });

  const uniqueBases = Array.from(new Set(orderedRows.map((row) => buildWorkOrderNumberBase(row))));
  const existingRows =
    uniqueBases.length > 0
      ? ((await tx.workOrder.findMany({
          where: {
            OR: uniqueBases.flatMap((base) => [{ workOrderNumber: base }, { workOrderNumber: { startsWith: `${base}-` } }]),
          },
          select: { workOrderNumber: true },
        })) as Array<{ workOrderNumber: string | null }>)
      : [];

  const usedNumbers = new Set(
    existingRows
      .map((row) => row.workOrderNumber)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
  );

  const assignments = new Map<string, string>();

  for (const row of orderedRows) {
    if (row.workOrderNumber?.trim()) {
      assignments.set(row.id, row.workOrderNumber.trim());
      usedNumbers.add(row.workOrderNumber.trim());
      continue;
    }

    const base = buildWorkOrderNumberBase(row);
    let candidate = base;
    let sequence = 2;

    while (usedNumbers.has(candidate)) {
      candidate = `${base}-${sequence}`;
      sequence += 1;
    }

    usedNumbers.add(candidate);
    assignments.set(row.id, candidate);
  }

  return assignments;
}

export async function finalizePendingWorkOrders(
  tx: WorkOrderNumberTx,
  params: FinalizePendingWorkOrdersParams
): Promise<FinalizedWorkOrderRow[]> {
  const ids = Array.from(new Set((params.ids ?? []).map((id) => id.trim()).filter(Boolean)));

  const rows = (await tx.workOrder.findMany({
    where: {
      ...(params.where ?? {}),
      ...(ids.length > 0 ? { id: { in: ids } } : {}),
      status: WorkOrderStatus.SUBMITTED,
    },
    orderBy: [{ createdByUserId: "asc" }, { endTime: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      createdAt: true,
      startTime: true,
      endTime: true,
      workOrderNumber: true,
      createdByUser: { select: { name: true, email: true } },
      location: { select: { name: true, locationNumber: true } },
    },
  })) as WorkOrderNumberRecord[];

  if (rows.length === 0) return [];

  const assignments = await reserveWorkOrderNumbers(tx, rows);
  const generatedAt = new Date();

  for (const row of rows) {
    const workOrderNumber = assignments.get(row.id);
    if (!workOrderNumber) {
      throw new Error(`Unable to generate a work order number for ${row.id}.`);
    }

    await tx.workOrder.update({
      where: { id: row.id },
      data: {
        status: WorkOrderStatus.FINALIZED,
        workOrderNumber,
        generatedAt,
        updatedByUserId: params.actorUserId ?? undefined,
      },
    });
  }

  return rows.map((row) => ({
    id: row.id,
    workOrderNumber: assignments.get(row.id) ?? row.workOrderNumber ?? row.id,
    createdByUser: row.createdByUser,
    location: row.location,
  }));
}

export async function ensureFinalizedWorkOrderNumber(
  tx: WorkOrderNumberTx,
  workOrderId: string,
  actorUserId?: string | null
): Promise<string> {
  const row = (await tx.workOrder.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      status: true,
      generatedAt: true,
      createdAt: true,
      startTime: true,
      endTime: true,
      workOrderNumber: true,
      createdByUser: { select: { name: true, email: true } },
      location: { select: { name: true, locationNumber: true } },
    },
  })) as (WorkOrderNumberRecord & { status: WorkOrderStatus; generatedAt: Date | null }) | null;

  if (!row) throw new Error("Work order not found.");
  if (row.status !== WorkOrderStatus.FINALIZED) {
    throw new Error("Work order must be generated before assigning a generated number.");
  }

  if (row.workOrderNumber?.trim()) {
    return row.workOrderNumber.trim();
  }

  const assignments = await reserveWorkOrderNumbers(tx, [row]);
  const workOrderNumber = assignments.get(row.id);
  if (!workOrderNumber) throw new Error("Unable to generate work order number.");

  await tx.workOrder.update({
    where: { id: row.id },
    data: {
      workOrderNumber,
      generatedAt: row.generatedAt ?? new Date(),
      updatedByUserId: actorUserId ?? undefined,
    },
  });

  return workOrderNumber;
}