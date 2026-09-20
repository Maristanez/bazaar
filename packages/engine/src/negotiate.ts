import type { Item } from "./types.ts";
import { floorOf } from "./floor.ts";
import { formatMoney, toShopper } from "./money.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_ROUNDS = 4;
/** An offer under this share of list gets the firm line. Wording only. */
const WELL_UNDER_LIST = 0.8;
/** The share of list the shopkeeper suggests a shopper open with. */
const SUGGESTED_OPENING = 0.85;

export type NegotiationItem = Item & {
  variantNumericId?: string;
  productNumericId?: string;
  handle?: string;
  image?: string;
  url?: string;
  qty?: number;
};
export type NegotiationMirror = { items: readonly NegotiationItem[] };
export type BuyerReason = {
  score: number; label: string | null; labels: string[];
  hasBulkIntent: boolean; hasAddOnIntent: boolean; hasMarketComparison: boolean; isReadyToBuy: boolean;
};
export type NegotiationOffer = {
  kind: "closed" | "accepted" | "counter" | "bundle";
  items: NegotiationItem[]; listTotal: number; total: number; line: string; badges: string[];
};
/** discountCapPct: the most the owner lets the shopkeeper take off list (0–40, default 22). It never reaches below the floor. */
/** maxRounds: how many rounds the owner allows (2–6, default 4). The round curve stretches so the last round always lands where round 4 of 4 does. */
export type NegotiationOptions = { floorPct: number; now: Date; discountCapPct?: number; maxRounds?: number };
const DEFAULT_DISCOUNT_CAP_PCT = 22;
export type NegotiationAudit = { cost: number; floor: number; target: number; profit: number };
type ReasonSignal = { pattern: RegExp; score: number; label: string; key?: string };

export function analyzeBuyerReason(message: string): BuyerReason {
  const text = String(message || "").toLowerCase();
  const signals: ReasonSignal[] = [
    { pattern: /\b(student|college|school|tight budget|budget is|payday|saving up)\b/, score: 1, label: "budget" },
    { pattern: /\b(buy|buying|grab|take|get|adding|add|order).*\b(two|2|both|multiple|pair|couple|tees|shirts|items|bundle|socks|cap|gaiters|vest|flask|kit)\b|\b(bundle|multiple items|full kit|whole kit|couple|pair)\b/, score: 2, label: "quantity intent", key: "bulk" },
    { pattern: /\b(socks?|cap|gaiters?|vest|flask|kit)\b/, score: 1, label: "add-on intent", key: "addon" },
    { pattern: /\b(returning|repeat|loyal|bought before|customer already|local)\b/, score: 1, label: "repeat shopper" },
    { pattern: /\b(last season|older model|clearance|sale|price match|competitor|elsewhere|same shoe)\b/, score: 2, label: "market comparison", key: "market" },
    { pattern: /\b(race|marathon|trail day|trip|weekend hike|gift|birthday|team|club)\b/, score: 1, label: "real use case" },
    { pattern: /\b(today|right now|checkout now|buy now|order now|ready to buy|buying now)\b/, score: 1, label: "ready to buy", key: "ready" },
  ];
  const matched = signals.filter(signal => signal.pattern.test(text));
  const score = Math.min(4, matched.reduce((sum, signal) => sum + signal.score, 0));
  const primary = matched.slice().sort((a, b) => b.score - a.score)[0];
  return {
    score, label: primary?.label ?? null, labels: matched.map(signal => signal.label),
    hasBulkIntent: matched.some(signal => signal.key === "bulk"),
    hasAddOnIntent: matched.some(signal => signal.key === "addon"),
    hasMarketComparison: matched.some(signal => signal.key === "market"),
    isReadyToBuy: matched.some(signal => signal.key === "ready"),
  };
}

export function applyNegotiationContext(reason: BuyerReason, context: { quantity?: number } = {}): BuyerReason {
  const quantity = Number(context.quantity || 0);
  if (quantity <= 1 || reason.hasBulkIntent) return reason;
  return {
    ...reason,
    score: Math.min(4, Math.max(reason.score || 0, 2)),
    label: reason.score >= 2 && reason.label ? reason.label : "quantity intent",
    labels: Array.from(new Set([...reason.labels, "quantity intent"])),
    hasBulkIntent: true,
  };
}

