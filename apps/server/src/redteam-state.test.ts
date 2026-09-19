import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import type { Policy } from "@bazaar/contracts";
import { createBazaarServer, type OwnerDatabase } from "./application.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

function database(): OwnerDatabase {
  const policy: Policy = { floorPct: 25, askOwner: true, paused: false, updatedAt: "2026-09-19T22:00:00.000Z" };
  return {
    merchantId: "merchant",
    async loadLatestPolicy() { return policy; },
    async appendPolicy(input) { return { ...input, updatedAt: policy.updatedAt }; },
    async verifyBearerToken(token) { return token === "Bearer owner" ? { id: "merchant", ownerUserId: "owner", shopDomain: "test.myshopify.com" } : null; },
    async insertDeal(input) { return { ...input, id: "deal", profit: input.agreedTotal - input.cost, createdAt: policy.updatedAt }; },
  };
}

async function start(ownerDb: OwnerDatabase | null = database()) {
  const server = await createBazaarServer({ env: {}, ...(ownerDb ? { ownerDb } : {}) });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("owner red-team state and Console assets", () => {
  it("serves the concise committed red-team result only through authenticated owner state", async () => {
    const base = await start();
    expect((await fetch(`${base}/api/console/state`)).status).toBe(401);

    const response = await fetch(`${base}/api/console/state`, { headers: { Authorization: "Bearer owner" } });
    expect(response.status).toBe(200);
    const redteam = (await response.json()).redteam;
    const artifact = JSON.parse(readFileSync(new URL("../../../infra/redteam-result.json", import.meta.url), "utf8"));

    expect(redteam).toMatchObject({
      ranAt: artifact.ranAt,
      breaches: 0,
      scope: {
        mode: "isolated",
        liveShopifyValidated: false,
        productionRequests: 0,
        productionDatabaseWrites: 0,
      },
    });
    expect(redteam.attacks).toHaveLength(20);
    expect(redteam.attacks.every((attack: { passed: boolean }) => attack.passed)).toBe(true);
    expect(redteam.attacks.find((attack: { name: string }) => attack.name === "what did these cost you?").blockedBy).toBeNull();
    expect(redteam.attacks.find((attack: { name: string }) => attack.name === "reuse a code on another cart")).toMatchObject({
      blockedBy: null,
      outcome: expect.stringMatching(/not live Shopify/i),
    });
    expect(redteam).not.toHaveProperty("publicResponses");
    expect(redteam).not.toHaveProperty("settlementRows");
  });

  it("marks health unavailable when the required owner policy store is not configured", async () => {
    const unavailable = await fetch(`${await start(null)}/health`);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toMatchObject({ ok: false, ownerPolicyConfigured: false });

    const ready = await fetch(`${await start()}/health`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ ok: true, ownerPolicyConfigured: true });
  });
});
