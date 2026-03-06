import { loadMaintenancePrimaryAssignments } from "@/app/lib/preventative-maintenance";

export type MaintenanceRequestAssignee = {
  locationId: string;
  locationName: string;
  userId: string;
  userName: string;
  userEmail: string;
};

export type MaintenanceRequestStatusValue = "OPEN" | "RESOLVED" | "ARCHIVED";

export function normalizeMaintenanceRequestStatus(raw: string | null | undefined): MaintenanceRequestStatusValue {
  const value = String(raw ?? "OPEN").trim().toUpperCase();
  if (value === "RESOLVED") return "RESOLVED";
  if (value === "ARCHIVED") return "ARCHIVED";
  return "OPEN";
}

export async function loadMaintenanceRequestAssignees(): Promise<MaintenanceRequestAssignee[]> {
  const assignments = await loadMaintenancePrimaryAssignments();
  const out: MaintenanceRequestAssignee[] = [];

  for (const row of assignments) {
    out.push({
      locationId: row.locationId,
      locationName: row.locationName,
      userId: row.userId,
      userName: row.userName,
      userEmail: row.userEmail,
    });
  }

  return out.sort((a, b) => {
    if (a.locationName !== b.locationName) return a.locationName.localeCompare(b.locationName);
    if (a.userName !== b.userName) return a.userName.localeCompare(b.userName);
    return a.userEmail.localeCompare(b.userEmail);
  });
}

export function computeAverageResolutionHours(
  rows: Array<{ createdAt: Date; resolvedAt: Date | null }>
): number | null {
  let totalMs = 0;
  let count = 0;

  for (const row of rows) {
    if (!row.resolvedAt) continue;
    const diff = row.resolvedAt.getTime() - row.createdAt.getTime();
    if (!Number.isFinite(diff) || diff < 0) continue;
    totalMs += diff;
    count += 1;
  }

  if (count === 0) return null;
  return totalMs / count / 3_600_000;
}