export function priceOffer(
  main: NegotiationItem,
  offered: number,
  round: number,
  mirror: NegotiationMirror,
  reason: BuyerReason = emptyReason(),
  quantity = 1,
  options: NegotiationOptions,
): NegotiationOffer {
  const mainQty = { ...main, qty: quantity };
  const validQuantity = validQuantityValue(quantity);
  const validMoney = validItem(main) && validQuantity;
  const listTotal = validMoney ? main.list * quantity : 0;
  const floor = validMoney && Number.isInteger(options.floorPct) && options.floorPct >= 0 && options.floorPct <= 60 && Number.isFinite(options.floorPct) && validDate(options.now)
    ? floorOf(main.cost! * quantity, options.floorPct)
    : null;
  if (!validMoney || !main.inStock || main.cost === null || floor === null || floor > listTotal) {
    return { kind: "closed", items: [mainQty], listTotal, total: listTotal, line: "I cannot safely haggle this item because it is not open to offers.", badges: [main.cost === null ? "missing cost" : "not open to offers"] };
  }
  if (!Number.isSafeInteger(offered) || offered <= 0) return { kind: "closed", items: [mainQty], listTotal, total: listTotal, line: "I cannot safely haggle this item because the offer is invalid.", badges: ["invalid offer"] };
  if (offered >= listTotal && !reason.hasAddOnIntent) {
    return { kind: "accepted", items: [mainQty], listTotal, total: listTotal, line: `${main.title} is already ${formatMoney(toShopper(main.list))}${quantity > 1 ? " each" : ""}. You can check out at list price, or send me a lower offer to haggle.`, badges: ["list price", "checkout ready"] };
  }
  const capPct = discountCapOf(options.discountCapPct);
  const maxRounds = maxRoundsOf(options.maxRounds);
  const step = curveStep(round, maxRounds);
  const pricedMain = { ...main, list: main.list * quantity };
  const baseTarget = targetOf(pricedMain, floor, options.now);
  const sellerTarget = sellerTargetFor(pricedMain, floor, baseTarget, reason, step, capPct);
  const ask = sellerAskFor(pricedMain, sellerTarget, step, reason, options.now);
  const safeOffered = toShopper(offered);
  const hasConvincingReason = reason.score >= 2 || reason.hasBulkIntent || quantity > 1;
  // Wording only: an offer well under list gets the firm line. The owner's lowball rule is isLowball (lowball.ts).
  const wellUnderList = safeOffered < toShopper(main.list * quantity * WELL_UNDER_LIST);
  const bundleItems = mirror.items.filter(item => validItem(item) && item.inStock && item.cost !== null && item.productId !== main.productId);
  if (bundleItems.length && reason.hasAddOnIntent) {
    const bundlePart = bundleItems.reduce((sum, item) => {
      const itemQuantity = item.qty || 1;
      return sum + Math.ceil(item.cost! + (item.list - item.cost!) / 2) * itemQuantity;
    }, 0);
    const bundleCost = main.cost * quantity + bundleItems.reduce((sum, item) => sum + item.cost! * (item.qty || 1), 0);
    const bundleList = main.list * quantity + bundleItems.reduce((sum, item) => sum + item.list * (item.qty || 1), 0);
    const bundleFloor = floorOf(bundleCost, options.floorPct);
    const bundleTotal = toShopper(Math.max(ask + bundlePart, bundleFloor));
    if (bundleFloor <= bundleList && bundleTotal > bundleCost && bundleTotal >= bundleFloor && bundleTotal <= bundleList) {
      const accepted = hasConvincingReason && safeOffered >= bundleTotal;
      const total = accepted ? Math.min(bundleList, safeOffered) : bundleTotal;
      const itemSummary = bundleItems.map(item => `${item.qty || 1} × ${item.title}`).join(" plus ");
      const line = accepted
        ? `${reasonPrefix(reason)}Deal, I can hold ${formatMoney(total)} for 15 minutes with ${itemSummary} included.`
        : `${reasonPrefix(reason)}I would rather protect the single item price, but I can make the cart better: ${formatMoney(total)} with ${itemSummary} included.`;
      return { kind: "bundle", items: [mainQty, ...bundleItems.map(item => ({ ...item, qty: item.qty || 1 }))], listTotal: bundleList, total, line, badges: reasonBadges(reason, [...bundleItems.map(item => `＋ ${item.qty || 1} × ${item.title}`), accepted ? "held 15:00" : "bundle value"]) };
    }
  }
  if (safeOffered >= floor && safeOffered >= sellerTarget && safeOffered <= listTotal && round >= 2 && hasConvincingReason) {
    return { kind: "accepted", items: [mainQty], listTotal, total: safeOffered, line: `${reasonPrefix(reason)}Deal — I can hold ${formatMoney(safeOffered)} for 15 minutes.`, badges: reasonBadges(reason, ["good intent", "held 15:00"]) };
  }
  const total = round === 1 && reason.score > 0 ? sellerAskFor(pricedMain, sellerTarget, 1, reason, options.now) : ask;
  const safeTotal = Math.min(listTotal, Math.max(floor, Math.ceil(listTotal * (1 - capPct / 100)), total));
  const line = round === 1 && reason.score > 0
    ? `${reasonPrefix(reason)}I can start at ${formatMoney(safeTotal)}. If you can show stronger intent — bundle, checkout today, or a real comparison — I may be able to sharpen it.`
    : step >= 3 || wellUnderList
      ? `I am going to hold firm at ${formatMoney(safeTotal)} on this one. I need a stronger reason to move lower — a real bundle, checkout today, or a fair comparison.`
      : `${reason.score === 0 ? "I need a better reason before I move much. " : ""}${reasonPrefix(reason)}I can do ${formatMoney(safeTotal)} if you want to move forward.`;
  return { kind: "counter", items: [mainQty], listTotal, total: safeTotal, line, badges: reasonBadges(reason, [round >= maxRounds ? "firm counter" : reason.score === 0 ? "reason needed" : "seller counter"]) };
}

