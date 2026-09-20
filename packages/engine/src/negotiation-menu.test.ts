import { describe, expect, it } from "vitest";
import { analyzeBuyerReason } from "./negotiate.ts";
import { buildNegotiationMenu, type NegotiationMenuInput } from "./negotiation-menu.ts";
import type { NegotiationItem } from "./negotiate.ts";

const now = new Date("2026-09-19T12:00:00.000Z");
const tr3: NegotiationItem = { variantId: "tr3-10", productId: "tr3", handle: "trail-runner-3", title: "Trail Runner 3", size: "10", productType: "Trail Shoes", list: 16900, cost: 9500, stockedAt: "2026-09-07", inStock: true, isAddOn: false };
const tr2: NegotiationItem = { variantId: "tr2-10", productId: "tr2", handle: "trail-runner-2", title: "Trail Runner 2", size: "10", productType: "Trail Shoes", list: 14900, cost: 7800, stockedAt: "2026-06-17", inStock: true, isAddOn: false };
const ridge: NegotiationItem = { ...tr2, variantId: "ridge-10", productId: "ridge", handle: "ridge-lite", title: "Ridge Lite", list: 9900, cost: 5200, stockedAt: "2026-08-10" };
const socks: NegotiationItem = { variantId: "socks-sm", productId: "socks", handle: "merino-socks", title: "Merino Socks", size: "S/M", productType: "Accessories", list: 1800, cost: 600, stockedAt: null, inStock: true, isAddOn: true };
const gaiters: NegotiationItem = { variantId: "gaiters", productId: "gaiters", handle: "trail-gaiters", title: "Trail Gaiters", size: "One size", productType: "Accessories", list: 3500, cost: 1200, stockedAt: null, inStock: true, isAddOn: true };

function input(overrides: Partial<NegotiationMenuInput> = {}): NegotiationMenuInput {
  return { main: tr3, mirror: { items: [tr3, tr2, ridge, socks, gaiters] }, offered: 12000, round: 1, reason: analyzeBuyerReason("I am buying socks too"), quantity: 1, floorPct: 25, now, allowAlternatives: true, ...overrides };
}

