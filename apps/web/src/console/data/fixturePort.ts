import type { ConsoleEvent, ConsoleState } from "@bazaar/contracts";
import { state } from "../fixtures/state";
import { events } from "../fixtures/events";
import type { ConsolePort } from "./port";

export function createFixturePort({ initialState = state, stream, intervalMs = 650 }: {
  initialState?: ConsoleState; stream?: ConsoleEvent[]; intervalMs?: number;
} = {}): ConsolePort {
  const replay = stream ?? events;
  const interactive = stream === undefined;
  const current = structuredClone(initialState);
  // Historical fixture dates are rebased only in this adapter, never in live data.
  if (initialState === state) current.pendingApprovals = current.pendingApprovals.map(approval => ({ ...approval, deadline: new Date(Date.now() + 45000).toISOString() }));
  const resolved = new Set<string>();
  const listeners = new Set<(event: ConsoleEvent) => void>();
  return {
    async load() { return structuredClone(current); },
    subscribe(onEvent) {
      listeners.add(onEvent);
      let index = 0;
      const timer = setInterval(() => {
        const event = replay[index++];
        if (index >= replay.length) clearInterval(timer);
        // The interactive preview waits for the real owner/timeout, not the recorded approval.
        if (interactive && event?.kind === "approval_resolved") return;
        if (event) {
          const next = structuredClone(event);
          if (next.approval) {
            if (resolved.has(next.approval.id)) return;
            const existing = current.pendingApprovals.find(approval => approval.id === next.approval!.id);
            next.approval.deadline = existing?.deadline ?? new Date(Date.now() + 45000).toISOString();
            current.pendingApprovals = current.pendingApprovals.filter(approval => approval.id !== next.approval!.id);
            if (next.approval.status === "requested") current.pendingApprovals.push(structuredClone(next.approval));
            else resolved.add(next.approval.id);
          }
          onEvent(next);
        }
        if (index >= replay.length) clearInterval(timer);
      }, intervalMs);
      return () => { clearInterval(timer); listeners.delete(onEvent); };
    },
    async setPolicy(next) {
      current.policy = { ...current.policy, floorPct: next.floorPct, askOwner: next.askOwner, updatedAt: new Date().toISOString() };
      return structuredClone(current.policy);
    },
    async setPaused(paused) {
      current.policy = { ...current.policy, paused, updatedAt: new Date().toISOString() };
      return structuredClone(current.policy);
    },
    async resolveApproval(id, decision) {
      const approval = current.pendingApprovals.find(approval => approval.id === id);
      if (!approval || resolved.has(id)) return;
      resolved.add(id);
      current.pendingApprovals = current.pendingApprovals.filter(approval => approval.id !== id);
      const status = Date.now() >= Date.parse(approval.deadline) ? "timed_out" : decision;
      const event: ConsoleEvent = {
        at: new Date().toISOString(), surface: "storefront", negotiationId: approval.negotiationId,
        shopperId: "fixture-shopper", kind: "approval_resolved", reasoning: `Owner decision: ${status.replace("_", " ")}`,
        offer: approval.offer, cost: approval.cost, profit: approval.profit, approval: { ...approval, status },
      };
      for (const listener of listeners) listener(structuredClone(event));
    },
  };
}