/** The figure the shopkeeper suggests a shopper open with when they have not named one. A prompt to the shopper, never an offer from the shop. */
export function suggestedOpeningOffer(list: number, quantity = 1): number {
  return toShopper(list * quantity * SUGGESTED_OPENING);
}

/**
 * The figure the owner is asked to approve: the shopper's offer in whole dollars, when it is above cost, under the floor
 * and under the shop's final price. Anything else needs no approval, or can never be approved (invariant 2): null.
 */
export function ownerApprovalTotal(offered: number, audit: Pick<NegotiationAudit, "cost" | "floor">, finalTotal: number): number | null {
  const total = toShopper(offered);
  return total > audit.cost && total < audit.floor && total < finalTotal ? total : null;
}

export function auditOffer(items: readonly (NegotiationItem & { qty?: number })[], total: number, floorPct: number, now: Date, ownerApproved = false): NegotiationAudit | null {
  if (!items.length || !validDate(now) || !Number.isSafeInteger(total) || !Number.isSafeInteger(floorPct) || floorPct < 0 || floorPct > 60 || items.some(item => !validItem(item) || !item.inStock || item.cost === null || !validQuantityValue(item.qty ?? 1))) return null;
  const cost = items.reduce((sum, item) => sum + item.cost! * (item.qty ?? 1), 0);
  const list = items.reduce((sum, item) => sum + item.list * (item.qty ?? 1), 0);
  if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(list)) return null;
  const floor = floorOf(cost, floorPct);
  if ((!ownerApproved && floor > list) || total <= cost || total > list || (!ownerApproved && total < floor)) return null;
  const main = items[0]!;
  const target = Math.ceil(list - urgencyFor(main.stockedAt, now) * (list - floor));
  return { cost, floor, target, profit: total - cost };
}

function maxRoundsOf(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 6 ? value : DEFAULT_MAX_ROUNDS;
}

/** Where round r of N sits on today's four-round curve: 1 at the first round, 4 at the last (and it stays there). With N = 4 it is the round itself. */
function curveStep(round: number, maxRounds: number): number {
  return Math.min(4, 1 + (round - 1) * 3 / (maxRounds - 1));
}

