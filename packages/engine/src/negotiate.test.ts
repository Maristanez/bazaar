import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { analyzeBuyerReason, applyNegotiationContext, auditOffer, leadWithStatedReason, ownerApprovalTotal, priceOffer, type BuyerReason } from "./negotiate.ts";

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

describe("owner discount cap", () => {
  const strong = { score: 4, label: "market comparison", labels: ["market comparison"], hasBulkIntent: true, hasAddOnIntent: false, hasMarketComparison: true, isReadyToBuy: true };

  it("never prices below the capped share of list, however strong the reason", () => {
    // 5% off $149 is $141.55, which a shopper sees as $142.
    const offer = priceOffer(shoe, 9000, 4, { items: [shoe] }, strong, 1, { floorPct: 25, now, discountCapPct: 5 });
    expect(offer.total).toBe(14200);
  });

  it("a zero cap holds list price", () => {
    const offer = priceOffer(shoe, 9000, 4, { items: [shoe] }, strong, 1, { floorPct: 25, now, discountCapPct: 0 });
    expect(offer.total).toBe(14900);
  });

  it("defaults to the 22% cap", () => {
    const fresh = { ...shoe, stockedAt: null }; // no urgency, so the cap is what binds: 22% off $149 is $116.22 → $117
    const withDefault = priceOffer(fresh, 9000, 4, { items: [fresh] }, strong, 1, { floorPct: 25, now });
    const loose = priceOffer(fresh, 9000, 4, { items: [fresh] }, strong, 1, { floorPct: 25, now, discountCapPct: 40 });
    expect(withDefault).toEqual(priceOffer(fresh, 9000, 4, { items: [fresh] }, strong, 1, { floorPct: 25, now, discountCapPct: 22 }));
    expect(withDefault.total).toBeGreaterThanOrEqual(11700);
    expect(loose.total).toBeLessThanOrEqual(withDefault.total);
  });

  it("a generous cap still cannot reach below the floor", () => {
    const thin = { ...shoe, cost: 13000 }; // floor at 5% is $136.50; 40% off list would be $89.40
    const offer = priceOffer(thin, 9000, 4, { items: [thin] }, strong, 1, { floorPct: 5, now, discountCapPct: 40 });
    expect(offer.total).toBeGreaterThanOrEqual(13650);
  });

  it("every single-item price is at least max(floor, capped list)", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1000, max: 50000 }), fc.integer({ min: 1, max: 99 }), fc.integer({ min: 0, max: 60 }), fc.integer({ min: 0, max: 40 }),
      fc.integer({ min: 1, max: 4 }), fc.integer({ min: 0, max: 4 }), fc.integer({ min: 100, max: 60000 }), fc.boolean(), fc.boolean(), fc.integer({ min: 0, max: 400 }),
      (list, costShare, floorPct, cap, round, score, offered, bulk, ready, ageDays) => {
        const cost = Math.floor(list * costShare / 100);
        const item = { ...shoe, list, cost, stockedAt: new Date(now.getTime() - ageDays * 86400000).toISOString() };
        const reason = { ...strong, score, hasBulkIntent: bulk, isReadyToBuy: ready };
        const offer = priceOffer(item, offered, round, { items: [item] }, reason, 1, { floorPct, now, discountCapPct: cap });
        if (offer.kind === "closed") return;
        const floor = Math.max(cost + 1, Math.ceil(cost * (1 + floorPct / 100)));
        expect(offer.total).toBeGreaterThanOrEqual(Math.max(floor, Math.ceil(list * (1 - cap / 100))));
      }));
  });
});

