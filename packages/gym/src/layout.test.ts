import { expect, it } from "vitest";
import fc from "fast-check";
import { frame, settle } from "./layout";
import { runGym } from "./run";
import { input } from "./test-data";

it("the last animation frame is exactly the static one-dot-per-shopper layout", () => {
  const result = runGym(input);
  const settled = settle(result, 500);
  expect(frame(result, 500, 1).dots).toEqual(settled);
  expect(new Set(settled.map((dot) => dot.id)).size).toBe(result.n);
  expect(settled).toHaveLength(result.n);
  expect(settled.filter((dot) => dot.state === "walked").every((dot) => dot.x < result.bins[0]!)).toBe(true);
});

it("keeps the round-four ask line when the last shopper settled early", () => {
  const result = runGym(input);
  const early = result.shoppers.find((shopper) => shopper.rounds.length === 1)!;
  const reordered = { ...result, shoppers: [...result.shoppers.filter((shopper) => shopper !== early), early] };
  expect(frame(reordered, 500, 1).askLine).toBe(12000);
});

it("settles would-ask-owner shoppers as yellow dots in the thin-margin bins", () => {
  const result = runGym(input);
  const positions = new Map(settle(result, 500).map((dot) => [dot.id, dot]));
  for (const shopper of result.shoppers.filter((candidate) => candidate.outcome === "would_ask_owner")) {
    expect(positions.get(shopper.id)).toMatchObject({ state: "settled", color: "yellow" });
    expect(positions.get(shopper.id)!.x).toBeGreaterThanOrEqual(result.bins[0]!);
  }
});

it("preserves final-layout invariants across seeds, populations, and floors", () => {
  fc.assert(fc.property(
    fc.integer(),
    fc.integer({ min: 1, max: 60 }),
    fc.integer({ min: 0, max: 60 }),
    (seed, n, floorPct) => {
      const result = runGym({ ...input, seed, n, floorPct });
      const final = frame(result, 500, 1).dots;
      expect(final).toEqual(settle(result, 500));
      expect(final).toHaveLength(n);
      expect(new Set(final.map((dot) => dot.id)).size).toBe(n);
      expect(final.filter((dot) => dot.state === "walked").every((dot) => dot.x < result.bins[0]!)).toBe(true);
    },
  ), { numRuns: 100, seed: 42 });
});
