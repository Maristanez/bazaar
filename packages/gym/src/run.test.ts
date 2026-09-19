import { expect, it } from "vitest";
import { floorOf } from "@bazaar/engine";
import { gymResultProblems } from "./invariants";
import { compare, runGym } from "./run";
import { input, main } from "./test-data";

declare const performance: { now(): number };
const crossoverFloor = Array.from({ length: 61 }, (_, floorPct) => floorPct)
  .find((floorPct) => runGym({ ...input, floorPct }).profitVsBanner < 0);
runGym(input);
const startedAt = performance.now();
runGym(input);
const runMs = performance.now() - startedAt;

it("produces a sound GymResult from the real seed-42 run", () => {
  const result = runGym(input);
  expect(gymResultProblems(result, { cost: main.cost!, floor: floorOf([main], input.floorPct) })).toEqual([]);
});

it("replays the same exact persona population for the same seed", () => {
  const first = runGym(input);
  expect(runGym(input)).toEqual(first);
  const count = (persona: string) => first.shoppers.filter((shopper) => shopper.persona === persona).length;
  expect(["bargain", "budgeted", "impatient", "loyal", "lowballer"].map(count)).toEqual([90, 105, 45, 30, 30]);
});

it(`finds the seed-42 banner crossover at floor ${crossoverFloor}`, () => {
  expect(crossoverFloor).toBeGreaterThan(0);
  expect(runGym(input).profitVsBanner).toBeGreaterThan(0);
  expect(runGym({ ...input, floorPct: 42 }).profitVsBanner).toBeLessThan(0);
});

it(`runs 300 shoppers in ${runMs.toFixed(2)} ms, below the 50 ms budget`, () => {
  expect(runMs).toBeLessThan(50);
});

it("compares policy B against policy A in the six owner-facing metrics", () => {
  const a = runGym(input);
  const b = { ...a, bought: a.bought + 3, avgAgreed: a.avgAgreed + 100, profitVsBanner: a.profitVsBanner - 500,
    aovUplift: a.aovUplift + 25, dealsMissed: a.dealsMissed - 2, wouldAskOwner: a.wouldAskOwner + 1 };
  expect(compare(a, b)).toEqual({
    boughtPct: 1,
    avgAgreed: 100,
    profitVsBanner: -500,
    aovUplift: 25,
    dealsMissed: -2,
    wouldAskOwner: 1,
  });
});

it("applies the pinned bundle rule without changing the known lowballer result", () => {
  const result = runGym(input);
  // The engine ranks the $152 flask bundle first, but it misses this shopper's threshold;
  // the later $150 gaiters bundle qualifies and must still be considered.
  expect(result.shoppers.some((shopper) => shopper.trade === "bundle" && shopper.agreed === 15000)).toBe(true);
  expect(result.shoppers.filter((shopper) => shopper.persona === "lowballer" && shopper.outcome === "bought")).toHaveLength(0);
});
