import Link from "next/link";
import { randomUUID } from "node:crypto";
import type { ComplianceDashboardData } from "@/app/lib/compliance-dashboard";
import type { ComplianceHistoryRecord } from "@/app/lib/compliance-history-fields";
import { addReminderMonths, DEFAULT_REMINDER_MONTHS, formatReminderDate, parseReminderDate, parseReminderMonths, reminderToday } from "@/app/lib/reminder-dates";
import { recordComplianceEntryAction, saveComplianceRoutingAction, saveReminderListAction, setReminderListActiveAction, setReminderLocationHiddenAction } from "@/app/admin/notification-reminders/actions";
import PendingButton from "@/app/admin/notification-reminders/PendingButton";
import RecipientPicker from "./RecipientPicker";
import ScheduleFields from "./ScheduleFields";
import styles from "./compliance.module.css";

type Section = ComplianceDashboardData["sections"][number];
type Location = ComplianceDashboardData["locations"][number];
type Setting = Section["locations"][number];
type Filters = { q: string; status: string; showHidden: boolean };
type Status = "overdue" | "soon" | "scheduled" | "missing" | "paused";
type Row = { location: Location; setting?: Setting; latest?: ComplianceHistoryRecord; due: Date | null; status: Status };
type Props = { data: ComplianceDashboardData; year: number; editable: boolean; actorId?: string; filters: Filters; feedback?: { error?: string; saved?: string }; emailConfigured?: boolean; canViewHistory?: boolean; expanded?: { sectionId: string; locationId: string } };

const STATUS_LABELS: Record<Status, string> = { overdue: "Overdue", soon: "Due soon", scheduled: "On track", missing: "Needs review", paused: "Paused" };
function sectionRows(section: Section, data: ComplianceDashboardData, today: Date): Row[] {
  const settings = new Map(section.locations.map((row) => [row.locationId, row]));
  const latestEntries = new Map(data.latestRecords.filter((record) => record.sectionId === section.id).map((record) => [record.locationId, record]));
  return data.locations.map((location) => {
    const setting = settings.get(location.id);
    const latest = latestEntries.get(location.id);
    const date = parseReminderDate(latest?.serviceDate);
    const months = latest?.intervalText ? parseReminderMonths(latest.intervalText) : section.defaultIntervalMonths;
    const due = section.complianceKind ? date && months ? addReminderMonths(date, months) : null : setting?.nextDueOn ?? null;
    const days = due ? Math.round((due.getTime() - today.getTime()) / 86400000) : null;
    const status: Status = !section.active || setting?.hidden ? "paused" : days === null ? "missing" : days < 0 ? "overdue" : days <= 30 ? "soon" : "scheduled";
    return { location, setting, latest, due, status };
  }).sort((a, b) => {
    const number = (location: Location) => location.locationNumber && Number.isFinite(Number(location.locationNumber)) ? Number(location.locationNumber) : Number.MAX_SAFE_INTEGER;
    return number(a.location) - number(b.location) || a.location.name.localeCompare(b.location.name);
  });
}

function matches(row: Row, section: Section, data: ComplianceDashboardData, filters: Filters) {
  if (!filters.showHidden && row.setting?.hidden) return false;
  if (filters.status === "attention" && !["overdue", "soon"].includes(row.status)) return false;
  if (filters.status === "missing" && row.status !== "missing") return false;
  if (filters.status === "paused" && row.status !== "paused") return false;
  if (!filters.q) return true;
  const company = row.latest?.companyName || data.companies.find((company) => company.id === row.setting?.companyId)?.name;
  return `${section.name} ${section.description ?? ""} ${row.location.name} ${row.location.locationNumber ?? ""} ${company ?? ""}`.toLowerCase().includes(filters.q.toLowerCase());
}

