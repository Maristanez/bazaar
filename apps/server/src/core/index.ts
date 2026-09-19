import type { ChatEvent, ConsoleEvent, OfferCard, Option, ProductCard, PublicOption, Settlement } from "@bazaar/contracts";
import { auditAccepted, buildMenu, toShopper, type PriceAudit } from "@bazaar/engine";
import { checkAcceptable, createOffer, markUsed, type Offer } from "./offers";
import { noOpHooks } from "./hooks";
import type { Blocked, CorePorts, MakeOfferInput, MirroredItem, Negotiation, Route, Timed, Understood } from "./ports";

const MAX_ROUNDS = 4;
const TURN_MS = 4_000;
const UNDERSTAND_MS = 2_500;

function routeOf(negotiation: Negotiation): Route {
  return { negotiationId: negotiation.negotiationId, shopperId: negotiation.shopperId, surface: negotiation.surface };
}

function publicOption(option: Option): PublicOption {
  const { id, kind, items, listTotal, total } = option;
  return { id, kind, items, listTotal, total };
}

function amount(total: number): string {
  return `$${(total / 100).toFixed(0)}`;
}

function template(option: Option): string {
  return option.kind === "final" ? `My best is ${amount(option.total)}.` : `I can hold ${amount(option.total)} for 15 minutes.`;
}

function cardFor(route: Route, round: number, offer: Offer, line: string): OfferCard {
  const option = offer.option;
  const badges = [
    ...(option.kind === "bundle" ? option.items.filter((item) => item.thrownIn).map((item) => `＋ ${item.title}`) : []),
    ...(option.kind === "final" ? ["final offer"] : ["held 15:00"]),
  ];
  return {
    negotiationId: route.negotiationId,
    offerId: offer.id,
    status: "live",
    round,
    maxRounds: MAX_ROUNDS,
    option: publicOption(option),
    line,
    mood: "deal",
    badges,
    trail: [{ label: "List", amount: option.listTotal, by: "shop" }, { label: "Deal", amount: option.total, by: "shop" }],
    expiresAt: offer.expiresAt.toISOString(),
    disclosure: ["You're talking to Trailhead Co's deal agent", "Only the offer on this card is binding."],
  };
}

function fallbackUnderstand(text: string): Understood {
  if (/(?:^|\s)-\s*(?:C\$|\$)/i.test(text)) return { kind: "question" };
  const match = /(?:C\$|\$)\s*(\d+(?:\.\d{1,2})?)/i.exec(text);
  if (!match) return { kind: "question" };
  const currency = /\b(?:USD|EUR|JPY|yen)\b/i.test(text) ? "non-CAD" : "CAD";
  const size = /\bsize\s*(9|10|11)\b/i.exec(text)?.[1];
  const value = Math.round(Number(match[1]) * 100);
  return /\bbudget\b/i.test(text)
    ? { kind: "budget", budget: value, currency, ...(size === undefined ? {} : { size }) }
    : { kind: "offer", amount: value, currency, ...(size === undefined ? {} : { size }) };
}

function elapsed(start: Date, now: Date): number {
  return Math.max(0, now.getTime() - start.getTime());
}

async function timed<T>(ports: CorePorts, start: Date, cap: number, work: () => Promise<T>): Promise<Timed<T>> {
  const remaining = Math.min(cap, TURN_MS - elapsed(start, ports.clock.now()));
  if (remaining <= 0) return { timedOut: true };
  try {
    return await ports.clock.within(work, remaining);
  } catch {
    return { timedOut: true };
  }
}

function validate(main: MirroredItem, understood: Understood): boolean {
  const currency = understood.currency ?? "CAD";
  const quantity = understood.quantity ?? 1;
  const values = [understood.amount, understood.budget].filter((value): value is number => value !== undefined);
  return currency === "CAD" && Number.isInteger(quantity) && quantity >= 1 && quantity <= 20
    && values.every((value) => Number.isFinite(value) && value > 0 && value <= main.list * 10);
}

