"use client";

import Link from "next/link";
import { useState } from "react";
import type { ComplianceSectionKind } from "@prisma/client";
import type { ComplianceHistoryRecord } from "@/app/lib/compliance-history-fields";
import { recordComplianceEntryAction, saveComplianceRoutingAction, setReminderLocationHiddenAction } from "@/app/admin/notification-reminders/actions";
import PendingButton from "@/app/admin/notification-reminders/PendingButton";
import FormContext from "./ComplianceContextFields";
import EmailRecipientField from "./EmailRecipientField";
import RecipientPicker from "./RecipientPicker";
import ScheduleFields from "./ScheduleFields";
import styles from "./compliance.module.css";

const labels = { overdue: "Overdue", soon: "Due soon", scheduled: "On track", missing: "Needs review", paused: "Paused" };
export type ComplianceStatus = keyof typeof labels;
const time = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" });

type Props = {
  listId: string; locationId: string; reminderLocationId?: string; label: string;
  kind: ComplianceSectionKind | null; latest?: ComplianceHistoryRecord; due: string | null; status: ComplianceStatus;
  hidden: boolean; editable: boolean; canViewHistory: boolean; expanded: boolean; submissionToken?: string;
  year: number; showHidden: boolean; defaultMonths: number;
  recipientNames: string[]; recipientIds: string[]; useLocationRecipients: boolean; includeCategoryRecipients: boolean; hasCategoryRecipients: boolean;
  locationEmails: string[]; effectiveEmailCount: number;
};

export default function ComplianceLocation(props: Props) {
  const { listId, locationId, label, latest, due, status, hidden, expanded } = props;
  const [visited, setVisited] = useState(expanded);
  return <details id={`location-${listId}-${locationId}`} className={`${styles.location} ${hidden ? styles.hiddenRow : ""}`} open={expanded || undefined} onToggle={(event) => {
    if (event.currentTarget.open) setVisited(true);
  }}>
    <summary className={styles.locationSummary}>
      <span className={styles.locationTitle}><strong>{label}</strong>{hidden && <small>Hidden · reminders paused</small>}</span>
      <span className={styles.locationDate}><small>Last service</small><strong>{latest?.serviceDate || "No entry yet"}</strong></span>
      <span className={styles.locationDate}><small>Next due</small><strong>{due ?? "—"}</strong></span>
      <span className={`${styles.statusBadge} ${styles[status]}`}>{labels[status]}</span>
      <span className={styles.locationExpand} aria-hidden="true">＋</span>
    </summary>
    {(expanded || visited) && <LocationBody {...props} />}
  </details>;
}

