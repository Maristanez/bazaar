import { floorOf } from "./floor.ts";
import { formatMoney } from "./money.ts";
import { priceOffer, type BuyerReason, type NegotiationItem, type NegotiationOffer, type NegotiationMirror, type NegotiationOptions } from "./negotiate.ts";

export type NegotiationMenuInput = {
  main: NegotiationItem;
  mirror: NegotiationMirror;
  offered: number;
  round: number;
  reason: BuyerReason;
  quantity: number;
  floorPct: number;
  now: Date;
  /** Owner settings (SPEC §4.4.1); absent = the defaults. */
  discountCapPct?: number;
  maxRounds?: number;
  requestedAddOn?: string;
  requestedItems?: readonly RequestedNegotiationItem[];
  allowAlternatives?: boolean;
};

export type RequestedNegotiationItem = {
  variantId: string;
  quantity: number;
};

/** facts: the only reasons the shopkeeper may say aloud for this option. Owner-side: they reach the LLM and the check, never the public card. */
export type NegotiationMenuCandidate = { id: string; offer: NegotiationOffer; facts: string[] };

export type NegotiationMenuResult = readonly NegotiationMenuCandidate[];

/** Build safe server-side choices while keeping all pricing in priceOffer. */
export function buildNegotiationMenu(input: NegotiationMenuInput): NegotiationMenuResult {
  const { main, mirror, offered, round, reason, quantity, floorPct } = input;
  const pricing: NegotiationOptions = { floorPct, now: input.now, discountCapPct: input.discountCapPct, maxRounds: input.maxRounds };
  const hasExplicitItems = Boolean(input.requestedItems?.length);
  const requestedItems = resolveRequestedItems(input.requestedItems, mirror.items, main);
  if (hasExplicitItems && requestedItems.length !== input.requestedItems!.length) return [];
  const requested = findRequestedAddOn(input.requestedAddOn, mirror.items, main);
  const requestedName = normalize(input.requestedAddOn || "");
  const addOns = uniqueAddOns(mirror.items, main, requested);
  const primary = priceCandidate(main, offered, round, { items: [main] }, reasonFor(reason, false), quantity, pricing);
  const candidates: NegotiationOffer[] = [];
  if (primary) candidates.push(primary);

  const bundleGroups = hasExplicitItems
    ? [requestedItems]
    : requested
      ? [[requested]]
      : requestedName
        ? []
        : reason.hasAddOnIntent
          ? addOns.map(addOn => [addOn])
          : [];
  for (const bundleItems of bundleGroups) {
    const bundle = priceCandidate(main, offered, round, mirrorFor(main, bundleItems), reasonFor(reason, true), quantity, pricing);
    if (bundle && bundle.kind === "bundle" && bundleContains(bundle, bundleItems)) candidates.push(bundle);
  }

  if (input.allowAlternatives && primary) {
    for (const alternative of alternativesFor(main, mirror.items)) {
      const alternativeOffer = priceCandidate(alternative, offered, round, { items: [alternative] }, reasonFor(reason, false), quantity, pricing);
      if (!alternativeOffer || alternativeOffer.total >= primary.total || alternativeOffer.listTotal >= primary.listTotal) continue;
      candidates.push(alternativeOffer);
    }
  }

  const unique: NegotiationOffer[] = [];
  const seen = new Set<string>();
  for (const offer of candidates) {
    const key = offer.items.map(item => `${item.productId}:${item.variantId}:${item.qty || 1}`).join("|");
    if (!seen.has(key) && safeOffer(offer, floorPct)) {
      seen.add(key);
      unique.push(offer);
    }
  }
  const explicitBundles = hasExplicitItems
    ? unique.filter(offer => offer.kind === "bundle" && bundleContains(offer, requestedItems))
    : requestedName
      ? unique.filter(offer => offer.kind === "bundle" && requested && offer.items.some(item => item.productId === requested.productId))
    : unique;
  return explicitBundles.map((offer, index) => ({ id: String.fromCharCode(65 + index), offer, facts: factsFor(offer, reason, offered) }));
}

/** Deterministic option-A fallback, shared by the server and synthetic rehearsals. */
export function rankNegotiationMenu(choices: NegotiationMenuResult, input: Pick<NegotiationMenuInput, "main" | "offered" | "requestedAddOn" | "requestedItems" | "allowAlternatives">): NegotiationMenuResult {
  const preferred = ((input.requestedAddOn || input.requestedItems?.length) && choices.find(choice => choice.offer.kind === "bundle"))
    || (input.allowAlternatives && choices.find(choice => choice.offer.items[0]!.productId !== input.main.productId && choice.offer.total <= input.offered)) || choices[0];
  return [preferred, ...choices.filter(choice => choice !== preferred)].filter((choice): choice is NegotiationMenuCandidate => Boolean(choice))
    .map((choice, index) => ({ ...choice, id: String.fromCharCode(65 + index) }));
}

/** What the shopkeeper may say back for each reason the shopper gave. True for every phrase that triggers the label; "market comparison" has no entry because we never verified a competitor's price, and "add-on intent" is covered by the bundle fact. */
const REASON_FACTS: Readonly<Record<string, string>> = {
  "budget": "to fit your budget",
  "quantity intent": "for buying more than one item",
  "repeat shopper": "for a returning customer",
  "real use case": "for what you have planned",
  "ready to buy": "since you're ready to check out today",
};

