import Link from "next/link";

export default function AdminNav() {
  return (
    <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
      <Link href="/admin">Dashboard</Link>
      <Link href="/admin/users">Users</Link>
    </div>
  );
}
