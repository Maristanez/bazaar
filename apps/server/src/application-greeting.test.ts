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
async function greet(llm: (body: Record<string, unknown>) => string | Error, shopperId = "demo") {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("/assistants?")) return new Response(JSON.stringify({ assistants: [] }), { status: 200 });
    if (target.endsWith("/clone")) return new Response(JSON.stringify({ assistant_id: "clone" }), { status: 200 });
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    const answer = llm(body);
    if (answer instanceof Error) throw answer;
    return new Response(`data: ${JSON.stringify({ type: "run_ended", status: "completed", thread_id: "thread", final_content: answer, model_provider: "openai", model_name: "test", cost_usd: 0 })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  const server = await createBazaarServer({ ownerDb: db(), env: { BACKBOARD_API_KEY: "test", BACKBOARD_ASSISTANT_ID: "base" }, fetchImpl });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const catalog = await (await fetch(`${base}/api/products`)).json();
  const product = catalog.items.find((p: { title: string }) => p.title === "Trail Runner 2");
  const response = await fetch(`${base}/api/greeting`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopperId, product }) });
  return { status: response.status, body: await response.json(), bodies };
}

test("the greeting is whatever the shopkeeper recalls, asked for without writing a new memory", async () => {
  const { status, body, bodies } = await greet(() => "Welcome back — still a size 10 for that muddy 50k?");
  expect(status).toBe(200);
  expect(body).toEqual({ greeting: "Welcome back — still a size 10 for that muddy 50k?", recalled: true });
  expect(bodies[0]).toMatchObject({ assistant_id: "clone", memory: "Readonly" });
});

test("with nothing recalled the shopkeeper says so by sending no greeting, and the theme keeps its plain welcome", async () => {
  const { body } = await greet(() => "NOTHING");
  expect(body).toEqual({ greeting: null, recalled: false });
});

test("a greeting that names a price is dropped: a dollar figure only ever comes from an offer", async () => {
  const { body } = await greet(() => "Welcome back! I can do $99 on those today.");
  expect(body).toEqual({ greeting: null, recalled: false });
});

test("when Backboard fails the greeting is simply absent", async () => {
  const { status, body } = await greet(() => new Error("down"));
  expect(status).toBe(200);
  expect(body).toEqual({ greeting: null, recalled: false });
});
