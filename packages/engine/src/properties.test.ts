// Invariants 1 and 2 as properties of the one menu every shopper is priced from (SPEC §6).
import { expect, it } from "vitest";
import fc from "fast-check";
import { auditOffer, buildNegotiationMenu, formatMoney, isLowball, rankNegotiationMenu, toShopper, type BuyerReason, type NegotiationItem, type NegotiationMenuInput, type NegotiationOffer } from "./index.ts";

const replay = { seed: 42, numRuns: 1000 };
const now = new Date("2026-09-19T12:00:00.000Z");

const stockedAt = fc.option(fc.integer({ min: 0, max: 200 }).map(days => new Date(now.getTime() - days * 86_400_000).toISOString()), { nil: null });
const money = fc.integer({ min: 1, max: 400 }).chain(costDollars => fc.record({
  cost: fc.option(fc.integer({ min: costDollars * 100 - 99, max: costDollars * 100 }), { nil: null, freq: 10 }),
  list: fc.integer({ min: costDollars * 100, max: costDollars * 400 }),
}));
function item(id: string, isAddOn: boolean): fc.Arbitrary<NegotiationItem> {
  return fc.record({ money, stockedAt, inStock: fc.boolean(), size: fc.constantFrom("9", "10") }).map(({ money, stockedAt, inStock, size }) => ({
    variantId: `${id}-v`, productId: id, title: id, handle: id, size, productType: isAddOn ? "Accessories" : "Trail Shoes",
    list: money.list, cost: money.cost, stockedAt, inStock, isAddOn,
  }));
}
const reason: fc.Arbitrary<BuyerReason> = fc.record({
  score: fc.integer({ min: 0, max: 4 }), label: fc.constantFrom(null, "budget"), labels: fc.subarray(["budget", "quantity intent", "add-on intent", "repeat shopper", "market comparison", "real use case", "ready to buy"]),
  hasBulkIntent: fc.boolean(), hasAddOnIntent: fc.boolean(), hasMarketComparison: fc.boolean(), isReadyToBuy: fc.boolean(),
});
const menuInput: fc.Arbitrary<NegotiationMenuInput> = fc.record({
  main: item("main", false), other: item("other", false), socks: item("socks", true), gaiters: item("gaiters", true),
  offered: fc.integer({ min: 1, max: 200_000 }), round: fc.integer({ min: 1, max: 6 }), reason,
  quantity: fc.integer({ min: 1, max: 10 }), floorPct: fc.integer({ min: 0, max: 60 }),
  discountCapPct: fc.option(fc.integer({ min: 0, max: 40 }), { nil: undefined }),
  maxRounds: fc.option(fc.integer({ min: 2, max: 6 }), { nil: undefined }),
  askSocks: fc.boolean(), allowAlternatives: fc.boolean(),
}).map(({ other, socks, gaiters, askSocks, ...rest }) => ({
  ...rest, now, mirror: { items: [rest.main, other, socks, gaiters] },
  ...(askSocks ? { requestedItems: [{ variantId: socks.variantId, quantity: 1 }] } : {}),
}));

const costOf = (items: readonly NegotiationItem[]) => items.reduce((sum, entry) => sum + entry.cost! * (entry.qty || 1), 0);
const floorOf = (cost: number, floorPct: number) => Math.max(cost + 1, Math.ceil(cost * (1 + floorPct / 100)));

it("every option on the menu is above cost, at or above the owner's floor, and never above list", () => {
  fc.assert(fc.property(menuInput, input => {
    for (const { offer } of buildNegotiationMenu(input)) {
      expect(offer.items.every(entry => entry.inStock && entry.cost !== null)).toBe(true);
      const cost = costOf(offer.items);
      expect(Number.isSafeInteger(offer.total)).toBe(true);
      expect(offer.total).toBeGreaterThan(cost);
      expect(offer.total).toBeGreaterThanOrEqual(floorOf(cost, input.floorPct));
      expect(offer.total).toBeLessThanOrEqual(offer.listTotal);
    }
  }), replay);
});

it("every option on the menu passes the settlement audit without an owner approval", () => {
  fc.assert(fc.property(menuInput, input => {
    for (const { offer } of buildNegotiationMenu(input)) {
      const audit = auditOffer(offer.items, offer.total, input.floorPct, now);
      expect(audit).not.toBeNull();
      expect(audit!.profit).toBeGreaterThan(0);
    }
  }), replay);
});