describe("owner-set max rounds", () => {
  const strong = { score: 4, label: "market comparison", labels: ["market comparison"], hasBulkIntent: true, hasAddOnIntent: false, hasMarketComparison: true, isReadyToBuy: true };
  const price = (round: number, maxRounds: number | undefined, reason: BuyerReason = strong) => priceOffer(shoe, 9000, round, { items: [shoe] }, reason, 1, { floorPct: 25, now, maxRounds });

  it("the last of two rounds reaches the price the fourth of four reaches today", () => {
    expect(price(4, undefined).total).toBe(12900);
    expect(price(2, 2).total).toBe(12900);
    expect(price(2, 2).badges).toContain("final offer");
  });

  it("the last of six rounds reaches the same price, and the middle rounds sit above it", () => {
    expect(price(6, 6).total).toBe(12900);
    expect(price(3, 6).total).toBeGreaterThan(12900);
    expect(price(3, 6).total).toBeLessThan(14900);
    expect(price(4, 6).badges).not.toContain("final offer");
  });

  it("a shopper with no reason still gets the small final-round move when there are only two rounds", () => {
    expect(price(4, undefined, emptyReasonForTest()).total).toBe(14800);
    expect(price(2, 2, emptyReasonForTest()).total).toBe(14800);
    expect(price(1, 2, emptyReasonForTest()).total).toBe(14900);
  });

  it("four rounds is the default", () => {
    for (const round of [1, 2, 3, 4]) expect(price(round, 4)).toEqual(price(round, undefined));
  });

  it("prices never step up as the rounds go on", () => {
    for (const maxRounds of [2, 3, 5, 6]) {
      const totals = Array.from({ length: maxRounds }, (_, index) => price(index + 1, maxRounds).total);
      expect(totals).toEqual(totals.slice().sort((a, b) => b - a));
    }
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

describe("ownerApprovalTotal", () => {
  const audit = { cost: 9500, floor: 11875 };
  it("is the shopper's offer in whole dollars when it sits above cost, under the floor and under the final price", () => {
    expect(ownerApprovalTotal(10050, audit, 14000)).toBe(10100);
  });
  it("is null at or below cost, at or above the floor, and at or above the final price", () => {
    expect(ownerApprovalTotal(9500, audit, 14000)).toBeNull();
    expect(ownerApprovalTotal(11875, audit, 14000)).toBeNull();
    expect(ownerApprovalTotal(11000, audit, 11000)).toBeNull();
  });
  it("never asks the owner to approve a total at or below cost", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 100_000 }), fc.integer({ min: 0, max: 50_000 }), (offered, cost) => {
      const total = ownerApprovalTotal(offered, { cost, floor: cost * 2 + 1 }, 1_000_000);
      if (total !== null) expect(total).toBeGreaterThan(cost);
    }), { numRuns: 500 });
  });
});

describe("what the shopper reads", () => {
  const ENGINE_WORDS = /reason:|intent|counter|bundle value|use case|comparison\)|\(/i;
  const said = (message: string, round = 2) => priceOffer(shoe, 11000, round, mirror, analyzeBuyerReason(message), 1, { floorPct: 25, now });

  it("names the shopper's reason in the shopper's words, never the engine's", () => {
    expect(said("I'm a student on a tight budget").badges).toContain("for a tight budget");
    for (const message of ["I'm a student on a tight budget", "I'm buying two pairs", "adding socks", "I saw the same shoe elsewhere", "I have a race in three weeks", "I'm ready to buy today", "I'm a returning customer", "no reason at all"]) {
      for (const round of [1, 2, 4]) {
        const offer = said(message, round);
        for (const badge of offer.badges) expect(badge).not.toMatch(ENGINE_WORDS);
        expect(offer.line).not.toMatch(ENGINE_WORDS);
      }
    }
  });

  it("leads with the reason given in this message, while the price still weighs everything said so far", () => {
    const soFar = analyzeBuyerReason("Could you do $120? I'm buying socks too. How about $110? I'm a student on a tight budget.");
    expect(soFar.label).toBe("quantity intent");
    const thisTurn = leadWithStatedReason(soFar, "How about $110? I'm a student on a tight budget.");
    expect(thisTurn.label).toBe("budget");
    expect({ ...thisTurn, label: soFar.label }).toEqual(soFar);
    expect(priceOffer(shoe, 11000, 2, mirror, thisTurn, 1, { floorPct: 25, now }).total).toBe(priceOffer(shoe, 11000, 2, mirror, soFar, 1, { floorPct: 25, now }).total);
    expect(leadWithStatedReason(soFar, "$100 and that's it").label).toBe("quantity intent");
  });
});

describe("buyer quantity intent", () => {
  it("does not treat a product number or one pair as bulk", () => {
    expect(analyzeBuyerReason("Could you take 20% off one Trail Runner 2, size 10?").hasBulkIntent).toBe(false);
    expect(analyzeBuyerReason("Could you do $120 for one pair of Trail Runner 2?").hasBulkIntent).toBe(false);
  });

  it("recognizes explicit multiple pairs and real bundles as bulk", () => {
    expect(analyzeBuyerReason("Could you do $220 for two pairs of Trail Runner 2?").hasBulkIntent).toBe(true);
    expect(analyzeBuyerReason("Throw in the socks and gaiters for the full kit.").hasBulkIntent).toBe(true);
  });
});