describe("buildNegotiationMenu", () => {
  it("only calls an item included when it is an add-on beside the main item", () => {
    const menu = buildNegotiationMenu(input({ main: socks, offered: 17000, reason: analyzeBuyerReason("I want both items"), quantity: 2, requestedItems: [{ variantId: tr2.variantId, quantity: 1 }], allowAlternatives: false }));
    expect(menu[0]!.offer.items.map(item => item.productId)).toEqual(["socks", "tr2"]);
    expect(menu[0]!.facts.join(" | ")).not.toContain("Trail Runner 2 included");
  });

  it("does not say a reason aloud when the words only looked like one", () => {
    // Each of these trips a pricing label today; none of them is the shopper giving that reason.
    const looksLike = analyzeBuyerReason("I'm returning these shoes and can't buy right now, saw it cheaper today, I'm local");
    const menu = buildNegotiationMenu(input({ main: tr2, round: 3, reason: looksLike, allowAlternatives: false }));
    expect(menu[0]!.offer.total).toBeLessThan(menu[0]!.offer.listTotal);
    expect(menu[0]!.facts).toEqual([]);
  });

  it("credits buying more than one item only on an option that holds more than one unit", () => {
    const menu = buildNegotiationMenu(input({ main: tr2, round: 3, quantity: 1, reason: analyzeBuyerReason("I want this pair, and I'd grab a couple of tees"), allowAlternatives: false }));
    expect(menu[0]!.offer.items.reduce((units, item) => units + (item.qty || 1), 0)).toBe(1);
    expect(menu[0]!.facts).not.toContain("for buying more than one item");
  });

  it("says an option meets the shopper's own number only when its total is at or under it", () => {
    const menu = buildNegotiationMenu(input({ offered: 12000, reason: analyzeBuyerReason("older model budget") }));
    const ridgeLite = menu.find(candidate => candidate.offer.items[0]!.title === "Ridge Lite")!;
    expect(ridgeLite.offer.total).toBeLessThanOrEqual(12000);
    expect(ridgeLite.facts).toContain("meets your $120 budget");
    expect(menu[0]!.offer.total).toBeGreaterThan(12000);
    expect(menu[0]!.facts.join(" ")).not.toContain("$");
  });

  it("echoes the shopper's own reasons back, but only on an option priced below list", () => {
    const belowList = buildNegotiationMenu(input({ main: tr2, round: 3, reason: analyzeBuyerReason("buying today for race day"), allowAlternatives: false }));
    expect(belowList[0]!.offer.total).toBeLessThan(belowList[0]!.offer.listTotal);
    expect(belowList[0]!.facts).toEqual(["for what you have planned", "since you're ready to check out today"]);

    const atList = buildNegotiationMenu(input({ round: 1, reason: analyzeBuyerReason("buying today"), allowAlternatives: false }));
    expect(atList[0]!.offer.total).toBe(atList[0]!.offer.listTotal);
    expect(atList[0]!.facts).toEqual([]);
  });

  it("never turns a price-match claim into a fact: we did not verify a competitor", () => {
    const menu = buildNegotiationMenu(input({ main: tr2, round: 3, reason: analyzeBuyerReason("price match, older model, returning customer on a tight budget"), allowAlternatives: false }));
    expect(menu[0]!.facts).toEqual(["to fit your budget", "for a returning customer"]);
  });

  it("states which add-on a bundle includes, and nothing about the main item", () => {
    const menu = buildNegotiationMenu(input({ requestedAddOn: "Merino Socks", allowAlternatives: false }));
    const bundle = menu.find(candidate => candidate.offer.kind === "bundle")!;
    expect(bundle.facts).toContain("Merino Socks included");
    expect(bundle.facts.join(" ")).not.toContain("Trail Runner 3");
  });

  it("passes the owner's max rounds through: round 2 of 2 prices like round 4 of 4", () => {
    const reason = analyzeBuyerReason("price match, buying today, older model");
    const lastOfTwo = buildNegotiationMenu(input({ main: tr2, round: 2, maxRounds: 2, reason, allowAlternatives: false }));
    expect(lastOfTwo[0]!.offer.total).toBe(13300);
    expect(buildNegotiationMenu(input({ main: tr2, round: 2, reason, allowAlternatives: false }))[0]!.offer.total).toBeGreaterThan(13300);
  });

  it("passes the owner's discount cap to every single-item option", () => {
    // 3% off: TR3 $169 → $163.93 → $164, TR2 $149 → $144.53 → $145, Ridge $99 → $96.03 → $97.
    const menu = buildNegotiationMenu(input({ round: 4, reason: analyzeBuyerReason("price match, buying today, older model"), discountCapPct: 3 }));
    const lowest = [16400, 9700, 14500];
    expect(menu).toHaveLength(3);
    menu.forEach((candidate, index) => expect(candidate.offer.total).toBeGreaterThanOrEqual(lowest[index]!));
    expect(menu[2]!.offer.total).toBe(14500); // aged TR2 would reach $133 under the default cap
  });

  it("uses current priceOffer math for a safe primary and cheaper alternatives", () => {
    const menu = buildNegotiationMenu(input({ reason: analyzeBuyerReason("older model budget") }));
    expect(menu[0]).toMatchObject({ id: "A", offer: { items: [{ variantId: "tr3-10" }] } });
    expect(menu.map(candidate => candidate.offer.items[0]?.title)).toContain("Trail Runner 2");
    expect(menu.map(candidate => candidate.offer.items[0]?.title)).toContain("Ridge Lite");
    for (const candidate of menu) {
      const cost = candidate.offer.items.reduce((sum, item) => sum + item.cost! * (item.qty || 1), 0);
      expect(candidate.offer.total).toBeGreaterThan(cost);
      expect(candidate.offer.total).toBeLessThanOrEqual(candidate.offer.listTotal);
    }
  });

  it("selects the exact requested gaiters add-on instead of socks", () => {
    const menu = buildNegotiationMenu(input({ requestedAddOn: "trail-gaiters", allowAlternatives: false }));
    const bundle = menu.find(candidate => candidate.offer.kind === "bundle");
    expect(bundle?.offer.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: "tr3" }),
      expect.objectContaining({ productId: "gaiters", qty: 1 }),
    ]));
    expect(bundle?.offer.items.some(item => item.productId === "socks")).toBe(false);
  });

  it("returns only the requested gaiters bundle when the shopper names that add-on", () => {
    const menu = buildNegotiationMenu(input({ main: tr2, mirror: { items: [tr2, socks, gaiters] }, offered: 12000, reason: analyzeBuyerReason(""), requestedAddOn: "Trail Gaiters", allowAlternatives: false }));
    expect(menu).toHaveLength(1);
    expect(menu[0]).toMatchObject({ id: "A", offer: { kind: "bundle", total: 17300, items: [{ productId: "tr2" }, { productId: "gaiters", qty: 1 }] } });
  });

  it("does not add an arbitrary add-on to a normal primary offer", () => {
    const menu = buildNegotiationMenu(input({ reason: analyzeBuyerReason("older model"), requestedAddOn: undefined, allowAlternatives: false }));
    expect(menu[0]?.offer.items).toHaveLength(1);
  });

  it("keeps new stock at list price and omits closed candidates", () => {
    const menu = buildNegotiationMenu(input({ offered: 12000, reason: analyzeBuyerReason("budget"), allowAlternatives: false }));
    expect(menu[0]?.offer.total).toBe(16900);
    const closed = buildNegotiationMenu(input({ main: { ...tr3, cost: null }, allowAlternatives: true }));
    expect(closed).toEqual([]);
  });

  it("omits candidates whose known inventory cannot cover the requested quantity", () => {
    const lowInventory = { ...tr3, inventory: 1 };
    expect(buildNegotiationMenu(input({ main: lowInventory, mirror: { items: [lowInventory] }, quantity: 2, allowAlternatives: false }))).toEqual([]);
  });

  it("does not substitute an alternative size when the main has a requested size", () => {
    const wrongSize = { ...tr2, variantId: "tr2-9", size: "9" };
    const menu = buildNegotiationMenu(input({ mirror: { items: [tr3, wrongSize] }, reason: analyzeBuyerReason("budget"), allowAlternatives: true }));
    expect(menu.some(candidate => candidate.offer.items.some(item => item.productId === "tr2"))).toBe(false);
  });

  it("keeps a cheaper alternative whose list is below the primary list", () => {
    const mid = { ...tr2, variantId: "mid-10", productId: "mid", handle: "mid-runner", title: "Mid Runner", list: 12500, cost: 6000 };
    const menu = buildNegotiationMenu(input({ main: tr3, mirror: { items: [tr3, mid] }, offered: 12000, reason: analyzeBuyerReason("budget"), allowAlternatives: true }));
    expect(menu.some(candidate => candidate.offer.items[0]?.productId === "mid")).toBe(true);
  });

  it("keeps an explicitly requested pair of socks in a final-round five-tee cart", () => {
    const tee: NegotiationItem = {
      variantId: "tee-xs",
      productId: "tee",
      handle: "everyday-heavyweight-tee",
      title: "Everyday Heavyweight Tee",
      size: "XS",
      productType: "T-Shirts",
      list: 5800,
      cost: 2000,
      stockedAt: "2026-06-01",
      inStock: true,
      isAddOn: false,
    };
    const menu = buildNegotiationMenu(input({
      main: tee,
      mirror: { items: [tee, socks] },
      offered: 28000,
      round: 4,
      reason: analyzeBuyerReason("five tees and one pair of socks as a gift"),
      quantity: 5,
      requestedAddOn: "Merino Socks",
      allowAlternatives: false,
    }));

    const bundle = menu.find(candidate => candidate.offer.kind === "bundle");
    expect(bundle?.offer.items).toEqual([
      expect.objectContaining({ title: "Everyday Heavyweight Tee", qty: 5 }),
      expect.objectContaining({ title: "Merino Socks", qty: 1 }),
    ]);
    expect(bundle?.offer.listTotal).toBe(30800);
    expect(bundle?.offer.total).toBe(28000);
  });

  it("keeps every explicitly requested line and quantity in one safe bundle", () => {
    const menu = buildNegotiationMenu(input({
      main: tr2,
      mirror: { items: [tr2, socks, gaiters] },
      offered: 25000,
      round: 2,
      reason: analyzeBuyerReason("I want a full kit"),
      quantity: 1,
      requestedItems: [
        { variantId: socks.variantId, quantity: 2 },
        { variantId: gaiters.variantId, quantity: 1 },
      ],
      allowAlternatives: false,
    }));

    expect(menu).toHaveLength(1);
    expect(menu[0]?.offer.items).toEqual([
      expect.objectContaining({ productId: "tr2", qty: 1 }),
      expect.objectContaining({ productId: "socks", qty: 2 }),
      expect.objectContaining({ productId: "gaiters", qty: 1 }),
    ]);
    expect(menu[0]?.offer.listTotal).toBe(22000);
  });

  it("can price an explicit cart even when the current page item is an accessory", () => {
    const menu = buildNegotiationMenu(input({
      main: socks,
      mirror: { items: [socks, tr2] },
      offered: 15000,
      round: 2,
      reason: analyzeBuyerReason("I want both items"),
      quantity: 2,
      requestedItems: [{ variantId: tr2.variantId, quantity: 1 }],
      allowAlternatives: false,
    }));

    expect(menu[0]?.offer.items).toEqual([
      expect.objectContaining({ productId: "socks", qty: 2 }),
      expect.objectContaining({ productId: "tr2", qty: 1 }),
    ]);
    expect(menu[0]?.facts).toContain("cart includes 2 × Merino Socks and 1 × Trail Runner 2");
  });

  it("does not replace a missing requested add-on with another add-on", () => {
    const unavailableGaiters = { ...gaiters, inStock: false };
    const menu = buildNegotiationMenu(input({ mirror: { items: [tr3, socks, unavailableGaiters] }, requestedAddOn: "Trail Gaiters", reason: analyzeBuyerReason("gaiters"), allowAlternatives: false }));
    expect(menu).toEqual([]);
  });
});
