import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { Permission, Prisma } from "@prisma/client";

import { authOptions } from "@/app/lib/auth";
import { prisma } from "@/app/lib/prisma";
import { hasAnyPermission, loadUserPermissions } from "@/app/lib/permissions";

type PaymentMode = "PRIMARY_CARD" | "BACKUP_CARD" | "ACCOUNT_CHARGE";
type ProposalStatus = "PENDING" | "REJECTED" | "ORDER_CREATED";

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

type AutoOrderProposal = {
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

type AutoOrderConfig = {
  cards: {
    primary?: CardProfile;
    backup?: CardProfile;
  };
  rules: Record<string, AutoOrderRule>;
  proposals: AutoOrderProposal[];
};

type AdminSession = {
  user?: {
    id?: string | null;
    email?: string | null;
  } | null;
} | null;

const AUTO_ORDER_KEY = "autoOrderConfig";

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function normalizeLast4(v: unknown): string {
  const digits = String(v ?? "").replace(/\D+/g, "");
  return digits.slice(-4);
}

function nowIso(): string {
  return new Date().toISOString();
}

function genId(): string {
  return `aop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parsePaymentMode(v: unknown): PaymentMode {
  const x = String(v ?? "").trim().toUpperCase();
  if (x === "BACKUP_CARD") return "BACKUP_CARD";
  if (x === "ACCOUNT_CHARGE") return "ACCOUNT_CHARGE";
  return "PRIMARY_CARD";
}

function parseCardProfile(v: unknown): CardProfile | undefined {
  const obj = asRecord(v);
  const nickname = String(obj.nickname ?? "").trim();
  const last4 = normalizeLast4(obj.last4);
  const expMonth = clampInt(obj.expMonth, 1, 12, 1);
  const expYear = clampInt(obj.expYear, 2024, 2100, new Date().getFullYear());
  if (!nickname || last4.length !== 4) return undefined;
  return { nickname, last4, expMonth, expYear };
}

function parseRule(v: unknown): AutoOrderRule | undefined {
  const obj = asRecord(v);
  const itemId = String(obj.itemId ?? "").trim();
  if (!itemId) return undefined;
  return {
    itemId,
    enabled: Boolean(obj.enabled),
    autoOrderAmount: clampInt(obj.autoOrderAmount, 1, 5000, 1),
    paymentMode: parsePaymentMode(obj.paymentMode),
    accountChargeSupported: Boolean(obj.accountChargeSupported),
    website: String(obj.website ?? "").trim().slice(0, 400),
    updatedAt: String(obj.updatedAt ?? "").trim() || nowIso(),
  };
}

function parseProposal(v: unknown): AutoOrderProposal | undefined {
  const obj = asRecord(v);
  const id = String(obj.id ?? "").trim();
  const itemId = String(obj.itemId ?? "").trim();
  const itemSku = String(obj.itemSku ?? "").trim();
  const itemName = String(obj.itemName ?? "").trim();
  const vendorRaw = String(obj.vendor ?? "SUCCESS_PLUS").trim().toUpperCase();
  const vendor = vendorRaw === "AMERICAN_PLUS" ? "AMERICAN_PLUS" : "SUCCESS_PLUS";
  const statusRaw = String(obj.status ?? "PENDING").trim().toUpperCase();
  const status: ProposalStatus = statusRaw === "REJECTED" || statusRaw === "ORDER_CREATED" ? statusRaw : "PENDING";
  if (!id || !itemId || !itemSku || !itemName) return undefined;

  return {
    id,
    itemId,
    itemSku,
    itemName,
    quantity: clampInt(obj.quantity, 1, 5000, 1),
    vendor,
    paymentMode: parsePaymentMode(obj.paymentMode),
    accountChargeSupported: Boolean(obj.accountChargeSupported),
    website: String(obj.website ?? "").trim().slice(0, 400),
    status,
    createdAt: String(obj.createdAt ?? "").trim() || nowIso(),
    updatedAt: String(obj.updatedAt ?? "").trim() || nowIso(),
    createdOrderId: String(obj.createdOrderId ?? "").trim() || undefined,
  };
}

function getConfigFromUiPreferences(uiPreferences: unknown): AutoOrderConfig {
  const root = asRecord(uiPreferences);
  const raw = asRecord(root[AUTO_ORDER_KEY]);

  const cardsObj = asRecord(raw.cards);
  const rulesObj = asRecord(raw.rules);
  const proposalsRaw = Array.isArray(raw.proposals) ? raw.proposals : [];

  const rules: Record<string, AutoOrderRule> = {};
  for (const val of Object.values(rulesObj)) {
    const rule = parseRule(val);
    if (!rule) continue;
    rules[rule.itemId] = rule;
  }

  const proposals: AutoOrderProposal[] = [];
  for (const val of proposalsRaw) {
    const p = parseProposal(val);
    if (p) proposals.push(p);
  }

  proposals.sort((a, b) => {
    if (a.status !== b.status) return a.status === "PENDING" ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return {
    cards: {
      primary: parseCardProfile(cardsObj.primary),
      backup: parseCardProfile(cardsObj.backup),
    },
    rules,
    proposals,
  };
}

function setConfigToUiPreferences(uiPreferences: unknown, cfg: AutoOrderConfig): Record<string, unknown> {
  const root = asRecord(uiPreferences);
  return {
    ...root,
    [AUTO_ORDER_KEY]: cfg,
  };
}

async function requireAutoOrderAccess() {
  const session = (await getServerSession(authOptions)) as AdminSession;
  if (!session) throw new Error("Unauthorized");

  const perms = await loadUserPermissions(session as unknown as Parameters<typeof loadUserPermissions>[0]);
  const canUse = perms.allowAll || hasAnyPermission(perms, [Permission.ADMIN_VIEW_ITEMS, Permission.ADMIN_EDIT_ITEMS]);
  if (!canUse) throw new Error("Forbidden");

  return session;
}

async function resolveCurrentUser() {
  const session = await requireAutoOrderAccess();
  const id = session?.user?.id ?? null;
  const email = session?.user?.email ?? null;

  if (id) {
    const row = await prisma.user.findUnique({ where: { id }, select: { id: true, uiPreferences: true } });
    if (row) return row;
  }

  if (email) {
    const row = await prisma.user.findUnique({ where: { email }, select: { id: true, uiPreferences: true } });
    if (row) return row;
  }

  throw new Error("User not found");
}

async function loadItemsForAutoOrder() {
  return prisma.item.findMany({
    where: { active: true },
    select: {
      id: true,
      sku: true,
      name: true,
      partNumber: true,
      onHandQty: true,
      orderedQty: true,
      minQty: true,
      reorderIgnored: true,
      vendor: true,
      orderFrom: true,
    },
    orderBy: [{ name: "asc" }],
  });
}

function sanitizeConfig(cfg: AutoOrderConfig): AutoOrderConfig {
  const cleanedRules: Record<string, AutoOrderRule> = {};
  for (const [itemId, rule] of Object.entries(cfg.rules)) {
    if (!itemId) continue;
    cleanedRules[itemId] = {
      ...rule,
      itemId,
      autoOrderAmount: clampInt(rule.autoOrderAmount, 1, 5000, 1),
      website: String(rule.website ?? "").trim().slice(0, 400),
      updatedAt: rule.updatedAt || nowIso(),
    };
  }

  const cleanedProposals = cfg.proposals.map((p) => ({
    ...p,
    quantity: clampInt(p.quantity, 1, 5000, 1),
    website: String(p.website ?? "").trim().slice(0, 400),
    updatedAt: p.updatedAt || nowIso(),
    createdAt: p.createdAt || nowIso(),
  }));

  return {
    cards: {
      primary: cfg.cards.primary,
      backup: cfg.cards.backup,
    },
    rules: cleanedRules,
    proposals: cleanedProposals,
  };
}

export async function GET() {
  try {
    const user = await resolveCurrentUser();
    const [items] = await Promise.all([loadItemsForAutoOrder()]);
    const cfg = sanitizeConfig(getConfigFromUiPreferences(user.uiPreferences));

    return NextResponse.json({
      items,
      cards: cfg.cards,
      rules: cfg.rules,
      proposals: cfg.proposals,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to load auto-order settings.";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();

    const user = await resolveCurrentUser();
    const cfg = sanitizeConfig(getConfigFromUiPreferences(user.uiPreferences));

    if (action === "saveCard") {
      const slot = String(body.slot ?? "").trim();
      if (slot !== "primary" && slot !== "backup") {
        return NextResponse.json({ error: "Invalid card slot." }, { status: 400 });
      }

      const profile = parseCardProfile(body.card);
      if (!profile) {
        return NextResponse.json({ error: "Card nickname and valid last4 are required." }, { status: 400 });
      }

      if (slot === "primary") cfg.cards.primary = profile;
      if (slot === "backup") cfg.cards.backup = profile;
    } else if (action === "deleteCard") {
      const slot = String(body.slot ?? "").trim();
      if (slot === "primary") delete cfg.cards.primary;
      else if (slot === "backup") delete cfg.cards.backup;
      else return NextResponse.json({ error: "Invalid card slot." }, { status: 400 });
    } else if (action === "saveRule") {
      const itemId = String(body.itemId ?? "").trim();
      if (!itemId) return NextResponse.json({ error: "Item is required." }, { status: 400 });

      const item = await prisma.item.findUnique({ where: { id: itemId }, select: { id: true } });
      if (!item) return NextResponse.json({ error: "Item not found." }, { status: 404 });

      cfg.rules[itemId] = {
        itemId,
        enabled: Boolean(body.enabled),
        autoOrderAmount: clampInt(body.autoOrderAmount, 1, 5000, 1),
        paymentMode: parsePaymentMode(body.paymentMode),
        accountChargeSupported: Boolean(body.accountChargeSupported),
        website: String(body.website ?? "").trim().slice(0, 400),
        updatedAt: nowIso(),
      };
    } else if (action === "generateProposals") {
      const items = await loadItemsForAutoOrder();
      const itemsById = new Map(items.map((x) => [x.id, x]));
      const pendingByItem = new Set(cfg.proposals.filter((p) => p.status === "PENDING").map((p) => p.itemId));

      for (const rule of Object.values(cfg.rules)) {
        if (!rule.enabled) continue;
        if (pendingByItem.has(rule.itemId)) continue;

        const item = itemsById.get(rule.itemId);
        if (!item || item.reorderIgnored) continue;

        const effectiveOnHand = Number(item.onHandQty) + Number(item.orderedQty);
        if (effectiveOnHand > Number(item.minQty)) continue;

        cfg.proposals.unshift({
          id: genId(),
          itemId: item.id,
          itemSku: item.sku,
          itemName: item.name,
          quantity: clampInt(rule.autoOrderAmount, 1, 5000, 1),
          vendor: item.vendor,
          paymentMode: rule.paymentMode,
          accountChargeSupported: rule.accountChargeSupported,
          website: rule.website || String(item.orderFrom ?? "").trim(),
          status: "PENDING",
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      }
    } else if (action === "approveProposal") {
      const proposalId = String(body.proposalId ?? "").trim();
      if (!proposalId) return NextResponse.json({ error: "Proposal is required." }, { status: 400 });

      const proposal = cfg.proposals.find((p) => p.id === proposalId);
      if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
      if (proposal.status !== "PENDING") {
        return NextResponse.json({ error: "Proposal is not pending." }, { status: 400 });
      }

      if (proposal.paymentMode === "PRIMARY_CARD" && !cfg.cards.primary) {
        return NextResponse.json({ error: "Primary card is required for this proposal." }, { status: 400 });
      }
      if (proposal.paymentMode === "BACKUP_CARD" && !cfg.cards.backup) {
        return NextResponse.json({ error: "Backup card is required for this proposal." }, { status: 400 });
      }
      if (proposal.paymentMode === "ACCOUNT_CHARGE" && !proposal.accountChargeSupported) {
        return NextResponse.json({ error: "This item/vendor is not marked as account-charge capable." }, { status: 400 });
      }

      const item = await prisma.item.findUnique({
        where: { id: proposal.itemId },
        select: { id: true, vendor: true },
      });
      if (!item) return NextResponse.json({ error: "Item no longer exists." }, { status: 404 });

      const paymentLabel =
        proposal.paymentMode === "PRIMARY_CARD"
          ? `Primary card (${cfg.cards.primary?.nickname ?? "missing"})`
          : proposal.paymentMode === "BACKUP_CARD"
            ? `Backup card (${cfg.cards.backup?.nickname ?? "missing"})`
            : "Charge to account";

      const order = await prisma.inventoryOrder.create({
        data: {
          itemId: proposal.itemId,
          quantity: proposal.quantity,
          vendor: item.vendor,
          createdByUserId: user.id,
          note: [
            "AUTO-ORDER APPROVED",
            `payment=${paymentLabel}`,
            proposal.website ? `website=${proposal.website}` : "",
          ]
            .filter(Boolean)
            .join(" | "),
        },
        select: { id: true },
      });

      proposal.status = "ORDER_CREATED";
      proposal.updatedAt = nowIso();
      proposal.createdOrderId = order.id;
    } else if (action === "rejectProposal") {
      const proposalId = String(body.proposalId ?? "").trim();
      if (!proposalId) return NextResponse.json({ error: "Proposal is required." }, { status: 400 });

      const proposal = cfg.proposals.find((p) => p.id === proposalId);
      if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
      proposal.status = "REJECTED";
      proposal.updatedAt = nowIso();
    } else {
      return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
    }

    const nextPrefs = setConfigToUiPreferences(user.uiPreferences, cfg);
    await prisma.user.update({
      where: { id: user.id },
      data: { uiPreferences: nextPrefs as Prisma.InputJsonValue },
      select: { id: true },
    });

    const items = await loadItemsForAutoOrder();
    return NextResponse.json({
      items,
      cards: cfg.cards,
      rules: cfg.rules,
      proposals: cfg.proposals,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to update auto-order settings.";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
