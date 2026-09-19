import type { Approval, ConsoleEvent, PausePersistence, PauseResult, Policy, RedTeamResult } from "@bazaar/contracts";
import type { SupabaseDb } from "../infra/db";

export type OwnerRuntimeDb = Pick<SupabaseDb, "loadLatestPolicy" | "appendPolicy">;

export type PublishedConsoleEvent = Readonly<{
  id: number;
  event: ConsoleEvent;
}>;

export type ApprovalRequest = Readonly<{
  negotiationId: string;
  shopperId: string;
  surface: "storefront";
  items: Approval["items"];
  offer: number;
  cost: number;
  finalTotal: number;
}>;

export type OwnerRuntime = {
  getPolicy(): Policy;
  getPausePersistence(): PausePersistence;
  getRedTeamResult(): RedTeamResult;
  setPolicy(input: Pick<Policy, "floorPct" | "askOwner">): Promise<Policy>;
  setPaused(paused: boolean): Promise<PauseResult>;
  publish(event: ConsoleEvent): PublishedConsoleEvent;
  eventsAfter(lastId?: number): PublishedConsoleEvent[];
  subscribe(listener: (entry: PublishedConsoleEvent) => void): () => void;
  pendingApprovals(): Approval[];
  requestApproval(input: ApprovalRequest): Approval;
  resolveApproval(id: string, decision: "approve" | "decline"): Promise<Approval>;
  dispose(): void;
};

type ApprovalRecord = {
  approval: Approval;
  shopperId: string;
  surface: ConsoleEvent["surface"];
};

