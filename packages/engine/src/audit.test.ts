import { expect, it } from "vitest";
import { addOnPart, auditAccepted } from "./audit";
import type { Item } from "./types";

const main: Item = { variantId: "tr2-10", productId: "tr2", title: "Trail Runner 2", size: "10", productType: "shoe", list: 14900, cost: 7800, stockedAt: "2026-06-17T12:00:00Z", inStock: true, isAddOn: false };
const now = new Date("2026-09-19T12:00:00Z");

it("audits an accepted offer in the engine so consumers never reconstruct its economics", () => {
  expect(auditAccepted({ main, total: 15000, floorPct: 25, now })).toEqual({ cost: 7800, floor: 9750, target: 11982, profit: 7200 });
  expect(auditAccepted({ main: { ...main, cost: null }, total: 15000, floorPct: 25, now })).toBeNull();
});

it("exposes the exact unrounded add-on part used by menu and Gym", () => {
  expect(addOnPart({ ...main, cost: 600, list: 1800 })).toBe(1200);
  expect(addOnPart({ ...main, cost: 1200, list: 3500 })).toBe(2350);
  expect(addOnPart({ ...main, cost: 600, list: 1801 })).toBe(1200.5);
  expect(addOnPart({ ...main, cost: null })).toBeNull();
});
