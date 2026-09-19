import type { Item } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function urgency(stockedAt: string | null, now: Date): number {
  if (stockedAt === null) return 0;
  const ageDays = (now.getTime() - Date.parse(stockedAt)) / DAY_MS;
  return Math.min(1, Math.max(0, (ageDays - 60) / 60));
}

export function costOf(items: readonly Item[]): number | null {
  let total = 0;
  for (const item of items) {
    if (item.cost === null) return null;
    total += item.cost;
  }
  return total;
}

/** The policy percentage is over cost: 25 means cost plus 25%. */
export function floorOf(items: readonly Item[], floorPct: number): number {
  const cost = costOf(items);
  if (cost === null) throw new Error("Cannot price a cart with missing cost");
  return Math.ceil(cost + cost * floorPct / 100);
}

/** Bundles use the supplied main product's urgency, regardless of add-on age. */
export function targetOf(items: readonly Item[], mainUrgency: number, floorPct: number): number {
  const list = items.reduce((total, item) => total + item.list, 0);
  return Math.ceil(list - mainUrgency * (list - floorOf(items, floorPct)));
}

export function ask(list: number, target: number, urgency: number, r: 1 | 2 | 3 | 4): number {
  return Math.ceil(list - ((r - 1) / 3) ** (1 / (1 + urgency)) * (list - target));
}
