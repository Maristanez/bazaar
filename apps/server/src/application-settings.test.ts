import { afterEach, expect, test } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createBazaarServer, type OwnerDatabase } from "./application.js";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); });

function db(): OwnerDatabase {
  let policy = { floorPct: 25, askOwner: false, paused: false, updatedAt: new Date().toISOString() };
  return { merchantId: "merchant", async loadLatestPolicy() { return policy; }, async appendPolicy(next) { policy = { ...next, updatedAt: new Date().toISOString() }; return policy; }, async verifyBearerToken(value) { return value === "Bearer owner" ? { id: "merchant", ownerUserId: "owner", shopDomain: "test.myshopify.com" } : null; }, async insertDeal(deal) { return { ...deal, id: "deal", profit: deal.agreedTotal - deal.cost, createdAt: new Date().toISOString() }; } };
}

/** An LLM double: answers like Backboard would, and counts every call it receives. */
function llmDouble() {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push(String(url));
    const menu = JSON.parse(JSON.parse(String(init?.body)).content.split("MENU: ")[1]);
    return new Response(`data: ${JSON.stringify({ type: "run_ended", status: "completed", thread_id: "thread", final_content: `OPTION: ${menu[0].id}\nI can do ${menu[0].total}.`, model_provider: "openai", model_name: "test", cost_usd: 0 })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
  };
  return { calls, fetchImpl };
}

async function start(fetchImpl?: typeof fetch) {
  const server = await createBazaarServer({ ownerDb: db(), env: fetchImpl ? { BACKBOARD_API_KEY: "test", BACKBOARD_ASSISTANT_ID: "test", BACKBOARD_MEMORY_MODE: "off" } : {}, ...(fetchImpl ? { fetchImpl } : {}) });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function setPolicy(base: string, body: unknown) {
  return (await fetch(`${base}/api/policy`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer owner" }, body: JSON.stringify(body) })).json();
}

async function chatter(base: string, shopperId: string) {
  const catalog = await (await fetch(`${base}/api/products`)).json();
  const product = catalog.items.find((item: { title: string }) => item.title === "Trail Runner 2");
  return async (message: string) => (await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopperId, product, productContextSource: "current", message }) })).json();
}

async function firstConsoleEvent(base: string, matching: (event: { reasoning: string }) => boolean) {
  const controller = new AbortController();
  const stream = await fetch(`${base}/api/console/stream`, { headers: { Authorization: "Bearer owner" }, signal: controller.signal });
  const reader = stream.body!.getReader();
  const deadline = setTimeout(() => controller.abort(), 500);
  let text = "";
  try {
    for (;;) {
      const events = text.split("\n\n").filter(chunk => chunk.includes("data: ")).map(chunk => JSON.parse(chunk.split("data: ")[1]!));
      const found = events.find(matching);
      if (found) return found;
      const next = await reader.read();
      if (next.done) return undefined;
      text += new TextDecoder().decode(next.value);
    }
  } finally { clearTimeout(deadline); controller.abort(); }
}

test("POST /api/policy stores the resolved owner settings and returns them on the policy", async () => {
  const base = await start();
  const saved = await setPolicy(base, { floorPct: 30, askOwner: false, settings: { maxRounds: 2, discountCapPct: 99, tone: "brisk" } });
  expect(saved).toMatchObject({ floorPct: 30, settings: { discountCapPct: 22, maxRounds: 2, lowballCutoffPct: 40, tone: "brisk", firmPriceProductIds: [] } });
  const kept = await setPolicy(base, { floorPct: 35, askOwner: false });
  expect(kept.settings.maxRounds).toBe(2);
  const state = await (await fetch(`${base}/api/console/state`, { headers: { Authorization: "Bearer owner" } })).json();
  expect(state.policy).toMatchObject({ floorPct: 35, settings: { maxRounds: 2, tone: "brisk" } });
});

test("a shopper turn ends at the owner's max rounds", async () => {
  const base = await start();
  await setPolicy(base, { floorPct: 25, askOwner: false, settings: { maxRounds: 2 } });
  const say = await chatter(base, "two-rounds");
  const first = await say("Could you do $130? It is last season and I am buying today.");
  const second = await say("Could you do $130? It is last season and I am buying today.");
  const third = await say("Could you do $130? It is last season and I am buying today.");
  expect(first.card).toMatchObject({ round: 1, maxRounds: 2 });
  expect(second.card).toMatchObject({ round: 2, maxRounds: 2 });
  expect(third.card).toMatchObject({ round: 2, maxRounds: 2 });
  expect(second.card.option.total).toBeLessThan(first.card.option.total);
});

test("a shopper turn never prices below the owner's discount cap", async () => {
  const base = await start();
  await setPolicy(base, { floorPct: 25, askOwner: false, settings: { discountCapPct: 2 } });
  const say = await chatter(base, "capped");
  let last;
  for (let turn = 0; turn < 4; turn += 1) last = await say("Could you do $100? It is last season and I am buying today.");
  // 2% off $149 is $146.02 → $147.
  expect(last.card.option.total).toBeGreaterThanOrEqual(14700);
  expect(last.card.option.total).toBeLessThanOrEqual(14900);
});

test("a lowball is countered by code: no LLM call, no round consumed, the same price forty times", async () => {
  const llm = llmDouble();
  const base = await start(llm.fetchImpl);
  const say = await chatter(base, "lowballer");
  const replies = [];
  // 40% of $149 is $59.60, so $40 is a lowball.
  for (let turn = 0; turn < 40; turn += 1) replies.push(await say("Could you do $40? It is last season and I am buying today."));
  expect(llm.calls).toHaveLength(0);
  expect(new Set(replies.map(reply => reply.card.option.total))).toEqual(new Set([14900]));
  expect(replies.every(reply => reply.card.round === 1 && reply.card.status === "live")).toBe(true);
  expect(replies[0].reply).toContain("$149");
  expect(replies[0].reply).toContain("Trail Runner 2");
  expect(JSON.stringify(replies)).not.toMatch(/"(?:cost|floor|profit|menu|ownerRank|facts|reasoning)":/);

  const event = await firstConsoleEvent(base, candidate => candidate.reasoning.startsWith("Lowball"));
  expect(event).toMatchObject({ kind: "decision", picked: "A", offer: 4000 });
  expect(event!.reasoning.startsWith("Lowball · countered at $149 · no LLM call")).toBe(true);
  expect(event).not.toHaveProperty("llm");

  const real = await say("Could you do $130? It is last season and I am buying today.");
  expect(real.card.round).toBe(1); // the forty lowballs consumed nothing
  expect(llm.calls).toHaveLength(1);
});

test("a cutoff of zero turns the lowball rule off", async () => {
  const llm = llmDouble();
  const base = await start(llm.fetchImpl);
  await setPolicy(base, { floorPct: 25, askOwner: false, settings: { lowballCutoffPct: 0 } });
  const say = await chatter(base, "cutoff-off");
  await say("Could you do $40? I am buying today.");
  const second = await say("Could you do $40? I am buying today.");
  expect(llm.calls).toHaveLength(2);
  expect(second.card.round).toBe(2);
});