function isUnderstood(value: unknown): value is Understood {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "offer" && candidate.kind !== "budget" && candidate.kind !== "question") return false;
  if (candidate.kind === "offer" && typeof candidate.amount !== "number") return false;
  if (candidate.kind === "budget" && typeof candidate.budget !== "number") return false;
  return ["amount", "budget", "quantity"].every((key) => candidate[key] === undefined || typeof candidate[key] === "number")
    && ["size", "wants", "currency"].every((key) => candidate[key] === undefined || typeof candidate[key] === "string");
}

function isPick(value: unknown): value is { optionId: string; line: string } {
  return value !== null && typeof value === "object"
    && typeof (value as Record<string, unknown>).optionId === "string"
    && typeof (value as Record<string, unknown>).line === "string";
}

function acceptedOption(main: MirroredItem, total: number): Option {
  return {
    id: "accepted",
    kind: "held",
    items: [{ variantId: main.variantId, title: main.title, ...(main.size === undefined ? {} : { size: main.size }), qty: 1 }],
    listTotal: toShopper(main.list),
    total,
    ownerRank: 1,
    facts: [],
  };
}

function productFor(ports: CorePorts, productId: string, size?: string): MirroredItem | undefined {
  return ports.db.getItems().find((item) => !item.isAddOn && item.inStock && item.productId === productId && (size === undefined || item.size === size));
}

function emit(ports: CorePorts, route: Route, event: ChatEvent, events: ChatEvent[]): void {
  ports.events.chat(route, event);
  events.push(event);
}

function consoleDecision(route: Route, offer: number, round: number, menu: Option[], picked: Option, audit: PriceAudit, at: Date): ConsoleEvent {
  return {
    at: at.toISOString(),
    surface: route.surface,
    negotiationId: route.negotiationId,
    shopperId: route.shopperId,
    kind: "decision",
    reasoning: "engine menu and selected option",
    offer,
    round,
    menu,
    picked: picked.id,
    cost: audit.cost,
    floor: audit.floor,
    target: audit.target,
    profit: audit.profit,
  };
}

function emitBlocked(ports: CorePorts, route: Route, blockedBy: "validate" | "engine"): void {
  ports.events.console(route, {
    at: ports.clock.now().toISOString(), surface: route.surface, negotiationId: route.negotiationId, shopperId: route.shopperId,
    kind: "blocked", reasoning: "core validation or engine refusal", blockedBy,
  });
}

/** Public catalog projection. Costs and owner-only menu fields do not cross this boundary. */
export function findProducts(ports: CorePorts, query: string): ProductCard[] {
  const needle = query.trim().toLowerCase();
  const groups = new Map<string, MirroredItem[]>();
  for (const item of ports.db.getItems()) {
    if (item.isAddOn) continue;
    const haystack = `${item.productId} ${item.title} ${item.productType}`.toLowerCase();
    if (needle && !haystack.includes(needle)) continue;
    const group = groups.get(item.productId) ?? [];
    group.push(item);
    groups.set(item.productId, group);
  }
  return [...groups.values()].map((items) => {
    const first = items[0]!;
    return {
      productId: first.productId,
      title: first.title,
      image: first.image,
      listPrice: toShopper(first.list),
      sizes: items.flatMap((item) => item.size === undefined ? [] : [item.size]),
      openToOffers: items.some((item) => item.inStock && item.cost !== null),
    };
  });
}

