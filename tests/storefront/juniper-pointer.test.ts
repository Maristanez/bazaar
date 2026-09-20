import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountWidget, type ChatReply } from "./widget.ts";

const RING = "juniper-pointer__ring";
const COLLECTION = "https://trailhead.test/collections/all";

const products = [
  { productId: "1", title: "Trail Runner 2", handle: "trail-runner-2", url: "/products/trail-runner-2" },
  { productId: "2", title: "Trail Runner", handle: "trail-runner", url: "/products/trail-runner" },
  { productId: "3", title: "Summit Gaiters (Pair) [v2.0]", handle: "summit-gaiters", url: "/products/summit-gaiters" },
  { productId: "4", title: "Ridge Vest", handle: "ridge-vest", url: "/products/ridge-vest" },
];

// Mirrors snippets/product-card.liquid inside the sections/collection.liquid grid.
function cardMarkup(product: { title: string; handle: string }) {
  return `<div class="collection-product"><article class="product-card">
    <a class="product-card__image" href="/collections/all/products/${product.handle}?variant=1" aria-label="View ${product.title}"><img alt=""></a>
    <div class="product-card__details"><h3><a href="/products/${product.handle}">${product.title}</a></h3><p class="product-card__price">$1</p></div>
  </article></div>`;
}

function mountPage(onPage: typeof products, reply: () => ChatReply, extra: Parameters<typeof mountWidget>[0] = {}) {
  const mounted = mountWidget({
    features: ["pointer"],
    url: COLLECTION,
    products,
    chat: reply,
    ...extra,
    before: (window) => {
      // The feature's timers run on the vitest fake clock.
      window.setTimeout = (fn: () => void, ms?: number) => setTimeout(fn, ms);
      window.clearTimeout = (id: any) => clearTimeout(id);
      extra.before?.(window);
    },
  });
  const grid = mounted.document.createElement("div");
  grid.className = "collection-products";
  grid.innerHTML = onPage.map(cardMarkup).join("");
  mounted.document.body.insertBefore(grid, mounted.document.body.firstChild);
  const cards: Record<string, HTMLElement & { scrollIntoView: ReturnType<typeof vi.fn> }> = {};
  onPage.forEach((product, index) => {
    const card = grid.querySelectorAll(".product-card")[index] as any;
    card.scrollIntoView = vi.fn();
    cards[product.handle] = card;
  });
  const say = async (text: string) => {
    mounted.chat.send(text);
    await vi.advanceTimersByTimeAsync(50);
  };
  return { ...mounted, cards, say };
}