export default function ComplianceDashboard({ data, year, editable, actorId, filters, feedback, emailConfigured, canViewHistory = false, expanded }: Props) {
  const today = reminderToday();
  const sections = data.sections.map((section) => ({ section, rows: sectionRows(section, data, today) }));
  const allRows = sections.flatMap((section) => section.rows);
  const overdue = allRows.filter((row) => row.status === "overdue").length;
  const dueSoon = allRows.filter((row) => row.status === "soon").length;
  const visible = sections.map(({ section, rows }) => ({ section, rows, filtered: rows.filter((row) => matches(row, section, data, filters)) })).filter(({ filtered, section }) => filtered.length > 0 || (!filters.q && filters.status === "all" && data.locations.length === 0 && section.active));
  const basePath = editable ? "/admin/preventative-maintenance/compliance" : "/maintenance/preventative-maintenance/compliance";
  return <main className={styles.dashboard}>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>FACILITIES / COMPLIANCE</p><h1>Compliance &amp; Testing</h1><p className={styles.subtitle}>A clear view of service dates, upcoming work, and the people who need to know.</p></div>
      <div className={styles.headerLinks}>{canViewHistory && <Link className={styles.button} href="/admin/reports/compliance-history">Compliance history <span aria-hidden="true">↗</span></Link>}<Link className={styles.button} href={`${editable ? "/admin" : "/maintenance"}/preventative-maintenance?year=${year}`}>PM checklist <span aria-hidden="true">↗</span></Link></div>
    </header>
    <div className={styles.metrics} aria-label="Compliance summary">
      <div><span>Sections</span><strong>{data.sections.length}</strong><small>{data.locations.length} locations</small></div>
      <div className={styles.overdueMetric}><span>Overdue</span><strong>{overdue}</strong><small>Service records to review</small></div>
      <div><span>Due within 30 days</span><strong>{dueSoon}</strong><small>Upcoming reminders</small></div>
      <div><span>New-section default</span><strong>11 <em>months</em></strong><small>Editable by section and location</small></div>
    </div>
    {feedback?.error && <p className={styles.error} role="alert">{feedback.error}</p>}
    {feedback?.saved && <p className={styles.success} role="status">{feedback.saved === "1" ? "Changes saved." : feedback.saved}</p>}
    <form key={`${year}:${filters.q}:${filters.status}:${filters.showHidden}`} method="get" className={styles.toolbar} action={basePath}>
      <label>New entry year<input type="number" name="year" min="2020" max="2100" defaultValue={year} required /></label>
      <label className={styles.search}>Find anything<input type="search" name="q" maxLength={200} defaultValue={filters.q} placeholder="Section, location, or service company…" /></label>
      <label>Show<select name="status" defaultValue={filters.status}><option value="all">All records</option><option value="attention">Needs attention</option><option value="missing">Missing dates</option><option value="paused">Paused</option></select></label>
      <label className={styles.check}><input type="checkbox" name="showHidden" value="1" defaultChecked={filters.showHidden} />Include hidden</label>
      <button type="submit" className={styles.primary}>Apply filters</button>
      {(filters.q || filters.status !== "all" || filters.showHidden) && <Link href={`${basePath}?year=${year}`} className={styles.textButton}>Reset</Link>}
    </form>
    {editable && <details className={styles.addSection}>
      <summary><span aria-hidden="true">＋</span> Add a compliance section <small>Inspections, testing, servicing, and renewals</small></summary>
      <form action={saveReminderListAction} className={styles.settingsForm}>
        <FormContext year={year} showHidden={filters.showHidden} />
        <input type="hidden" name="active" value="on" />
        <label>Section name<input name="name" required maxLength={160} placeholder="e.g. Fire extinguisher testing" /></label>
        <label>Repeat every (months)<input name="defaultIntervalMonths" type="number" min="1" max="120" defaultValue={DEFAULT_REMINDER_MONTHS} required /></label>
        <label className={styles.full}>Description<textarea name="description" maxLength={500} rows={2} placeholder="What should be checked or recorded?" /></label>
        <input type="hidden" name="sortOrder" value={1000} />
        <div className={styles.full}><RecipientPicker users={data.users} selectedIds={actorId ? [actorId] : []} /></div>
        <p className={`${styles.muted} ${styles.full}`}>Choose several people if needed. Each active location gets its own date, company, and optional interval and recipient overrides.</p>
        <div><PendingButton className={styles.primary}>Create section</PendingButton></div>
      </form>
    </details>}
    <div className={styles.sectionIntro}><h2>Your sections <span>{visible.length}</span></h2><p>Open a section, then a location to see its last entry or add a new one.</p></div>
    {editable && <datalist id="compliance-company-names">{data.companies.map((company) => <option key={company.id} value={company.name} />)}</datalist>}
    <div className={styles.sections}>
      {visible.map(({ section, rows, filtered }) => <details key={section.id} id={`section-${section.id}`} className={styles.section} open={expanded?.sectionId === section.id || undefined}>
        <summary className={styles.sectionSummary}>
          <span className={styles.sectionIcon} aria-hidden="true">{section.complianceKind === "GREASE_TRAP" ? "G" : section.complianceKind === "BACKFLOW" ? "B" : section.complianceKind === "BOILER" ? "T" : section.name.slice(0, 1).toUpperCase()}</span>
          <span className={styles.sectionTitle}><strong>{section.name}</strong><small>{section.description || "Service entries and recurring reminders"}</small></span>
          <span className={styles.summaryStats}><span>{filtered.length} locations</span><span>{section.recipients.length ? `${section.recipients.length} recipient${section.recipients.length === 1 ? "" : "s"}` : "Location maintenance team"}</span></span>
          <span className={styles.summaryBadges}>{!section.active ? <span className={styles.pausedBadge}>Paused</span> : <>{rows.some((row) => row.status === "overdue") && <span className={styles.dangerBadge}>{rows.filter((row) => row.status === "overdue").length} overdue</span>}{rows.some((row) => row.status === "soon") && <span className={styles.warningBadge}>{rows.filter((row) => row.status === "soon").length} due soon</span>}{rows.some((row) => row.status === "missing") && <span className={styles.pausedBadge}>{rows.filter((row) => row.status === "missing").length} missing dates</span>}{!rows.some((row) => ["overdue", "soon", "missing"].includes(row.status)) && <span className={styles.goodBadge}>No urgent items</span>}</>}</span>
          <span className={styles.expandIcon} aria-hidden="true">＋</span>
        </summary>
        <div className={styles.sectionBody}>
          <div className={styles.sectionGuide}><p>Latest service entries are shown across all years. Add a new entry to keep the previous one in history. Blank intervals use <strong>{section.defaultIntervalMonths} months</strong>.</p>
            <div className={styles.headerLinks}>{canViewHistory && <Link className={styles.button} href={`/admin/reports/compliance-history?sectionId=${encodeURIComponent(section.id)}`}>Section history</Link>}{editable && <form action={setReminderListActiveAction}><FormContext listId={section.id} year={year} showHidden={filters.showHidden} /><input type="hidden" name="active" value={section.active ? "false" : "true"} /><PendingButton className={styles.button}>{section.active ? "Pause section" : "Resume section"}</PendingButton></form>}</div>
          </div>
          {editable && <details className={styles.sectionSettings}>
            <summary>Edit section &amp; recipients</summary>
            <form key={section.updatedAt.toISOString()} action={saveReminderListAction} className={styles.settingsForm}>
              <FormContext listId={section.id} year={year} showHidden={filters.showHidden} />
              <label>Section name<input name="name" defaultValue={section.name} required maxLength={160} /></label>
              <label>Default interval (months)<input name="defaultIntervalMonths" type="number" min="1" max="120" defaultValue={section.defaultIntervalMonths} required /></label>
              <label className={styles.full}>Description<textarea name="description" rows={2} maxLength={500} defaultValue={section.description ?? ""} /></label>
              <label>Display order<input name="sortOrder" type="number" min="0" max="10000" defaultValue={section.sortOrder} /></label>
              <div className={styles.full}><RecipientPicker users={data.users} selectedIds={section.recipients.map((recipient) => recipient.userId)} /></div>
              <p className={`${styles.muted} ${styles.full}`}>{section.complianceKind ? "Leave recipients empty to notify each location’s primary maintenance team. Individual locations can have their own recipients." : "Choose at least one recipient. You can choose different people for individual locations below."}</p>
              <div><PendingButton className={styles.primary}>Save section settings</PendingButton></div>
            </form>
          </details>}
          <div className={styles.locations} aria-label={`${section.name} locations`}>{filtered.map((row) => <LocationRow key={`${section.id}:${row.location.id}:${row.setting?.updatedAt.toISOString() ?? ""}:${row.latest?.id ?? ""}`} row={row} section={section} data={data} year={year} editable={editable} showHidden={filters.showHidden} canViewHistory={canViewHistory} expanded={expanded?.sectionId === section.id && expanded?.locationId === row.location.id} />)}</div>
          <p className={styles.sectionFootnote}>{editable ? "Every new service entry is kept in history. Hide & pause stops reminders while retaining all records. Use Include hidden to show and resume locations." : "Your view is limited to your assigned maintenance locations. Contact a compliance administrator to add a service entry."}</p>
        </div>
      </details>)}
      {visible.length === 0 && <div className={styles.empty}><strong>No matching records</strong><p>Try clearing filters or including hidden locations.</p></div>}
    </div>
    <p className={styles.footerNote}>{emailConfigured === false ? "Email setup is pending. " : ""}New sections default to 11 months from the date entered. Use the Reports Hub for the complete history by location or section.</p>
  </main>;
}

