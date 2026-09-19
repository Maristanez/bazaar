export type Random = () => number;

/** Small deterministic PRNG used by every Gym run. */
export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function wholeDollarBetween(random: Random, low: number, high: number): number {
  return Math.round((low + random() * (high - low)) / 100) * 100;
}
