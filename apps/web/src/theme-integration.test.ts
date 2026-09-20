// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

const script = readFileSync("apps/storefront/assets/chat-demo.js", "utf8");

function product() {
  return {
    productId: "trail-runner-3",
    handle: "trail-runner-3",
    title: "Trail Runner 3",
    url: "/products/trail-runner-3",
    type: "Trail shoe",
    price: "$169",
    listPrice: 16900,
    selectedVariantId: "9",
    variants: [
      { id: "9", title: "9", price: "$169", available: true },
      { id: "10", title: "10", price: "$169", available: true },
    ],
  };
}

function card(status: string, negotiationId = "neg-1", total = 15000) {
  return {
    offerId: "offer-1",
    negotiationId,
    status,
    round: 1,
    maxRounds: 4,
    option: { id: "A", kind: "held", items: [{ title: "Trail Runner 3", variantId: "10", size: "10", qty: 1 }], listTotal: 16900, total },
    line: "I can hold $150 for 15 minutes.",
    badges: ["held 15:00"],
    trail: [{ label: "List", amount: 16900, by: "shop" }, { label: "Deal", amount: 15000, by: "shop" }],
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    ...(status === "pending_owner" ? { pendingUntil: new Date(Date.now() + 45000).toISOString() } : {}),
    disclosure: ["private", "Only this card is binding."],
  };
}

/** By default a returning shopper: the identity comes from storage, as it does for everyone but the demo shopper. */
function mount(fetchImpl: typeof fetch, url = "https://shop.example.test/products/trail-runner-3", beforeScript: (window: JSDOM["window"]) => void = window => window.localStorage.setItem("bazaar:shopper-id", "test")) {
  const item = product();
  const dom = new JSDOM(`<!doctype html><body>
    <div data-ai-chat data-ai-chat-endpoint="https://chat.example.test">
      <button data-ai-chat-toggle></button><button data-ai-chat-close></button>
      <section id="ai-chat-panel"><div data-ai-chat-messages><p data-ai-chat-welcome></p></div>
        <div data-ai-chat-mode></div>
        <form data-ai-chat-form><input data-ai-chat-input><button type="submit">Send</button></form>
      </section>
    </div>
    <select name="id"><option value="9">9</option><option value="10" selected>10</option></select>
    <input name="quantity" value="1">
    <script type="application/json" data-ai-chat-products>${JSON.stringify([item])}</script>
    <script type="application/json" data-ai-chat-current-product>${JSON.stringify(item)}</script>
  </body>`, { url, runScripts: "outside-only" });
  Object.defineProperty(dom.window, "fetch", { value: fetchImpl, configurable: true });
  beforeScript(dom.window);
  dom.window.eval(script);
  return dom;
}

async function submit(dom: JSDOM, text: string) {
  const input = dom.window.document.querySelector("[data-ai-chat-input]") as HTMLInputElement;
  input.value = text;
  dom.window.document.querySelector("[data-ai-chat-form]")!.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  for (let i = 0; i < 50 && input.disabled; i += 1) await Promise.resolve();
}

