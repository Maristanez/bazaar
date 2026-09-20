import { describe, expect, it } from "vitest";
import { mountWidget, type MountOptions } from "./widget.ts";

const PAGE_ONE = "https://trailhead.test/collections/all?shopper=demo";
const PAGE_TWO = "https://trailhead.test/products/trail-runner-2?shopper=demo";
const products = [{ title: "Trail Runner 2", handle: "trail-runner-2", url: "/products/trail-runner-2", price: "$140" }];

function offerCard(overrides: Record<string, unknown> = {}) {
  return {
    offerId: "offer-1",
    negotiationId: "neg-1",
    status: "live",
    round: 1,
    maxRounds: 4,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    line: "I can hold this for 15 minutes.",
    option: { kind: "single", total: 12600, listTotal: 14000, items: [{ title: "Trail Runner 2", qty: 1, listPrice: 14000 }] },
    ...overrides,
  };
}

const mount = (options: MountOptions = {}) => mountWidget({ features: ["persist"], products, ...options });

/** What a same-tab navigation hands the next page: this tab's sessionStorage. */
function carryStorage(from: any) {
  const snapshot: Record<string, string> = {};
  for (let index = 0; index < from.sessionStorage.length; index += 1) {
    const key = from.sessionStorage.key(index);
    snapshot[key] = from.sessionStorage.getItem(key);
  }
  return (window: any) => Object.entries(snapshot).forEach(([key, value]) => window.sessionStorage.setItem(key, value));
}

async function haggleOnPageOne(card = offerCard()) {
  const page = mount({ url: PAGE_ONE, chat: () => ({ reply: "Best I can do today.", card, negotiationId: "neg-1", products }) });
  page.document.addEventListener("click", (event) => event.preventDefault());
  page.chat.open();
  page.chat.send("Could you do $120?");
  await page.settle();
  await page.settle();
  return page;
}

