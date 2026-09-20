import { describe, expect, it } from "vitest";
import { mountWidget } from "./widget.ts";

describe("window.BazaarChat — the seam the juniper-* feature files use", () => {
  it("sends a turn and reports it, the reply and the chips", async () => {
    const seen: string[] = [];
    const { chat, requests, settle } = mountWidget({ chat: () => ({ reply: "Name a price." }) });
    for (const name of ["turn:start", "reply", "speak:end", "message"]) chat.on(name, () => seen.push(name));
    chat.extendPayload((payload: any) => { payload.page = { pageType: "product" }; });

    expect(chat.send("Could you do better?")).toBe(true);
    await settle();
    await settle();

    expect(requests.find((request) => request.path === "/api/chat")?.body.page).toEqual({ pageType: "product" });
    expect(seen).toContain("turn:start");
    expect(seen).toContain("reply");
    expect(seen).toContain("speak:end");
  });

  it("lets a feature replace the chips, and a chip provider that throws changes nothing", () => {
    const { chat, document } = mountWidget();
    chat.setChipProvider(() => [["I'm buying two"]]);
    chat.renderChips([["Is that your best?"]], "offer");
    expect(document.querySelector("[data-ai-chat-prompts]")?.textContent).toBe("I'm buying two");
    chat.setChipProvider(() => { throw new Error("broken feature"); });
    chat.renderChips([["Is that your best?"]], "offer");
    expect(document.querySelector("[data-ai-chat-prompts]")?.textContent).toBe("Is that your best?");
  });

  it("keeps the conversation when the carry flag is set, and resets a plain ?shopper= visit", async () => {
    const carried = mountWidget({ url: "https://trailhead.test/products/trail-runner-2?shopper=demo", before: (window) => window.sessionStorage.setItem("bazaar:carry", "1") });
    const clean = mountWidget({ url: "https://trailhead.test/products/trail-runner-2?shopper=demo" });
    await carried.settle();
    await clean.settle();
    expect(carried.requests.some((request) => request.path === "/api/session/reset")).toBe(false);
    expect(clean.requests.some((request) => request.path === "/api/session/reset")).toBe(true);
  });
});
