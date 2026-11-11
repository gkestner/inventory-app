import Link from "next/link";
import { randomUUID } from "node:crypto";
import type { ComplianceDashboardData, ComplianceFilters } from "@/app/lib/compliance-dashboard";
import type { ComplianceHistoryRecord } from "@/app/lib/compliance-history-fields";
import { DEFAULT_REMINDER_MONTHS, formatReminderDate, reminderSchedule, reminderToday } from "@/app/lib/reminder-dates";
import { reminderDeliveryRecipients } from "@/app/lib/reminder-email-events";
import { saveCategoryRecipientsAction, saveReminderListAction, setReminderListActiveAction } from "@/app/admin/notification-reminders/actions";
import PendingButton from "@/app/admin/notification-reminders/PendingButton";
import RecipientPicker, { RecipientDirectory } from "./RecipientPicker";
import FormContext from "./ComplianceContextFields";
import EmailRecipientField from "./EmailRecipientField";
import ComplianceLocation, { type ComplianceStatus } from "./ComplianceLocation";
import styles from "./compliance.module.css";

type Section = ComplianceDashboardData["sections"][number];
type Location = ComplianceDashboardData["locations"][number];
type Setting = Section["locations"][number];
type EmailLink = { contactId: string; contact?: { email: string } };
const addresses = (links: EmailLink[]) => links.flatMap(({ contact }) => contact ? [contact.email] : []);
const assignedCount = (section: Section) => section.recipients.length + section.emailRecipients.length;
type Row = { location: Location; setting?: Setting; latest?: ComplianceHistoryRecord; due: Date | null; status: ComplianceStatus; hidden: boolean };
type Props = { data: ComplianceDashboardData; year: number; editable: boolean; actorId?: string; filters: ComplianceFilters; feedback?: { error?: string; saved?: string }; emailConfigured?: boolean; canViewHistory?: boolean; expanded?: { sectionId: string; locationId: string } };

function sectionRows(section: Section, locations: Location[], latestByLocation: Map<string, ComplianceHistoryRecord>, today: Date): Row[] {
  const settings = new Map(section.locations.map((row) => [row.locationId, row]));
  return locations.map((location) => {
    const setting = settings.get(location.id);
    const latest = latestByLocation.get(`${section.id}:${location.id}`);
    const hidden = setting?.hidden ?? location.defaultHidden;
    const due = section.complianceKind ? reminderSchedule(latest?.serviceDate, latest?.intervalText, section.defaultIntervalMonths)?.nextDueOn ?? null : setting?.nextDueOn ?? null;
    const days = due ? Math.round((due.getTime() - today.getTime()) / 86400000) : null;
    const status: ComplianceStatus = !section.active || hidden ? "paused" : days === null ? "missing" : days < 0 ? "overdue" : days <= 30 ? "soon" : "scheduled";
    return { location, setting, latest, due, status, hidden };
  });
}
function matches(row: Row, section: Section, filters: ComplianceFilters, query: string) {
  if (!filters.showHidden && row.hidden) return false;
  if (filters.status === "attention" && !["overdue", "soon"].includes(row.status)) return false;
  if (filters.status === "missing" && row.status !== "missing") return false;
  if (filters.status === "paused" && row.status !== "paused") return false;
  if (!query) return true;
  const company = row.latest?.companyName || row.setting?.company?.name;
  return `${section.name} ${section.description ?? ""} ${row.location.name} ${row.location.locationNumber ?? ""} ${company ?? ""}`.toLowerCase().includes(query);
}