function assertPolicy(policy: Policy): void {
  if (!Number.isFinite(policy.floorPct) || !Number.isInteger(policy.floorPct) || policy.floorPct < 0 || policy.floorPct > 60) {
    throw new TypeError("floorPct must be an integer from 0 to 60");
  }
  if (typeof policy.askOwner !== "boolean") throw new TypeError("askOwner must be a boolean");
  if (typeof policy.paused !== "boolean") throw new TypeError("paused must be a boolean");
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function emptyRedTeamResult(): RedTeamResult {
  return {
    ranAt: "",
    attacks: [],
    breaches: 0,
    scope: {
      mode: "isolated",
      server: "no recorded run",
      backboard: "no recorded run",
      shopify: "no recorded run",
      database: "no recorded run",
      liveShopifyValidated: false,
      productionRequests: 0,
      productionDatabaseWrites: 0,
      dryRunDiscounts: 0,
      settlementRows: 0,
    },
  };
}

export async function createOwnerRuntime(options: {
  db: OwnerRuntimeDb;
  now?: () => Date;
  onApprovalResolved?: (approval: Approval) => void | Promise<void>;
  onPaused?: () => void;
  redteam?: RedTeamResult;
}): Promise<OwnerRuntime> {
  let policy = { ...await options.db.loadLatestPolicy() };
  assertPolicy(policy);
  let mutationTail: Promise<void> = Promise.resolve();
  let pauseGeneration = 0;
  let pausePersistence: PausePersistence = "saved";
  let nextEventId = 1;
  const feed: PublishedConsoleEvent[] = [];
  const listeners = new Set<(entry: PublishedConsoleEvent) => void>();
  const approvals = new Map<string, ApprovalRecord>();
  const askedNegotiations = new Set<string>();
  const approvalTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const pauseRetryTimers = new Set<ReturnType<typeof setTimeout>>();
  const now = options.now ?? (() => new Date());
  const redteam = clone(options.redteam ?? emptyRedTeamResult());

  function publish(event: ConsoleEvent): PublishedConsoleEvent {
    const entry = { id: nextEventId, event: clone(event) };
    nextEventId += 1;
    feed.push(entry);
    if (feed.length > 500) feed.splice(0, feed.length - 500);
    for (const listener of listeners) {
      try {
        listener(clone(entry));
      } catch {
        // A disconnected Console client must not interrupt the event producer.
      }
    }
    return clone(entry);
  }

  function transitionApproval(id: string, status: Approval["status"]): Approval {
    const record = approvals.get(id);
    if (!record) throw new Error(`Unknown approval ${id}`);
    if (record.approval.status !== "requested") throw new Error(`Approval ${id} is already resolved`);
    const approval = { ...record.approval, status };
    record.approval = approval;
    const timer = approvalTimers.get(id);
    if (timer) clearTimeout(timer);
    approvalTimers.delete(id);
    publish({
      at: now().toISOString(),
      surface: record.surface,
      negotiationId: approval.negotiationId,
      shopperId: record.shopperId,
      kind: "approval_resolved",
      reasoning: `Owner approval ${status}.`,
      offer: approval.offer,
      cost: approval.cost,
      profit: approval.profit,
      approval,
    });
    return approval;
  }

  async function resolveTerminal(id: string, status: Approval["status"]): Promise<Approval> {
    const approval = transitionApproval(id, status);
    await options.onApprovalResolved?.(clone(approval));
    return clone(approval);
  }

  function serializeMutation<T>(work: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(work);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  function pauseResult(): PauseResult {
    return { policy: { ...policy }, persistence: pausePersistence };
  }

  function schedulePauseRetry(generation: number, attempt: number): void {
    const delays = [250, 1_000, 5_000, 15_000, 30_000];
    const delay = delays[Math.min(attempt, delays.length - 1)]!;
    if (generation !== pauseGeneration || pausePersistence === "saved") return;
    const timer = setTimeout(() => {
      pauseRetryTimers.delete(timer);
      void serializeMutation(async () => {
        if (generation !== pauseGeneration || pausePersistence === "saved") return;
        const snapshot = { floorPct: policy.floorPct, askOwner: policy.askOwner, paused: policy.paused };
        try {
          const saved = await options.db.appendPolicy(snapshot);
          assertPolicy(saved);
          if (generation === pauseGeneration && policy.paused === snapshot.paused) {
            policy = { ...policy, updatedAt: saved.updatedAt };
            pausePersistence = "saved";
          }
        } catch {
          schedulePauseRetry(generation, attempt + 1);
        }
      });
    }, delay);
    timer.unref?.();
    pauseRetryTimers.add(timer);
  }

  return {
    getPolicy: () => ({ ...policy }),
    getPausePersistence: () => pausePersistence,
    getRedTeamResult: () => clone(redteam),
    setPolicy: (input) => {
      if (!Number.isFinite(input.floorPct) || !Number.isInteger(input.floorPct) || input.floorPct < 0 || input.floorPct > 60) {
        return Promise.reject(new TypeError("floorPct must be an integer from 0 to 60"));
      }
      if (typeof input.askOwner !== "boolean") return Promise.reject(new TypeError("askOwner must be a boolean"));
      return serializeMutation(async () => {
        const generation = pauseGeneration;
        const paused = policy.paused;
        const saved = await options.db.appendPolicy({ ...input, paused });
        assertPolicy(saved);
        if (generation === pauseGeneration) {
          policy = { ...saved };
          pausePersistence = "saved";
        } else {
          policy = { ...saved, paused: policy.paused };
        }
        return { ...policy };
      });
    },
    setPaused: (paused) => {
      if (typeof paused !== "boolean") return Promise.reject(new TypeError("paused must be a boolean"));
      const generation = ++pauseGeneration;
      policy = { ...policy, paused };
      pausePersistence = "pending";
      if (paused) {
        options.onPaused?.();
        const pendingIds = [...approvals.entries()]
          .filter(([, { approval }]) => approval.status === "requested")
          .map(([id]) => id);
        void Promise.allSettled(pendingIds.map((id) => resolveTerminal(id, "declined")));
      }
      return serializeMutation(async () => {
        if (generation !== pauseGeneration) return pauseResult();
        const snapshot = { floorPct: policy.floorPct, askOwner: policy.askOwner, paused };
        try {
          const saved = await options.db.appendPolicy(snapshot);
          assertPolicy(saved);
          if (generation === pauseGeneration && policy.paused === paused) {
            policy = { ...policy, updatedAt: saved.updatedAt };
            pausePersistence = "saved";
          }
        } catch {
          if (generation === pauseGeneration) {
            pausePersistence = "pending";
            schedulePauseRetry(generation, 0);
          }
        }
        return pauseResult();
      });
    },
    publish,
    eventsAfter: (lastId = 0) => feed.filter(({ id }) => id > lastId).map(clone),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pendingApprovals: () => [...approvals.values()]
      .map(({ approval }) => approval)
      .filter(({ status }) => status === "requested")
      .map(clone),
    requestApproval: (input) => {
      if (policy.paused) throw new Error("Approvals cannot be requested while deals are paused");
      if (input.surface !== "storefront") throw new Error("Approvals are storefront-only");
      if (!Number.isInteger(input.cost) || input.cost <= 0 || !Number.isInteger(input.offer) || input.offer <= input.cost) {
        throw new Error("Approval offer must be whole cents strictly above cost");
      }
      if (!Number.isInteger(input.finalTotal) || input.finalTotal <= input.cost) {
        throw new Error("Final total must be whole cents strictly above cost");
      }
      if (input.offer >= input.finalTotal) {
        throw new Error("Approval offer must be below the shop's final total");
      }
      if (askedNegotiations.has(input.negotiationId)) {
        throw new Error(`Approval already requested for negotiation ${input.negotiationId}`);
      }
      const requestedAt = now();
      const approval: Approval = {
        id: globalThis.crypto.randomUUID(),
        negotiationId: input.negotiationId,
        items: clone(input.items),
        offer: input.offer,
        cost: input.cost,
        profit: input.offer - input.cost,
        pctOverCost: (input.offer - input.cost) / input.cost * 100,
        deadline: new Date(requestedAt.getTime() + 45_000).toISOString(),
        status: "requested",
      };
      askedNegotiations.add(input.negotiationId);
      approvals.set(approval.id, {
        approval,
        shopperId: input.shopperId,
        surface: input.surface,
      });
      publish({
        at: requestedAt.toISOString(),
        surface: input.surface,
        negotiationId: input.negotiationId,
        shopperId: input.shopperId,
        kind: "approval_requested",
        reasoning: "Owner approval requested for a storefront offer above cost.",
        offer: input.offer,
        cost: input.cost,
        profit: approval.profit,
        approval,
      });
      approvalTimers.set(approval.id, setTimeout(() => {
        void resolveTerminal(approval.id, "timed_out").catch(() => undefined);
      }, 45_000));
      return clone(approval);
    },
    resolveApproval: (id, decision) => {
      if (decision !== "approve" && decision !== "decline") {
        return Promise.reject(new TypeError("Approval decision must be approve or decline"));
      }
      return resolveTerminal(id, decision === "approve" ? "approved" : "declined");
    },
    dispose: () => {
      for (const timer of approvalTimers.values()) clearTimeout(timer);
      approvalTimers.clear();
      for (const timer of pauseRetryTimers) clearTimeout(timer);
      pauseRetryTimers.clear();
      listeners.clear();
    },
  };
}
