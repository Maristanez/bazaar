import { describe, expect, it } from "vitest";
import { countLowballs, runLiveGym } from "./live.ts";
import type { NegotiationItem } from "@bazaar/engine";

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

  describe("owner settings", () => {
    const base = { main, catalog: [main], floorPct: 25, askOwner: true, seed: 42, n: 300, now };

    it("holds every ask above the owner's discount cap", () => {
      // 2% off $149 is $146.02 → $147.
      const result = runLiveGym({ ...base, settings: { discountCapPct: 2 } });
      expect(result.shoppers.flatMap((shopper) => shopper.rounds).every((round) => round.ask >= 14700)).toBe(true);
      expect(runLiveGym(base).shoppers.flatMap((shopper) => shopper.rounds).some((round) => round.ask < 14700)).toBe(true);
    });

    it("ends every shopper by the owner's last round and escalates after it, not after round four", () => {
      const result = runLiveGym({ ...base, settings: { maxRounds: 2 } });
      const asking = result.shoppers.filter((shopper) => shopper.outcome === "would_ask_owner");
      expect(result.shoppers.every((shopper) => shopper.rounds.length <= 2)).toBe(true);
      expect(asking.length).toBeGreaterThan(0);
      expect(asking.every((shopper) => shopper.rounds.length === 2)).toBe(true);
      expect(result.shoppers.some((shopper) => shopper.trade === "final" && shopper.rounds.length === 2)).toBe(true);
    });

    it("keeps personas at their own patience when the owner allows six rounds", () => {
      const result = runLiveGym({ ...base, settings: { maxRounds: 6 } });
      expect(result.shoppers.every((shopper) => shopper.rounds.length <= 4)).toBe(true);
      expect(result.wouldAskOwner).toBe(0); // nobody lasts to round six
    });

    it("counters a lowball opening with the round-one quote and no round consumed", () => {
      // 40% of $149 is $59.60.
      const result = runLiveGym({ ...base, settings: { lowballCutoffPct: 40 } });
      const off = runLiveGym({ ...base, settings: { lowballCutoffPct: 0 } });
      const lowballers = result.shoppers.filter((shopper) => shopper.rounds[0]!.offer < 5960);
      expect(lowballers.length).toBeGreaterThan(0);
      for (const shopper of lowballers.filter((candidate) => candidate.rounds.length >= 2)) {
        expect(shopper.rounds[0]!.ask).toBe(14900);
        expect(shopper.rounds[1]!.ask).toBe(14900); // still round one
        expect(off.shoppers[shopper.id - 1]!.rounds[1]!.ask).toBeLessThan(14900); // without the cutoff they had earned round two
      }
      expect(lowballers.every((shopper) => shopper.outcome !== "would_ask_owner")).toBe(true);
      expect(result.lowballs).toBe(lowballers.length);
      expect(countLowballs(result, 14900, 40)).toBe(lowballers.length);
      expect(off.lowballs).toBe(0);
    });

    it("stays deterministic with settings and treats bad settings as the defaults", () => {
      const settings = { discountCapPct: 10, maxRounds: 3, lowballCutoffPct: 50 };
      expect(runLiveGym({ ...base, settings })).toEqual(runLiveGym({ ...base, settings }));
      expect(runLiveGym({ ...base, settings: { maxRounds: 99, discountCapPct: -1 } })).toEqual(runLiveGym(base));
    });
  });
});
