import { expect, it } from "vitest";
import fc from "fast-check";
import { ask, floorOf, targetOf, urgency } from "./formulas";
import { toShopper } from "./money";
import type { Item } from "./types";
import { costOf } from "./index";

const now = new Date("2026-09-19T12:00:00.000Z");
const trailRunner2: Item = {
  variantId: "tr2-10",
  productId: "tr2",
  title: "Trail Runner 2",
  size: "10",
  productType: "Trail shoes",
  list: 14900,
  cost: 7800,
  stockedAt: "2026-06-17T12:00:00.000Z",
  inStock: true,
  isAddOn: false,
};

// SPEC — do not edit
it("reproduces the Trail Runner 2 and Trail Runner 3 worked example", () => {
  const tr2Urgency = urgency(trailRunner2.stockedAt, now);
  const tr2Target = targetOf([trailRunner2], tr2Urgency, 25);
  expect(floorOf([trailRunner2], 25)).toBe(9750);
  expect(tr2Urgency).toBeCloseTo(0.5667, 4);
  expect(tr2Target).toBe(11982);
  expect(ask(14900, tr2Target, tr2Urgency, 1)).toBe(14900);
  expect(ask(14900, tr2Target, tr2Urgency, 4)).toBe(tr2Target);
  expect(([1, 2, 3, 4] as const).map((round) =>
    toShopper(ask(14900, tr2Target, tr2Urgency, round)),
  )).toEqual([14900, 13500, 12700, 12000]);

  const trailRunner3: Item = {
    ...trailRunner2,
    variantId: "tr3-10",
    productId: "tr3",
    title: "Trail Runner 3",
    list: 16900,
    cost: 9500,
    stockedAt: "2026-09-07T12:00:00.000Z",
  };
  const tr3Urgency = urgency(trailRunner3.stockedAt, now);
  const tr3Target = targetOf([trailRunner3], tr3Urgency, 25);
  expect(tr3Urgency).toBe(0);
  expect(tr3Target).toBe(trailRunner3.list);
  expect(([1, 2, 3, 4] as const).map((round) =>
    toShopper(ask(16900, tr3Target, tr3Urgency, round)),
  )).toEqual([16900, 16900, 16900, 16900]);
});

it("holds price at list when stock age is missing", () => {
  const unknownAge = { ...trailRunner2, stockedAt: null };
  expect(urgency(unknownAge.stockedAt, now)).toBe(0);
  expect(targetOf([unknownAge], urgency(unknownAge.stockedAt, now), 25)).toBe(14900);
});

it("exposes cart cost and refuses to price a cart with any missing cost", () => {
  const socks: Item = { ...trailRunner2, variantId: "socks", list: 1800, cost: 600, isAddOn: true };
  expect(costOf([trailRunner2, socks])).toBe(8400);
  const unpricedSocks = { ...socks, cost: null };
  expect(costOf([trailRunner2, unpricedSocks])).toBeNull();
  expect(costOf([unpricedSocks, trailRunner2])).toBeNull();
  expect(floorOf([trailRunner2, socks], 25)).toBe(10500);
  expect(() => floorOf([trailRunner2, unpricedSocks], 25)).toThrow("missing cost");
  expect(() => targetOf([trailRunner2, unpricedSocks], 0, 25)).toThrow("missing cost");
});

it("prices a bundle with its main product's urgency regardless of add-on age", () => {
  const socks: Item = {
    ...trailRunner2, variantId: "socks", list: 1800, cost: 600, isAddOn: true,
    stockedAt: "2025-01-01T00:00:00.000Z",
  };
  expect(targetOf([trailRunner2, socks], 0, 25)).toBe(16700);
  expect(targetOf([trailRunner2, socks], 0.5, 25)).toBe(13600);
  expect(targetOf([trailRunner2, socks], 1, 25)).toBe(10500);
  expect(targetOf([socks, trailRunner2], 0.5, 25)).toBe(13600);
});

it("clamps urgency at 60 and 120 days and handles dates in the future", () => {
  expect(urgency("2026-09-20T12:00:00.000Z", now)).toBe(0);
  expect(urgency("2026-07-21T12:00:00.000Z", now)).toBe(0);
  expect(urgency("2026-06-21T12:00:00.000Z", now)).toBe(0.5);
  expect(urgency("2026-05-22T12:00:00.000Z", now)).toBe(1);
  expect(urgency("2025-01-01T00:00:00.000Z", now)).toBe(1);
});

it("keeps rounded asks above cost, floor and target across valid pricing inputs", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 100000 }),
    fc.integer({ min: 1, max: 100 }),
    fc.integer({ min: 0, max: 100000 }),
    fc.integer({ min: 0, max: 120 }),
    (cost, floorPct, headroom, ageDays) => {
      const item = { ...trailRunner2, cost };
      const floor = floorOf([item], floorPct);
      item.list = floor + headroom;
      const mainUrgency = urgency(new Date(now.getTime() - ageDays * 86400000).toISOString(), now);
      const target = targetOf([item], mainUrgency, floorPct);
      const asks = ([1, 2, 3, 4] as const).map((round) => ask(item.list, target, mainUrgency, round));
      const shown = asks.map(toShopper);
      expect(asks[0]).toBe(item.list);
      expect(asks[3]).toBe(target);
      for (const [index, total] of shown.entries()) {
        expect(Number.isInteger(total / 100)).toBe(true);
        expect(total).toBeGreaterThan(cost);
        expect(total).toBeGreaterThanOrEqual(floor);
        expect(total).toBeGreaterThanOrEqual(target);
        expect(total).toBeGreaterThanOrEqual(asks[index]!);
        if (index > 0) expect(total).toBeLessThanOrEqual(shown[index - 1]!);
      }
    },
  ), { numRuns: 1000, seed: 42 });
});
