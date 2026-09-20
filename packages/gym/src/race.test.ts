import { describe, expect, it } from "vitest";
import { runLiveGym } from "./live";
import { raceLayout } from "./race";
import type { NegotiationItem } from "@bazaar/engine";

const main: NegotiationItem = { variantId: "v", productId: "p", title: "Trail Runner", productType: "shoes", list: 14900, cost: 7800, stockedAt: "2026-06-17", inStock: true, isAddOn: false };
const addOn: NegotiationItem = { variantId: "a", productId: "a", title: "Trail Gaiters", productType: "accessories", list: 3900, cost: 1700, stockedAt: "2026-05-01", inStock: true, isAddOn: true };
const result = runLiveGym({ main, catalog: [main, addOn], floorPct: 25, askOwner: true, seed: 42, n: 300, now: new Date("2026-09-19T12:00:00Z") });
const byId = new Map(result.shoppers.map((shopper) => [shopper.id, shopper]));

describe("price race", () => {
  it("rests every buyer at the price the engine agreed, and leaves everyone else without one", () => {
    const race = raceLayout(result, main.list, 4);

    expect(race.dots).toHaveLength(300);
    for (const dot of race.dots) {
      const shopper = byId.get(dot.id)!;
      expect(dot.willingness).toBe(shopper.willingness);
      if (shopper.outcome === "bought") expect(dot).toMatchObject({ state: "bought", price: shopper.agreed });
      else {
        expect(dot.state).toBe(shopper.outcome === "would_ask_owner" ? "owner" : "walked");
        expect(dot.price).toBeUndefined();
      }
    }
  });

  it("starts with everyone still deciding", () => {
    const race = raceLayout(result, main.list, 0);
    expect(race.dots.every((dot) => dot.state === "deciding" && dot.price === undefined)).toBe(true);
    expect(race.customersSaved).toBe(0);
  });

  it("resolves a shopper in the round their negotiation ended, not before", () => {
    const race = raceLayout(result, main.list, 1);
    for (const dot of race.dots) expect(dot.state === "deciding").toBe(byId.get(dot.id)!.rounds.length > 1);
  });

  it("counts a customer saved only when they bought the item for less than list", () => {
    const race = raceLayout(result, main.list, 4);
    const saved = race.dots.filter((dot) => dot.kind === "saved");

    expect(saved.length).toBeGreaterThan(0);
    expect(race.customersSaved).toBe(saved.length);
    expect(saved.every((dot) => dot.price! < main.list && byId.get(dot.id)!.trade !== "bundle")).toBe(true);
    expect(race.dots.filter((dot) => dot.kind === "bundle").every((dot) => byId.get(dot.id)!.trade === "bundle")).toBe(true);
  });

  it("gives every resting dot its own seat in its price stack", () => {
    const race = raceLayout(result, main.list, 4);
    const seats = race.dots.filter((dot) => dot.state === "bought").map((dot) => `${dot.bucket}:${dot.seat}`);
    expect(new Set(seats).size).toBe(seats.length);
  });

  it("reports the typical ask of the round from the engine's own asks", () => {
    const asks = result.shoppers.filter((shopper) => shopper.rounds.length >= 2).map((shopper) => shopper.rounds[1]!.ask);
    const race = raceLayout(result, main.list, 2);
    expect(race.typicalAsk).toBeGreaterThanOrEqual(Math.min(...asks));
    expect(race.typicalAsk).toBeLessThanOrEqual(Math.max(...asks));
    expect(asks).toContain(race.typicalAsk);
  });
});
