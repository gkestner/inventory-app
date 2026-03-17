"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type PaymentMode = "PRIMARY_CARD" | "BACKUP_CARD" | "ACCOUNT_CHARGE";
type ProposalStatus = "PENDING" | "REJECTED" | "ORDER_CREATED";

type ItemRow = {
  id: string;
  sku: string;
  name: string;
  partNumber: string | null;
  onHandQty: number;
  orderedQty: number;
  minQty: number;
  reorderIgnored: boolean;
  vendor: "SUCCESS_PLUS" | "AMERICAN_PLUS";
  orderFrom: string | null;
};

type CardProfile = {
  nickname: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

type AutoOrderRule = {
  itemId: string;
  enabled: boolean;
  autoOrderAmount: number;
  paymentMode: PaymentMode;
  accountChargeSupported: boolean;
  website: string;
  updatedAt: string;
};

type Proposal = {
  id: string;
  itemId: string;
  itemSku: string;
  itemName: string;
  quantity: number;
  vendor: "SUCCESS_PLUS" | "AMERICAN_PLUS";
  paymentMode: PaymentMode;
  accountChargeSupported: boolean;
  website: string;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
  createdOrderId?: string;
};

type Payload = {
  items: ItemRow[];
  cards: { primary?: CardProfile; backup?: CardProfile };
  rules: Record<string, AutoOrderRule>;
  proposals: Proposal[];
  error?: string;
};

export default function AutoOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const [cards, setCards] = useState<{ primary?: CardProfile; backup?: CardProfile }>({});
  const [rules, setRules] = useState<Record<string, AutoOrderRule>>({});
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [q, setQ] = useState("");

  const [primaryNickname, setPrimaryNickname] = useState("");
  const [primaryLast4, setPrimaryLast4] = useState("");
  const [primaryExpMonth, setPrimaryExpMonth] = useState("");
  const [primaryExpYear, setPrimaryExpYear] = useState("");

  const [backupNickname, setBackupNickname] = useState("");
  const [backupLast4, setBackupLast4] = useState("");
  const [backupExpMonth, setBackupExpMonth] = useState("");
  const [backupExpYear, setBackupExpYear] = useState("");

  function hydrate(payload: Payload) {
    setItems(Array.isArray(payload.items) ? payload.items : []);
    setCards(payload.cards ?? {});
    setRules(payload.rules ?? {});
    setProposals(Array.isArray(payload.proposals) ? payload.proposals : []);
  }

  async function fetchAll() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auto-orders", { method: "GET" });
      const payload = (await res.json().catch(() => ({}))) as Payload;
      if (!res.ok) {
        setError(payload.error || "Failed to load auto-order settings.");
        return;
      }
      hydrate(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load auto-order settings.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function postAction(body: Record<string, unknown>) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auto-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => ({}))) as Payload;
      if (!res.ok) {
        setError(payload.error || "Action failed.");
        return;
      }
      hydrate(payload);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  function getRule(item: ItemRow): AutoOrderRule {
    return (
      rules[item.id] ?? {
        itemId: item.id,
        enabled: false,
        autoOrderAmount: 1,
        paymentMode: "PRIMARY_CARD",
        accountChargeSupported: false,
        website: item.orderFrom || "",
        updatedAt: "",
      }
    );
  }

  function changeRule(item: ItemRow, patch: Partial<AutoOrderRule>) {
    const current = getRule(item);
    setRules((prev) => ({ ...prev, [item.id]: { ...current, ...patch, itemId: item.id } }));
  }

  async function saveRule(item: ItemRow) {
    const rule = getRule(item);
    await postAction({
      action: "saveRule",
      itemId: item.id,
      enabled: rule.enabled,
      autoOrderAmount: Number(rule.autoOrderAmount || 1),
      paymentMode: rule.paymentMode,
      accountChargeSupported: rule.accountChargeSupported,
      website: rule.website,
    });
  }

  async function onSaveCard(e: FormEvent<HTMLFormElement>, slot: "primary" | "backup") {
    e.preventDefault();
    if (slot === "primary") {
      await postAction({
        action: "saveCard",
        slot,
        card: {
          nickname: primaryNickname,
          last4: primaryLast4,
          expMonth: primaryExpMonth,
          expYear: primaryExpYear,
        },
      });
      return;
    }

    await postAction({
      action: "saveCard",
      slot,
      card: {
        nickname: backupNickname,
        last4: backupLast4,
        expMonth: backupExpMonth,
        expYear: backupExpYear,
      },
    });
  }

  const filteredItems = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((x) => {
      const hay = `${x.sku} ${x.name} ${x.partNumber ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q]);

  useEffect(() => {
    void fetchAll();
  }, []);

  return (
    <main style={{ display: "grid", gap: 14, maxWidth: 1200 }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>Auto Order Approval Center</h1>
      <div style={{ padding: 10, border: "1px solid var(--border, rgba(0,0,0,0.2))", borderRadius: 10, fontWeight: 700 }}>
        Safety lock: this page never places orders automatically. It only creates approval proposals. Orders are created only when you click Approve.
      </div>
      {error ? <div style={{ fontWeight: 800 }}>Error: {error}</div> : null}

      <section style={{ border: "1px solid var(--border, rgba(0,0,0,0.2))", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Payment Preferences</h2>
        <div style={{ opacity: 0.85 }}>Use nickname + last4 for approval routing. This app does not run direct card charges; approval creates internal order records only.</div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <form onSubmit={(e) => void onSaveCard(e, "primary")} style={{ display: "grid", gap: 8, border: "1px solid var(--border, rgba(0,0,0,0.2))", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 800 }}>Primary Card</div>
            {cards.primary ? <div style={{ fontSize: 13 }}>Saved: {cards.primary.nickname} •••• {cards.primary.last4} (exp {cards.primary.expMonth}/{cards.primary.expYear})</div> : null}
            <input value={primaryNickname} onChange={(e) => setPrimaryNickname(e.target.value)} placeholder="Card nickname" />
            <input value={primaryLast4} onChange={(e) => setPrimaryLast4(e.target.value)} placeholder="Last 4 digits" maxLength={4} />
            <div style={{ display: "flex", gap: 8 }}>
              <input value={primaryExpMonth} onChange={(e) => setPrimaryExpMonth(e.target.value)} placeholder="Exp month" />
              <input value={primaryExpYear} onChange={(e) => setPrimaryExpYear(e.target.value)} placeholder="Exp year" />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={saving} type="submit">Save Primary Card</button>
              <button disabled={saving} type="button" onClick={() => void postAction({ action: "deleteCard", slot: "primary" })}>Remove</button>
            </div>
          </form>

          <form onSubmit={(e) => void onSaveCard(e, "backup")} style={{ display: "grid", gap: 8, border: "1px solid var(--border, rgba(0,0,0,0.2))", borderRadius: 10, padding: 10 }}>
            <div style={{ fontWeight: 800 }}>Backup Card</div>
            {cards.backup ? <div style={{ fontSize: 13 }}>Saved: {cards.backup.nickname} •••• {cards.backup.last4} (exp {cards.backup.expMonth}/{cards.backup.expYear})</div> : null}
            <input value={backupNickname} onChange={(e) => setBackupNickname(e.target.value)} placeholder="Card nickname" />
            <input value={backupLast4} onChange={(e) => setBackupLast4(e.target.value)} placeholder="Last 4 digits" maxLength={4} />
            <div style={{ display: "flex", gap: 8 }}>
              <input value={backupExpMonth} onChange={(e) => setBackupExpMonth(e.target.value)} placeholder="Exp month" />
              <input value={backupExpYear} onChange={(e) => setBackupExpYear(e.target.value)} placeholder="Exp year" />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button disabled={saving} type="submit">Save Backup Card</button>
              <button disabled={saving} type="button" onClick={() => void postAction({ action: "deleteCard", slot: "backup" })}>Remove</button>
            </div>
          </form>
        </div>
      </section>

      <section style={{ border: "1px solid var(--border, rgba(0,0,0,0.2))", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Per-Item Auto Order Rules</h2>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" />
            <button disabled={saving || loading} type="button" onClick={() => void postAction({ action: "generateProposals" })}>Generate Approval Queue</button>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th align="left">Item</th>
                <th align="left">Stock</th>
                <th align="left">Enable</th>
                <th align="left">Auto Order Qty</th>
                <th align="left">Website</th>
                <th align="left">Payment</th>
                <th align="left">Charge To Account?</th>
                <th align="left">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const rule = getRule(item);
                const stock = item.onHandQty + item.orderedQty;
                return (
                  <tr key={item.id} style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.2))" }}>
                    <td style={{ padding: "8px 6px" }}>
                      <div style={{ fontWeight: 800 }}>{item.name}</div>
                      <div style={{ opacity: 0.8 }}>{item.sku}{item.partNumber ? ` | ${item.partNumber}` : ""}</div>
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      {stock} (min {item.minQty})
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      <input type="checkbox" checked={rule.enabled} onChange={(e) => changeRule(item, { enabled: e.target.checked })} />
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      <input type="number" min={1} value={rule.autoOrderAmount} onChange={(e) => changeRule(item, { autoOrderAmount: Number(e.target.value || 1) })} style={{ width: 90 }} />
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      <input value={rule.website} onChange={(e) => changeRule(item, { website: e.target.value })} placeholder="Exact URL or site" style={{ width: 240 }} />
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      <select value={rule.paymentMode} onChange={(e) => changeRule(item, { paymentMode: e.target.value as PaymentMode })}>
                        <option value="PRIMARY_CARD">Primary Card</option>
                        <option value="BACKUP_CARD">Backup Card</option>
                        <option value="ACCOUNT_CHARGE">Charge To Account</option>
                      </select>
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      <input type="checkbox" checked={rule.accountChargeSupported} onChange={(e) => changeRule(item, { accountChargeSupported: e.target.checked })} />
                    </td>
                    <td style={{ padding: "8px 6px" }}>
                      <button disabled={saving} type="button" onClick={() => void saveRule(item)}>Save</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ border: "1px solid var(--border, rgba(0,0,0,0.2))", borderRadius: 12, padding: 12, display: "grid", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>Approval Queue</h2>
        <div style={{ opacity: 0.85 }}>Pending proposals below can be approved one-by-one. No order is created until you approve.</div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th align="left">Item</th>
                <th align="left">Qty</th>
                <th align="left">Vendor</th>
                <th align="left">Payment</th>
                <th align="left">Website</th>
                <th align="left">Status</th>
                <th align="left">Action</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id} style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.2))" }}>
                  <td style={{ padding: "8px 6px" }}>
                    <div style={{ fontWeight: 800 }}>{p.itemName}</div>
                    <div style={{ opacity: 0.8 }}>{p.itemSku}</div>
                  </td>
                  <td style={{ padding: "8px 6px" }}>{p.quantity}</td>
                  <td style={{ padding: "8px 6px" }}>{p.vendor}</td>
                  <td style={{ padding: "8px 6px" }}>{p.paymentMode}</td>
                  <td style={{ padding: "8px 6px" }}>
                    {p.website ? (
                      <a href={p.website} target="_blank" rel="noreferrer">{p.website}</a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td style={{ padding: "8px 6px" }}>
                    {p.status}
                    {p.createdOrderId ? ` (${p.createdOrderId})` : ""}
                  </td>
                  <td style={{ padding: "8px 6px" }}>
                    {p.status === "PENDING" ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <button disabled={saving} type="button" onClick={() => void postAction({ action: "approveProposal", proposalId: p.id })}>Approve</button>
                        <button disabled={saving} type="button" onClick={() => void postAction({ action: "rejectProposal", proposalId: p.id })}>Reject</button>
                      </div>
                    ) : (
                      "-"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
