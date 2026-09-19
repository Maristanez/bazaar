import type { ConsoleEvent, ConsoleState, PauseResult, Policy } from "@bazaar/contracts";
export type Connection = "connected" | "reconnecting" | "unauthorized";
export type ConsolePort = {
  load(): Promise<ConsoleState>;
  subscribe(onEvent: (event: ConsoleEvent) => void, onConnection?: (state: Connection) => void): () => void;
  setPolicy(next: Pick<Policy, "floorPct" | "askOwner">): Promise<Policy>;
  setPaused(paused: boolean): Promise<PauseResult>;
  resolveApproval(id: string, decision: "approved" | "declined"): Promise<void>;
};
// Auth remains owner-local and independent of R15's data-route contract.
export type ConsoleAuth = {
  session(): Promise<boolean>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
};