describe("juniper-pointer — Juniper points at the page", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("scrolls a suggested product into view, rings its card, and lifts the ring after the timeout", async () => {
    const { cards, say } = mountPage(products, () => ({ reply: "The ridge vest carries water on long days." }));
    await say("what carries water?");

    const card = cards["ridge-vest"];
    expect(card.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(card.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(card.classList.contains(RING)).toBe(true);

    await vi.advanceTimersByTimeAsync(2600);
    expect(card.classList.contains(RING)).toBe(false);
    expect(card.className.trim()).toBe("product-card");
  });

  it("does nothing on a page that does not show the product", async () => {
    const { cards, say, document } = mountPage([products[0]], () => ({ reply: "Try the Ridge Vest." }));
    await say("what carries water?");
    expect(cards["trail-runner-2"].scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector("." + RING)).toBeNull();
  });

  it("never rings the product whose page this is, and never a link inside the chat", async () => {
    const { cards, say, document, chat } = mountPage(products, () => ({ reply: "The Trail Runner 2 is a fine pick. See /products/trail-runner-2" }), {
      url: "https://trailhead.test/products/trail-runner-2",
      currentProduct: products[0],
    });
    const link = document.createElement("a");
    link.href = "/products/ridge-vest";
    chat.elements.messages.appendChild(link);
    await say("is it good?");
    expect(cards["trail-runner-2"].scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector("." + RING)).toBeNull();
    expect(chat.pointer.point("trail-runner-2")).toBe(false);
  });

  it("matches the whole title: Trail Runner 2 does not ring Trail Runner", async () => {
    const { cards, say } = mountPage(products, () => ({ reply: "Last season's TRAIL RUNNER 2 has the same fit." }));
    await say("anything cheaper?");
    expect(cards["trail-runner-2"].classList.contains(RING)).toBe(true);
    expect(cards["trail-runner"].classList.contains(RING)).toBe(false);
    expect(cards["trail-runner"].scrollIntoView).not.toHaveBeenCalled();
  });

  it("moves the ring when a second reply names another product", async () => {
    const replies = ["Try the Ridge Vest.", "Or the Trail Runner, plain and light."];
    const { cards, say, document } = mountPage(products, () => ({ reply: replies.shift() || "Noted." }));
    await say("one");
    expect(cards["ridge-vest"].classList.contains(RING)).toBe(true);
    await say("two");
    expect(cards["ridge-vest"].classList.contains(RING)).toBe(false);
    expect(cards["trail-runner"].classList.contains(RING)).toBe(true);
    expect(document.querySelectorAll("." + RING).length).toBe(1);

    await vi.advanceTimersByTimeAsync(2600);
    expect(document.querySelectorAll("." + RING).length).toBe(0);
  });

  it("rings the product on the offer card even when the line does not name it", async () => {
    const card = { negotiationId: "n1", status: "live", round: 1, option: { id: "A", items: [{ title: "Ridge Vest", quantity: 1 }], total: 100, listTotal: 120 }, line: "Held for 15 minutes." };
    const { cards, say } = mountPage(products, () => ({ reply: "Here is what I can do.", card, negotiationId: "n1" }));
    await say("best price on the vest?");
    expect(cards["ridge-vest"].classList.contains(RING)).toBe(true);
    expect(cards["ridge-vest"].scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not throw on titles with regex-special characters", async () => {
    const { cards, say, chat } = mountPage(products, () => ({ reply: "Add the summit gaiters (pair) [v2.0] and we can talk. (.*)+ [" }));
    await say("bundle?");
    expect(cards["summit-gaiters"].classList.contains(RING)).toBe(true);
    expect(() => chat.pointer.point("a[b](c)*\"'\\")).not.toThrow();
    expect(chat.pointer.point("a[b](c)*\"'\\")).toBe(false);
  });

  it("uses an instant scroll under reduced motion, and keeps focus where it was", async () => {
    const { cards, say, chat, document } = mountPage(products, () => ({ reply: "Try the Ridge Vest." }), {
      before: (window) => { window.matchMedia = (query: string) => ({ matches: /reduced-motion/.test(query), addEventListener() {}, removeEventListener() {} }); },
    });
    chat.elements.input.focus();
    await say("what carries water?");
    expect(cards["ridge-vest"].scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
    expect(document.activeElement).toBe(chat.elements.input);
  });

  it("on a phone with the chat open it rings without scrolling, then scrolls once the chat closes", async () => {
    const { cards, say, chat } = mountPage(products, () => ({ reply: "Try the Ridge Vest." }), {
      before: (window) => { window.matchMedia = (query: string) => ({ matches: /max-width:\s*480px/.test(query), addEventListener() {}, removeEventListener() {} }); },
    });
    chat.open();
    await say("what carries water?");
    const card = cards["ridge-vest"];
    expect(card.classList.contains(RING)).toBe(true);
    expect(card.scrollIntoView).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(card.classList.contains(RING)).toBe(true);

    chat.close();
    expect(card.scrollIntoView).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2600);
    expect(card.classList.contains(RING)).toBe(false);
  });

  it("does not scroll the page out from under a shopper who is mid-sentence", async () => {
    const { cards, chat } = mountPage(products, () => ({ reply: "Try the Ridge Vest." }));
    // The chat locks its input during a turn, so this is the integrator's point() (a voice turn, a nudge).
    chat.elements.input.focus();
    chat.elements.input.value = "and what about";
    expect(chat.pointer.point("ridge-vest")).toBe(true);
    expect(cards["ridge-vest"].classList.contains(RING)).toBe(true);
    expect(cards["ridge-vest"].scrollIntoView).not.toHaveBeenCalled();
  });
});
