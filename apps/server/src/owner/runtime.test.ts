import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConsoleEvent, Policy } from "@bazaar/contracts";
import { createOwnerRuntime } from "./runtime";

afterEach(() => vi.useRealTimers());

const INITIAL_POLICY: Policy = {
  floorPct: 25,
  askOwner: true,
  paused: false,
  updatedAt: "2026-09-19T12:00:00.000Z",
};

function consoleEvent(negotiationId: string): ConsoleEvent {
  return {
    at: "2026-09-19T12:00:00.000Z",
    surface: "storefront",
    negotiationId,
    shopperId: "shopper-1",
    kind: "decision",
    reasoning: `decision ${negotiationId}`,
  };
}

function runtimeDb() {
  return {
    loadLatestPolicy: vi.fn(async () => INITIAL_POLICY),
    appendPolicy: vi.fn(async (input: Omit<Policy, "updatedAt"> & Partial<Pick<Policy, "updatedAt">>) => ({
      ...input,
      updatedAt: "2026-09-19T12:01:00.000Z",
    } as Policy)),
  };
}

describe("owner runtime policy", () => {
  it("loads the latest policy before exposing the runtime", async () => {
    const db = {
      loadLatestPolicy: vi.fn(async () => INITIAL_POLICY),
      appendPolicy: vi.fn(),
    };

    const runtime = await createOwnerRuntime({ db });

    expect(db.loadLatestPolicy).toHaveBeenCalledOnce();
    expect(runtime.getPolicy()).toEqual(INITIAL_POLICY);
  });

  it("serializes policy writes and changes the hot-path cache only after each append succeeds", async () => {
    const writes: Array<{
      input: Omit<Policy, "updatedAt"> & Partial<Pick<Policy, "updatedAt">>;
      resolve: (policy: Policy) => void;
    }> = [];
    const db = {
      loadLatestPolicy: vi.fn(async () => INITIAL_POLICY),
      appendPolicy: vi.fn((input: Omit<Policy, "updatedAt"> & Partial<Pick<Policy, "updatedAt">>) =>
        new Promise<Policy>((resolve) => writes.push({ input, resolve }))),
    };
    const runtime = await createOwnerRuntime({ db });

    const first = runtime.setPolicy({ floorPct: 30, askOwner: false });
    const second = runtime.setPolicy({ floorPct: 35, askOwner: true });

    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes).toHaveLength(1);
    expect(writes[0]?.input).toEqual({ floorPct: 30, askOwner: false, paused: false });
    expect(runtime.getPolicy()).toEqual(INITIAL_POLICY);

    writes[0]?.resolve({ floorPct: 30, askOwner: false, paused: false, updatedAt: "2026-09-19T12:01:00.000Z" });
    await first;
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]?.input).toEqual({ floorPct: 35, askOwner: true, paused: false });

    writes[1]?.resolve({ floorPct: 35, askOwner: true, paused: false, updatedAt: "2026-09-19T12:02:00.000Z" });
    await second;
    expect(runtime.getPolicy()).toEqual({
      floorPct: 35,
      askOwner: true,
      paused: false,
      updatedAt: "2026-09-19T12:02:00.000Z",
    });
  });

  it("rejects invalid policy inputs without writing", async () => {
    const db = runtimeDb();
    const runtime = await createOwnerRuntime({ db });

    await expect(runtime.setPolicy({ floorPct: 1.5, askOwner: true })).rejects.toThrow(/integer.*0 to 60/i);
    await expect(runtime.setPolicy({ floorPct: Number.NaN, askOwner: true })).rejects.toThrow(/integer.*0 to 60/i);
    await expect(runtime.setPolicy({ floorPct: 61, askOwner: true })).rejects.toThrow(/integer.*0 to 60/i);
    await expect(runtime.setPolicy({ floorPct: 25, askOwner: "yes" as never })).rejects.toThrow(/boolean/i);
    await expect(runtime.setPaused("yes" as never)).rejects.toThrow(/boolean/i);
    expect(db.appendPolicy).not.toHaveBeenCalled();
  });
});