/** Public-safe reasons only. Stock age, cost, floor and target never become a fact: they are leverage against the owner. */
function factsFor(offer: NegotiationOffer, reason: BuyerReason, offered: number): string[] {
  const included = offer.items.filter(item => item.productId !== offer.items[0]!.productId).map(item => `${item.title} included`);
  // Only spell out the full cart when quantities make "both" ambiguous. For a
  // normal one-item-plus-add-on bundle, the individual included fact is safer
  // because it does not repeat the main product in shopper copy.
  const isMultiLine = offer.items.length > 1 && offer.items.some(item => (item.qty || 1) > 1);
  const cartDescription = isMultiLine
    ? [`cart includes ${offer.items.map(item => `${item.qty || 1} × ${item.title}`).join(" and ")}`]
    : [];
  // A reason is only credited where it bought something: an option still at list earned nothing.
  const reasons = offer.total < offer.listTotal ? reason.labels.flatMap(label => REASON_FACTS[label] ?? []) : [];
  // The one dollar figure a fact may carry is the shopper's own, and only where the option really is at or under it.
  const budget = Number.isSafeInteger(offered) && offered > 0 && offer.total <= offered ? [`meets your ${formatMoney(offered)} budget`] : [];
  return [...included, ...cartDescription, ...reasons, ...budget];
}

function priceCandidate(main: NegotiationItem, offered: number, round: number, mirror: NegotiationMirror, reason: BuyerReason, quantity: number, pricing: NegotiationOptions): NegotiationOffer | null {
  const offer = priceOffer(main, offered, round, mirror, reason, quantity, pricing);
  return offer.kind === "closed" ? null : offer;
}

function safeOffer(offer: NegotiationOffer, floorPct: number): boolean {
  const cost = offer.items.reduce((sum, item) => sum + (item.cost ?? Number.POSITIVE_INFINITY) * (item.qty || 1), 0);
  const floor = floorOf(cost, floorPct);
  return Number.isSafeInteger(cost) && Number.isSafeInteger(offer.total)
    && offer.items.every(item => item.inStock && item.cost !== null && inventorySafe(item, item.qty || 1))
    && offer.total > cost && offer.total >= floor && offer.total <= offer.listTotal;
}

function inventorySafe(item: NegotiationItem, quantity: number): boolean {
  const inventory = (item as NegotiationItem & { inventory?: number }).inventory;
  return inventory === undefined || (Number.isSafeInteger(inventory) && inventory >= quantity);
}

function reasonFor(reason: BuyerReason, includeAddOn: boolean): BuyerReason {
  return includeAddOn ? { ...reason, hasAddOnIntent: true } : { ...reason, hasAddOnIntent: false };
}

function mirrorFor(main: NegotiationItem, items: readonly NegotiationItem[]): NegotiationMirror {
  return { items: [main, ...items] };
}

function resolveRequestedItems(requests: readonly RequestedNegotiationItem[] | undefined, items: readonly NegotiationItem[], main: NegotiationItem): NegotiationItem[] {
  if (!requests?.length) return [];
  return requests.flatMap(request => {
    const item = items.find(candidate => candidate.variantId === request.variantId);
    if (!item || item.productId === main.productId || !item.inStock || item.cost === null
      || !Number.isSafeInteger(request.quantity) || request.quantity < 1 || request.quantity > 10
      || !inventorySafe(item, request.quantity)) return [];
    return [{ ...item, qty: request.quantity }];
  });
}

function bundleContains(offer: NegotiationOffer, requested: readonly NegotiationItem[]): boolean {
  return requested.every(expected => offer.items.some(item => item.variantId === expected.variantId && (item.qty || 1) === (expected.qty || 1)));
}

function findRequestedAddOn(request: string | undefined, items: readonly NegotiationItem[], main: NegotiationItem): NegotiationItem | undefined {
  const wanted = normalize(request || "");
  if (!wanted) return undefined;
  return items.find(item => item.isAddOn && item.productId !== main.productId && item.inStock && item.cost !== null
    && (normalize(item.title) === wanted || normalize(item.handle || "") === wanted));
}

function uniqueAddOns(items: readonly NegotiationItem[], main: NegotiationItem, requested?: NegotiationItem): NegotiationItem[] {
  const eligible = items.filter(item => item.isAddOn && item.productId !== main.productId && item.inStock && item.cost !== null);
  const groups = new Map<string, NegotiationItem>();
  for (const item of eligible.sort((left, right) => normalize(left.title).localeCompare(normalize(right.title)) || normalize(left.size || "").localeCompare(normalize(right.size || "")) || left.variantId.localeCompare(right.variantId))) {
    if (!groups.has(item.productId)) groups.set(item.productId, item);
  }
  const result = [...groups.values()];
  if (requested) return [requested, ...result.filter(item => item.productId !== requested.productId)];
  return result;
}

function alternativesFor(main: NegotiationItem, items: readonly NegotiationItem[]): NegotiationItem[] {
  const grouped = new Map<string, NegotiationItem[]>();
  for (const item of items) {
    if (item.isAddOn || item.productId === main.productId || item.productType !== main.productType || !item.inStock || item.cost === null) continue;
    const list = grouped.get(item.productId) || [];
    list.push(item);
    grouped.set(item.productId, list);
  }
  return [...grouped.values()].map(variants => main.size
    ? variants.find(item => item.size === main.size)
    : variants.slice().sort((a, b) => a.list - b.list || a.variantId.localeCompare(b.variantId))[0])
    .filter((item): item is NegotiationItem => Boolean(item))
    .filter(item => item.list < main.list)
    .sort((a, b) => a.list - b.list || normalize(a.title).localeCompare(normalize(b.title)) || a.variantId.localeCompare(b.variantId));
}

function normalize(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
