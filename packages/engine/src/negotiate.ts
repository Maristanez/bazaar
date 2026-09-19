import type { Item } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROUNDS = 4;

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
export type NegotiationOptions = { floorPct: number; now: Date };
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
    ? Math.max(main.cost! * quantity + 1, Math.ceil(main.cost! * quantity * (1 + options.floorPct / 100)))
    : null;
  if (!validMoney || !main.inStock || main.cost === null || floor === null || floor > listTotal) {
    return { kind: "closed", items: [mainQty], listTotal, total: listTotal, line: "I cannot safely haggle this item because it is not open to offers.", badges: [main.cost === null ? "missing cost" : "not open to offers"] };
  }
  if (!Number.isSafeInteger(offered) || offered <= 0) return { kind: "closed", items: [mainQty], listTotal, total: listTotal, line: "I cannot safely haggle this item because the offer is invalid.", badges: ["invalid offer"] };
  if (offered >= listTotal && !reason.hasAddOnIntent) {
    return { kind: "accepted", items: [mainQty], listTotal, total: listTotal, line: `${main.title} is already ${formatMoney(roundToShopper(main.list))}${quantity > 1 ? " each" : ""}. You can check out at list price, or send me a lower offer to haggle.`, badges: ["list price", "checkout ready"] };
  }
  const pricedMain = { ...main, list: main.list * quantity };
  const baseTarget = targetOf(pricedMain, floor, options.now);
  const sellerTarget = sellerTargetFor(pricedMain, floor, baseTarget, reason, round);
  const ask = sellerAskFor(pricedMain, sellerTarget, round, reason, options.now);
  const safeOffered = roundToShopper(offered);
  const hasConvincingReason = reason.score >= 2 || reason.hasBulkIntent || quantity > 1;
  const isLowball = safeOffered < roundToShopper(main.list * quantity * 0.8);
  const addOn = mirror.items.find(item => item.isAddOn && validItem(item) && item.inStock && item.cost !== null && item.productId !== main.productId);
  if (addOn && !main.isAddOn && reason.hasAddOnIntent) {
    const addonPart = Math.ceil(addOn.cost! + (addOn.list - addOn.cost!) / 2);
    const bundleCost = main.cost * quantity + addOn.cost!;
    const bundleList = main.list * quantity + addOn.list;
    const bundleFloor = Math.max(bundleCost + 1, Math.ceil(bundleCost * (1 + options.floorPct / 100)));
    const bundleTotal = roundToShopper(Math.max(ask + addonPart, bundleFloor));
    if (bundleFloor <= bundleList && bundleTotal > bundleCost && bundleTotal >= bundleFloor && bundleTotal <= bundleList) {
      const accepted = round >= 2 && hasConvincingReason && safeOffered >= bundleTotal;
      const total = accepted ? Math.min(bundleList, safeOffered) : bundleTotal;
      const line = accepted
        ? `${reasonPrefix(reason)}Deal — I can hold ${formatMoney(total)} for 15 minutes with ${addOn.title} included.`
        : `${reasonPrefix(reason)}I would rather protect the single-item price, but I can make the cart better: ${formatMoney(total)} with ${addOn.title} included.`;
      return { kind: "bundle", items: [mainQty, { ...addOn, qty: 1 }], listTotal: bundleList, total, line, badges: reasonBadges(reason, [`＋ ${addOn.title}`, accepted ? "held 15:00" : "bundle value"]) };
    }
  }
  if (safeOffered >= floor && safeOffered >= sellerTarget && safeOffered <= listTotal && round >= 2 && hasConvincingReason) {
    return { kind: "accepted", items: [mainQty], listTotal, total: safeOffered, line: `${reasonPrefix(reason)}Deal — I can hold ${formatMoney(safeOffered)} for 15 minutes.`, badges: reasonBadges(reason, ["good intent", "held 15:00"]) };
  }
  const total = round === 1 && reason.score > 0 ? sellerAskFor(pricedMain, sellerTarget, 1, reason, options.now) : ask;
  const safeTotal = Math.min(listTotal, Math.max(floor, total));
  const line = round === 1 && reason.score > 0
    ? `${reasonPrefix(reason)}I can start at ${formatMoney(safeTotal)}. If you can show stronger intent — bundle, checkout today, or a real comparison — I may be able to sharpen it.`
    : round >= 3 || isLowball
      ? `I am going to hold firm at ${formatMoney(safeTotal)} on this one. I need a stronger reason to move lower — a real bundle, checkout today, or a fair comparison.`
      : `${reason.score === 0 ? "I need a better reason before I move much. " : ""}${reasonPrefix(reason)}I can do ${formatMoney(safeTotal)} if you want to move forward.`;
  return { kind: "counter", items: [mainQty], listTotal, total: safeTotal, line, badges: reasonBadges(reason, [round >= MAX_ROUNDS ? "firm counter" : reason.score === 0 ? "reason needed" : "seller counter"]) };
}

