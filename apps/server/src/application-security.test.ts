import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Policy } from "@bazaar/contracts";
import { createBazaarServer, type OwnerDatabase } from "./application.js";

const INITIAL_POLICY: Policy = {
  floorPct: 25,
  askOwner: true,
  paused: false,
  updatedAt: "2026-09-19T12:00:00.000Z",
};

const servers: Server[] = [];

async function closeServer(server: Server) {
  const index = servers.indexOf(server);
  if (index >= 0) servers.splice(index, 1);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

function persistentDatabase() {
  const policies: Policy[] = [{ ...INITIAL_POLICY }];
  const db: OwnerDatabase = {
    merchantId: "merchant",
    async loadLatestPolicy() { return { ...policies.at(-1)! }; },
    async appendPolicy(next) {
      const saved = { ...next, updatedAt: `2026-09-19T12:00:0${policies.length}.000Z` };
      policies.push(saved);
      return { ...saved };
    },
    async verifyBearerToken(token) {
      return token === "Bearer owner"
        ? { id: "merchant", ownerUserId: "owner", shopDomain: "test.myshopify.com" }
        : null;
    },
    async insertDeal(deal) {
      return { ...deal, id: "deal", profit: deal.agreedTotal - deal.cost, createdAt: new Date().toISOString() };
    },
  };
  return { db, policies };
}

async function start(ownerDb: OwnerDatabase, env: Record<string, string> = {}) {
  const server = await createBazaarServer({ env, ownerDb });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

function request(base: string, path: string, options: RequestInit = {}) {
  return fetch(base + path, options);
}

function ownerRequest(base: string, path: string, body?: unknown) {
  return request(base, path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function currentPolicy(base: string) {
  const response = await ownerRequest(base, "/api/console/state");
  expect(response.status).toBe(200);
  return (await response.json()).policy as Policy;
}

async function publishDecision(base: string, shopperId: string) {
  const catalog = await (await request(base, "/api/products")).json();
  const product = catalog.items.find((item: { title: string }) => item.title === "Trail Runner 2");
  const response = await request(base, "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      shopperId,
      product,
      productContextSource: "current",
      message: "Could you do $110? I am buying today because it is last season.",
    }),
  });
  expect(response.status).toBe(200);
  return (await response.json()).card.negotiationId as string;
}

type StreamEntry = { id: string; event: { negotiationId: string; shopperId: string } };

async function readStream(base: string, count: number, lastEventId?: string): Promise<StreamEntry[]> {
  const controller = new AbortController();
  const response = await request(base, "/api/console/stream", {
    headers: {
      Authorization: "Bearer owner",
      ...(lastEventId === undefined ? {} : { "Last-Event-ID": lastEventId }),
    },
    signal: controller.signal,
  });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = setTimeout(() => controller.abort(), 1_000);
  try {
    while ((text.match(/^data:/gm) ?? []).length < count) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
    }
  } finally {
    clearTimeout(deadline);
    controller.abort();
  }
  return text.split("\n\n").flatMap((frame) => {
    const id = /^id: (.+)$/m.exec(frame)?.[1];
    const data = /^data: (.+)$/m.exec(frame)?.[1];
    return id && data ? [{ id, event: JSON.parse(data) }] : [];
  });
}

describe("owner HTTP security and persistence", () => {
  it("exposes only public sign-in configuration without granting owner access", async () => {
    const { db } = persistentDatabase();
    const { base } = await start(db, { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_demo", SUPABASE_SECRET_KEY: "sb_secret_private" });
    const config = await request(base, "/api/public-config");
    expect(config.status).toBe(200);
    expect(await config.json()).toEqual({ supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "sb_publishable_demo" });
    expect((await request(base, "/api/console/state")).status).toBe(401);
  });
  it("requires a valid bearer token on every owner endpoint and ignores cookies", async () => {
    const { db } = persistentDatabase();
    const { base } = await start(db);
    const endpoints = [
      { path: "/api/console/state", method: "GET" },
      { path: "/api/console/stream", method: "GET" },
      { path: "/api/policy", method: "POST", body: { floorPct: 30, askOwner: true } },
      { path: "/api/pause", method: "POST", body: { paused: true } },
      { path: "/api/approvals/missing", method: "POST", body: { decision: "approve" } },
    ];
    const unauthorizedHeaders: Array<Record<string, string>> = [
      { Cookie: "session=owner" },
      { Authorization: "Bearer wrong" },
    ];

    for (const endpoint of endpoints) {
      for (const headers of unauthorizedHeaders) {
        const response = await request(base, endpoint.path, {
          method: endpoint.method,
          headers: { ...headers, "Content-Type": "application/json" },
          ...(endpoint.body === undefined ? {} : { body: JSON.stringify(endpoint.body) }),
        });
        expect(response.status, `${endpoint.method} ${endpoint.path}`).toBe(401);
        expect(await response.json()).toEqual({ error: "unauthorized" });
      }
    }
  });

  it("rejects invalid policy and PAUSE types without changing cached or persisted state", async () => {
    const { db, policies } = persistentDatabase();
    const { base } = await start(db);

    for (const invalid of [
      { floorPct: 1.5, askOwner: true },
      { floorPct: 61, askOwner: true },
      { floorPct: 25, askOwner: "yes" },
    ]) {
      expect((await ownerRequest(base, "/api/policy", invalid)).status).toBe(400);
    }
    expect((await ownerRequest(base, "/api/pause", { paused: "true" })).status).toBe(400);

    expect(await currentPolicy(base)).toEqual(INITIAL_POLICY);
    expect(policies).toEqual([INITIAL_POLICY]);
  });

  it("loads the newest persisted policy after a server restart", async () => {
    const { db, policies } = persistentDatabase();
    const first = await start(db);
    const adopted = await ownerRequest(first.base, "/api/policy", { floorPct: 40, askOwner: false });
    expect(adopted.status).toBe(200);
    expect(await adopted.json()).toMatchObject({ floorPct: 40, askOwner: false, paused: false });
    await closeServer(first.server);

    const second = await start(db);

    expect(await currentPolicy(second.base)).toEqual(policies.at(-1));
    expect(await currentPolicy(second.base)).toMatchObject({ floorPct: 40, askOwner: false, paused: false });
  });

  it("replays only unseen SSE events in-process and replays the new epoch after restart", async () => {
    const { db } = persistentDatabase();
    const first = await start(db);
    const firstNegotiation = await publishDecision(first.base, "stream-shopper-1");
    const secondNegotiation = await publishDecision(first.base, "stream-shopper-2");
    const initial = await readStream(first.base, 2);

    expect(initial.map(({ event }) => event.negotiationId)).toEqual([firstNegotiation, secondNegotiation]);
    expect(initial[0]!.id).toMatch(/^[0-9a-f-]{36}:1$/);
    expect(initial[1]!.id).toMatch(/^[0-9a-f-]{36}:2$/);

    const resumed = await readStream(first.base, 1, initial[0]!.id);
    expect(resumed).toEqual([initial[1]]);

    const oldEpoch = initial[1]!.id.split(":")[0];
    await closeServer(first.server);
    const second = await start(db);
    const restartedNegotiation = await publishDecision(second.base, "stream-shopper-restarted");
    const afterRestart = await readStream(second.base, 1, initial[1]!.id);

    expect(afterRestart[0]!.event.negotiationId).toBe(restartedNegotiation);
    expect(afterRestart[0]!.id).toMatch(/^[0-9a-f-]{36}:1$/);
    expect(afterRestart[0]!.id.split(":")[0]).not.toBe(oldEpoch);
  });
});
