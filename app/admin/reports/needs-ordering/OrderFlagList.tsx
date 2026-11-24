import type { OrderMoreFlag } from "@/app/lib/needs-ordering-report";
import DismissFlagButton from "./DismissFlagButton";

export default function OrderFlagList({ flags, canEdit, dismissAction, returnQuery }: {
  flags: OrderMoreFlag[];
  canEdit: boolean;
  dismissAction: (formData: FormData) => Promise<void>;
  returnQuery: string;
}) {
  if (flags.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 6, marginTop: 6, fontSize: 12, fontWeight: 500 }}>
      {flags.map((flag) => (
        <div key={flag.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{flag.requestedBy}{flag.storeName ? ` · ${flag.storeName}` : ""} · {flag.requestedAtLabel}</span>
          {canEdit ? (
            <form action={dismissAction}>
              <input type="hidden" name="flagId" value={flag.id} />
              <input type="hidden" name="returnQuery" value={returnQuery} />
              <DismissFlagButton description={`from ${flag.requestedBy} on ${flag.requestedAtLabel}`} />
            </form>
          ) : null}
        </div>
      ))}
    </div>
  );
}
