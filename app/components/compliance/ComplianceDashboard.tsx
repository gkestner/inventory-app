import Link from "next/link";
import type { ComplianceDashboardData } from "@/app/lib/compliance-dashboard";
import { PM_REMINDER_RULES } from "@/app/lib/pm-compliance-rules";
import { addReminderMonths, DEFAULT_REMINDER_MONTHS, formatReminderDate, parseReminderDate, parseReminderMonths, reminderToday } from "@/app/lib/reminder-dates";
import { saveComplianceLocationAction, saveReminderCompanyAction, saveReminderListAction, saveReminderLocationAction, setReminderListActiveAction, setReminderLocationHiddenAction } from "@/app/admin/notification-reminders/actions";
import PendingButton from "@/app/admin/notification-reminders/PendingButton";
import RecipientPicker from "./RecipientPicker";
import ScheduleFields from "./ScheduleFields";
import styles from "./compliance.module.css";

type Section = ComplianceDashboardData["sections"][number];
type Location = ComplianceDashboardData["locations"][number];
type Entry = ComplianceDashboardData["entries"][number];
type Setting = Section["locations"][number];
type Filters = { q: string; status: string; showHidden: boolean };
type Status = "overdue" | "soon" | "scheduled" | "missing" | "paused";
type Row = { location: Location; setting?: Setting; entry?: Entry; due: Date | null; status: Status };
type Props = { data: ComplianceDashboardData; year: number; editable: boolean; actorId?: string; filters: Filters; feedback?: { error?: string; saved?: string }; emailConfigured?: boolean };

const STATUS_LABELS: Record<Status, string> = { overdue: "Overdue", soon: "Due soon", scheduled: "On track", missing: "Needs a date", paused: "Paused" };
const EXTRAS = {
  GREASE_TRAP: [{ key: "greaseTrapTankSize", label: "Tank size" }, { key: "greaseTrapCost", label: "Service cost" }, { key: "greaseTrapGallons", label: "Gallons / PM notes" }],
  BACKFLOW: [{ key: "backflowAmount", label: "Testing cost" }],
  BOILER: [{ key: "boilerInspectionCost", label: "Inspection cost" }, { key: "boilerInspectionDateSecondary", label: "Additional inspection date" }],
} as const;

