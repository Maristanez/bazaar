// The Gym (SPEC §9). Pure, like the engine it runs — the same code serves the server and the browser.
export const PACKAGE = "@bazaar/gym";
export { PERSONAS } from "./personas.ts";
export type { Persona, SimulatedPersona } from "./personas.ts";
export { countLowballs, runLiveGym } from "./live.ts";
export type { LiveGymInput, LiveGymResult } from "./live.ts";
export { raceLayout } from "./race.ts";
export type { Race, RaceDot } from "./race.ts";
