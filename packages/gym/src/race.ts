import type { GymResult, GymShopper } from "@bazaar/contracts";

export type RaceDot = {
  id: number;
  persona: GymShopper["persona"];
  /** Where the dot waits: what this shopper would pay. */
  willingness: number;
  state: "deciding" | "bought" | "walked" | "owner";
  /** What happened, for colour: `saved` bought the item below list; `missed` walked although they would have paid the floor. */
  kind: "deciding" | "list" | "saved" | "bundle" | "walked" | "missed" | "owner";
  /** The engine's agreed total. Only buyers have one. */
  price?: number;
  /** Price stack the dot rests in, and its seat within that stack. */
  bucket?: number;
  seat?: number;
};

export type Race = { round: number; rounds: number; typicalAsk: number; customersSaved: number; dots: RaceDot[] };

const BUCKET_CENTS = 500;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
}

/**
 * The price race at the end of `round` (0 = nobody has answered yet). Pure: every
 * position comes from the Gym run, so the picture can never disagree with the figures.
 * Each shopper is quoted their own ask, so the line is the round's typical (median) ask.
 */
export function raceLayout(result: GymResult, list: number, round: number): Race {
  const rounds = Math.max(1, ...result.shoppers.map((shopper) => shopper.rounds.length));
  const upTo = Math.min(Math.max(0, Math.floor(round)), rounds);
  const seats = new Map<number, number>();
  const dots = result.shoppers.map((shopper): RaceDot => {
    const base = { id: shopper.id, persona: shopper.persona, willingness: shopper.willingness };
    if (shopper.rounds.length > upTo) return { ...base, state: "deciding", kind: "deciding" };
    if (shopper.outcome === "would_ask_owner") return { ...base, state: "owner", kind: "owner" };
    if (shopper.outcome !== "bought" || shopper.agreed === undefined) return { ...base, state: "walked", kind: shopper.missed ? "missed" : "walked" };
    const bucket = Math.round(shopper.agreed / BUCKET_CENTS) * BUCKET_CENTS;
    const seat = seats.get(bucket) ?? 0;
    seats.set(bucket, seat + 1);
    const kind = shopper.trade === "bundle" ? "bundle" : shopper.agreed < list ? "saved" : "list";
    return { ...base, state: "bought", kind, price: shopper.agreed, bucket, seat };
  });
  const asks = result.shoppers.flatMap((shopper) => shopper.rounds[Math.max(0, upTo - 1)]?.ask ?? []);
  return { round: upTo, rounds, typicalAsk: upTo === 0 ? list : median(asks), customersSaved: dots.filter((dot) => dot.kind === "saved").length, dots };
}