export default function ComplianceDashboard({ data, year, editable, actorId, filters, feedback, emailConfigured, canViewHistory = false, expanded }: Props) {
  const today = reminderToday();
  const number = (location: Location) => location.locationNumber && Number.isFinite(Number(location.locationNumber)) ? Number(location.locationNumber) : Number.MAX_SAFE_INTEGER;
  const locations = [...data.locations].sort((a, b) => number(a) - number(b) || a.name.localeCompare(b.name));
  const latest = new Map(data.latestRecords.map((entry) => [`${entry.sectionId}:${entry.locationId}`, entry]));
  const assignments = new Map<string, typeof data.assignments>();
  for (const assignment of data.assignments) {
    const people = assignments.get(assignment.locationId) ?? [];
    people.push(assignment);
    assignments.set(assignment.locationId, people);
  }
  const query = filters.q.toLowerCase();
  const visibleLocations = new Set<string>();
  let overdue = 0;
  let dueSoon = 0;
  const sections: { section: Section; counts: Record<ComplianceStatus, number>; filtered: Row[] }[] = [];
  for (const section of data.sections) {
    const counts = { overdue: 0, soon: 0, scheduled: 0, missing: 0, paused: 0 };
    const rows = sectionRows(section, locations, latest, today);
    for (const row of rows) {
      counts[row.status]++;
      if (filters.showHidden || !row.hidden) visibleLocations.add(row.location.id);
    }
    overdue += counts.overdue;
    dueSoon += counts.soon;
    sections.push({ section, counts, filtered: rows.filter((row) => matches(row, section, filters, query)) });
  }
  const visible = sections.filter(({ filtered }) => filtered.length > 0 || (editable && !query && filters.status === "all"));
  const basePath = editable ? "/admin/preventative-maintenance/compliance" : "/maintenance/preventative-maintenance/compliance";
  return <RecipientDirectory users={data.users}><main className={styles.dashboard}>
    <header className={styles.hero}>
      <div><p className={styles.eyebrow}>FACILITIES / COMPLIANCE</p><h1>Compliance &amp; Testing</h1><p className={styles.subtitle}>A clear view of service dates, upcoming work, and the people who need to know.</p></div>
      <div className={styles.headerLinks}>{canViewHistory && <Link prefetch={false} className={styles.button} href="/admin/reports/compliance-history">Compliance history <span aria-hidden="true">↗</span></Link>}<Link prefetch={false} className={styles.button} href={`${editable ? "/admin" : "/maintenance"}/preventative-maintenance?year=${year}`}>PM checklist <span aria-hidden="true">↗</span></Link></div>
    </header>
    <div className={styles.metrics} aria-label="Compliance summary">
      <div><span>Categories</span><strong>{data.sections.length}</strong><small>{visibleLocations.size} visible locations</small></div>
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
        <input type="hidden" name="includeCategoryRecipients" value="1" />
        <label>Section name<input name="name" required maxLength={160} placeholder="e.g. Fire extinguisher testing" /></label>
        <label>Repeat every (months)<input name="defaultIntervalMonths" type="number" min="1" max="120" defaultValue={DEFAULT_REMINDER_MONTHS} required /></label>
        <label className={styles.full}>Description<textarea name="description" maxLength={500} rows={2} placeholder="What should be checked or recorded?" /></label>
        <input type="hidden" name="sortOrder" value={1000} />
        <div className={styles.full}><RecipientPicker selectedIds={actorId ? [actorId] : []} label="Category recipients" /></div>
        <EmailRecipientField />
        <p className={`${styles.muted} ${styles.full}`}>These users and email addresses receive reminders for every location with reminders on. Each location can also have its own recipients.</p>
        <div><PendingButton className={styles.primary}>Create section</PendingButton></div>
      </form>
    </details>}
    <div className={styles.sectionIntro}><h2>Your sections <span>{visible.length}</span></h2><p>Open a section, then a location to see its last entry or add a new one.</p></div>
    {editable && <datalist id="compliance-company-names">{data.companies.map((company) => <option key={company.id} value={company.name} />)}</datalist>}
    <div className={styles.sections}>
      {visible.map(({ section, counts, filtered }) => <details key={section.id} id={`section-${section.id}`} className={styles.section} open={expanded?.sectionId === section.id || undefined}>
        <summary className={styles.sectionSummary}>
          <span className={styles.sectionIcon} aria-hidden="true">{section.complianceKind === "GREASE_TRAP" ? "G" : section.complianceKind === "BACKFLOW" ? "B" : section.complianceKind === "BOILER" ? "T" : section.name.slice(0, 1).toUpperCase()}</span>
          <span className={styles.sectionTitle}><strong>{section.name}</strong><small>{section.description || "Service entries and recurring reminders"}</small></span>
          <span className={styles.summaryStats}><span>{filtered.length} locations</span><span>{assignedCount(section) ? `${assignedCount(section)} category recipient${assignedCount(section) === 1 ? "" : "s"}` : "Location maintenance team"}</span></span>
          <span className={styles.summaryBadges}>{!section.active ? <span className={styles.pausedBadge}>Paused</span> : <>{counts.overdue > 0 && <span className={styles.dangerBadge}>{counts.overdue} overdue</span>}{counts.soon > 0 && <span className={styles.warningBadge}>{counts.soon} due soon</span>}{counts.missing > 0 && <span className={styles.pausedBadge}>{counts.missing} need review</span>}{!(counts.overdue || counts.soon || counts.missing) && <span className={styles.goodBadge}>No urgent items</span>}</>}</span>
          <span className={styles.expandIcon} aria-hidden="true">＋</span>
        </summary>
        <div className={styles.sectionBody}>
          <div className={styles.sectionGuide}><p>Latest service entries are shown across all years. Add a new entry to keep the previous one in history. Blank intervals use <strong>{section.defaultIntervalMonths} months</strong>.</p>
            <div className={styles.headerLinks}>{canViewHistory && <Link prefetch={false} className={styles.button} href={`/admin/reports/compliance-history?sectionId=${encodeURIComponent(section.id)}`}>Section history</Link>}{editable && <form action={setReminderListActiveAction}><FormContext listId={section.id} year={year} showHidden={filters.showHidden} /><input type="hidden" name="active" value={section.active ? "false" : "true"} /><PendingButton className={styles.button}>{section.active ? "Pause section" : "Resume section"}</PendingButton></form>}</div>
          </div>
          {editable && <CategoryRecipients section={section} year={year} showHidden={filters.showHidden} />}
          {editable && <details className={styles.sectionSettings}>
            <summary>Edit category details</summary>
            <form key={section.updatedAt.toISOString()} action={saveReminderListAction} className={styles.settingsForm}>
              <FormContext listId={section.id} year={year} showHidden={filters.showHidden} />
              <input type="hidden" name="keepCategoryRecipients" value="1" />
              <label>Section name<input name="name" defaultValue={section.name} required maxLength={160} /></label>
              <label>Default interval (months)<input name="defaultIntervalMonths" type="number" min="1" max="120" defaultValue={section.defaultIntervalMonths} required /></label>
              <label className={styles.full}>Description<textarea name="description" rows={2} maxLength={500} defaultValue={section.description ?? ""} /></label>
              <label>Display order<input name="sortOrder" type="number" min="0" max="10000" defaultValue={section.sortOrder} /></label>
              <div><PendingButton className={styles.primary}>Save section settings</PendingButton></div>
            </form>
          </details>}
          {filtered.length ? <div className={styles.locations} aria-label={`${section.name} locations`}>
            {filtered.map((row) => {
              const open = expanded?.sectionId === section.id && expanded.locationId === row.location.id;
              const token = editable ? randomUUID() : undefined;
              return <ComplianceLocation key={`${row.location.id}:${row.setting?.updatedAt.toISOString() ?? ""}:${row.latest?.id ?? ""}:${open ? token : ""}`}
                listId={section.id} locationId={row.location.id} reminderLocationId={row.setting?.id} label={`${row.location.locationNumber ? `${row.location.locationNumber} · ` : ""}${row.location.name}`}
                kind={section.complianceKind} latest={row.latest} due={row.due ? formatReminderDate(row.due) : null} status={row.status} hidden={row.hidden}
                editable={editable} canViewHistory={canViewHistory} expanded={open} submissionToken={token} year={year} showHidden={filters.showHidden} defaultMonths={section.defaultIntervalMonths}
                {...locationRecipients(section, row.setting, assignments.get(row.location.id), editable)} />;
            })}
          </div> : <p className={styles.muted}>No visible locations. Select Include hidden to review paused locations.</p>}
          <p className={styles.sectionFootnote}>{editable ? "Locations numbered 65 and above start hidden and paused. Use Include hidden and Show & resume to turn one back on." : "Your view is limited to your assigned maintenance locations."}</p>
        </div>
      </details>)}
      {visible.length === 0 && <div className={styles.empty}><strong>No matching records</strong><p>Try clearing filters or including hidden locations.</p></div>}
    </div>
    <p className={styles.footerNote}>{emailConfigured === false ? "Email setup is pending. " : ""}New sections default to 11 months from the date entered. Use the Reports Hub for the complete history by location or section.</p>
  </main></RecipientDirectory>;
}

