export default async function AdminAccessTitlesPage({
  searchParams,
}: {
  searchParams?: { titleId?: string };
}) {
  await requireAdmin();

  const titles = await prisma.permissionTitle.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, description: true, active: true },
  });

  if (titles.length === 0) {
    redirect("/admin/access-titles");
  }

  const requestedTitleId =
    typeof searchParams?.titleId === "string" ? searchParams.titleId : null;

  let selectedTitle = requestedTitleId
    ? titles.find((t) => t.id === requestedTitleId)
    : null;

  // ✅ Default WITHOUT redirect (prevents loops)
  if (!selectedTitle) selectedTitle = titles[0];

  const selectedWithPerms = await prisma.permissionTitle.findUnique({
    where: { id: selectedTitle.id },
    select: {
      id: true,
      name: true,
      description: true,
      permissions: { select: { permission: true } },
    },
  });

  const userCount = await prisma.userPermissionTitle.count({
    where: { titleId: selectedTitle.id },
  });

  const selectedPermissions = (selectedWithPerms?.permissions ?? []).map((p) =>
    String(p.permission)
  );

  const allPermissions = Object.values(Permission).map((p) => String(p));

  return (
    <main style={{ padding: 16 }}>
      <div style={{ padding: 16, maxWidth: 1500, margin: "0 auto" }}>
        <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>
          Permissions: {selectedWithPerms?.name ?? selectedTitle.name}
        </h1>

        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          Assigned users: <b>{userCount}</b>
        </div>

        <div style={{ marginTop: 16 }}>
          <PermissionsTreeClient
            allPermissions={allPermissions}
            selectedPermissions={selectedPermissions}
          />
        </div>
      </div>
    </main>
  );
}