function LocationRow({ row, section, data, year, editable, showHidden, canViewHistory, expanded }: { row: Row; section: Section; data: ComplianceDashboardData; year: number; editable: boolean; showHidden: boolean; canViewHistory: boolean; expanded: boolean }) {
  const { location, setting, latest, due, status } = row;
  const formId = `entry-${section.id}-${location.id}`;
  const label = `${location.locationNumber ? `${location.locationNumber} · ` : ""}${location.name}`;
  const primaryNames = data.assignments.filter((assignment) => assignment.locationId === location.id).map((assignment) => assignment.userName);
  const selectedPeople = setting?.useLocationRecipients ? setting.recipients.map((recipient) => recipient.userId) : section.recipients.map((recipient) => recipient.userId);
  const names = selectedPeople.length ? selectedPeople.map((id) => data.users.find((user) => user.id === id)?.name || "Inactive user") : primaryNames;
  return <details id={`location-${section.id}-${location.id}`} className={`${styles.location} ${setting?.hidden ? styles.hiddenRow : ""}`} open={expanded || undefined}>
    <summary className={styles.locationSummary}>
      <span className={styles.locationTitle}><strong>{label}</strong>{setting?.hidden && <small>Hidden · reminders paused</small>}</span>
      <span className={styles.locationDate}><small>Last service</small><strong>{latest?.serviceDate || "No entry yet"}</strong></span>
      <span className={styles.locationDate}><small>Next due</small><strong>{due ? formatReminderDate(due) : "—"}</strong></span>
      <span className={`${styles.statusBadge} ${styles[status]}`}>{STATUS_LABELS[status]}</span>
      <span className={styles.locationExpand} aria-hidden="true">＋</span>
    </summary>
    <div className={styles.locationBody}>
      <div className={styles.locationTools}><p className={styles.muted}>Last service and a new entry, together in one place.</p>{canViewHistory && <Link className={styles.button} href={`/admin/reports/compliance-history?locationId=${encodeURIComponent(location.id)}`}>All history for this location ↗</Link>}</div>
      <div className={editable ? styles.entryComparison : undefined}>
        <section className={styles.lastEntry} aria-label={`Last entry for ${label}`}>
          <div className={styles.entryHeading}><h3>Last entry</h3>{latest && <span>Record year {latest.recordYear}</span>}</div>
          {latest ? <><dl className={styles.entryFacts}>
            <Fact label="Service date" value={latest.serviceDate} />
            <Fact label="Service company" value={latest.companyName} />
            <Fact label="Reminder interval" value={latest.intervalText || `${latest.intervalMonths} months · section default when recorded`} />
            <Fact label="Cost / amount" value={latest.cost} />
            {section.complianceKind === "GREASE_TRAP" && <><Fact label="Tank size" value={latest.tankSize} /><Fact label="Gallons / PM notes" value={latest.gallons} /></>}
            {section.complianceKind === "BOILER" && <Fact label="Additional inspection date" value={latest.additionalDate} />}
            <Fact label="Notes" value={latest.notes} />
          </dl><p className={styles.entryMeta}>Recorded {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(latest.recordedAt)}{latest.recordedByName ? ` by ${latest.recordedByName}` : ""}. {latest.source === "BASELINE" ? "Preserved from an existing record." : latest.source === "AUDIT" ? "Recovered from change history." : ""}</p></> : <p className={styles.muted}>No service entry has been recorded for this location in this section.</p>}
        </section>
        {editable && <form id={formId} action={recordComplianceEntryAction} className={styles.newEntry} aria-label={`New entry for ${label}`}>
          <FormContext listId={section.id} year={year} showHidden={showHidden} />
          <input type="hidden" name="locationId" value={location.id} />
          <input type="hidden" name="submissionToken" value={randomUUID()} />
          <div className={styles.entryHeading}><h3>New entry</h3><span>Record year {year}</span></div>
          <p className={styles.muted}>Record another service visit. Your previous entries stay in history.</p>
          <div className={styles.newEntryFields}>
            <ScheduleFields formId={formId} dateName="serviceDate" intervalName="intervalMonths" initialDate="" initialInterval={latest?.intervalOverrideMonths ? String(latest.intervalOverrideMonths) : ""} defaultMonths={section.defaultIntervalMonths} locationLabel={label} custom={false} required />
            <div className={styles.fieldStack}>
              <label>Service company<input name="companyName" list="compliance-company-names" defaultValue={latest?.companyName ?? ""} maxLength={160} /></label>
              <label>Cost / amount<input name="cost" maxLength={500} /></label>
              {section.complianceKind === "GREASE_TRAP" && <><label>Tank size<input name="tankSize" defaultValue={latest?.tankSize ?? ""} maxLength={500} /></label><label>Gallons / PM notes<input name="gallons" maxLength={500} /></label></>}
              {section.complianceKind === "BOILER" && <label>Additional inspection date<input name="additionalDate" type="date" /></label>}
            </div>
          </div>
          <label className={styles.notesLabel}>Notes<textarea name="notes" rows={2} maxLength={2000} /></label>
          <p className={styles.muted}>Reminders follow the most recent service date. Earlier dates are saved in history.</p>
          <div><PendingButton className={styles.primary}>Save new entry</PendingButton></div>
        </form>}
      </div>
      <div className={styles.locationFooter}>
        <div className={styles.recipientSummary}><strong>Notifications</strong><span>{names.length ? names.join(", ") : "No assigned recipients"}</span><small>{setting?.useLocationRecipients ? "Location override" : section.recipients.length ? "Section recipients" : "Primary maintenance team"}</small></div>
        {editable && <form action={setReminderLocationHiddenAction}><FormContext listId={section.id} year={year} showHidden={showHidden} /><input type="hidden" name="locationId" value={location.id} /><input type="hidden" name="reminderLocationId" value={setting?.id ?? ""} /><input type="hidden" name="hidden" value={setting?.hidden ? "false" : "true"} /><PendingButton className={styles.button}>{setting?.hidden ? "Show & resume" : "Hide & pause"}</PendingButton></form>}
      </div>
      {editable && <details className={styles.sectionSettings}><summary>Change notification recipients</summary><form action={saveComplianceRoutingAction} className={styles.routingForm}>
        <FormContext listId={section.id} year={year} showHidden={showHidden} /><input type="hidden" name="locationId" value={location.id} /><input type="hidden" name="reminderLocationId" value={setting?.id ?? ""} />
        <label className={styles.check}><input type="checkbox" name="useLocationRecipients" defaultChecked={setting?.useLocationRecipients ?? false} />Use different people for this location</label>
        <RecipientPicker users={data.users} selectedIds={setting?.recipients.map((recipient) => recipient.userId) ?? []} name="locationRecipientIds" label="Choose people" />
        <p className={styles.muted}>When unchecked, this location uses the section’s recipients. Changing recipients leaves the service history unchanged.</p>
        <div><PendingButton className={styles.button}>Save recipients</PendingButton></div>
      </form></details>}
    </div>
  </details>;
}

function Fact({ label, value }: { label: string; value?: string | null }) {
  return <div><dt>{label}</dt><dd>{value || "Not recorded"}</dd></div>;
}

function FormContext({ listId, year, showHidden }: { listId?: string; year: number; showHidden: boolean }) {
  return <><input type="hidden" name="listId" value={listId ?? ""} /><input type="hidden" name="year" value={year} /><input type="hidden" name="showHidden" value={showHidden ? "1" : "0"} /></>;
}
