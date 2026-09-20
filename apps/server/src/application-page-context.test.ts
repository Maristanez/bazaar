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

/** A server whose Backboard is a fake: every run body is captured, and `llm` writes the answer. */
async function shop(llm: (body: Record<string, unknown>) => string) {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    const target = String(url);
    if (target.includes("/assistants?")) return new Response(JSON.stringify({ assistants: [] }), { status: 200 });
    if (target.endsWith("/clone")) return new Response(JSON.stringify({ assistant_id: "clone" }), { status: 200 });
    const body = JSON.parse(String(init?.body)); bodies.push(body);
    return new Response(`data: ${JSON.stringify({ type: "run_ended", status: "completed", thread_id: "thread", final_content: llm(body), model_provider: "openai", model_name: "test", cost_usd: 0 })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  const server = await createBazaarServer({ ownerDb: db(), env: { BACKBOARD_API_KEY: "test", BACKBOARD_ASSISTANT_ID: "base" }, fetchImpl });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = async (path: string, payload: unknown) => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return { status: response.status, body: await response.json() };
  };
  return { bodies, post };
}

const QUESTION = "Would these go well with what I have already picked out?";
const collectionPage = {
  pageType: "collection",
  template: "collection",
  path: "/collections/socks",
  collection: { handle: "socks", title: "Socks", productHandles: ["summit-crew-sock", "ridge-ankle-sock"] },
  cartItemCount: 2,
  cart: { itemCount: 2, items: [{ handle: "summit-crew-sock", title: "Summit Crew Sock", variantTitle: "M", quantity: 2 }] },
  selection: { variantId: "123", variantTitle: "M", quantity: 2 },
};

const hostilePage = {
  pageType: "collection",
  template: "<script>alert(1)</script>",
  path: "/collections/socks?secret=1",
  price: 1, cost: 1, floor: 1, profit: 1,
  customer: { email: "shopper@example.com" },
  product: { id: 42, handle: "trail-runner-2", title: `<script>steal()</script>${"A".repeat(5000)}`, type: "Shoes", available: true, price: 100, cost: 40, variants: [{ id: 1, price: 1 }] },
  collection: { handle: "socks", title: { nested: { deep: "object" } }, productHandles: Array.from({ length: 500 }, (_, index) => `handle-${index}`), floorPct: 5 },
  search: { terms: "B".repeat(5000), resultsCount: 1e12, cost: 3 },
  cartItemCount: "many",
  cart: { itemCount: 3, total_price: 999, items: Array.from({ length: 50 }, (_, index) => ({ handle: `item-${index}`, title: `Item ${index}`, variantTitle: "M", quantity: 1, price: 5000, final_line_price: 5000, properties: { note: "x" } })) },
  selection: { variantId: "123", variantTitle: "M", quantity: 2, price: 100 },
  nested: { a: { b: { c: "d" } } },
};

function run(bodies: Array<Record<string, unknown>>, index = 0): Record<string, unknown> {
  const body = bodies[index];
  if (!body) throw new Error(`Backboard run ${index} never happened`);
  return body;
}

function pageSentToTheModel(content: string): any {
  const line = content.split("\n").find(entry => entry.startsWith("SHOPPER PAGE"));
  return line ? JSON.parse(line.slice(line.indexOf("{"))) : null;
}

test("a question with no page, or a page that is not an object, is asked exactly as it is today", async () => {
  const { bodies, post } = await shop(() => "They pair well with the crew socks.");
  const plain = await post("/api/chat", { shopperId: "page-none", message: QUESTION });
  for (const page of ["collection", 7, ["collection"], { price: 100 }, null]) {
    const answered = await post("/api/chat", { shopperId: "page-none", message: QUESTION, page });
    expect(answered).toEqual(plain);
  }
  expect(plain.status).toBe(200);
  expect(new Set(bodies.map(body => body.content)).size).toBe(1);
  expect(String(run(bodies, 0).content)).not.toContain("SHOPPER PAGE");
  expect(new Set(bodies.map(body => body.system_prompt)).size).toBe(1);
});

test("the collection being browsed and the socks in the cart reach the model with the question", async () => {
  const { bodies, post } = await shop(() => "Those crew socks in your cart pair well with anything on this shelf.");
  const answered = await post("/api/chat", { shopperId: "page-collection", message: QUESTION, page: collectionPage });
  expect(answered.body.reply).toContain("crew socks");
  expect(pageSentToTheModel(String(run(bodies, 0).content))).toEqual(collectionPage);
});

test("a hostile page is cut down to the whitelist before anything reads it", async () => {
  const { bodies, post } = await shop(() => "Happy to help.");
  await post("/api/chat", { shopperId: "page-hostile", message: QUESTION, page: hostilePage });
  const content = String(run(bodies, 0).content);
  const page = pageSentToTheModel(content);
  expect(Object.keys(page).sort()).toEqual(["cart", "collection", "pageType", "path", "product", "search", "selection"]);
  expect(page.path).toBe("/collections/socks");
  expect(Object.keys(page.product).sort()).toEqual(["available", "handle", "id", "title", "type"]);
  expect(page.product.title.length).toBeLessThanOrEqual(120);
  expect(page.collection).toEqual({ handle: "socks", productHandles: Array.from({ length: 12 }, (_, index) => `handle-${index}`) });
  expect(page.search.terms.length).toBeLessThanOrEqual(120);
  expect(page.search.resultsCount).toBeUndefined();
  expect(page.cart.items).toHaveLength(10);
  expect(Object.keys(page.cart.items[0]).sort()).toEqual(["handle", "quantity", "title", "variantTitle"]);
  expect(page.selection).toEqual({ variantId: "123", variantTitle: "M", quantity: 2 });
  const pageLine = content.split("\n").find(entry => entry.startsWith("SHOPPER PAGE")) || "";
  expect(pageLine).not.toMatch(/[<>]|script>|price|cost|floor|profit|email|nested|properties/i);
  expect(pageLine.length).toBeLessThan(4000);
});

test("no owner-only figure rides back to the shopper with a page-aware answer", async () => {
  const { post } = await shop(() => "Happy to help.");
  const answered = await post("/api/chat", { shopperId: "page-public", message: QUESTION, page: hostilePage });
  expect(answered.body.page).toBeUndefined();
  expect(JSON.stringify(answered.body)).not.toMatch(/"(?:cost|floor|floorPct|profit|margin|menu|reasoning)"/);
});

test("the greeting with no page is asked exactly as it is today", async () => {
  const { bodies, post } = await shop(() => "Welcome back — still a size 10 for that muddy 50k?");
  const plain = await post("/api/greeting", { shopperId: "demo", product: { title: "Trail Runner 2" } });
  const malformed = await post("/api/greeting", { shopperId: "demo", product: { title: "Trail Runner 2" }, page: "collection" });
  expect(plain.body).toEqual({ greeting: "Welcome back — still a size 10 for that muddy 50k?", recalled: true });
  expect(malformed.body).toEqual(plain.body);
  expect(run(bodies, 0).content).toBe("A shopper has just opened the chat on the Trail Runner 2 page. Greet them.");
  expect(run(bodies, 1).content).toBe(run(bodies, 0).content);
  expect(run(bodies, 1).system_prompt).toBe(run(bodies, 0).system_prompt);
});

test("the greeting for a new page is recalled with that page in context, read-only", async () => {
  const { bodies, post } = await shop(() => "Back among the socks — those crew pairs in your cart are a good start.");
  const greeted = await post("/api/greeting", { shopperId: "demo", page: collectionPage });
  expect(greeted.body).toEqual({ greeting: "Back among the socks — those crew pairs in your cart are a good start.", recalled: true });
  expect(run(bodies, 0)).toMatchObject({ memory: "Readonly" });
  expect(pageSentToTheModel(String(run(bodies, 0).content))).toEqual(collectionPage);
});

test("a page-aware greeting keeps every greeting guarantee: no figure, and NOTHING means none", async () => {
  const priced = await shop(() => "Those socks in your cart? I can do $9 today.");
  expect((await priced.post("/api/greeting", { shopperId: "demo", page: collectionPage })).body).toEqual({ greeting: null, recalled: false });
  const silent = await shop(() => "NOTHING");
  expect((await silent.post("/api/greeting", { shopperId: "demo", page: collectionPage })).body).toEqual({ greeting: null, recalled: false });
  const hostile = await shop(() => "Welcome in.");
  await hostile.post("/api/greeting", { shopperId: "demo", page: hostilePage });
  expect(String(run(hostile.bodies).content)).not.toMatch(/[<>]|price|cost|email/i);
});