/** Runs §5.1 through the injected ports and returns only public chat events. */
export async function makeOffer(ports: CorePorts, input: MakeOfferInput): Promise<ChatEvent[]> {
  const negotiationId = input.negotiationId ?? ports.newId();
  const provisionalRoute: Route = { negotiationId, shopperId: input.shopperId, surface: input.surface };
  const initialMain = productFor(ports, input.productId, input.size);
  if (!initialMain || !initialMain.inStock) {
    emitBlocked(ports, provisionalRoute, "validate");
    return [{ t: "text", delta: "I can only make offers on an available product." }];
  }
  return ports.db.withNegotiationLock(negotiationId, async () => {
    const existing = ports.db.getNegotiation(negotiationId);
    if (existing && (existing.shopperId !== input.shopperId || existing.surface !== input.surface || existing.productId !== input.productId)) {
      emitBlocked(ports, provisionalRoute, "validate");
      return [{ t: "text", delta: "That negotiation belongs to a different product or shopper." }];
    }
    const negotiation = existing ?? { negotiationId, shopperId: input.shopperId, surface: input.surface, productId: input.productId, ...(input.size === undefined ? {} : { size: input.size }), round: 0 };
    const route = routeOf(negotiation);
    const start = ports.clock.now();
    const understandingProduct = productFor(ports, input.productId, input.size ?? existing?.size) ?? initialMain;
    const understoodResult = input.understood === undefined
      ? await timed(ports, start, UNDERSTAND_MS, () => ports.understand({
        text: input.text ?? "",
        product: { productId: understandingProduct.productId, title: understandingProduct.title, ...(understandingProduct.size === undefined ? {} : { size: understandingProduct.size }) },
      }))
      : { timedOut: false as const, value: input.understood };
    const understood = understoodResult.timedOut ? fallbackUnderstand(input.text ?? "") : understoodResult.value;
    if (!isUnderstood(understood)) {
      const events: ChatEvent[] = [];
      emit(ports, route, { t: "text", delta: "Please send a positive CAD offer for this product." }, events);
      emitBlocked(ports, route, "validate");
      return events;
    }
    if (input.size !== undefined && understood.size !== undefined && input.size !== understood.size) {
      const events: ChatEvent[] = [];
      emit(ports, route, { t: "text", delta: "Please send a positive CAD offer for this product." }, events);
      emitBlocked(ports, route, "validate");
      return events;
    }
    if (existing && input.size !== undefined && existing.size !== input.size) {
      const events: ChatEvent[] = [];
      emit(ports, route, { t: "text", delta: "That negotiation belongs to a different product or shopper." }, events);
      emitBlocked(ports, route, "validate");
      return events;
    }
    const normalizedSize = input.size ?? understood.size ?? existing?.size;
    if (existing && existing.size !== normalizedSize) {
      const events: ChatEvent[] = [];
      emit(ports, route, { t: "text", delta: "That negotiation belongs to a different product or shopper." }, events);
      emitBlocked(ports, route, "validate");
      return events;
    }
    if (!existing && normalizedSize !== undefined) negotiation.size = normalizedSize;
    const main = productFor(ports, input.productId, normalizedSize);
    if (!main || !main.inStock) {
      const events: ChatEvent[] = [];
      emit(ports, route, { t: "text", delta: "Please send a positive CAD offer for this product." }, events);
      emitBlocked(ports, route, "validate");
      return events;
    }
    if (understood.kind === "question") {
      const events: ChatEvent[] = [];
      emit(ports, route, { t: "text", delta: "I can answer product questions or help with a concrete offer." }, events);
      return events;
    }
    if (!validate(main, understood)) {
      const events: ChatEvent[] = [];
      emit(ports, route, { t: "text", delta: "Please send a positive CAD offer for this product." }, events);
      emitBlocked(ports, route, "validate");
      return events;
    }
    const explicitOffer = understood.kind === "offer" && understood.amount !== undefined;
    const finalRefusal = explicitOffer && negotiation.round >= MAX_ROUNDS;
    const round = explicitOffer ? Math.min(MAX_ROUNDS, negotiation.round + 1) : Math.max(1, negotiation.round);
    const offer = explicitOffer ? understood.amount! : 0;
    const menu = buildMenu({
      main,
      addOns: ports.db.getItems().filter((item) => item.isAddOn),
      catalog: ports.db.getItems(),
      offer,
      ...(understood.budget === undefined ? {} : { budget: understood.budget }),
      ...(normalizedSize === undefined ? {} : { size: normalizedSize }),
      round: round as 1 | 2 | 3 | 4,
      floorPct: ports.db.getPolicy().floorPct,
      now: start,
    });
    if (menu.outcome === "closed") {
      const events: ChatEvent[] = [];
      emit(ports, route, { t: "text", delta: "This product is not open to offers right now." }, events);
      emitBlocked(ports, route, "engine");
      return events;
    }
    let selected: Option;
    let audit: PriceAudit;
    let line: string;
    let menuOptions: Option[];
    if (menu.outcome === "accept") {
      selected = acceptedOption(main, menu.total);
      audit = auditAccepted({ main, total: menu.total, floorPct: ports.db.getPolicy().floorPct, now: start })!;
      line = template(selected);
      menuOptions = [selected];
    } else {
      const fallback = menu.options.find((option) => option.id === "A");
      if (!fallback) {
        emitBlocked(ports, route, "engine");
        return [{ t: "text", delta: "I cannot make a safe offer for that cart." }];
      }
      const picked = finalRefusal ? { timedOut: true as const } : await timed(ports, start, TURN_MS, () => ports.chooseAndSay(menu.options, {
        productId: main.productId, title: main.title, ...(main.size === undefined ? {} : { size: main.size }), round,
        ...(understood.budget === undefined ? {} : { budget: understood.budget }),
        ...(understood.wants === undefined ? {} : { wants: understood.wants }),
      }));
      const validPick = !picked.timedOut && isPick(picked.value);
      selected = validPick && menu.options.some((option) => option.id === picked.value.optionId)
        ? menu.options.find((option) => option.id === picked.value.optionId)!
        : fallback;
      line = validPick && selected.id === picked.value.optionId ? picked.value.line : template(fallback);
      audit = menu.internals[selected.id]!;
      menuOptions = menu.options;
    }
    negotiation.round = explicitOffer ? round : negotiation.round;
    ports.db.setNegotiation(negotiation);
    const created = createOffer(ports.db.offers, { negotiationId, option: selected, now: start, newId: ports.newId });
    ports.db.setAudit(created.id, audit);
    const events: ChatEvent[] = [];
    emit(ports, route, { t: "card", card: cardFor(route, round, created, line) }, events);
    emit(ports, route, { t: "text", delta: line }, events);
    ports.events.console(route, consoleDecision(route, offer, round, menuOptions, selected, audit, ports.clock.now()));
    return events;
  });
}