describe("owner runtime console feed", () => {
  it("publishes monotonic ids, supports unsubscribe, and retains only the newest 500 events", async () => {
    const runtime = await createOwnerRuntime({ db: runtimeDb() });
    const received: number[] = [];
    const unsubscribe = runtime.subscribe(({ id }) => received.push(id));

    for (let id = 1; id <= 505; id += 1) runtime.publish(consoleEvent(`neg-${id}`));
    unsubscribe();
    runtime.publish(consoleEvent("after-unsubscribe"));

    expect(received).toEqual(Array.from({ length: 505 }, (_, index) => index + 1));
    expect(runtime.eventsAfter()).toHaveLength(500);
    expect(runtime.eventsAfter()[0]).toMatchObject({ id: 7, event: { negotiationId: "neg-7" } });
    expect(runtime.eventsAfter(503).map(({ id }) => id)).toEqual([504, 505, 506]);
  });

  it("isolates retained events and subscribers from each other's mutations and failures", async () => {
    const runtime = await createOwnerRuntime({ db: runtimeDb() });
    const original = consoleEvent("neg-isolated");
    let secondListenerCalled = false;
    runtime.subscribe(() => { throw new Error("closed SSE connection"); });
    runtime.subscribe((entry) => {
      secondListenerCalled = true;
      entry.event.reasoning = "subscriber mutation";
    });

    expect(() => runtime.publish(original)).not.toThrow();
    original.reasoning = "caller mutation";
    const replay = runtime.eventsAfter();

    expect(secondListenerCalled).toBe(true);
    expect(replay[0]?.event.reasoning).toBe("decision neg-isolated");
    if (replay[0]) replay[0].event.reasoning = "reader mutation";
    expect(runtime.eventsAfter()[0]?.event.reasoning).toBe("decision neg-isolated");
  });
});

