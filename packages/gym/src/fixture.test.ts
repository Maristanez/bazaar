import { describe, expect, it } from "vitest";
import type { GymResult } from "@bazaar/contracts";
import { seed42 } from "../fixtures/index";
import { gymResultProblems } from "./invariants";

// SPEC §6 worked example, as literals — never recomputed here the way a generator would.
const TR2 = { cost: 7800, floor: 9750 };
const ASKS = [14900, 13500, 12700, 12000];

// The Console UI is built against this file and B11 later regenerates it from a real run.
// Everything below must hold for both, or the UI notices the swap.
describe("seed42 fixture", () => {
  it("breaks no invariant of a real GymResult", () => {
    expect(gymResultProblems(seed42, TR2)).toEqual([]);
  });

  it("is the run the spec describes: seed 42, 300 shoppers, floor 25%, $5 bins from cost to list", () => {
    expect(seed42).toMatchObject({ seed: 42, n: 300, floorPct: 25 });
    expect(seed42.bins).toHaveLength(15);
    expect(seed42.bins.at(0)).toBe(7800);
    expect(seed42.bins.at(-1)).toBe(14800);
  });

  it("splits the personas 30 / 35 / 15 / 10 / 10", () => {
    const count = (p: string) => seed42.shoppers.filter((s) => s.persona === p).length;
    expect(["bargain", "budgeted", "impatient", "loyal", "lowballer"].map(count)).toEqual([90, 105, 45, 30, 30]);
  });

  it("asks every shopper 149 → 135 → 127 → 120", () => {
    for (const s of seed42.shoppers) expect(s.rounds.map((r) => r.ask)).toEqual(ASKS.slice(0, s.rounds.length));
  });

  it("can render every UI state: each outcome, each trade, a missed deal, a would-ask-owner", () => {
    const seen = new Set(seed42.shoppers.flatMap((s) => [s.outcome, s.trade, s.missed ? "missed" : undefined]));
    for (const state of ["bought", "walked", "would_ask_owner", "accepted", "held", "bundle", "final", "missed"])
      expect(seen).toContain(state);
  });
});

// The checker is only worth reusing in B11 if it actually bites.
describe("gymResultProblems", () => {
  const corrupt = (edit: (r: GymResult) => void) => {
    const copy: GymResult = JSON.parse(JSON.stringify(seed42)); // structuredClone is outside the pure lib
    edit(copy);
    return gymResultProblems(copy, TR2);
  };
  const firstBought = (r: GymResult) => r.shoppers.find((s) => s.trade === "held")!;

  it.each<[string, (r: GymResult) => void]>([
    ["a headline count that disagrees with the shoppers", (r) => { r.bought += 1; }],
    ["an average that disagrees with the shoppers", (r) => { r.avgAgreed += 100; }],
    ["a histogram that disagrees with the shoppers", (r) => { r.counts[0]! += 1; r.counts[14]! -= 1; }],
    ["a deal at cost", (r) => { firstBought(r).agreed = 7800; }],
    ["a shopper who paid more than they were willing to", (r) => { firstBought(r).willingness = 9000; }],
    ["a walked shopper with an agreed price", (r) => { r.shoppers.find((s) => s.outcome === "walked")!.agreed = 12000; }],
    ["an ask that goes back up", (r) => { r.shoppers.find((s) => s.rounds.length > 1)!.rounds[1]!.ask = 15000; }],
    ["an unknown persona", (r) => { (r.shoppers[0] as { persona: string }).persona = "whale"; }],
    ["a duplicate id", (r) => { r.shoppers[1]!.id = r.shoppers[0]!.id; }],
    ["a missed deal below the floor", (r) => { Object.assign(r.shoppers.find((s) => s.missed)!, { willingness: 9000 }); }],
  ])("reports %s", (_, edit) => {
    expect(corrupt(edit)).not.toEqual([]);
  });
});