function LocationBody({ listId, locationId, reminderLocationId, label, latest, kind, hidden, editable, canViewHistory, submissionToken,
  year, showHidden, defaultMonths, recipientNames, recipientIds, useLocationRecipients, includeCategoryRecipients, hasCategoryRecipients, locationEmails, effectiveEmailCount }: Props) {
  const context = { listId, locationId, reminderLocationId, year, showHidden };
  const both = hasCategoryRecipients && includeCategoryRecipients;
  const routing = useLocationRecipients ? both ? "Category and location recipients" : "Location recipients" : hasCategoryRecipients ? "Category recipients" : "Primary maintenance team";
  return <div className={styles.locationBody}>
    {canViewHistory && <div className={styles.locationTools}><Link prefetch={false} className={styles.button} href={`/admin/reports/compliance-history?locationId=${encodeURIComponent(locationId)}`}>All history for this location ↗</Link></div>}
    <div className={editable ? styles.entryComparison : undefined}>
      <section className={styles.lastEntry} aria-label={`Last entry for ${label}`}>
        <div className={styles.entryHeading}><h3>Last entry</h3>{latest && <span>Record year {latest.recordYear}</span>}</div>
        {latest ? <><dl className={styles.entryFacts}>
          <Fact label="Service date" value={latest.serviceDate} />
          <Fact label="Service company" value={latest.companyName} />
          <Fact label="Reminder interval" value={latest.intervalText || `${latest.intervalMonths} months · section default when recorded`} />
          <Fact label="Cost / amount" value={latest.cost} />
          {kind === "GREASE_TRAP" && <><Fact label="Tank size" value={latest.tankSize} /><Fact label="Gallons / PM notes" value={latest.gallons} /></>}
          {kind === "BOILER" && <Fact label="Additional inspection date" value={latest.additionalDate} />}
          <Fact label="Notes" value={latest.notes} />
        </dl><p className={styles.entryMeta}>Recorded {time.format(latest.recordedAt)}{latest.recordedByName ? ` by ${latest.recordedByName}` : ""}. {latest.source === "BASELINE" ? "Preserved from an existing record." : latest.source === "AUDIT" ? "Recovered from change history." : ""}</p></> : <p className={styles.muted}>No service entry has been recorded for this location in this category.</p>}
      </section>
      {editable && <form action={recordComplianceEntryAction} className={styles.newEntry} aria-label={`New entry for ${label}`}>
        <FormContext {...context} />
        <input type="hidden" name="submissionToken" value={submissionToken} />
        <div className={styles.entryHeading}><h3>New entry</h3><span>Record year {year}</span></div>
        <p className={styles.muted}>Previous entries stay in history. Reminders follow the most recent service date.</p>
        <div className={styles.newEntryFields}>
          <ScheduleFields initialInterval={latest?.intervalOverrideMonths?.toString() ?? ""} defaultMonths={defaultMonths} locationLabel={label} />
          <div className={styles.fieldStack}>
            <label>Service company<input name="companyName" list="compliance-company-names" defaultValue={latest?.companyName ?? ""} maxLength={160} /></label>
            <label>Cost / amount<input name="cost" maxLength={500} /></label>
            {kind === "GREASE_TRAP" && <><label>Tank size<input name="tankSize" defaultValue={latest?.tankSize ?? ""} maxLength={500} /></label><label>Gallons / PM notes<input name="gallons" maxLength={500} /></label></>}
            {kind === "BOILER" && <label>Additional inspection date<input name="additionalDate" type="date" /></label>}
          </div>
        </div>
        <label className={styles.notesLabel}>Notes<textarea name="notes" rows={2} maxLength={2000} /></label>
        <div><PendingButton className={styles.primary}>Save new entry</PendingButton></div>
      </form>}
    </div>
    <div className={styles.locationFooter}>
      <div className={styles.recipientSummary}><strong>Notifications</strong><span>{[...recipientNames, ...(effectiveEmailCount ? [`${effectiveEmailCount} email-only ${effectiveEmailCount === 1 ? "address" : "addresses"}`] : [])].join(", ") || "No assigned recipients"}</span><small>{routing}</small></div>
      {editable && <form action={setReminderLocationHiddenAction}><FormContext {...context} /><input type="hidden" name="hidden" value={hidden ? "false" : "true"} /><PendingButton className={styles.button}>{hidden ? "Show & resume" : "Hide & pause"}</PendingButton></form>}
    </div>
    {editable && <details className={styles.sectionSettings}><summary>Change location recipients</summary><form action={saveComplianceRoutingAction} className={styles.routingForm} aria-label={`Recipients for ${label}`}>
      <FormContext {...context} />
      <label className={styles.check}><input type="checkbox" name="useLocationRecipients" defaultChecked={useLocationRecipients} />Choose recipients for this location</label>
      <RecipientPicker selectedIds={recipientIds} name="locationRecipientIds" label="Choose people" />
      <EmailRecipientField addresses={locationEmails} />
      <p className={styles.muted}>{both ? "Category recipients are also included at this location." : "When unchecked, this location uses the category’s recipients."}</p>
      <div><PendingButton className={styles.button}>Save recipients</PendingButton></div>
    </form></details>}
  </div>;
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return <div><dt>{label}</dt><dd>{value || "Not recorded"}</dd></div>;
}