it("a single-item option never goes below the owner's discount cap", () => {
  fc.assert(fc.property(menuInput, input => {
    const capPct = input.discountCapPct ?? 22;
    for (const { offer } of buildNegotiationMenu(input)) {
      if (offer.kind === "bundle") continue;
      expect(offer.total).toBeGreaterThanOrEqual(Math.ceil(offer.listTotal * (1 - capPct / 100)));
    }
  }), replay);
});

it("an item with no cost, out of stock, or with a floor above list never reaches the menu", () => {
  fc.assert(fc.property(menuInput, input => {
    const { main, quantity, floorPct } = input;
    const closed = !main.inStock || main.cost === null || floorOf(main.cost * quantity, floorPct) > main.list * quantity;
    if (closed) expect(buildNegotiationMenu(input).some(({ offer }) => offer.items[0]!.productId === main.productId)).toBe(false);
  }), replay);
});

it("the menu is deterministic, lettered from A, and ranking only reorders it", () => {
  fc.assert(fc.property(menuInput, input => {
    const menu = buildNegotiationMenu(input);
    expect(buildNegotiationMenu(input)).toEqual(menu);
    expect(menu.map(choice => choice.id)).toEqual(menu.map((_, index) => String.fromCharCode(65 + index)));
    const ranked = rankNegotiationMenu(menu, input);
    const byCart = (a: NegotiationOffer, b: NegotiationOffer) => JSON.stringify(a).localeCompare(JSON.stringify(b));
    expect(ranked.map(choice => choice.offer).sort(byCart)).toEqual(menu.map(choice => choice.offer).sort(byCart));
    expect(ranked.map(choice => choice.id)).toEqual(menu.map(choice => choice.id));
  }), replay);
});

it("a fact never carries a dollar figure that is not the shopper's own, and never hints at stock age", () => {
  fc.assert(fc.property(menuInput, input => {
    for (const { offer, facts } of buildNegotiationMenu(input)) {
      for (const fact of facts) {
        // Invariant 1 for words: cost, floor, target and profit have no way into a sentence.
        for (const figure of fact.match(/\$[\d,.]+/g) ?? []) {
          expect(figure).toBe(formatMoney(input.offered));
          expect(offer.total).toBeLessThanOrEqual(input.offered);
        }
        expect(fact).not.toMatch(/\b(?:stocked|days?|weeks?|months?|ago|old|aged|clearance|season)\b/i);
      }
    }
  }), replay);
});

it("a later round never asks more than an earlier one", () => {
  fc.assert(fc.property(menuInput, input => {
    const at = (round: number) => buildNegotiationMenu({ ...input, round, requestedItems: undefined, allowAlternatives: false, reason: { ...input.reason, hasAddOnIntent: false } })[0]?.offer;
    const earlier = at(1), later = at(input.maxRounds ?? 4);
    if (earlier?.kind === "counter" && later?.kind === "counter") expect(later.total).toBeLessThanOrEqual(earlier.total);
  }), replay);
});

it("the lowball rule is off at zero and otherwise a strict share of list", () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 200_000 }), fc.integer({ min: 100, max: 200_000 }), fc.integer({ min: 0, max: 80 }), (offered, list, cutoffPct) => {
    expect(isLowball(offered, list, 0)).toBe(false);
    expect(isLowball(offered, list, cutoffPct)).toBe(cutoffPct > 0 && offered / list < cutoffPct / 100);
    expect(toShopper(offered) % 100).toBe(0);
  }), replay);
});

it("the generated inputs are not vacuous: they reach open menus, bundles and alternatives", () => {
  const menus = fc.sample(menuInput, replay).map(input => ({ input, menu: buildNegotiationMenu(input) }));
  const open = menus.filter(({ menu }) => menu.length > 0);
  expect(open.length).toBeGreaterThan(200);
  expect(open.filter(({ menu }) => menu.some(choice => choice.offer.kind === "bundle")).length).toBeGreaterThan(20);
  expect(open.filter(({ input, menu }) => menu.some(choice => choice.offer.items[0]!.productId !== input.main.productId)).length).toBeGreaterThan(5);
});