describe("owner runtime approvals", () => {
  it("creates one storefront request per negotiation strictly above cost and publishes it", async () => {
    const now = new Date("2026-09-19T14:00:00.000Z");
    const runtime = await createOwnerRuntime({ db: runtimeDb(), now: () => now });
    const input = {
      negotiationId: "neg-approval",
      shopperId: "shopper-7",
      surface: "storefront" as const,
      items: [{ variantId: "tr2-10", title: "Trail Runner 2", size: "10", qty: 1 }],
      offer: 9_000,
      cost: 7_800,
      finalTotal: 12_000,
    };

    const approval = runtime.requestApproval(input);

    expect(approval).toEqual({
      id: expect.any(String),
      negotiationId: "neg-approval",
      items: input.items,
      offer: 9_000,
      cost: 7_800,
      profit: 1_200,
      pctOverCost: 1_200 / 7_800 * 100,
      deadline: "2026-09-19T14:00:45.000Z",
      status: "requested",
    });
    expect(runtime.pendingApprovals()).toEqual([approval]);
    expect(runtime.eventsAfter()).toEqual([expect.objectContaining({
      id: 1,
      event: expect.objectContaining({
        at: now.toISOString(),
        surface: "storefront",
        negotiationId: "neg-approval",
        shopperId: "shopper-7",
        kind: "approval_requested",
        offer: 9_000,
        cost: 7_800,
        profit: 1_200,
        approval,
      }),
    })]);
    expect(() => runtime.requestApproval(input)).toThrow(/already requested/i);
    expect(() => runtime.requestApproval({ ...input, negotiationId: "at-cost", offer: 7_800 })).toThrow(/above cost/i);
    expect(() => runtime.requestApproval({ ...input, negotiationId: "at-final", offer: 12_000 })).toThrow(/below.*final/i);
    expect(() => runtime.requestApproval({ ...input, negotiationId: "chatgpt", surface: "chatgpt" as never })).toThrow(/storefront/i);
    runtime.dispose();
  });

  it("does not expose mutable approval state through inputs or return values", async () => {
    const runtime = await createOwnerRuntime({ db: runtimeDb() });
    const items = [{ variantId: "tr2-10", title: "Trail Runner 2", qty: 1 }];
    const approval = runtime.requestApproval({
      negotiationId: "neg-isolated-approval",
      shopperId: "shopper-isolated-approval",
      surface: "storefront",
      items,
      offer: 9_000,
      cost: 7_800,
      finalTotal: 12_000,
    });

    approval.status = "declined";
    items[0]!.title = "mutated input";
    approval.items[0]!.title = "mutated output";

    expect(runtime.pendingApprovals()).toEqual([expect.objectContaining({
      status: "requested",
      items: [expect.objectContaining({ title: "Trail Runner 2" })],
    })]);
    runtime.dispose();
  });

  it("resolves an approval once, publishes the terminal state, and notifies the shopper bridge", async () => {
    const resolved: Array<{ status: string; negotiationId: string }> = [];
    const runtime = await createOwnerRuntime({
      db: runtimeDb(),
      now: () => new Date("2026-09-19T14:00:00.000Z"),
      onApprovalResolved: async (approval) => {
        resolved.push({ status: approval.status, negotiationId: approval.negotiationId });
      },
    });
    const approval = runtime.requestApproval({
      negotiationId: "neg-race",
      shopperId: "shopper-race",
      surface: "storefront",
      items: [{ variantId: "tr2-10", title: "Trail Runner 2", qty: 1 }],
      offer: 9_000,
      cost: 7_800,
      finalTotal: 12_000,
    });

    const first = runtime.resolveApproval(approval.id, "approve");
    const second = runtime.resolveApproval(approval.id, "decline");
    const secondExpectation = expect(second).rejects.toThrow(/already resolved/i);

    await expect(first).resolves.toMatchObject({ status: "approved" });
    await secondExpectation;
    expect(runtime.pendingApprovals()).toEqual([]);
    expect(resolved).toEqual([{ status: "approved", negotiationId: "neg-race" }]);
    expect(runtime.eventsAfter(1)).toEqual([expect.objectContaining({
      id: 2,
      event: expect.objectContaining({
        kind: "approval_resolved",
        shopperId: "shopper-race",
        approval: expect.objectContaining({ status: "approved" }),
      }),
    })]);
    runtime.dispose();
  });

  it("rejects an untyped decision without consuming the request", async () => {
    const runtime = await createOwnerRuntime({ db: runtimeDb() });
    const approval = runtime.requestApproval({
      negotiationId: "neg-invalid-decision",
      shopperId: "shopper-invalid-decision",
      surface: "storefront",
      items: [{ variantId: "tr2-10", title: "Trail Runner 2", qty: 1 }],
      offer: 9_000,
      cost: 7_800,
      finalTotal: 12_000,
    });

    await expect(runtime.resolveApproval(approval.id, "maybe" as never)).rejects.toThrow(/approve.*decline/i);
    expect(runtime.pendingApprovals()).toEqual([approval]);
    runtime.dispose();
  });

  it("times out at 45 seconds on the server clock", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T14:00:00.000Z"));
    const statuses: string[] = [];
    const runtime = await createOwnerRuntime({
      db: runtimeDb(),
      now: () => new Date(Date.now()),
      onApprovalResolved: (approval) => { statuses.push(approval.status); },
    });
    runtime.requestApproval({
      negotiationId: "neg-timeout",
      shopperId: "shopper-timeout",
      surface: "storefront",
      items: [{ variantId: "tr2-10", title: "Trail Runner 2", qty: 1 }],
      offer: 9_000,
      cost: 7_800,
      finalTotal: 12_000,
    });

    await vi.advanceTimersByTimeAsync(44_999);
    expect(runtime.pendingApprovals()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(runtime.pendingApprovals()).toEqual([]);
    expect(statuses).toEqual(["timed_out"]);
    expect(runtime.eventsAfter(1)[0]?.event.approval).toMatchObject({ status: "timed_out" });
    runtime.dispose();
  });

  it("activates PAUSE, invalidates offers, and declines pending requests before persistence settles", async () => {
    const statuses: string[] = [];
    let save!: (policy: Policy) => void;
    const db = runtimeDb();
    db.appendPolicy.mockImplementationOnce(() => new Promise(resolve => { save = resolve; }));
    const onPaused = vi.fn();
    const runtime = await createOwnerRuntime({
      db,
      onPaused,
      onApprovalResolved: (approval) => { statuses.push(approval.status); },
    });
    runtime.requestApproval({
      negotiationId: "neg-pause",
      shopperId: "shopper-pause",
      surface: "storefront",
      items: [{ variantId: "tr2-10", title: "Trail Runner 2", qty: 1 }],
      offer: 9_000,
      cost: 7_800,
      finalTotal: 12_000,
    });

    const pausing = runtime.setPaused(true);

    expect(runtime.getPolicy().paused).toBe(true);
    expect(runtime.getPausePersistence()).toBe("pending");
    expect(onPaused).toHaveBeenCalledOnce();
    expect(runtime.pendingApprovals()).toEqual([]);
    expect(statuses).toEqual(["declined"]);
    expect(() => runtime.requestApproval({
      negotiationId: "neg-paused",
      shopperId: "shopper-paused",
      surface: "storefront",
      items: [{ variantId: "tr2-10", title: "Trail Runner 2", qty: 1 }],
      offer: 9_000,
      cost: 7_800,
      finalTotal: 12_000,
    })).toThrow(/paused/i);
    await vi.waitFor(() => expect(db.appendPolicy).toHaveBeenCalledOnce());
    expect(db.appendPolicy).toHaveBeenCalledWith({ floorPct: 25, askOwner: true, paused: true });
    save({ floorPct: 25, askOwner: true, paused: true, updatedAt: "2026-09-19T12:02:00.000Z" });
    await expect(pausing).resolves.toMatchObject({ policy: { paused: true }, persistence: "saved" });
    runtime.dispose();
  });

  it("keeps the emergency pause active and retries when its first persistence attempt fails", async () => {
    vi.useFakeTimers();
    const db = runtimeDb();
    db.appendPolicy.mockRejectedValueOnce(new Error("database unavailable"));
    const runtime = await createOwnerRuntime({ db });
    runtime.requestApproval({
      negotiationId: "neg-failed-pause",
      shopperId: "shopper-failed-pause",
      surface: "storefront",
      items: [{ variantId: "tr2-10", title: "Trail Runner 2", qty: 1 }],
      offer: 9_000,
      cost: 7_800,
      finalTotal: 12_000,
    });

    await expect(runtime.setPaused(true)).resolves.toMatchObject({ policy: { paused: true }, persistence: "pending" });

    expect(runtime.getPolicy()).toMatchObject({ paused: true });
    expect(runtime.getPausePersistence()).toBe("pending");
    expect(runtime.pendingApprovals()).toEqual([]);
    await vi.advanceTimersByTimeAsync(250);
    expect(db.appendPolicy).toHaveBeenCalledTimes(2);
    expect(runtime.getPausePersistence()).toBe("saved");
    runtime.dispose();
  });

  it("cancels a failed PAUSE retry after a newer Resume is durably saved", async () => {
    vi.useFakeTimers();
    const db = runtimeDb();
    db.appendPolicy.mockRejectedValueOnce(new Error("database unavailable"));
    const runtime = await createOwnerRuntime({ db });

    await expect(runtime.setPaused(true)).resolves.toMatchObject({ persistence: "pending" });
    await expect(runtime.setPaused(false)).resolves.toMatchObject({ policy: { paused: false }, persistence: "saved" });
    await vi.advanceTimersByTimeAsync(250);

    expect(db.appendPolicy).toHaveBeenCalledTimes(2);
    expect(db.appendPolicy).toHaveBeenLastCalledWith({ floorPct: 25, askOwner: true, paused: false });
    expect(runtime.getPolicy().paused).toBe(false);
    runtime.dispose();
  });

  it("does not let an in-flight Adopt reopen deals after an emergency PAUSE", async () => {
    const writes: Array<{ input: Omit<Policy, "updatedAt">; save(policy: Policy): void }> = [];
    const db = {
      loadLatestPolicy: vi.fn(async () => INITIAL_POLICY),
      appendPolicy: vi.fn((input: Omit<Policy, "updatedAt">) => new Promise<Policy>(resolve => writes.push({ input, save: resolve }))),
    };
    const runtime = await createOwnerRuntime({ db });

    const adopting = runtime.setPolicy({ floorPct: 35, askOwner: false });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    const pausing = runtime.setPaused(true);
    expect(runtime.getPolicy().paused).toBe(true);

    writes[0]!.save({ floorPct: 35, askOwner: false, paused: false, updatedAt: "2026-09-19T12:01:00.000Z" });
    await expect(adopting).resolves.toMatchObject({ floorPct: 35, askOwner: false, paused: true });
    await vi.waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[1]!.input).toEqual({ floorPct: 35, askOwner: false, paused: true });
    writes[1]!.save({ floorPct: 35, askOwner: false, paused: true, updatedAt: "2026-09-19T12:02:00.000Z" });
    await expect(pausing).resolves.toMatchObject({ policy: { paused: true }, persistence: "saved" });
    expect(runtime.getPolicy()).toMatchObject({ floorPct: 35, askOwner: false, paused: true });
    runtime.dispose();
  });
});