function discountCapOf(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 40 ? value : DEFAULT_DISCOUNT_CAP_PCT;
}

function emptyReason(): BuyerReason {
  return {
    score: 0,
    label: null,
    labels: [],
    hasBulkIntent: false,
    hasAddOnIntent: false,
    hasMarketComparison: false,
    isReadyToBuy: false,
  };
}

function validDate(value: Date): boolean {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function validQuantityValue(value: number | undefined): boolean {
  return value !== undefined && Number.isSafeInteger(value) && value >= 1 && value <= 10;
}

function validItem(item: NegotiationItem): boolean {
  return Number.isSafeInteger(item.list) && item.list > 0
    && (item.cost === null || (Number.isSafeInteger(item.cost) && item.cost >= 0));
}

function targetOf(item: NegotiationItem, floor: number, now: Date): number {
  return Math.ceil(item.list - urgencyFor(item.stockedAt, now) * (item.list - floor));
}

function urgencyFor(stockedAt: string | null, now: Date): number {
  if (!stockedAt || !validDate(now)) return 0;
  const stockedAtMs = Date.parse(stockedAt);
  if (!Number.isFinite(stockedAtMs) || stockedAtMs > now.getTime()) return 0;
  const ageDays = (now.getTime() - stockedAtMs) / DAY_MS;
  return Math.min(1, Math.max(0, (ageDays - 60) / 60));
}

function askFor(list: number, target: number, stockedAt: string | null, round: number, now: Date): number {
  const urgency = urgencyFor(stockedAt, now);
  return list - ((round - 1) / 3) ** (1 / (1 + urgency)) * (list - target);
}

function reasonAdjustedTarget(list: number, baseTarget: number, score: number): number {
  const strength = score >= 4 ? 0.7 : score >= 3 ? 0.55 : score === 2 ? 0.4 : score === 1 ? 0.2 : 0.05;
  return Math.ceil(list - strength * (list - baseTarget));
}

function maxSellerDiscount(reason: BuyerReason, step: number, capPct: number): number {
  const baseByScore = [
    [0, 0, 0.04, 0.06],
    [0.02, 0.04, 0.07, 0.09],
    [0.03, 0.06, 0.1, 0.12],
    [0.04, 0.08, 0.12, 0.15],
    [0.05, 0.1, 0.15, 0.18],
  ];
  const score = Math.max(0, Math.min(4, reason.score));
  const row = baseByScore[score]!;
  const position = Math.max(1, Math.min(4, step)) - 1;
  const lower = Math.floor(position);
  let discount = row[lower]! + (row[Math.min(3, lower + 1)]! - row[lower]!) * (position - lower);
  if (reason.hasBulkIntent) discount += 0.03;
  if (reason.hasAddOnIntent) discount += 0.02;
  if (reason.isReadyToBuy) discount += 0.02;
  if (reason.hasMarketComparison) discount += 0.02;
  return Math.min(capPct / 100, discount);
}

function sellerTargetFor(
  item: NegotiationItem,
  floor: number,
  baseTarget: number,
  reason: BuyerReason,
  round: number,
  capPct: number,
): number {
  const protectedTarget = toShopper(item.list * (1 - maxSellerDiscount(reason, round, capPct)));
  const reasonBaseTarget = reason.score >= 2 && baseTarget >= item.list ? protectedTarget : baseTarget;
  const reasonTarget = reasonAdjustedTarget(item.list, reasonBaseTarget, reason.score);
  return toShopper(Math.max(floor, reasonTarget, protectedTarget));
}

function sellerAskFor(
  item: NegotiationItem,
  sellerTarget: number,
  round: number,
  reason: BuyerReason,
  now: Date,
): number {
  if (reason.score === 0 && round <= 2) return toShopper(item.list);
  return toShopper(askFor(item.list, sellerTarget, item.stockedAt, round, now));
}

function reasonPrefix(reason: BuyerReason): string {
  return reason.label ? `That gives me something to work with (${reason.label}). ` : "";
}

function reasonBadges(reason: BuyerReason, badges: string[]): string[] {
  return reason.label ? [`reason: ${reason.label}`, ...badges] : badges;
}
