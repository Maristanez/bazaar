import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { analyzeBuyerReason, applyNegotiationContext, auditOffer, priceOffer } from "./negotiate";

const shoe = {
  variantId: "tr2-10", productId: "tr2", title: "Trail Runner 2", size: "10", productType: "shoe",
  list: 14900, cost: 7800, stockedAt: "2026-06-17T00:00:00.000Z", inStock: true, isAddOn: false,
  variantNumericId: "101", productNumericId: "201", handle: "trail-runner-2", image: "", url: "/products/trail-runner-2",
};
const addOn = { ...shoe, variantId: "gaiters", productId: "gaiters", title: "Trail Gaiters", list: 3000, cost: 1200, isAddOn: true };
const now = new Date("2026-09-19T00:00:00.000Z");
const mirror = { items: [shoe, addOn] };

describe("live negotiation pricing", () => {
  it("changes the floor with policy and keeps a convincing second round above it", () => {
    const reason = analyzeBuyerReason("I am buying today for a weekend hike");
    const lowFloor = priceOffer(shoe, 12000, 2, mirror, reason, 1, { floorPct: 25, now });
    const highFloor = priceOffer(shoe, 12000, 2, mirror, reason, 1, { floorPct: 50, now });
    expect(lowFloor.total).toBeGreaterThan(7800);
    expect(highFloor.total).toBeGreaterThanOrEqual(Math.ceil(7800 * 1.5));
    expect(highFloor.total).toBeGreaterThanOrEqual(lowFloor.total);
  });

  it("prices quantity intent against the quantity floor and cart list", () => {
    const reason = applyNegotiationContext(analyzeBuyerReason("Can I get these"), { quantity: 2 });
    const offer = priceOffer(shoe, 20000, 2, mirror, reason, 2, { floorPct: 25, now });
    expect(offer.items[0]?.qty).toBe(2);
    expect(offer.total).toBeGreaterThan(7800 * 2);
    expect(offer.total).toBeGreaterThanOrEqual(Math.ceil(7800 * 2 * 1.25));
    expect(offer.total).toBeLessThanOrEqual(14900 * 2);
  });

  it("keeps a non-whole-dollar Shopify list price exact", () => {
    const item = { ...shoe, list: 9999, cost: 5000, stockedAt: null };
    const offer = priceOffer(item, 9000, 2, { items: [] }, analyzeBuyerReason("I am buying today"), 1, { floorPct: 25, now });
    expect(offer.listTotal).toBe(9999);
    expect(offer.total).toBeLessThanOrEqual(9999);
    expect(auditOffer([item], offer.total, 25, now)).not.toBeNull();
    expect(offer.line).not.toContain("$100");
  });

  it("returns a safe audit for quantity and rejects unsafe totals", () => {
    expect(auditOffer([{ ...shoe, qty: 2 }], 20000, 25, now)).toEqual({ cost: 15600, floor: 19500, target: 23964, profit: 4400 });
    expect(auditOffer([{ ...shoe, qty: 2 }], 15600, 0, now)).toBeNull();
    expect(auditOffer([{ ...shoe }], 8000, 25, now)).toBeNull();
    expect(auditOffer([{ ...shoe }], 8000, 25, now, true)).toMatchObject({ cost: 7800, floor: 9750, profit: 200 });
    expect(auditOffer([{ ...shoe, list: 7000 }], 8000, 25, now, true)).toBeNull();
    expect(auditOffer([{ ...shoe, list: 9000 }], 8000, 25, now, true)).toMatchObject({ cost: 7800, floor: 9750, profit: 200 });
  });

  it("keeps every issued non-closed offer inside integer money and safety bounds", () => {
    fc.assert(fc.property(
      fc.integer({ min: 100, max: 50000 }),
      fc.integer({ min: 100, max: 30000 }),
      fc.integer({ min: 0, max: 60 }),
      fc.integer({ min: 1, max: 4 }),
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 1, max: 100000 }),
      (cost, margin, floorPct, round, quantity, offered) => {
        const list = cost + margin;
        const item = { ...shoe, list, cost, stockedAt: null };
        const result = priceOffer(item, offered, round, { items: [] }, emptyReasonForTest(), quantity, { floorPct, now });
        const totalCost = cost * quantity;
        const listTotal = list * quantity;
        const floor = Math.max(totalCost + 1, Math.ceil(totalCost * (1 + floorPct / 100)));
        if (floor > listTotal) return result.kind === "closed";
        if (result.kind === "closed") return false;
        return Number.isInteger(result.total)
          && result.total > totalCost
          && result.total >= floor
          && result.total <= listTotal;
      },
    ), { numRuns: 250 });
  });

  it("fails closed for malformed money, dates, quantities, and policies", () => {
    const malformedDate = priceOffer({ ...shoe, stockedAt: "not-a-date" }, 12000, 2, mirror, emptyReasonForTest(), 1, { floorPct: 25, now });
    const futureStock = priceOffer({ ...shoe, stockedAt: "2099-01-01" }, 12000, 2, mirror, emptyReasonForTest(), 1, { floorPct: 25, now });
    expect(Number.isFinite(malformedDate.total)).toBe(true);
    expect(malformedDate.total).toBe(futureStock.total);
    expect(priceOffer({ ...shoe, list: Number.NaN }, 12000, 2, mirror, emptyReasonForTest(), 1, { floorPct: 25, now }).kind).toBe("closed");
    expect(priceOffer(shoe, 12000, 2, mirror, emptyReasonForTest(), 11, { floorPct: 25, now }).kind).toBe("closed");
    expect(priceOffer(shoe, 12000, 2, mirror, emptyReasonForTest(), 1, { floorPct: 25, now: new Date("invalid") }).kind).toBe("closed");
    expect(auditOffer([{ ...shoe, qty: 0 }], 12000, 25, now)).toBeNull();
    expect(auditOffer([{ ...shoe, cost: Number.NaN }], 12000, 25, now)).toBeNull();
    expect(auditOffer([shoe], Number.NaN, 25, now)).toBeNull();
    expect(auditOffer([shoe], 12000, 61, now)).toBeNull();
  });
});

function emptyReasonForTest() {
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