describe("Shopify theme chat integration", () => {
  it("opens a visit under an explicit ?shopper= identity by asking the server for a clean conversation", async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined }); return new Response(JSON.stringify({ ok: true })); }) as unknown as typeof fetch;
    mount(fetchImpl, "https://shop.example.test/products/trail-runner-3?shopper=demo");
    expect(calls[0]).toEqual({ url: "https://chat.example.test/api/session/reset", body: { shopperId: "demo" } });
    calls.length = 0;
    mount(fetchImpl);
    expect(calls.filter(call => call.url.endsWith("/api/session/reset"))).toEqual([]);
  });

  it("greets a remembered shopper with what the server recalled, and claims no memory when it recalled nothing", async () => {
    const welcomeAfter = async (greeting: string | null) => {
      const fetchImpl = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/api/greeting") ? { greeting, recalled: greeting !== null } : { ok: true }))) as unknown as typeof fetch;
      const dom = mount(fetchImpl, "https://shop.example.test/products/trail-runner-3?shopper=demo");
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      return dom.window.document.querySelector("[data-ai-chat-welcome]")!.textContent || "";
    };
    expect(await welcomeAfter("Welcome back — still a size 10 for that muddy 50k?")).toBe("Welcome back — still a size 10 for that muddy 50k?");
    // A greeting that lands after the shopper has already spoken must not rewrite the top of the conversation.
    let release: (value: Response) => void = () => {};
    const slow = vi.fn(async (url: string) => url.endsWith("/api/greeting") ? new Promise<Response>(resolve => { release = resolve; }) : new Response(JSON.stringify({ reply: "ok" }))) as unknown as typeof fetch;
    const late = mount(slow, "https://shop.example.test/products/trail-runner-3?shopper=demo");
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await submit(late, "hello");
    release(new Response(JSON.stringify({ greeting: "Welcome back — still a size 10?", recalled: true })));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(late.window.document.querySelector("[data-ai-chat-welcome]")?.textContent || "").not.toContain("size 10");

    const plain = await welcomeAfter(null);
    expect(plain).toContain("Trail Runner 3");
    expect(plain).not.toMatch(/welcome back|size 10/i);
  });

  it("never falls back to an identity every storage-blocked browser would share", async () => {
    const ids: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => { ids.push(JSON.parse(String(init?.body)).shopperId); return new Response(JSON.stringify({ reply: "ok" })); }) as unknown as typeof fetch;
    const blockStorage = (window: JSDOM["window"]) => Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); }, configurable: true });
    for (let visit = 0; visit < 2; visit += 1) await submit(mount(fetchImpl, "https://shop.example.test/products/trail-runner-3", blockStorage), "hello");
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe("shopper-session");
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("sends the selected variant and carries the server negotiation across follow-ups", async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    const item = product();
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      const response = calls.length === 1
        ? { reply: "I can hold $150.", card: card("live"), products: [item] }
        : { reply: "Still the Trail Runner 3.", negotiationId: "neg-1", products: [item] };
      return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
  const dom = mount(fetchImpl);

    await submit(dom, "Could you do $150?");
    await submit(dom, "What about that size?");

    expect(calls[0]?.body?.product).toMatchObject({ selectedVariantId: "10" });
    expect(dom.window.document.querySelector("[data-offer-items]")?.textContent).toContain("Trail Runner 3 · size 10 · qty 1");
    expect(calls[1]?.body?.negotiationId).toBe("neg-1");
    expect(calls[1]?.body?.product).toMatchObject({ selectedVariantId: "10" });

    const select = dom.window.document.querySelector('select[name="id"]') as HTMLSelectElement;
    select.value = "9";
    select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await submit(dom, "Could you do $145?");
    expect(calls[2]?.body?.negotiationId).toBeUndefined();
    expect(calls[2]?.body?.product).toMatchObject({ selectedVariantId: "9" });
    expect(calls[2]?.body?.variantSelectionChanged).toBe(true);
  });

  it("shows an unavailable retry message without fictional product or offer cards", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const dom = mount(fetchImpl);

    await submit(dom, "Could you do $120?");

    expect(dom.window.document.querySelector("[data-ai-chat-messages]")?.textContent).toContain("temporarily unavailable");
    expect(dom.window.document.querySelector(".ai-chat__product-card")).toBeNull();
    expect(dom.window.document.querySelector(".ai-chat__offer-card")).toBeNull();
  });

  it("captures a changed product quantity and carries the negotiation across a page-default reset", async () => {
    const calls: { body?: Record<string, unknown> }[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const response = calls.length === 1
        ? { reply: "I can hold two.", card: card("live", "neg-quantity"), products: [product()] }
        : { reply: "Still two pairs.", negotiationId: "neg-quantity", products: [product()] };
      return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    const dom = mount(fetchImpl);
    const quantity = dom.window.document.querySelector('input[name="quantity"]') as HTMLInputElement;
    quantity.value = "2";
    quantity.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    await submit(dom, "Could you do $240 for 2 pairs?");

    expect(calls[0]?.body).toMatchObject({ quantity: 2, quantitySelectionChanged: true });
    expect(calls[0]?.body?.product).toMatchObject({ quantity: 2 });

    quantity.value = "1";
    await submit(dom, "Could you do $230?");
    expect(calls[1]?.body).toMatchObject({ negotiationId: "neg-quantity", quantity: 1 });
    expect(calls[1]?.body?.quantitySelectionChanged).toBeUndefined();
  });

  it("keeps independently negotiated product offer cards usable", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const first = !body?.negotiationId;
      const next = first ? { ...card("live", "neg-a"), offerId: "offer-a" } : { ...card("live", "neg-b"), offerId: "offer-b" };
      return new Response(JSON.stringify({ reply: "Here is an offer.", card: next, products: [product()] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;
    const dom = mount(fetchImpl);

    await submit(dom, "Could you do $150?");
    await submit(dom, "Could you do $145?");

    const cards = [...dom.window.document.querySelectorAll(".ai-chat__offer-card")];
    expect(cards).toHaveLength(2);
    expect(cards.map(article => article.getAttribute("data-offer-status"))).toEqual(["live", "live"]);
    expect(cards.every(article => article.querySelector("[data-offer-actions] button")?.textContent?.startsWith("Deal at $"))).toBe(true);
  });

  it("polls pending owner cards and renders the final live totals", async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      let acceptBody: Record<string, unknown> | undefined;
      const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (init?.method === "POST" && url.endsWith("/api/accept")) {
          acceptBody = JSON.parse(String(init.body));
          return new Response(JSON.stringify({ reply: "Opening checkout.", settlement: { checkoutUrl: "/checkout/final-142" } }), { status: 200 });
        }
        const response = calls.length === 1
          ? { reply: "Let me check with the owner.", card: card("pending_owner", "neg-1", 9000), products: [product()] }
          : { card: { ...card("live", "neg-1", 14200), expiresAt: new Date(Date.now() + 14 * 60 * 1000).toISOString(), line: "My best offer is $142.", badges: ["final offer"] } };
        return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
      }) as unknown as typeof fetch;
      const dom = mount(fetchImpl);
      await submit(dom, "Could you do $150?");
      await vi.advanceTimersByTimeAsync(0);
      const button = dom.window.document.querySelector("[data-offer-actions] button") as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe("Waiting for owner");

      await vi.advanceTimersByTimeAsync(2000);
      expect(calls[1]).toContain("/api/offers/offer-1?");
      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe("Deal at $142");
      expect(button.closest("article")?.getAttribute("data-offer-status")).toBe("live");
      expect(dom.window.document.querySelector("[data-offer-price] strong")?.textContent).toBe("$142");
      expect(dom.window.document.querySelector("[data-offer-line]")?.textContent).toBe("My best offer is $142.");
      expect(dom.window.document.querySelector("[data-offer-badges]")?.textContent).toContain("final offer");
      expect(dom.window.document.querySelector("[data-offer-countdown]")?.textContent).toMatch(/^14:\d\d$/);

      button.click();
      await Promise.resolve();
      expect(acceptBody).toMatchObject({ offerId: "offer-1", negotiationId: "neg-1", shopperId: "test" });
    } finally {
      vi.useRealTimers();
    }
  });
});