/** Accepts one live offer through the injected minter; B7/B8/B9 hooks are currently no-ops. */
export async function acceptOffer(ports: CorePorts, offerId: string): Promise<Settlement | Blocked> {
  const initial = ports.db.offers.get(offerId);
  const negotiationId = initial?.negotiationId ?? offerId;
  return ports.db.withNegotiationLock(negotiationId, async () => {
    const checked = checkAcceptable(ports.db.offers, offerId, ports.clock.now());
    if (!checked.ok) return { blocked: "offer_ids" };
    if (!ports.db.claimOffer(offerId)) return { blocked: "offer_ids" };
    try {
      const audit = ports.db.getAudit(offerId);
      if (!audit) return { blocked: "auditor" };
      const hooks = ports.hooks ?? noOpHooks;
      if (!await hooks.pause() || !await hooks.approval(checked.offer, audit)) {
        return { blocked: "auditor" };
      }
      const refreshedAudit = await hooks.auditor(checked.offer, audit);
      if (!refreshedAudit) return { blocked: "auditor" };
      ports.db.setAudit(offerId, refreshedAudit);
      const minted = await ports.mint(checked.offer, refreshedAudit);
      const settlement: Settlement = {
        offerId,
        code: minted.code,
        agreedTotal: checked.offer.option.total,
        checkoutUrl: minted.checkoutUrl,
        expiresAt: checked.offer.expiresAt.toISOString(),
      };
      markUsed(ports.db.offers, offerId);
      ports.db.setSettlement(settlement);
      const negotiation = ports.db.getNegotiation(checked.offer.negotiationId);
      if (negotiation) {
        const route = routeOf(negotiation);
        ports.events.chat(route, { t: "settled", settlement });
        ports.events.console(route, {
          at: ports.clock.now().toISOString(), surface: route.surface, negotiationId: route.negotiationId, shopperId: route.shopperId,
          kind: "settled", reasoning: "offer settled", cost: refreshedAudit.cost, floor: refreshedAudit.floor, target: refreshedAudit.target, profit: refreshedAudit.profit,
        });
      }
      return settlement;
    } catch {
      return { blocked: "mint" };
    } finally {
      ports.db.releaseOffer(offerId);
    }
  });
}
