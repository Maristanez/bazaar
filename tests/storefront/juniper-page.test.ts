import { describe, expect, it } from "vitest";
import { mountWidget, type MountOptions } from "./widget.ts";

const collectionBlob = {
  pageType: "collection",
  template: "collection",
  path: "/collections/socks",
  collection: { handle: "socks", title: "Socks", productHandles: ["summit-crew-sock", "ridge-ankle-sock"] },
  cartItemCount: 2,
};
// What Shopify's /cart.js answers with, prices and all; none of the money may travel on.
const cartJs = {
  item_count: 2,
  total_price: 3600,
  items: [{ handle: "summit-crew-sock", product_title: "Summit Crew Sock", title: "Summit Crew Sock - M", variant_title: "M", quantity: 2, price: 1800, final_line_price: 3600 }],
};

function mount(options: MountOptions = {}) {
  return mountWidget({ features: ["page"], url: "https://trailhead.test/collections/socks", page: collectionBlob, ...options, routes: { "/cart.js": () => cartJs, ...(options.routes || {}) } });
}
async function settled(mounted: { settle: () => Promise<unknown> }, turns = 6) { for (let turn = 0; turn < turns; turn += 1) await mounted.settle(); }
const voiceState = (window: any, on: boolean) => window.document.dispatchEvent(new window.CustomEvent("bazaar-voice:state", { detail: { on, state: on ? "listening" : "off" } }));
const greetings = (requests: { path: string }[]) => requests.filter((request) => request.path === "/api/greeting");

describe("juniper-page — the shopkeeper knows where the shopper is", () => {
  it("on the collection page with socks in the cart, the page sent with a turn names both", async () => {
    const mounted = mount();
    mounted.chat.open();
    await settled(mounted);
    mounted.chat.send("What about this one?");
    await settled(mounted);

    const page = mounted.requests.find((request) => request.path === "/api/chat")?.body.page;
    expect(page.pageType).toBe("collection");
    expect(page.collection).toEqual(collectionBlob.collection);
    expect(page.cart).toEqual({ itemCount: 2, items: [{ handle: "summit-crew-sock", title: "Summit Crew Sock", variantTitle: "M", quantity: 2 }] });
    expect(JSON.stringify(page)).not.toMatch(/price|3600|1800/);
  });

  it("publishes the page on BazaarChat and announces it once", async () => {
    let announced: any = null;
    const mounted = mount({ before: (window) => window.document.addEventListener("bazaar-page:ready", (event: any) => { announced = event.detail; }) });
    expect(mounted.chat.page.pageType).toBe("collection");
    expect(announced).toBe(mounted.chat.page);
    expect(mounted.requests.some((request) => request.path === "/cart.js")).toBe(false);
  });

  it.each([
    ["https://trailhead.test/products/trail-runner-2", "product"],
    ["https://trailhead.test/collections/socks", "collection"],
    ["https://trailhead.test/cart", "cart"],
    ["https://trailhead.test/search?q=socks", "search"],
    ["https://trailhead.test/", "index"],
  ])("with no blob, %s still yields a page type", async (url, pageType) => {
    const mounted = mount({ url, page: null });
    mounted.chat.send("Hello");
    await settled(mounted);
    const page = mounted.requests.find((request) => request.path === "/api/chat")?.body.page;
    expect(page.pageType).toBe(pageType);
    expect(page.path).toBe(new URL(url).pathname);
  });

  it("falls back the same way when the blob does not parse", () => {
    const mounted = mount({ page: null, before: (window) => window.document.body.insertAdjacentHTML("beforeend", '<script type="application/json" data-ai-chat-page>{ not json</script>') });
    expect(mounted.chat.page.pageType).toBe("collection");
  });

  it("follows the variant and quantity the shopper picks, without a price", async () => {
    const mounted = mount({
      url: "https://trailhead.test/products/trail-runner-2",
      page: { pageType: "product", template: "product", path: "/products/trail-runner-2", product: { id: 1, handle: "trail-runner-2", title: "Trail Runner 2", type: "Shoes", available: true } },
      currentProduct: { handle: "trail-runner-2", title: "Trail Runner 2", variants: [{ id: 11, title: "9", price: "$140" }, { id: 12, title: "10", price: "$140" }] },
      before: (window) => window.document.body.insertAdjacentHTML("beforeend", '<form><select name="id"><option value="11">9 - $140</option><option value="12">10 - $140</option></select><input type="number" name="quantity" value="1"></form>'),
    });
    const select = mounted.document.querySelector('select[name="id"]') as HTMLSelectElement;
    const quantity = mounted.document.querySelector('input[name="quantity"]') as HTMLInputElement;
    expect(mounted.chat.page.selection).toEqual({ variantId: "11", variantTitle: "9", quantity: 1 });
    select.value = "12";
    select.dispatchEvent(new mounted.window.Event("change", { bubbles: true }));
    quantity.value = "2";
    quantity.dispatchEvent(new mounted.window.Event("change", { bubbles: true }));
    expect(mounted.chat.page.selection).toEqual({ variantId: "12", variantTitle: "10", quantity: 2 });
    expect(JSON.stringify(mounted.chat.page)).not.toContain("$");
  });

  it("a cart that cannot be read leaves the turn untouched", async () => {
    const mounted = mount({ routes: { "/cart.js": () => { throw new Error("offline"); } } });
    mounted.chat.open();
    await settled(mounted);
    expect(mounted.chat.send("Hello")).toBe(true);
    await settled(mounted);
    const page = mounted.requests.find((request) => request.path === "/api/chat")?.body.page;
    expect(page.pageType).toBe("collection");
    expect(page.cart).toBeUndefined();
  });
});

