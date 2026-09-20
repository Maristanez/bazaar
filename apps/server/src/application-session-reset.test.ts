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
async function shop() {
  const threadsSent: Array<string | undefined> = [];
  let thread = 0;
  const fetchImpl: typeof fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("/assistants?")) return new Response(JSON.stringify({ assistants: [] }), { status: 200 });
    if (target.endsWith("/clone")) return new Response(JSON.stringify({ assistant_id: "clone" }), { status: 200 });
    const body = JSON.parse(String(init?.body));
    if (String(body.content).startsWith("SHOPPER QUESTION")) threadsSent.push(body.thread_id);
    return new Response(`data: ${JSON.stringify({ type: "run_ended", status: "completed", thread_id: `thread-${++thread}`, final_content: "They fit true to size.", model_provider: "openai", model_name: "test", cost_usd: 0 })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  const server = await createBazaarServer({ ownerDb: db(), env: { BACKBOARD_API_KEY: "test", BACKBOARD_ASSISTANT_ID: "base" }, fetchImpl });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, body: unknown) => { const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; };
  const catalog = await (await fetch(`${base}/api/products`)).json();
  return { post, threadsSent, product: catalog.items.find((p: { title: string }) => p.title === "Trail Runner 2") };
}

test("a fresh visit under a shared identity starts a clean conversation: no carried product, no carried thread", async () => {
  const { post, threadsSent, product } = await shop();
  // Visit one: the presenter asks about a product, so the server remembers it and Backboard has a thread.
  await post("/api/chat", { shopperId: "demo", product, productContextSource: "current", message: "do these run small?" });
  await post("/api/chat", { shopperId: "demo", message: "do these run small?" });
  expect(threadsSent).toEqual([undefined, "thread-1"]);

  expect((await post("/api/session/reset", { shopperId: "demo" })).status).toBe(200);

  // Visit two, same identity, no product on the page: nothing from visit one may leak in.
  const offer = await post("/api/chat", { shopperId: "demo", message: "Could you do $120?" });
  expect(offer.body.card).toBeUndefined();
  expect(offer.body.reply).toMatch(/pick a published product/i);
  await post("/api/chat", { shopperId: "demo", message: "do these run small?" });
  expect(threadsSent.at(-1)).toBeUndefined();
});

test("a reset needs a shopper id and touches nobody else", async () => {
  const { post, threadsSent, product } = await shop();
  await post("/api/chat", { shopperId: "alice", product, productContextSource: "current", message: "do these run small?" });
  expect((await post("/api/session/reset", {})).status).toBe(400);
  await post("/api/session/reset", { shopperId: "demo" });
  await post("/api/chat", { shopperId: "alice", message: "do these run small?" });
  expect(threadsSent).toEqual([undefined, "thread-1"]);
});
