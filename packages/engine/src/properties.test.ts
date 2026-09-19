import { expect, it } from "vitest";
import fc from "fast-check";
import { ask, buildMenu, costOf, floorOf, targetOf, toShopper, urgency, type Item } from "./index";

// B8 owns owner-decline restatement; B4 offers.test.ts owns offer-id lifecycle.
// Owner clarified §6.2 on 2026-09-19: unrounded concession steps; bundle shoe
// target, not bundle cart target. See docs/part-b-spec-notes.md.
const now = new Date("2026-09-19T12:00:00Z");
const replay = { seed: 42, numRuns: 1000 };
const round = fc.constantFrom(1 as const, 2 as const, 3 as const, 4 as const);
const item = fc.record({
  cost: fc.integer({ min: 1, max: 50000 }), margin: fc.integer({ min: 1, max: 50000 }),
  age: fc.option(fc.integer({ min: 0, max: 400 }), { nil: null }),
  size: fc.constantFrom("9", "10", "11"), inStock: fc.boolean(),
}).map(({ cost, margin, age, size, inStock }): Item => ({
  variantId: "p", productId: "p", title: "Shoe", productType: "shoe", size, inStock,
  list: cost + margin, cost, stockedAt: age === null ? null : new Date(now.getTime() - age * 86400000).toISOString(), isAddOn: false,
}));
const cases = fc.tuple(item, item, item, fc.integer({ min: 0, max: 100 }), round).chain(([product, other, addon, floorPct, round]) =>
  fc.record({ offer: fc.integer({ min: 1, max: product.list * 10 }), budget: fc.option(fc.integer({ min: 1, max: product.list * 10 }), { nil: undefined }) })
    .map(({ offer, budget }) => ({ product, catalog: [product, { ...other, productId: "q", variantId: "q" }, { ...addon, productId: "a", variantId: "a", size: undefined, isAddOn: true }], floorPct, round, offer, budget, now })));

it("every emitted option or acceptance clears cost and the rounded floor", () => {
  fc.assert(fc.property(cases, (input) => {
    const result = buildMenu(input);
    if (result.decision === "accept") {
      expect(result.total).toBeGreaterThan(input.product.cost!);
      expect(result.total).toBeGreaterThanOrEqual(toShopper(floorOf([input.product], input.floorPct)));
      expect(result.total % 100).toBe(0);
    }
    if (result.decision === "menu") for (const option of result.options) {
      const cart = option.items.map((i) => input.catalog.find((p) => p.variantId === i.variantId)!);
      expect(option.total).toBeGreaterThan(costOf(cart)!);
      expect(option.total).toBeGreaterThanOrEqual(toShopper(floorOf(cart, input.floorPct)));
      expect(option.total % 100).toBe(0);
      expect(option.listTotal % 100).toBe(0);
      expect(result.audit[option.id]!.profit).toBe(option.total - costOf(cart)!);
    }
  }), replay);
});

it("missing stock age has zero urgency and cannot move the rounded ask", () => {
  fc.assert(fc.property(cases, ({ product, floorPct, round }) => {
    const missing = { ...product, stockedAt: null };
    expect(urgency(missing.stockedAt, now)).toBe(0);
    expect(toShopper(targetOf([missing], 0, floorPct))).toBe(toShopper(product.list));
    expect(toShopper(ask(product.list, targetOf([missing], 0, floorPct), 0, round))).toBe(toShopper(product.list));
  }), replay);
});

it("urgency endpoints mean list at zero and floor at one, and round four equals target", () => {
  fc.assert(fc.property(cases, ({ product, floorPct }) => {
    expect(toShopper(targetOf([product], 0, floorPct))).toBe(toShopper(product.list));
    expect(toShopper(targetOf([product], 1, floorPct))).toBe(toShopper(floorOf([product], floorPct)));
    const u = urgency(product.stockedAt, now), target = targetOf([product], u, floorPct);
    expect(toShopper(ask(product.list, target, u, 4))).toBe(toShopper(target));
  }), replay);
});

it("acceptances never reduce an offer", () => {
  fc.assert(fc.property(cases, (input) => {
    const result = buildMenu(input);
    if (result.decision === "accept") expect(result.total).toBe(toShopper(input.offer));
    if (result.decision === "menu") {
      for (const option of result.options.filter((o) => o.kind !== "else"))
        expect(option.total).toBeGreaterThanOrEqual(toShopper(input.offer));
    }
  }), replay);
});

it("a bundle uses its main urgency regardless of add-on stock age", () => {
  fc.assert(fc.property(cases, (input) => {
    const low = buildMenu({ ...input, offer: 1 });
    const high = buildMenu({ ...input, offer: 1, catalog: input.catalog.map((p) => p.isAddOn ? { ...p, stockedAt: "2020-01-01T00:00:00Z" } : p) });
    expect(high).toEqual(low);
    if (low.decision === "menu") for (const option of low.options) {
      const cart = option.items.map((i) => input.catalog.find((p) => p.variantId === i.variantId)!);
      expect(toShopper(low.audit[option.id]!.target)).toBe(toShopper(targetOf(cart, urgency(cart[0]!.stockedAt, now), input.floorPct)));
    }
  }), replay);
});

it("bundles add exactly half the add-on margin before shopper rounding and unlock only when profit holds", () => {
  fc.assert(fc.property(cases, (input) => {
    const result = buildMenu({ ...input, offer: 1 });
    if (result.decision !== "menu") return;
    const u = urgency(input.product.stockedAt, now), target = targetOf([input.product], u, input.floorPct);
    const held = ask(input.product.list, target, u, input.round);
    const next = ask(input.product.list, target, u, Math.min(4, input.round + 1) as 1 | 2 | 3 | 4);
    for (const bundle of result.options.filter((o) => o.kind === "bundle")) {
      const addon = input.catalog.find((p) => p.variantId === bundle.items[1]!.variantId)!;
      const addonPart = (addon.list + addon.cost!) / 2;
      const shoe = next + addonPart - addon.cost! >= held ? next : held;
      expect(bundle.total).toBe(toShopper(shoe + addonPart));
      expect(bundle.items[1]!.thrownIn).toBe(true);
    }
  }), replay);
});

