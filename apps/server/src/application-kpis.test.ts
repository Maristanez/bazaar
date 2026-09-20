import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Deal, Policy } from "@bazaar/contracts";
import { createBazaarServer, type OwnerDatabase } from "./application.js";

const POLICY: Policy = { floorPct: 25, askOwner: true, paused: false, updatedAt: "2026-09-19T12:00:00.000Z" };
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
});

function deal(id: string, productId: string, listTotal: number, agreedTotal: number, cost: number): Deal {
  return {
    id, merchantId: "merchant", offerId: `offer-${id}`, surface: "storefront",
    items: [{ variantId: `${productId}/1`, title: productId, qty: 1 }],
    listTotal, agreedTotal, cost, floor: cost + 100, profit: agreedTotal - cost, ownerApproved: false, code: agreedTotal < listTotal ? "BZR-1" : null,
    createdAt: "2026-09-19T20:00:00.000Z",
  };
}

// Two shoppers asked for less than list and still bought; one paid list.
const DEALS = [
  deal("1", "trail-runner-2", 14_900, 13_300, 7_800),
  deal("2", "race-vest", 12_900, 11_000, 6_000),
  deal("3", "trail-socks", 1_800, 1_800, 700),
];

function database(deals: Deal[]): OwnerDatabase {
  return {
    merchantId: "merchant",
    async loadLatestPolicy() { return { ...POLICY }; },
    async appendPolicy(next) { return { ...next, updatedAt: POLICY.updatedAt }; },
    async verifyBearerToken(token) { return token === "Bearer owner" ? { id: "merchant", ownerUserId: "owner", shopDomain: "test.myshopify.com" } : null; },
    async insertDeal(input) { return { ...input, id: "deal", profit: input.agreedTotal - input.cost, createdAt: new Date().toISOString() }; },
    async listDeals() { return deals; },
  };
}

async function start(ownerDb: OwnerDatabase) {
  const server = await createBazaarServer({ env: {}, ownerDb });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const ownerState = async (base: string) => (await fetch(`${base}/api/console/state`, { headers: { Authorization: "Bearer owner" } })).json();

describe("owner KPIs from settled deals", () => {
  it("counts a deal below list as a customer saved and totals what was recovered", async () => {
    const state = await ownerState(await start(database(DEALS)));
    expect(state.kpis).toEqual({
      deals: 3,
      customersSaved: 2,
      revenueRecovered: 24_300,
      profitRecovered: 10_500,
      vsBanner: 2_420,
      agentCostUsd: 0,
    });
  });
});
