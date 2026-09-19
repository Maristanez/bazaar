import type { GymResult } from "@bazaar/contracts";

export type DotPosition = {
  id: number;
  x: number;
  y: number;
  /** Animation position. A yellow settled dot still represents a pending owner decision, not a purchase. */
  state: "haggling" | "settled" | "walked";
  color: "persona" | "yellow";
};

function binIndex(price: number, firstBin: number, binWidth: number, count: number): number {
  return Math.min(count - 1, Math.max(0, Math.floor((price - firstBin) / binWidth)));
}

function askAt(result: GymResult, roundIndex: number): number {
  for (let index = roundIndex; index >= 0; index -= 1) {
    const ask = result.shoppers.find((shopper) => shopper.rounds[index] !== undefined)?.rounds[index]?.ask;
    if (ask !== undefined) return ask;
  }
  return 0;
}

/** Stable final histogram plus a separate pile for shoppers who did not close. */
export function settle(result: GymResult, binWidth: number): DotPosition[] {
  if (binWidth <= 0) throw new Error("binWidth must be positive");
  const firstBin = result.bins[0];
  if (firstBin === undefined) return [];
  const stacks = result.bins.map(() => 0);
  const yellowStacks = result.bins.map(() => 0);
  let walked = 0;

  return result.shoppers.map((shopper) => {
    if (shopper.outcome === "bought") {
      const bin = binIndex(shopper.agreed!, firstBin, binWidth, result.bins.length);
      const y = stacks[bin]!;
      stacks[bin]! += 1;
      return { id: shopper.id, x: firstBin + bin * binWidth, y, state: "settled", color: "persona" };
    }
    if (shopper.outcome === "would_ask_owner") {
      const bin = binIndex(shopper.rounds.at(-1)!.offer, firstBin, binWidth, result.bins.length);
      const y = result.counts[bin]! + yellowStacks[bin]!;
      yellowStacks[bin]! += 1;
      return { id: shopper.id, x: firstBin + bin * binWidth, y, state: "settled", color: "yellow" };
    }
    const dot = {
      id: shopper.id,
      x: firstBin - binWidth,
      y: walked,
      state: "walked" as const,
      color: "persona" as const,
    };
    walked += 1;
    return dot;
  });
}

/** One deterministic animation frame from opening offers (t=0) to the settled histogram (t=1). */
export function frame(result: GymResult, binWidth: number, t: number): { dots: DotPosition[]; askLine: number; round: 1 | 2 | 3 | 4 } {
  const clamped = Math.min(1, Math.max(0, t));
  if (clamped === 1) {
    return { dots: settle(result, binWidth), askLine: askAt(result, 3), round: 4 };
  }

  const phase = clamped * 3;
  const roundIndex = Math.floor(phase);
  const progress = phase - roundIndex;
  const round = (roundIndex + 1) as 1 | 2 | 3 | 4;
  const finished = new Map(settle(result, binWidth).map((dot) => [dot.id, dot]));
  const dots = result.shoppers.map((shopper): DotPosition => {
    const lastIndex = shopper.rounds.length - 1;
    if (lastIndex < roundIndex) return finished.get(shopper.id)!;
    const current = shopper.rounds[Math.min(roundIndex, lastIndex)]!;
    const next = shopper.rounds[Math.min(roundIndex + 1, lastIndex)]!;
    return {
      id: shopper.id,
      x: current.offer + (next.offer - current.offer) * progress,
      y: 0,
      state: "haggling",
      color: "persona",
    };
  });
  const currentAsk = askAt(result, roundIndex);
  const nextAsk = askAt(result, roundIndex + 1) || currentAsk;
  return { dots, askLine: currentAsk + (nextAsk - currentAsk) * progress, round };
}
