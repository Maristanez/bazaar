import { afterEach, expect, test } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createBazaarServer, type OwnerDatabase } from "./application.js";
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });
function db(): OwnerDatabase {
  let policy = { floorPct: 25, askOwner: false, paused: false, updatedAt: new Date().toISOString() };
  return { merchantId: "merchant", async loadLatestPolicy() { return policy; }, async appendPolicy(next) { policy = { ...next, updatedAt: new Date().toISOString() }; return policy; }, async verifyBearerToken() { return null; }, async insertDeal(deal) { return { ...deal, id: "deal", profit: 0, createdAt: new Date().toISOString() }; } };
}
/** The memory mode Backboard is sent for a real shopper's question, given what the host's settings say. */
async function modeSent(configured: string | undefined) {
  const sent: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("/assistants?")) return new Response(JSON.stringify({ assistants: [] }), { status: 200 });
    if (target.endsWith("/clone")) return new Response(JSON.stringify({ assistant_id: "clone" }), { status: 200 });
    sent.push(JSON.parse(String(init?.body)).memory);
    return new Response(`data: ${JSON.stringify({ type: "run_ended", status: "completed", thread_id: "thread", final_content: "They fit true to size.", model_provider: "openai", model_name: "test", cost_usd: 0 })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  const server = await createBazaarServer({ ownerDb: db(), env: { BACKBOARD_API_KEY: "test", BACKBOARD_ASSISTANT_ID: "base", ...(configured === undefined ? {} : { BACKBOARD_MEMORY_MODE: configured }) }, fetchImpl });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopperId: "shopper-alice", message: "do these run small?" }) });
  return sent[0];
}

test.each([[undefined, "Auto"], ["Auto", "Auto"], ["auto", "Auto"], ["READONLY", "Readonly"], [" Off ", "off"], ["Off", "off"]])("a host memory mode of %j reaches Backboard as %j", async (configured, expected) => {
  expect(await modeSent(configured)).toBe(expected);
});

test("a memory mode nobody recognises turns memory off rather than guessing", async () => {
  expect(await modeSent("sometimes")).toBe("off");
});
