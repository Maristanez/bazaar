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

  it("remembers a request for spoken replies until the voice config arrives, then reads a line aloud", async () => {
    const { chat, requests, settle } = mountWidget({ routes: { "/api/voice/config": () => ({ enabled: true }) }, before: (window) => { window.MediaRecorder = function () {}; Object.defineProperty(window.navigator, "mediaDevices", { value: { getUserMedia: async () => ({}) }, configurable: true }); window.URL.createObjectURL = () => "blob:x"; window.URL.revokeObjectURL = () => {}; window.Audio = function () { return { addEventListener() {}, play: async () => {}, pause() {} }; }; } });
    const seen: boolean[] = [];
    chat.on("spoken-replies", (detail: { on: boolean }) => seen.push(detail.on));
    chat.setSpokenReplies(true);
    await settle();
    await settle();
    expect(seen).toEqual([true]);
    chat.say("Back at the Trail Runner 2?");
    await settle();
    expect(requests.some((request) => request.path === "/api/voice/speak" && request.body.text === "Back at the Trail Runner 2?")).toBe(true);
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
