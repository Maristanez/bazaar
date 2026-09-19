import { describe, expect, it } from "vitest";
import { runLiveGym } from "./live";
import type { NegotiationItem } from "../../../packages/engine/src/negotiate";

const main: NegotiationItem = { variantId: "v", productId: "p", title: "Trail Runner", productType: "shoes", list: 14900, cost: 7800, stockedAt: "2026-06-17", inStock: true, isAddOn: false };
const addOn: NegotiationItem = { variantId: "a", productId: "a", title: "Trail Gaiters", productType: "accessories", list: 3900, cost: 1700, stockedAt: "2026-05-01", inStock: true, isAddOn: true };
const now = new Date("2026-09-19T12:00:00Z");

describe("live Gym", () => {
  it("is deterministic and uses the live price engine for every ask", () => {
    const input = { main, catalog: [main, addOn], floorPct: 25, askOwner: true, seed: 42, n: 300, now };
    const result = runLiveGym(input);
    expect(result).toEqual(runLiveGym(input));
    expect(result.shoppers).toHaveLength(300);
    expect(result.shoppers.flatMap((shopper) => shopper.rounds).every((round) => round.ask > main.cost!)).toBe(true);
    expect(result.shoppers.filter((shopper) => shopper.outcome === "bought").length + result.shoppers.filter((shopper) => shopper.outcome !== "bought").length).toBe(300);
  });

  it("stops at each persona's patience and escalates only after four refusals", () => {
    const result = runLiveGym({ main, catalog: [main], floorPct: 25, askOwner: true, seed: 42, n: 300, now });
    const patience = { bargain: 4, budgeted: 3, impatient: 2, loyal: 3, lowballer: 4 } as const;

    expect(result.shoppers.every((shopper) => shopper.rounds.length <= patience[shopper.persona])).toBe(true);
    expect(result.shoppers.filter((shopper) => shopper.outcome === "would_ask_owner").every((shopper) => shopper.rounds.length === 4)).toBe(true);
    expect(result.shoppers.some((shopper) => shopper.outcome === "would_ask_owner")).toBe(true);
    expect(result.shoppers.filter((shopper) => shopper.persona === "impatient").every((shopper) => shopper.outcome !== "would_ask_owner")).toBe(true);
  });

  it("counts profit against every item cost when a bundle closes", () => {
    const result = runLiveGym({ main, catalog: [main, addOn], floorPct: 10, askOwner: false, seed: 42, n: 300, now });
    const bundles = result.shoppers.filter((shopper) => shopper.trade === "bundle");

    expect(bundles.length).toBeGreaterThan(0);
    expect(bundles.every((shopper) => shopper.outcome === "bought" && shopper.agreed! > main.cost! + addOn.cost!)).toBe(true);
    expect(result.aovUplift).toBeGreaterThan(0);
  });

  it("changes the candidate policy without mutating the source input", () => {
    const base = { main, catalog: [main], floorPct: 10, askOwner: false, seed: 7, n: 20, now };
    expect(runLiveGym({ ...base, floorPct: 50 }).floorPct).toBe(50);
    expect(base.floorPct).toBe(10);
  });

  it("fails closed for unavailable products and rejects malformed run controls", () => {
    expect(() => runLiveGym({ main: { ...main, cost: null }, catalog: [main], floorPct: 25, askOwner: true, seed: 42, n: 3, now })).toThrow(/cost/);
    expect(() => runLiveGym({ main: { ...main, inStock: false }, catalog: [main], floorPct: 25, askOwner: true, seed: 42, n: 3, now })).toThrow(/in-stock/);
    expect(() => runLiveGym({ main, catalog: [main], floorPct: 61, askOwner: true, seed: 42, n: 3, now })).toThrow(/floor/);
    expect(() => runLiveGym({ main, catalog: [main], floorPct: 25, askOwner: true, seed: 42, n: 0, now })).toThrow(/population/);
    expect(() => runLiveGym({ main, catalog: [main], floorPct: 25, askOwner: true, seed: 42, n: 3, now: new Date("invalid") })).toThrow(/timestamp/);
  });

  it("treats a live-engine closed quote as a walk with no owner request", () => {
    const noHeadroom = { ...main, cost: 14000 };
    const result = runLiveGym({ main: noHeadroom, catalog: [noHeadroom], floorPct: 60, askOwner: true, seed: 42, n: 20, now });
    expect(result.bought).toBe(0);
    expect(result.wouldAskOwner).toBe(0);
    expect(result.shoppers.every((shopper) => shopper.outcome === "walked" && shopper.rounds.length === 1)).toBe(true);
  });
});