export function auditOffer(items: readonly (NegotiationItem & { qty?: number })[], total: number, floorPct: number, now: Date, ownerApproved = false): NegotiationAudit | null {
  if (!items.length || !validDate(now) || !Number.isSafeInteger(total) || !Number.isSafeInteger(floorPct) || floorPct < 0 || floorPct > 60 || items.some(item => !validItem(item) || !item.inStock || item.cost === null || !validQuantityValue(item.qty ?? 1))) return null;
  const cost = items.reduce((sum, item) => sum + item.cost! * (item.qty ?? 1), 0);
  const list = items.reduce((sum, item) => sum + item.list * (item.qty ?? 1), 0);
  if (!Number.isSafeInteger(cost) || !Number.isSafeInteger(list)) return null;
  const floor = Math.max(cost + 1, Math.ceil(cost * (1 + floorPct / 100)));
  if ((!ownerApproved && floor > list) || total <= cost || total > list || (!ownerApproved && total < floor)) return null;
  const main = items[0]!;
  const target = Math.ceil(list - urgencyFor(main.stockedAt, now) * (list - floor));
  return { cost, floor, target, profit: total - cost };
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

function maxSellerDiscount(reason: BuyerReason, round: number): number {
  const baseByScore = [
    [0, 0, 0.04, 0.06],
    [0.02, 0.04, 0.07, 0.09],
    [0.03, 0.06, 0.1, 0.12],
    [0.04, 0.08, 0.12, 0.15],
    [0.05, 0.1, 0.15, 0.18],
  ];
  const score = Math.max(0, Math.min(4, reason.score));
  let discount = baseByScore[score]![Math.max(1, Math.min(MAX_ROUNDS, round)) - 1]!;
  if (reason.hasBulkIntent) discount += 0.03;
  if (reason.hasAddOnIntent) discount += 0.02;
  if (reason.isReadyToBuy) discount += 0.02;
  if (reason.hasMarketComparison) discount += 0.02;
  return Math.min(0.22, discount);
}

function sellerTargetFor(
  item: NegotiationItem,
  floor: number,
  baseTarget: number,
  reason: BuyerReason,
  round: number,
): number {
  const protectedTarget = roundToShopper(item.list * (1 - maxSellerDiscount(reason, round)));
  const reasonBaseTarget = reason.score >= 2 && baseTarget >= item.list ? protectedTarget : baseTarget;
  const reasonTarget = reasonAdjustedTarget(item.list, reasonBaseTarget, reason.score);
  return roundToShopper(Math.max(floor, reasonTarget, protectedTarget));
}

function sellerAskFor(
  item: NegotiationItem,
  sellerTarget: number,
  round: number,
  reason: BuyerReason,
  now: Date,
): number {
  if (reason.score === 0 && round <= 2) return roundToShopper(item.list);
  return roundToShopper(askFor(item.list, sellerTarget, item.stockedAt, round, now));
}

function reasonPrefix(reason: BuyerReason): string {
  return reason.label ? `That gives me something to work with (${reason.label}). ` : "";
}

function reasonBadges(reason: BuyerReason, badges: string[]): string[] {
  return reason.label ? [`reason: ${reason.label}`, ...badges] : badges;
}

function roundToShopper(cents: number): number {
  return Math.ceil(Number(cents || 0) / 100) * 100;
}

function formatMoney(cents: number): string {
  return cents % 100 === 0 ? `$${(cents / 100).toFixed(0)}` : `$${(cents / 100).toFixed(2)}`;
}
