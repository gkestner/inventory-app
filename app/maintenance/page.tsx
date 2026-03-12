import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Permission, Role } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";
import {
  ADMIN_VIEW_TEMPERATURE_DASHBOARD,
  ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
  CREATE_RECEIPTS,
  CREATE_WORK_ORDERS_FOR_OTHERS,
  VIEW_COMPANY_VEHICLE_LOG,
  VIEW_EQUIPMENT_TRACKING,
  VIEW_MAINTENANCE_REQUESTS,
  VIEW_PREVENTATIVE_MAINTENANCE,
  VIEW_RECEIPTS,
  VIEW_TEMPERATURE_DASHBOARD,
} from "@/app/lib/permission-constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionUser = {
  email?: string | null;
  role?: Role | null;
  name?: string | null;
};

export default async function MaintenanceHomePage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const user = session.user as SessionUser;
  if (!user.email) redirect("/login");

  const perms = await loadUserPermissions(session);

  const canCheckout = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_CHECKOUT, Permission.CREATE_CHECKOUT]);
  const canWorkOrders =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_WORK_ORDERS,
      Permission.CREATE_WORK_ORDERS,
      Permission.UPDATE_OWN_WORK_ORDERS,
      Permission.SUBMIT_OWN_WORK_ORDERS,
    ]);
  const canTravelLog = canWorkOrders;
  const canLiveOrders = perms.allowAll || hasAnyPermission(perms, [Permission.VIEW_LIVE_ORDERS]);
  const canOfficeEntry = perms.allowAll || hasAnyPermission(perms, [CREATE_WORK_ORDERS_FOR_OTHERS]);
  const canPreventativeMaintenance = perms.allowAll || hasAnyPermission(perms, [VIEW_PREVENTATIVE_MAINTENANCE]);
  const canEquipmentTracking = perms.allowAll || hasAnyPermission(perms, [VIEW_EQUIPMENT_TRACKING]);
  const canVehicleLog = perms.allowAll || hasAnyPermission(perms, [VIEW_COMPANY_VEHICLE_LOG]);
  const canMaintenanceRequests = perms.allowAll || hasAnyPermission(perms, [VIEW_MAINTENANCE_REQUESTS]);
  const canTemperatureDashboard =
    perms.allowAll || hasAnyPermission(perms, [VIEW_TEMPERATURE_DASHBOARD, ADMIN_VIEW_TEMPERATURE_DASHBOARD]);
  const canReceipts = perms.allowAll || hasAnyPermission(perms, [VIEW_RECEIPTS, CREATE_RECEIPTS]);
  const canRoomDiagrams =
    perms.allowAll ||
    hasAnyPermission(perms, [
      Permission.VIEW_CHECKOUT,
      Permission.CREATE_CHECKOUT,
      VIEW_PREVENTATIVE_MAINTENANCE,
      ADMIN_VIEW_PREVENTATIVE_MAINTENANCE,
      Permission.ADMIN_VIEW_ITEMS,
      Permission.ADMIN_EDIT_ITEMS,
    ]);
  const canQuickCountEditor =
    perms.allowAll || hasAnyPermission(perms, [Permission.CREATE_CHECKOUT, Permission.ADMIN_EDIT_ITEMS]);

  const border = "1px solid var(--border)";

  const card: React.CSSProperties = {
    border,
    borderRadius: 14,
    background: "var(--surface)",
    boxShadow: "var(--shadow)",
    padding: 14,
    display: "grid",
    gap: 8,
  };

  const action: React.CSSProperties = {
    display: "inline-block",
    textDecoration: "none",
    padding: "8px 12px",
    borderRadius: 10,
    border,
    background: "var(--surface-2)",
    color: "var(--foreground)",
    fontWeight: 800,
    width: "fit-content",
  };

  return (
    <main>
      <div>
        <section
          style={{
            border,
            borderRadius: 16,
            background: "linear-gradient(150deg, color-mix(in srgb, var(--brand) 14%, var(--surface)) 0%, var(--surface) 65%)",
            boxShadow: "var(--shadow)",
            padding: 18,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>Maintenance Hub</h1>
          <p style={{ margin: "8px 0 0", color: "var(--muted)", lineHeight: 1.5 }}>
            Start your day from one place: open work orders, log travel, process part checkouts, and monitor live order flow.
          </p>
        </section>

        <section
          style={{
            marginTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          {canWorkOrders ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Work Orders</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Create, update, and submit active work orders with full technician workflow support.
              </p>
              <Link href="/maintenance/work-orders" style={action}>
                Open Work Orders
              </Link>
            </article>
          ) : null}

          {canOfficeEntry ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Work Orders (Office Entry)</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Enter work orders from paper forms on behalf of a technician by selecting the target user.
              </p>
              <Link href="/maintenance/work-orders/office-entry" style={action}>
                Open Office Entry
              </Link>
            </article>
          ) : null}

          {canTravelLog ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Travel Log</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Track travel entries tied to your field work for accurate reporting and handoff.
              </p>
              <Link href="/maintenance/travel-log" style={action}>
                Open Travel Log
              </Link>
            </article>
          ) : null}

          {canReceipts ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Receipt Data Entry</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Enter receipt details with date, store, amount, areas, and optional notes.
              </p>
              <Link href="/maintenance/receipts" style={action}>
                Open Receipt Entry
              </Link>
            </article>
          ) : null}

          {canCheckout ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Checkout</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Check out inventory items to stores or technicians and flag parts that need reorder.
              </p>
              <Link href="/maintenance/checkout" style={action}>
                Open Checkout
              </Link>
            </article>
          ) : null}

          {canPreventativeMaintenance ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Preventative Maintenance</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Manage the annual PM checklist by location. Assignments follow your primary stores under the Maintenance title.
              </p>
              <Link href="/maintenance/preventative-maintenance" style={action}>
                Open PM List
              </Link>
            </article>
          ) : null}

          {canEquipmentTracking ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Equipment Tracking</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Store-by-store equipment log for HVAC, refrigeration, signs, and other installed assets.
              </p>
              <Link href="/maintenance/equipment-tracking" style={action}>
                Open Equipment Log
              </Link>
            </article>
          ) : null}

          {canVehicleLog ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Vehicle Maintenance Log</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Quick entry page for technicians to log company vehicle work and complete reminders.
              </p>
              <Link href="/maintenance/vehicle-log" style={action}>
                Open Vehicle Log
              </Link>
            </article>
          ) : null}

          {canMaintenanceRequests ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Maintenance Requests</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Submit and track store maintenance requests with automatic routing to the assigned maintenance technician.
              </p>
              <Link href="/maintenance-requests" style={action}>
                Open Requests
              </Link>
            </article>
          ) : null}

          {canTemperatureDashboard ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Temperature Dashboard</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Monitor Mocreo hub temperatures and route alerts to the assigned maintenance tech and selected recipients.
              </p>
              <Link href="/maintenance/temperature-dashboard" style={action}>
                Open Temperature Dashboard
              </Link>
            </article>
          ) : null}

          {canRoomDiagrams ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Maintenance Room Diagrams</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Search and highlight part locations across maintenance location, shelf, and bin diagrams.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Link href="/maintenance/room-diagrams" style={action}>
                  Open Room Diagrams
                </Link>
                {canQuickCountEditor ? (
                  <Link href="/maintenance/room-diagrams/quick-count" style={action}>
                    Open Quick Count Editor
                  </Link>
                ) : null}
              </div>
            </article>
          ) : null}

          {canLiveOrders ? (
            <article style={card}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Live Orders</h2>
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.5 }}>
                Watch operational order movement in real time for immediate status visibility.
              </p>
              <Link href="/employee/live-orders" style={action}>
                Open Live Orders
              </Link>
            </article>
          ) : null}
        </section>
      </div>
    </main>
  );
}
