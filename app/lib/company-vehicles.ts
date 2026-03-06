import { prisma } from "@/app/lib/prisma";

export type VehicleMileageSource = "MANUAL" | "WORK_ORDERS_BY_ASSIGNED_USER";
export type VehicleReminderType = "TIME_BASED" | "MILEAGE_BASED";

export type CompanyVehicleLite = {
  id: string;
  name: string;
  vinNumber: string | null;
  licensePlate: string | null;
  active: boolean;
  mileageSource: VehicleMileageSource;
  currentMileage: number | null;
  assignedUserId: string | null;
};

export type VehicleReminderLite = {
  id: string;
  vehicleId: string;
  title: string;
  description: string | null;
  reminderType: VehicleReminderType;
  intervalDays: number | null;
  intervalMiles: number | null;
  lastCompletedAt: Date | null;
  lastCompletedMileage: number | null;
  active: boolean;
};

export type DueVehicleReminder = {
  reminderId: string;
  vehicleId: string;
  vehicleName: string;
  title: string;
  reminderType: VehicleReminderType;
  due: boolean;
  milesRemaining: number | null;
  daysRemaining: number | null;
  currentMileage: number | null;
  nextDueMileage: number | null;
  nextDueDate: Date | null;
};

type Db = {
  workOrder: {
    findMany: (args: unknown) => Promise<
      Array<{ createdByUserId: string; endingMileage: number | null; startingMileage: number | null; createdAt: Date }>
    >;
  };
};

const db = prisma as unknown as Db;

export function parseOptionalInt(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export function parseOptionalDecimal(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

export function parseOptionalDateTimeLocal(raw: FormDataEntryValue | null): Date | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function fmtDateTimeLocalInput(d: Date): string {
  const x = new Date(d);
  const y = x.getFullYear();
  const mo = String(x.getMonth() + 1).padStart(2, "0");
  const da = String(x.getDate()).padStart(2, "0");
  const h = String(x.getHours()).padStart(2, "0");
  const mi = String(x.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${da}T${h}:${mi}`;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function resolveVehicleCurrentMileageMap(vehicles: CompanyVehicleLite[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();

  const byUser: string[] = [];
  for (const v of vehicles) {
    if (v.mileageSource === "WORK_ORDERS_BY_ASSIGNED_USER" && v.assignedUserId) byUser.push(v.assignedUserId);
  }

  const userIds = Array.from(new Set(byUser));
  const latestMileageByUser = new Map<string, number>();

  if (userIds.length > 0) {
    const rows = await db.workOrder.findMany({
      where: {
        status: "SUBMITTED",
        createdByUserId: { in: userIds },
        OR: [{ endingMileage: { not: null } }, { startingMileage: { not: null } }],
      },
      orderBy: [{ createdByUserId: "asc" }, { createdAt: "desc" }],
      select: { createdByUserId: true, endingMileage: true, startingMileage: true, createdAt: true },
      take: 5000,
    });

    for (const row of rows) {
      if (latestMileageByUser.has(row.createdByUserId)) continue;
      const mileage = typeof row.endingMileage === "number" ? row.endingMileage : row.startingMileage;
      if (typeof mileage !== "number") continue;
      latestMileageByUser.set(row.createdByUserId, mileage);
    }
  }

  for (const v of vehicles) {
    if (v.mileageSource === "WORK_ORDERS_BY_ASSIGNED_USER" && v.assignedUserId) {
      out.set(v.id, latestMileageByUser.get(v.assignedUserId) ?? v.currentMileage ?? null);
    } else {
      out.set(v.id, v.currentMileage ?? null);
    }
  }

  return out;
}

export function evaluateVehicleReminder(args: {
  reminder: VehicleReminderLite;
  vehicle: CompanyVehicleLite;
  currentMileage: number | null;
  now: Date;
}): DueVehicleReminder {
  const { reminder, vehicle, currentMileage, now } = args;

  if (reminder.reminderType === "MILEAGE_BASED") {
    const base = reminder.lastCompletedMileage ?? currentMileage ?? null;
    const interval = reminder.intervalMiles ?? null;
    const nextDueMileage = base !== null && interval !== null ? base + interval : null;
    const milesRemaining =
      nextDueMileage !== null && currentMileage !== null ? Math.max(0, nextDueMileage - currentMileage) : null;
    const due = nextDueMileage !== null && currentMileage !== null ? currentMileage >= nextDueMileage : false;

    return {
      reminderId: reminder.id,
      vehicleId: vehicle.id,
      vehicleName: vehicle.name,
      title: reminder.title,
      reminderType: reminder.reminderType,
      due,
      milesRemaining,
      daysRemaining: null,
      currentMileage,
      nextDueMileage,
      nextDueDate: null,
    };
  }

  const baseDate = reminder.lastCompletedAt ?? now;
  const intervalDays = reminder.intervalDays ?? null;
  const nextDueDate = intervalDays !== null ? addDays(baseDate, intervalDays) : null;
  const daysRemaining =
    nextDueDate !== null ? Math.max(0, Math.ceil((nextDueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))) : null;
  const due = nextDueDate !== null ? now.getTime() >= nextDueDate.getTime() : false;

  return {
    reminderId: reminder.id,
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    title: reminder.title,
    reminderType: reminder.reminderType,
    due,
    milesRemaining: null,
    daysRemaining,
    currentMileage,
    nextDueMileage: null,
    nextDueDate,
  };
}
