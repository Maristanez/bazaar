// The Gym (SPEC §9). Pure, like the engine it runs — the same code serves the server and the browser.
export const PACKAGE = "@bazaar/gym";
export { compare, runGym } from "./run";
export type { MetricDeltas, RunGymInput } from "./run";
export { frame, settle } from "./layout";
export type { DotPosition } from "./layout";
export { PERSONAS } from "./personas";
export type { Persona, SimulatedPersona } from "./personas";
export { runLiveGym } from "./live";
export type { LiveGymInput } from "./live";
export { gymResultProblems } from "./invariants";