function CategoryRecipients({ section, year, showHidden }: { section: Section; year: number; showHidden: boolean }) {
  const count = assignedCount(section);
  const all = section.includeCategoryRecipients || !count;
  return <details className={styles.sectionSettings}>
    <summary>Assign category recipients {count > 0 && <span className={styles.count}>{count} assigned · {section.includeCategoryRecipients ? "all locations" : "category defaults"}</span>}</summary>
    <form key={section.updatedAt.toISOString()} action={saveCategoryRecipientsAction} className={styles.settingsForm} aria-label={`${section.name} category recipients`}>
      <FormContext listId={section.id} year={year} showHidden={showHidden} />
      <div className={styles.full}><RecipientPicker selectedIds={section.recipients.map(({ userId }) => userId)} label="Choose category recipients" /></div>
      <EmailRecipientField addresses={addresses(section.emailRecipients)} />
      <label className={styles.full}>Apply to<select name="includeCategoryRecipients" defaultValue={all ? "1" : "0"}>
        <option value="1">All locations, keeping location recipients</option>
        <option value="0">Only locations without their own recipients</option>
      </select></label>
      <p className={`${styles.muted} ${styles.full}`}>All locations includes these recipients alongside any location recipients. Hidden and paused locations stay paused.{section.complianceKind ? " If no app users are selected, locations without overrides still notify their primary maintenance team." : " Choose an app user or enter an email address."}</p>
      <div><PendingButton className={styles.primary}>Save category recipients</PendingButton></div>
    </form>
  </details>;
}

function locationRecipients(section: Section, setting: Setting | undefined, fallback: ComplianceDashboardData["assignments"] = [], editable: boolean) {
  const location = setting?.recipients ?? [];
  const useLocationRecipients = setting?.useLocationRecipients ?? false;
  const names = new Map(fallback.map(({ userId, userName }) => [userId, userName]));
  for (const { userId, user } of [...section.recipients, ...location]) names.set(userId, user.active ? user.name : "Inactive user");
  const locationEmails = setting?.emailRecipients ?? [];
  const { userIds, contactIds } = reminderDeliveryRecipients(section, { recipients: location, emailRecipients: locationEmails, useLocationRecipients }, fallback.map(({ userId }) => userId));
  return { recipientNames: userIds.map((id) => names.get(id) ?? "Inactive user"), recipientIds: editable ? location.map(({ userId }) => userId) : [], useLocationRecipients,
    hasCategoryRecipients: assignedCount(section) > 0, includeCategoryRecipients: section.includeCategoryRecipients,
    locationEmails: editable ? addresses(locationEmails) : [], effectiveEmailCount: contactIds.length };
}
