"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireNotificationUser } from "./actions";
import { setNotificationOversightEnabled } from "@/app/lib/notification-oversight";

export async function saveNotificationOversightPreference(formData: FormData) {
  const user = await requireNotificationUser();
  const enabled = ["on", "true", "1"].includes(String(formData.get("oversightEnabled") ?? "").toLowerCase());
  // Eligibility is reloaded from current DB roles inside the transaction;
  // generic module managers and stale session administrator claims do not pass.
  await setNotificationOversightEnabled(user.id, enabled);
  revalidatePath("/notifications");
  redirect("/notifications?oversightSaved=1");
}
