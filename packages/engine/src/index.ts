// The deal engine (SPEC §6). Pure: time, seed and data arrive as arguments — no I/O, no clock, no randomness.
export const PACKAGE = "@bazaar/engine";
export { ask, costOf, floorOf, targetOf, urgency } from "./formulas";
export { toShopper } from "./money";
export type { Item } from "./types";