function leaveByProductLink(page: Awaited<ReturnType<typeof haggleOnPageOne>>) {
  const link = page.document.querySelector(".ai-chat__offer-card a[href]") as HTMLAnchorElement;
  link.dispatchEvent(new page.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  page.window.dispatchEvent(new page.window.Event("pagehide"));
  return link;
}

const texts = (document: Document, selector: string) => Array.from(document.querySelectorAll(selector)).map((node) => node.textContent);

describe("V2 — the conversation survives navigation", () => {
  it("keeps the transcript, the live card and the open panel when the shopper follows a product link", async () => {
    const first = await haggleOnPageOne();
    const link = leaveByProductLink(first);
    expect(new URL(link.href).searchParams.get("shopper")).toBe("demo");

    const second = mount({
      url: PAGE_TWO,
      before: carryStorage(first.window),
      routes: { "/api/offers/offer-1": () => ({ card: offerCard({ line: "Still holding it for you." }) }) },
    });
    await second.settle();
    await second.settle();

    expect(texts(second.document, ".ai-chat__message--user")).toEqual(["Could you do $120?"]);
    expect(texts(second.document, ".ai-chat__message--bot")).toContain("Best I can do today.");
    expect(texts(second.document, ".ai-chat__message--bot")).not.toContain("Doing the maths");
    const card = second.document.querySelector(".ai-chat__offer-card");
    expect(card?.getAttribute("data-offer-status")).toBe("live");
    expect((card?.querySelector("[data-offer-actions] button") as HTMLButtonElement).disabled).toBe(false);
    expect(second.chat.isOpen()).toBe(true);
    const paths = second.requests.map((request) => request.path);
    expect(paths).not.toContain("/api/session/reset");
    expect(paths).not.toContain("/api/chat");
    expect(paths).not.toContain("/api/voice/speak");
    expect(second.window.sessionStorage.getItem("bazaar:carry")).toBeNull();
    expect(second.window.sessionStorage.getItem("bazaar:chat")).not.toBeNull();
  });

  it("starts empty and resets the visit when the ?shopper= URL is typed or pasted", async () => {
    const first = await haggleOnPageOne();
    first.window.dispatchEvent(new first.window.Event("pagehide"));
    expect(first.window.sessionStorage.getItem("bazaar:carry")).toBeNull();

    const second = mount({ url: PAGE_TWO, before: carryStorage(first.window) });
    await second.settle();

    expect(texts(second.document, ".ai-chat__message--user")).toEqual([]);
    expect(second.document.querySelector(".ai-chat__offer-card")).toBeNull();
    expect(second.chat.isOpen()).toBe(false);
    expect(second.requests.map((request) => request.path)).toContain("/api/session/reset");
    expect(second.window.sessionStorage.getItem("bazaar:chat")).toBeNull();
  });

  it("carries the conversation at pagehide while hands-free is on", async () => {
    const first = await haggleOnPageOne();
    first.window.sessionStorage.setItem("bazaar:handsfree", "1");
    first.window.dispatchEvent(new first.window.Event("pagehide"));
    expect(first.window.sessionStorage.getItem("bazaar:carry")).toBe("1");

    const second = mount({ url: PAGE_TWO, before: carryStorage(first.window), routes: { "/api/offers/offer-1": () => ({ card: offerCard() }) } });
    await second.settle();
    expect(texts(second.document, ".ai-chat__message--user")).toEqual(["Could you do $120?"]);
  });

  it("does not record the replay again, so a second hop shows each line once", async () => {
    const first = await haggleOnPageOne();
    leaveByProductLink(first);
    const routes = { "/api/offers/offer-1": () => ({ card: offerCard() }) };
    const second = mount({ url: PAGE_TWO, before: carryStorage(first.window), routes });
    await second.settle();
    await second.settle();
    second.window.sessionStorage.setItem("bazaar:handsfree", "1");
    second.window.dispatchEvent(new second.window.Event("pagehide"));

    const third = mount({ url: PAGE_ONE, before: carryStorage(second.window), routes });
    await third.settle();
    await third.settle();
    expect(texts(third.document, ".ai-chat__message--user")).toEqual(["Could you do $120?"]);
    expect(texts(third.document, ".ai-chat__message--bot").filter((text) => text === "Best I can do today.")).toHaveLength(1);
    expect(third.document.querySelectorAll(".ai-chat__offer-card")).toHaveLength(1);
  });

  it("shows an offer the server says has expired as expired, never as live", async () => {
    const first = await haggleOnPageOne();
    leaveByProductLink(first);
    const second = mount({
      url: PAGE_TWO,
      before: carryStorage(first.window),
      routes: { "/api/offers/offer-1": () => ({ card: offerCard({ status: "expired", expiresAt: new Date(Date.now() - 1000).toISOString() }) }) },
    });
    await second.settle();
    await second.settle();
    const card = second.document.querySelector(".ai-chat__offer-card");
    expect(card?.getAttribute("data-offer-status")).toBe("expired");
    expect((card?.querySelector("[data-offer-actions] button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("falls back to the stored card when the server cannot be reached, but never to one past its time", async () => {
    const unreachable = { "/api/offers/offer-1": () => { throw new Error("offline"); } };
    const fresh = await haggleOnPageOne();
    leaveByProductLink(fresh);
    const kept = mount({ url: PAGE_TWO, before: carryStorage(fresh.window), routes: unreachable });
    await kept.settle();
    await kept.settle();
    expect(kept.document.querySelector(".ai-chat__offer-card")?.getAttribute("data-offer-status")).toBe("live");

    const stale = await haggleOnPageOne(offerCard({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    leaveByProductLink(stale);
    const dropped = mount({ url: PAGE_TWO, before: carryStorage(stale.window), routes: unreachable });
    await dropped.settle();
    await dropped.settle();
    expect(texts(dropped.document, ".ai-chat__message--user")).toEqual(["Could you do $120?"]);
    expect(dropped.document.querySelector(".ai-chat__offer-card")).toBeNull();
  });

  it("names the restored negotiation on the next turn", async () => {
    const first = await haggleOnPageOne();
    leaveByProductLink(first);
    const second = mount({ url: PAGE_TWO, before: carryStorage(first.window), routes: { "/api/offers/offer-1": () => ({ card: offerCard() }) } });
    await second.settle();
    await second.settle();
    second.chat.send("Is that your best?");
    await second.settle();
    expect(second.requests.find((request) => request.path === "/api/chat")?.body.negotiationId).toBe("neg-1");
  });

  it("hides the panel's cold-open line once a real transcript comes back, so Jarvis does not re-invite a shopper mid-haggle", async () => {
    const first = await haggleOnPageOne();
    leaveByProductLink(first);
    const second = mount({ url: PAGE_TWO, before: carryStorage(first.window), routes: { "/api/offers/offer-1": () => ({ card: offerCard() }) } });
    await second.settle();
    await second.settle();
    const coldOpen = second.document.querySelector("[data-ai-chat-welcome]") as HTMLElement | null;
    expect(coldOpen?.hidden).toBe(true);
  });

  it("leaves the cold-open line showing on a clean visit with nothing to restore", async () => {
    const first = await haggleOnPageOne();
    first.window.dispatchEvent(new first.window.Event("pagehide"));
    const second = mount({ url: PAGE_TWO, before: carryStorage(first.window) });
    await second.settle();
    const coldOpen = second.document.querySelector("[data-ai-chat-welcome]") as HTMLElement | null;
    expect(coldOpen?.hidden ?? false).toBe(false);
  });

  it("keeps the chat working when storage throws", async () => {
    const page = mount({
      url: PAGE_ONE,
      before: (window) => {
        const blocked = () => { throw new Error("storage blocked"); };
        Object.defineProperty(window, "sessionStorage", { configurable: true, value: { getItem: blocked, setItem: blocked, removeItem: blocked } });
      },
      chat: () => ({ reply: "Name a price.", card: offerCard(), products }),
    });
    page.chat.open();
    page.chat.send("Hello");
    await page.settle();
    await page.settle();
    page.window.dispatchEvent(new page.window.Event("pagehide"));
    expect(texts(page.document, ".ai-chat__message--bot")).toContain("Name a price.");
    expect(page.document.querySelector(".ai-chat__offer-card")).not.toBeNull();
  });
});
