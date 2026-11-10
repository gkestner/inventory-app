import { redirect } from "next/navigation";
import { normalizePmYear } from "@/app/lib/preventative-maintenance";

export const dynamic = "force-dynamic";

/** Keep existing bookmarks while using one authoritative compliance workspace. */
export default async function ReminderListsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const query = new URLSearchParams({ year: String(normalizePmYear(params.year)) });
  for (const key of ["showHidden", "q", "saved", "error"]) if (typeof params[key] === "string") query.set(key, params[key]);
  const section = typeof params.listId === "string" ? params.listId : typeof params.section === "string" ? params.section : "";
  if (section) query.set("section", section);
  redirect(`/admin/preventative-maintenance/compliance?${query}`);
}
