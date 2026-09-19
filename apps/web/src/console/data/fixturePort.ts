import type { ConsoleEvent, ConsoleState } from "@bazaar/contracts";
import { state } from "../fixtures/state";
import { events } from "../fixtures/events";
import type { ConsolePort } from "./port";

export function createFixturePort({ initialState = state, stream = events, intervalMs = 650 }: {
  initialState?: ConsoleState; stream?: ConsoleEvent[]; intervalMs?: number;
} = {}): ConsolePort {
  const current = structuredClone(initialState);
  return {
    async load() { return structuredClone(current); },
    subscribe(onEvent) {
      let index = 0;
      const timer = setInterval(() => {
        const event = stream[index++];
        if (event) onEvent(structuredClone(event));
        if (index >= stream.length) clearInterval(timer);
      }, intervalMs);
      return () => clearInterval(timer);
    },
    async setPolicy() { throw new Error("Policy editing is not available yet."); },
    async setPaused(paused) {
      current.policy = { ...current.policy, paused, updatedAt: new Date().toISOString() };
      return structuredClone(current.policy);
    },
    async resolveApproval() { throw new Error("Approvals are not available yet."); },
  };
}
