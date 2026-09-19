// @ts-expect-error Node's strip-types runtime requires the explicit extension.
import { priceOffer, type BuyerReason, type NegotiationItem, type NegotiationOffer, type NegotiationMirror } from "./negotiate.ts";

export type NegotiationMenuInput = {
  main: NegotiationItem;
  mirror: NegotiationMirror;
  offered: number;
  round: number;
  reason: BuyerReason;
  quantity: number;
  floorPct: number;
  now: Date;
  requestedAddOn?: string;
  allowAlternatives?: boolean;
};

export type NegotiationMenuCandidate = { id: string; offer: NegotiationOffer };

export type NegotiationMenuResult = readonly NegotiationMenuCandidate[];

/** Build safe server-side choices while keeping all pricing in priceOffer. */
export function buildNegotiationMenu(input: NegotiationMenuInput): NegotiationMenuResult {
  const { main, mirror, offered, round, reason, quantity, floorPct, now } = input;
  const requested = findRequestedAddOn(input.requestedAddOn, mirror.items, main);
  const requestedName = normalize(input.requestedAddOn || "");
  const addOns = uniqueAddOns(mirror.items, main, requested);
  const primary = priceCandidate(main, offered, round, { items: [main] }, reasonFor(reason, false), quantity, floorPct, now);
  const candidates: NegotiationOffer[] = [];
  if (primary) candidates.push(primary);

  const bundleAddOns = requested ? [requested] : requestedName ? [] : reason.hasAddOnIntent ? addOns : [];
  for (const addOn of bundleAddOns) {
    const bundle = priceCandidate(main, offered, round, mirrorFor(main, [addOn], addOn), reasonFor(reason, true), quantity, floorPct, now);
    if (bundle && bundle.kind === "bundle" && bundle.items.some(item => item.productId === addOn.productId)) candidates.push(bundle);
  }

  if (input.allowAlternatives && primary) {
    for (const alternative of alternativesFor(main, mirror.items)) {
      const alternativeOffer = priceCandidate(alternative, offered, round, { items: [alternative] }, reasonFor(reason, false), quantity, floorPct, now);
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
  const explicitBundles = requestedName
    ? unique.filter(offer => offer.kind === "bundle" && requested && offer.items.some(item => item.productId === requested.productId))
    : unique;
  return explicitBundles.map((offer, index) => ({ id: String.fromCharCode(65 + index), offer }));
}

/** Deterministic option-A fallback, shared by the server and synthetic rehearsals. */
export function rankNegotiationMenu(choices: NegotiationMenuResult, input: Pick<NegotiationMenuInput, "main" | "offered" | "requestedAddOn" | "allowAlternatives">): NegotiationMenuResult {
  const preferred = (input.requestedAddOn && choices.find(choice => choice.offer.kind === "bundle"))
    || (input.allowAlternatives && choices.find(choice => choice.offer.items[0]!.productId !== input.main.productId && choice.offer.total <= input.offered)) || choices[0];
  return [preferred, ...choices.filter(choice => choice !== preferred)].filter((choice): choice is NegotiationMenuCandidate => Boolean(choice))
    .map((choice, index) => ({ ...choice, id: String.fromCharCode(65 + index) }));
}

function priceCandidate(main: NegotiationItem, offered: number, round: number, mirror: NegotiationMirror, reason: BuyerReason, quantity: number, floorPct: number, now: Date): NegotiationOffer | null {
  const offer = priceOffer(main, offered, round, mirror, reason, quantity, { floorPct, now });
  return offer.kind === "closed" ? null : offer;
}

function safeOffer(offer: NegotiationOffer, floorPct: number): boolean {
  const cost = offer.items.reduce((sum, item) => sum + (item.cost ?? Number.POSITIVE_INFINITY) * (item.qty || 1), 0);
  const floor = Math.max(cost + 1, Math.ceil(cost * (1 + floorPct / 100)));
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

function mirrorFor(main: NegotiationItem, addOns: readonly NegotiationItem[], selected?: NegotiationItem): NegotiationMirror {
  const ordered = selected ? [selected, ...addOns.filter(item => item.variantId !== selected.variantId)] : addOns;
  return { items: [main, ...ordered] };
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