it("alternatives obey the trigger, stock/size/type/target eligibility and exact cart price", () => {
  fc.assert(fc.property(cases, (input) => {
    const result = buildMenu(input);
    if (result.decision !== "menu") return;
    const mainTarget = targetOf([input.product], urgency(input.product.stockedAt, now), input.floorPct);
    for (const option of result.options.filter((o) => o.kind === "else")) {
      expect(input.offer < mainTarget || input.round >= 3).toBe(true);
      const cart = option.items.map((i) => input.catalog.find((p) => p.variantId === i.variantId)!);
      const q = cart[0]!, u = urgency(q.stockedAt, now), target = targetOf(cart, u, input.floorPct);
      expect(q.inStock).toBe(true);
      expect(q.size).toBe(input.product.size);
      expect(q.productType).toBe(input.product.productType);
      expect(toShopper(targetOf([q], u, input.floorPct))).toBeLessThanOrEqual(toShopper(Math.max(input.offer, input.budget ?? input.offer)));
      const list = cart.reduce((sum, p) => sum + p.list, 0);
      expect(option.total).toBe(toShopper(Math.max(target, Math.min(ask(list, target, u, input.round), input.budget ?? input.offer))));
    }
  }), replay);
});

it("missing product cost closes and missing add-on/alternative costs are excluded", () => {
  fc.assert(fc.property(cases, (input) => {
    expect(buildMenu({ ...input, product: { ...input.product, cost: null } })).toEqual({ decision: "closed", reason: "missing_cost" });
    const result = buildMenu({ ...input, offer: 1, catalog: input.catalog.map((p) => p.productId === "p" ? p : { ...p, cost: null }) });
    if (result.decision === "menu") expect(result.options.flatMap((o) => o.items.map((i) => i.variantId))).toEqual(result.options.map(() => "p"));
  }), replay);
});

// Owner clarification: shrinking steps use unrounded cents. Floors above list
// cannot define a discount curve: still generate them, but verify that the menu
// drops unsafe asks. Monotonicity covers every ask the menu can actually publish.
it("published asks never increase; unrounded discount steps shrink; round four reaches target", () => {
  fc.assert(fc.property(cases, (input) => {
    const { product, floorPct } = input;
    const u = urgency(product.stockedAt, now), target = targetOf([product], u, floorPct);
    const raw = ([1, 2, 3, 4] as const).map((r) => ask(product.list, target, u, r));
    const published = ([1, 2, 3, 4] as const).flatMap((round) => {
      const result = buildMenu({ ...input, round, offer: 0 });
      return result.decision === "menu" ? result.options.filter((o) => o.id === "A").map((o) => o.total) : [];
    });
    expect(published.every((value, i) => i === 0 || value <= published[i - 1]!)).toBe(true);
    expect(toShopper(raw[3]!)).toBe(toShopper(target));
    if (floorOf([product], floorPct) <= product.list) {
      const drops = raw.slice(1).map((value, i) => raw[i]! - value);
      expect(drops.every((d) => d >= 0)).toBe(true);
      expect(drops[0]).toBeGreaterThanOrEqual(drops[1]!);
      expect(drops[1]).toBeGreaterThanOrEqual(drops[2]!);
    } else {
      expect(published.every((value) => value >= toShopper(floorOf([product], floorPct)))).toBe(true);
    }
  }), replay);
});

// Owner clarification: bundles preserve the MAIN shoe target; their cart need
// only clear cost/floor. Held, final and recommendations preserve cart target.
it("non-bundles clear cart target and bundles preserve the main shoe target", () => {
  fc.assert(fc.property(cases, (input) => {
    const result = buildMenu({ ...input, offer: 0 });
    if (result.decision !== "menu") return;
    const u = urgency(input.product.stockedAt, now), target = targetOf([input.product], u, input.floorPct);
    const held = ask(input.product.list, target, u, input.round);
    const next = ask(input.product.list, target, u, Math.min(4, input.round + 1) as 1 | 2 | 3 | 4);
    for (const option of result.options) {
      const audited = result.audit[option.id]!;
      if (option.kind !== "bundle") expect(option.total).toBeGreaterThanOrEqual(toShopper(audited.target));
      else {
        const addon = input.catalog.find((p) => p.variantId === option.items[1]!.variantId)!;
        const part = (addon.list + addon.cost!) / 2;
        const shoe = next + part - addon.cost! >= held ? next : held;
        expect(shoe).toBeGreaterThanOrEqual(target);
        expect(option.total).toBeGreaterThanOrEqual(toShopper(audited.floor));
        expect(option.total).toBeGreaterThan(audited.cost);
      }
    }
  }), replay);
});

it("drops every cart whose policy floor exceeds its list", () => {
  fc.assert(fc.property(cases, (input) => {
    const result = buildMenu(input);
    if (result.decision === "accept") expect(floorOf([input.product], input.floorPct)).toBeLessThanOrEqual(input.product.list);
    if (result.decision === "menu") for (const option of result.options) {
      const cart = option.items.map((i) => input.catalog.find((p) => p.variantId === i.variantId)!);
      expect(floorOf(cart, input.floorPct)).toBeLessThanOrEqual(cart.reduce((sum, p) => sum + p.list, 0));
    }
  }), replay);
});
