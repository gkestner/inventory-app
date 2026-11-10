import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { loadComplianceHistory } from "@/app/lib/compliance-history";
import type { ComplianceHistoryRecord } from "@/app/lib/compliance-history-fields";
import { complianceHistoryAccess } from "./access";
import { complianceHistoryQuery, historySourceLabel, parseComplianceHistoryFilters } from "./report-data";
import styles from "./history.module.css";

export const dynamic = "force-dynamic";

type Params = Record<string, string | string[] | undefined>;
const PAGE_SIZE = 25;

function recordedTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(value);
}

function EntryFields({ record }: { record: ComplianceHistoryRecord }) {
  const value = (text: string | null | undefined) => text || "Not recorded";
  return <dl className={styles.fields}>
    <div><dt>Service date</dt><dd>{value(record.serviceDate)}</dd></div>
    <div><dt>Repeat every (months)</dt><dd>{record.intervalText || record.intervalMonths}</dd></div>
    <div><dt>Service company</dt><dd>{value(record.companyName)}</dd></div>
    {(record.complianceKind || record.cost) && <div><dt>{record.complianceKind === "BACKFLOW" ? "Testing cost" : record.complianceKind === "BOILER" ? "Inspection cost" : "Service cost"}</dt><dd>{value(record.cost)}</dd></div>}
    {record.complianceKind === "GREASE_TRAP" && <><div><dt>Tank size</dt><dd>{value(record.tankSize)}</dd></div><div><dt>Gallons / PM notes</dt><dd>{value(record.gallons)}</dd></div></>}
    {record.complianceKind === "BOILER" && <div><dt>Additional inspection date</dt><dd>{value(record.additionalDate)}</dd></div>}
    <div className={styles.wide}><dt>Notes</dt><dd>{value(record.notes)}</dd></div>
    <div><dt>Recorded at (Eastern)</dt><dd>{recordedTime(record.recordedAt)}</dd></div>
    <div><dt>Recorded by</dt><dd>{value(record.recordedByName)}</dd></div>
    <div><dt>Record year</dt><dd>{record.recordYear}</dd></div>
    <div><dt>Source</dt><dd>{historySourceLabel(record.source)}</dd></div>
    <div className={styles.wide}><dt>Entry ID</dt><dd className={styles.identifier}>{record.id}</dd></div>
  </dl>;
}

export default async function ComplianceHistoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const access = await complianceHistoryAccess();
  if (access === "unauthenticated") redirect("/login");
  if (access !== "allowed") redirect("/");
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") params.set(key, value);
  const filters = parseComplianceHistoryFilters(params);
  const [history, locations, sections] = await Promise.all([
    loadComplianceHistory({ ...filters, pageSize: PAGE_SIZE }),
    prisma.location.findMany({ select: { id: true, name: true, locationNumber: true, active: true }, orderBy: [{ name: "asc" }, { id: "asc" }] }),
    prisma.notificationReminderList.findMany({ select: { id: true, name: true, active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }] }),
  ]);
  const location = locations.find((item) => item.id === filters.locationId);
  const section = sections.find((item) => item.id === filters.sectionId);
  const pages = Math.max(1, Math.ceil(history.total / history.pageSize));
  if (history.page > pages) redirect(`/admin/reports/compliance-history?${complianceHistoryQuery(filters, pages)}`);
  const start = history.total ? (history.page - 1) * history.pageSize + 1 : 0;
  const end = Math.min(history.page * history.pageSize, history.total);
  const href = (page: number) => `/admin/reports/compliance-history?${complianceHistoryQuery(filters, page)}`;

  return <main className={styles.report}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>REPORTS / FACILITIES</p><h1>Compliance history</h1><p>Every saved service entry, organized by location and section.</p></div>
      <nav aria-label="Compliance report navigation" className={styles.links}><Link href="/admin/reports">Reports Hub</Link><Link href="/admin/preventative-maintenance/compliance">Compliance dashboard</Link></nav>
    </header>
    <form method="get" className={`${styles.filters} ${styles.noPrint}`}>
      <label>Location<select name="locationId" defaultValue={filters.locationId ?? ""}><option value="">All locations</option>{locations.map((item) => <option value={item.id} key={item.id}>{item.locationNumber ? `${item.locationNumber} · ` : ""}{item.name}{item.active ? "" : " (inactive)"}</option>)}</select></label>
      <label>Compliance section<select name="sectionId" defaultValue={filters.sectionId ?? ""}><option value="">All sections</option>{sections.map((item) => <option value={item.id} key={item.id}>{item.name}{item.active ? "" : " (paused)"}</option>)}</select></label>
      <label>Record year<input type="number" name="year" min="2020" max="2100" placeholder="All years" defaultValue={filters.year ?? ""} /></label>
      <button type="submit">View history</button>
      {(filters.locationId || filters.sectionId || filters.year) && <Link href="/admin/reports/compliance-history">Clear filters</Link>}
      <p className={styles.guide}>Choose a location to see all its compliance fields, or choose a section to see every location’s history. Hidden and inactive locations stay in history.</p>
    </form>
    <section className={styles.results} aria-label="Compliance history entries">
      <div className={styles.resultHeading}><div><h2>{location ? `${location.locationNumber ? `${location.locationNumber} · ` : ""}${location.name}` : "All locations"}</h2><p>{section?.name ?? "All sections"} · {filters.year ?? "All years"}</p></div><strong>{history.total.toLocaleString()} {history.total === 1 ? "entry" : "entries"}</strong></div>
      <p className={styles.muted}>Showing {start.toLocaleString()}–{end.toLocaleString()}. Expand an entry for every saved field. Print covers this page; exports include all matching entries.</p>
      {history.records.length ? <div className={styles.entries}>{history.records.map((record) => <details className={styles.entry} key={record.id}>
        <summary><span className={styles.entryIdentity}><strong>{record.locationNumber ? `${record.locationNumber} · ` : ""}{record.locationName}</strong><small>{record.sectionName}</small></span><span className={styles.entryDate}><strong>{record.serviceDate || "No service date"}</strong><small>{record.companyName || "Company not recorded"}</small></span><span className={styles.saved}>Saved {recordedTime(record.recordedAt)}</span><span className={styles.plus} aria-hidden="true">＋</span></summary>
        <EntryFields record={record} />
      </details>)}</div> : <div className={styles.empty}><strong>No saved entries match these filters.</strong><p>Try all years or a different location or section.</p></div>}
      <nav className={`${styles.pagination} ${styles.noPrint}`} aria-label="History pages">{history.page > 1 && <Link href={href(history.page - 1)}>← Previous</Link>}<span>Page {history.page.toLocaleString()} of {pages.toLocaleString()}</span>{history.page < pages && <Link href={href(history.page + 1)}>Next →</Link>}</nav>
    </section>
    <p className={styles.muted}>Existing annual records and available change history are retained. Import labels distinguish older records from new service entries.</p>
  </main>;
}