function sectionRows(section: Section, data: ComplianceDashboardData, today: Date): Row[] {
  const settings = new Map(section.locations.map((row) => [row.locationId, row]));
  const entries = new Map(data.entries.map((row) => [row.locationId, row]));
  const rule = PM_REMINDER_RULES.find((candidate) => candidate.key === section.complianceKind);
  return data.locations.map((location) => {
    const setting = settings.get(location.id);
    const entry = entries.get(location.id);
    const date = rule ? parseReminderDate(entry?.[rule.dateField]) : setting?.referenceOn;
    const months = rule ? parseReminderMonths(entry?.[rule.monthsField], section.defaultIntervalMonths) : setting?.intervalMonths ?? section.defaultIntervalMonths;
    const due = rule ? date && months ? addReminderMonths(date, months) : null : setting?.nextDueOn ?? null;
    const days = due ? Math.round((due.getTime() - today.getTime()) / 86400000) : null;
    const status: Status = !section.active || setting?.hidden ? "paused" : days === null ? "missing" : days < 0 ? "overdue" : days <= 30 ? "soon" : "scheduled";
    return { location, setting, entry, due, status };
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
  const rule = PM_REMINDER_RULES.find((candidate) => candidate.key === section.complianceKind);
  const company = rule ? row.entry?.[rule.companyField] : data.companies.find((company) => company.id === row.setting?.companyId)?.name;
  return `${section.name} ${section.description ?? ""} ${row.location.name} ${row.location.locationNumber ?? ""} ${company ?? ""}`.toLowerCase().includes(filters.q.toLowerCase());
}

export default function ComplianceDashboard({ data, year, editable, actorId, filters, feedback, emailConfigured }: Props) {
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
      <Link className={styles.button} href={`${editable ? "/admin" : "/maintenance"}/preventative-maintenance?year=${year}`}>PM checklist <span aria-hidden="true">↗</span></Link>
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
      <label>Record year<input type="number" name="year" min="2020" max="2100" defaultValue={year} required /></label>
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
    <div className={styles.sectionIntro}><h2>Your sections <span>{visible.length}</span></h2><p>Click a section to expand its records.</p></div>
    {editable && <datalist id="compliance-company-names">{data.companies.map((company) => <option key={company.id} value={company.name} />)}</datalist>}
    <div className={styles.sections}>
      {visible.map(({ section, rows, filtered }) => <details key={section.id} id={`section-${section.id}`} className={styles.section}>
        <summary className={styles.sectionSummary}>
          <span className={styles.sectionIcon} aria-hidden="true">{section.complianceKind === "GREASE_TRAP" ? "G" : section.complianceKind === "BACKFLOW" ? "B" : section.complianceKind === "BOILER" ? "T" : section.name.slice(0, 1).toUpperCase()}</span>
          <span className={styles.sectionTitle}><strong>{section.name}</strong><small>{section.description || (section.complianceKind ? `Annual service records · ${year}` : "Custom recurring reminders")}</small></span>
          <span className={styles.summaryStats}><span>{filtered.length} locations</span><span>{section.recipients.length ? `${section.recipients.length} recipient${section.recipients.length === 1 ? "" : "s"}` : "Location maintenance team"}</span></span>
          <span className={styles.summaryBadges}>{!section.active ? <span className={styles.pausedBadge}>Paused</span> : <>{rows.some((row) => row.status === "overdue") && <span className={styles.dangerBadge}>{rows.filter((row) => row.status === "overdue").length} overdue</span>}{rows.some((row) => row.status === "soon") && <span className={styles.warningBadge}>{rows.filter((row) => row.status === "soon").length} due soon</span>}{rows.some((row) => row.status === "missing") && <span className={styles.pausedBadge}>{rows.filter((row) => row.status === "missing").length} missing dates</span>}{!rows.some((row) => ["overdue", "soon", "missing"].includes(row.status)) && <span className={styles.goodBadge}>No urgent items</span>}</>}</span>
          <span className={styles.expandIcon} aria-hidden="true">＋</span>
        </summary>
        <div className={styles.sectionBody}>
          <div className={styles.sectionGuide}><p>{section.complianceKind ? `Showing service facts for ${year}. Reminders follow the most recent service date across annual records.` : "Reminders repeat from the date entered, using the section interval unless a location overrides it."} Blank intervals use <strong>{section.defaultIntervalMonths} months</strong>.</p>
            {editable && <form action={setReminderListActiveAction}><FormContext listId={section.id} year={year} showHidden={filters.showHidden} /><input type="hidden" name="active" value={section.active ? "false" : "true"} /><PendingButton className={styles.button}>{section.active ? "Pause section" : "Resume section"}</PendingButton></form>}
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
          {editable && !section.complianceKind && <details className={styles.sectionSettings}><summary>Add a service company</summary><form action={saveReminderCompanyAction} className={styles.companyForm}><FormContext listId={section.id} year={year} showHidden={filters.showHidden} /><label>Company name<input name="name" required maxLength={160} /></label><PendingButton className={styles.button}>Add company</PendingButton></form></details>}
          <div className={styles.tableWrap}><table className={styles.table}>
            <caption className={styles.srOnly}>{section.name} location records</caption>
            <thead><tr><th scope="col">Location</th><th scope="col">Service date &amp; interval</th><th scope="col">Company &amp; details</th><th scope="col">Next due</th><th scope="col">Recipients</th>{editable && <th scope="col">Actions</th>}</tr></thead>
            <tbody>{filtered.map((row) => <LocationRow key={`${section.id}:${row.location.id}:${row.setting?.updatedAt.toISOString() ?? ""}:${row.entry?.updatedAt.toISOString() ?? ""}`} row={row} section={section} data={data} year={year} editable={editable} showHidden={filters.showHidden} />)}</tbody>
          </table></div>
          <p className={styles.sectionFootnote}>{editable ? "Save each location after editing. Hide & pause stops reminders while keeping the saved record. Use Include hidden to show and resume locations." : "Your view is limited to your assigned maintenance locations. Contact a compliance administrator to update a record."}</p>
        </div>
      </details>)}
      {visible.length === 0 && <div className={styles.empty}><strong>No matching records</strong><p>Try clearing filters or including hidden locations.</p></div>}
    </div>
    <p className={styles.footerNote}>{emailConfigured === false ? "Email setup is pending. " : ""}New sections default to 11 months from the date entered. Existing compliance reminders retain their advance warnings. Annual records and notification history are preserved.</p>
  </main>;
}

function LocationRow({ row, section, data, year, editable, showHidden }: { row: Row; section: Section; data: ComplianceDashboardData; year: number; editable: boolean; showHidden: boolean }) {
  const { location, setting, entry, due, status } = row;
  const formId = `compliance-${section.id}-${location.id}`;
  const label = `${location.locationNumber ? `${location.locationNumber} · ` : ""}${location.name}`;
  const rule = PM_REMINDER_RULES.find((candidate) => candidate.key === section.complianceKind);
  const sourceDate = rule ? entry?.[rule.dateField] ?? "" : setting?.referenceOn ? formatReminderDate(setting.referenceOn) : "";
  const parsedDate = parseReminderDate(sourceDate);
  const dateValue = parsedDate ? formatReminderDate(parsedDate) : sourceDate;
  const intervalValue = rule ? entry?.[rule.monthsField] ?? "" : setting?.intervalMonths ?? "";
  const primaryNames = data.assignments.filter((assignment) => assignment.locationId === location.id).map((assignment) => assignment.userName);
  const selectedPeople = setting?.useLocationRecipients ? setting.recipients.map((recipient) => recipient.userId) : section.recipients.map((recipient) => recipient.userId);
  const names = selectedPeople.length ? selectedPeople.map((id) => data.users.find((user) => user.id === id)?.name || "Inactive user") : primaryNames;
  return <tr className={setting?.hidden ? styles.hiddenRow : undefined}>
    <th scope="row"><strong>{label}</strong>{setting?.hidden && <small>Hidden · reminders paused</small>}</th>
    <td data-label="Service date & interval">{editable ? <ScheduleFields formId={formId} dateName={rule?.dateField ?? "referenceOn"} intervalName={rule?.monthsField ?? "intervalMonths"} initialDate={dateValue} initialInterval={String(intervalValue)} defaultMonths={section.defaultIntervalMonths} locationLabel={label} custom={!rule} /> : <div className={styles.fieldStack}>
      <label>{rule ? "Service date" : "Starting date"}<strong>{dateValue || "Not recorded"}</strong></label>
      <label>Repeat every (months)<strong>{intervalValue || section.defaultIntervalMonths}</strong></label>
      <small>Blank uses section default: {section.defaultIntervalMonths} months</small>
    </div>}</td>
    <td data-label="Company & details"><div className={styles.fieldStack}>
      <label>Service company{editable ? rule ? <input form={formId} list="compliance-company-names" name={rule.companyField} defaultValue={entry?.[rule.companyField] ?? ""} maxLength={160} aria-label={`Service company for ${label}`} /> : <select form={formId} name="companyId" defaultValue={setting?.companyId ?? ""} aria-label={`Service company for ${label}`}><option value="">Not assigned</option>{data.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select> : <strong>{rule ? entry?.[rule.companyField] || "Not recorded" : data.companies.find((company) => company.id === setting?.companyId)?.name || "Not assigned"}</strong>}</label>
      {section.complianceKind && EXTRAS[section.complianceKind].map((field) => <label key={field.key}>{field.label}{editable ? <input form={formId} name={field.key} defaultValue={entry?.[field.key] ?? ""} maxLength={500} aria-label={`${field.label} for ${label}`} /> : <strong>{entry?.[field.key] || "Not recorded"}</strong>}</label>)}
    </div></td>
    <td data-label="Next due"><div className={styles.due}><strong>{due ? formatReminderDate(due) : "—"}</strong><span className={`${styles.statusBadge} ${styles[status]}`}>{STATUS_LABELS[status]}</span></div></td>
    <td data-label="Recipients"><div className={styles.recipientSummary}>{names.length ? names.join(", ") : "No assigned recipients"}<small>{setting?.useLocationRecipients ? "Location override" : section.recipients.length ? "Section recipients" : "Primary maintenance team"}</small></div>
      {editable && <details className={styles.rowRecipientSettings}><summary>Change recipients</summary><label className={styles.check}><input form={formId} type="checkbox" name="useLocationRecipients" defaultChecked={setting?.useLocationRecipients ?? false} />Use different people here</label><RecipientPicker key={setting?.updatedAt.toISOString() ?? "new"} users={data.users} selectedIds={setting?.recipients.map((recipient) => recipient.userId) ?? []} name="locationRecipientIds" formId={formId} label="Choose people" /><small>When unchecked, this location uses the section’s recipients.</small></details>}
    </td>
    {editable && <td data-label="Actions"><div className={styles.rowActions}>
      <form id={formId} action={section.complianceKind ? saveComplianceLocationAction : saveReminderLocationAction}><FormContext listId={section.id} year={year} showHidden={showHidden} /><input type="hidden" name="locationId" value={location.id} /><input type="hidden" name="reminderLocationId" value={setting?.id ?? ""} /><PendingButton className={styles.primary}>Save location</PendingButton></form>
      <form action={setReminderLocationHiddenAction}><FormContext listId={section.id} year={year} showHidden={showHidden} /><input type="hidden" name="locationId" value={location.id} /><input type="hidden" name="reminderLocationId" value={setting?.id ?? ""} /><input type="hidden" name="hidden" value={setting?.hidden ? "false" : "true"} /><PendingButton className={styles.button}>{setting?.hidden ? "Show & resume" : "Hide & pause"}</PendingButton></form>
    </div></td>}
  </tr>;
}

function FormContext({ listId, year, showHidden }: { listId?: string; year: number; showHidden: boolean }) {
  return <><input type="hidden" name="listId" value={listId ?? ""} /><input type="hidden" name="year" value={year} /><input type="hidden" name="showHidden" value={showHidden ? "1" : "0"} /></>;
}
