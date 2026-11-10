// Shared canonical identity check for the seeded full-administrator role.
export function isSystemAdminRoleName(name: string): boolean {
  return name.trim().toUpperCase() === "ADMIN";
}