describe("juniper-page — the page-aware opening in hands-free", () => {
  const routes = { "/api/greeting": () => ({ greeting: "Back among the socks, I see.", recalled: true }) };

  it("is not asked for while hands-free is off", async () => {
    const mounted = mount({ routes });
    mounted.chat.open();
    await settled(mounted);
    expect(greetings(mounted.requests)).toHaveLength(0);
  });

  it("landing on a page with hands-free on asks once, with the page and the cart, and shows what came back", async () => {
    const mounted = mount({ routes, before: (window) => window.sessionStorage.setItem("bazaar:handsfree", "1") });
    await settled(mounted);
    voiceState(mounted.window, true);
    voiceState(mounted.window, false);
    voiceState(mounted.window, true);
    await settled(mounted);

    const asked = greetings(mounted.requests);
    expect(asked).toHaveLength(1);
    expect((asked[0] as any).body.shopperId).toBe(mounted.chat.state().shopperId);
    expect((asked[0] as any).body.page.collection.handle).toBe("socks");
    expect((asked[0] as any).body.page.cart.items[0].handle).toBe("summit-crew-sock");
    const bubbles = Array.from(mounted.document.querySelectorAll(".ai-chat__message--bot")).map((node) => node.textContent);
    expect(bubbles.filter((text) => text === "Back among the socks, I see.")).toHaveLength(1);
  });

  it("turning voice on asks for it too", async () => {
    const mounted = mount({ routes });
    voiceState(mounted.window, true);
    await settled(mounted);
    expect(greetings(mounted.requests)).toHaveLength(1);
  });

  it("is never asked for once the shopper has spoken on this page", async () => {
    const mounted = mount({ routes });
    mounted.chat.send("Hello");
    await settled(mounted);
    voiceState(mounted.window, true);
    await settled(mounted);
    expect(greetings(mounted.requests)).toHaveLength(0);
  });

  // juniper-persist.js (V2) restores a carried conversation before this line ever shows: replaying the shopper's own
  // past words through addMessage, or putting a live card back on screen. Either one means this is not a cold open.
  it("a carried conversation with the shopper's own restored words is not asked for, or is asked but not shown", async () => {
    const mounted = mount({ routes, before: (window) => window.sessionStorage.setItem("bazaar:handsfree", "1") });
    // Simulates V2's restore(), which replays saved lines through addMessage before this feature's opening can land.
    mounted.chat.addMessage("Would you do $120 on the trail runners?", "user");
    await settled(mounted);
    expect(mounted.document.body.textContent).not.toContain("Back among the socks");
  });

  it("a carried conversation with a live offer card already showing is not shown a fresh opening", async () => {
    const mounted = mount({ routes, before: (window) => window.sessionStorage.setItem("bazaar:handsfree", "1") });
    // Simulates V2's restoreCard(), which puts the card back on screen without going through addMessage.
    mounted.chat.addOfferCard({
      negotiationId: "n1", offerId: "o1", status: "live", round: 2, maxRounds: 4, line: "Here is my offer.", mood: "tempted", badges: [], trail: [],
      option: { id: "A", kind: "final", items: [{ variantId: "v1", title: "Trail Runner 2", qty: 1 }], listTotal: 15000, total: 13500 },
      expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), disclosure: ["Deal agent.", "Only this card is binding."],
    });
    await settled(mounted);
    expect(mounted.document.body.textContent).not.toContain("Back among the socks");
  });

  // The recogniser reports a caption well before a turn is committed (it waits out ~1.2s of quiet first). If the
  // opening only watched for "turn:start" it could still land — and be read aloud — over a shopper already talking.
  it("a caption heard before the greeting lands cancels it, even with no committed turn yet", async () => {
    let release: (value: unknown) => void = () => {};
    const mounted = mount({ routes: { "/api/greeting": () => new Promise((resolve) => { release = resolve; }) } });
    voiceState(mounted.window, true);
    await settled(mounted);
    mounted.window.document.dispatchEvent(new mounted.window.CustomEvent("bazaar-voice:caption", { detail: { text: "hi", final: false } }));
    release({ ok: true, json: async () => ({ greeting: "Back among the socks, I see." }) });
    await settled(mounted);
    expect(mounted.document.body.textContent).not.toContain("Back among the socks");
  });

  // A silent bubble is no opening at all in hands-free: the shopper is listening, not reading. The seam's say()
  // (addMessage + speakReply) is what makes the line audible.
  it("with spoken replies on, the page-aware opening is read aloud, not just shown", async () => {
    const enableVoice = (window: any) => {
      window.MediaRecorder = function () {};
      Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => ({}) }, configurable: true });
      window.URL.createObjectURL = () => "blob:x";
      window.URL.revokeObjectURL = () => {};
      window.Audio = function () { return { addEventListener() {}, play: async () => {}, pause() {} }; };
    };
    const mounted = mount({
      routes: { ...routes, "/api/voice/config": () => ({ enabled: true }) },
      before: (window) => { enableVoice(window); window.sessionStorage.setItem("bazaar:handsfree", "1"); },
    });
    mounted.chat.setSpokenReplies(true);
    await settled(mounted);
    expect(mounted.requests.some((request) => request.path === "/api/voice/speak" && request.body.text === "Back among the socks, I see.")).toBe(true);
  });

  it("an opening that arrives after the shopper spoke is dropped, and an empty one shows nothing", async () => {
    let release: (value: unknown) => void = () => {};
    const late = mount({ routes });
    const realFetch = late.window.fetch;
    late.window.fetch = (input: string, init: unknown) => String(input).indexOf("/api/greeting") === -1 ? realFetch(input, init) : new Promise((resolve) => { release = resolve; });
    voiceState(late.window, true);
    await settled(late);
    late.chat.send("Hello");
    await settled(late);
    release({ ok: true, json: async () => ({ greeting: "Back among the socks, I see." }) });
    await settled(late);
    expect(late.document.body.textContent).not.toContain("Back among the socks");

    const empty = mount({ routes: { "/api/greeting": () => ({ greeting: null, recalled: false }) } });
    const before = empty.document.querySelectorAll(".ai-chat__message--bot").length;
    voiceState(empty.window, true);
    await settled(empty);
    expect(empty.document.querySelectorAll(".ai-chat__message--bot").length).toBe(before);
  });
});
