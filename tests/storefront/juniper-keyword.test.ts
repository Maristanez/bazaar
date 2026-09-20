import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountWidget } from "./widget.ts";

// A stand-in for Chrome's SpeechRecognition. `running` is the truth the ear is checked against.
// refuseFirst: only the first N recognisers refuse; later ones start normally.
type FakeOptions = { failWith?: string; endAtOnce?: boolean; throwOnStart?: boolean; refuseFirst?: number };

function fakeRecognition(window: any, options: FakeOptions = {}) {
  const made: any[] = [];
  class FakeRecognition {
    continuous = false;
    interimResults = false;
    lang = "";
    running = false;
    onresult: any = null;
    onend: any = null;
    onerror: any = null;
    constructor() { made.push(this); }
    start() {
      const refusing = made.length <= (options.refuseFirst ?? Infinity);
      if (options.throwOnStart && refusing) throw new Error("start refused");
      if (options.failWith && refusing) {
        this.onerror?.({ error: options.failWith });
        this.onend?.({});
        return;
      }
      this.running = true;
      if (options.endAtOnce) this.end();
    }
    stop() { this.end(); }
    abort() { this.end(); }
    end() {
      if (!this.running) return;
      this.running = false;
      this.onend?.({});
    }
    hear(transcript: string, isFinal = false) {
      const result: any = [{ transcript, confidence: 0.9 }];
      result.isFinal = isFinal;
      this.onresult?.({ resultIndex: 0, results: [result] });
    }
  }
  window.SpeechRecognition = FakeRecognition;
  return { made, running: () => made.filter((recognition) => recognition.running) };
}

type Setup = { flag?: boolean; autoListen?: string; handsfree?: boolean; recognition?: FakeOptions; unsupported?: boolean };

const EAR_LABEL = "Listening for 'Hey Jarvis' — Chrome's speech service hears the audio";

function mount(setup: Setup = {}) {
  let fake = { made: [] as any[], running: () => [] as any[] };
  const order: string[] = [];
  const start = vi.fn(() => { order.push("handsfree.start"); });
  const mounted = mountWidget({
    features: ["keyword"],
    before: (window) => {
      if (!setup.unsupported) fake = fakeRecognition(window, setup.recognition);
      if (setup.flag !== undefined || setup.autoListen !== undefined) {
        window.BazaarChatFlags = {};
        if (setup.flag !== undefined) window.BazaarChatFlags.keyword = setup.flag;
        if (setup.autoListen !== undefined) window.BazaarChatFlags.autoListen = setup.autoListen;
      }
      window.document.addEventListener("bazaar-chat:ready", () => {
        window.BazaarChat.on("open", () => order.push("open"));
        if (setup.handsfree !== false) window.BazaarChat.handsfree = { start, stop: vi.fn(), isOn: () => false };
      });
    },
  });
  const ears = () => mounted.document.querySelectorAll(".juniper-keyword__ear").length;
  const voice = (on: boolean) =>
    mounted.document.dispatchEvent(new mounted.window.CustomEvent("bazaar-voice:state", { detail: { on, state: on ? "listening" : "off" } }));
  return { ...mounted, fake, start, order, ears, voice };
}

describe("V8 the Jarvis keyword", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("is armed on every page load, with no flag, no click and no control in the chat", () => {
    const { fake, ears, document, window } = mount();
    vi.advanceTimersByTime(50);
    expect(fake.running()).toHaveLength(1);
    expect(ears()).toBeGreaterThan(0);
    expect(fake.made[0]).toMatchObject({ continuous: true, interimResults: true, lang: "en-US" });
    expect(document.querySelector(".juniper-keyword__control, [data-juniper-keyword-toggle], .juniper-keyword__note")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Turn on Hey Jarvis|Turn off/);
    expect(window.localStorage.getItem("bazaar:keyword")).toBeNull();
    expect(window.sessionStorage.getItem("bazaar:keyword:off")).toBeNull();
  });

  it("opens the agent when the shopper says Jarvis: the panel first, then hands-free, its own recogniser stopped before either", () => {
    const { fake, start, order, ears, chat } = mount();
    vi.advanceTimersByTime(50);
    expect(chat.isOpen()).toBe(false);

    let runningAtOpen = -1;
    chat.on("open", () => { runningAtOpen = fake.running().length; });
    fake.made[0].hear("hey jarvis could you do one twenty");
    vi.advanceTimersByTime(400);

    expect(order).toEqual(["open", "handsfree.start"]);
    expect(chat.isOpen()).toBe(true);
    expect(runningAtOpen).toBe(0);
    expect(start.mock.calls[0]).toEqual([]);
    expect(fake.running()).toHaveLength(0);
    expect(ears()).toBe(0);
  });

  it("just opens the chat when hands-free is not there", () => {
    const { fake, chat, order } = mount({ handsfree: false });
    vi.advanceTimersByTime(50);
    fake.made[0].hear("Jarvis");
    vi.advanceTimersByTime(400);
    expect(chat.isOpen()).toBe(true);
    expect(order).toEqual(["open"]);
  });

  it("shows the ear exactly while a recogniser runs, carries the disclosure, and says so on the document", () => {
    const { fake, ears, voice, document } = mount();
    const armed: boolean[] = [];
    document.addEventListener("bazaar-keyword:state", (event: any) => armed.push(event.detail.armed));
    expect(ears()).toBe(0);
    vi.advanceTimersByTime(50);
    expect(fake.running()).toHaveLength(1);
    const ear = document.querySelector("[data-ai-chat-toggle] .juniper-keyword__ear");
    expect(ear?.getAttribute("aria-label")).toBe(EAR_LABEL);
    expect(ear?.getAttribute("title")).toBe(EAR_LABEL);

    voice(true);
    expect([fake.running().length, ears()]).toEqual([0, 0]);
    voice(false);
    vi.advanceTimersByTime(600);
    expect(fake.running()).toHaveLength(1);
    expect(ears()).toBeGreaterThan(0);
    expect(armed).toEqual([true, false, true]);
  });

  it("keeps listening in an open panel, with an ear inside the panel where the launcher cannot be seen", () => {
    const { fake, chat } = mount();
    vi.advanceTimersByTime(50);
    chat.open();
    vi.advanceTimersByTime(600);
    expect(fake.running()).toHaveLength(1);
    expect(chat.elements.panel.querySelector(".juniper-keyword__ear")?.getAttribute("aria-label")).toBe(EAR_LABEL);
    chat.close();
    vi.advanceTimersByTime(600);
    expect(fake.running()).toHaveLength(1);
  });

  it("steps aside while a turn is in flight, and comes back after the reply", async () => {
    const { fake, chat, ears, settle } = mount();
    vi.advanceTimersByTime(50);
    chat.open();
    expect(chat.send("Could you do better?")).toBe(true);
    expect([fake.running().length, ears()]).toEqual([0, 0]);
    vi.useRealTimers();
    await settle();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(fake.running()).toHaveLength(1);
  });

  it("puts an ear on the hands-free pill as well when there is one", () => {
    const { document, chat } = mount();
    const pill = document.createElement("div");
    pill.setAttribute("data-juniper-pill", "");
    chat.elements.widget.appendChild(pill);
    vi.advanceTimersByTime(50);
    expect(pill.querySelector(".juniper-keyword__ear")).not.toBeNull();
  });

  for (const setup of [{ flag: false }, { autoListen: "always" }, { flag: false, autoListen: "keyword" }] as Setup[]) {
    it(`never constructs a recogniser with ${JSON.stringify(setup)}`, () => {
      const { fake, document, chat } = mount(setup);
      vi.advanceTimersByTime(10000);
      chat.open();
      chat.close();
      document.body.click();
      vi.advanceTimersByTime(10000);
      expect(fake.made).toHaveLength(0);
      expect(document.querySelector("[class^='juniper-keyword__']")).toBeNull();
    });
  }

  it("injects nothing where the browser has no speech recognition", () => {
    const { document } = mount({ unsupported: true });
    vi.advanceTimersByTime(1000);
    document.body.click();
    expect(document.querySelector("[class^='juniper-keyword__']")).toBeNull();
  });

  it("matches the keywords as whole words and lets ordinary words pass", () => {
    const { chat } = mount();
    for (const heard of ["jarvis", "Jarvis", "hey jarvis", "Hi Jarvis!", "jarvus", "jervis", "javis", "jarves", "ok so, JARVIS, could you", "hey  jarvis"]) {
      expect(chat.keyword.matches(heard), heard).toBe(true);
    }
    for (const heard of ["service", "travis", "jar", "harvest", "jarvisson", "customer service please", "", "hey"]) {
      expect(chat.keyword.matches(heard), heard).toBe(false);
    }
    expect(chat.keyword.KEYWORDS).toEqual(expect.arrayContaining(["jarvis", "hey jarvis", "hi jarvis", "jarvus", "jervis", "javis", "jarves"]));
    expect(chat.keyword.KEYWORDS).not.toEqual(expect.arrayContaining(["service"]));
    expect(chat.keyword.KEYWORDS).not.toEqual(expect.arrayContaining(["travis"]));
  });

  it("gives the microphone to hands-free and takes it back half a second after", () => {
    const { fake, voice, ears } = mount();
    vi.advanceTimersByTime(50);
    voice(true);
    expect([fake.running().length, ears()]).toEqual([0, 0]);
    vi.advanceTimersByTime(5000);
    expect(fake.running()).toHaveLength(0);
    voice(false);
    vi.advanceTimersByTime(400);
    expect(fake.running()).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect(fake.running()).toHaveLength(1);
  });

  it("steps aside while push-to-talk records", () => {
    const { fake, chat } = mount();
    vi.advanceTimersByTime(50);
    chat.setMood("listening");
    expect(fake.running()).toHaveLength(0);
    chat.setMood("idle");
    vi.advanceTimersByTime(600);
    expect(fake.running()).toHaveLength(1);
  });

  it("pauses while the tab is hidden", () => {
    const { fake, window, document } = mount();
    vi.advanceTimersByTime(50);
    let hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    document.dispatchEvent(new window.Event("visibilitychange"));
    expect(fake.running()).toHaveLength(0);
    hidden = false;
    document.dispatchEvent(new window.Event("visibilitychange"));
    vi.advanceTimersByTime(600);
    expect(fake.running()).toHaveLength(1);
  });

  it("starts again when Chrome ends recognition after silence", () => {
    const { fake } = mount();
    vi.advanceTimersByTime(20000);
    fake.made[0].end();
    expect(fake.running()).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(fake.running()).toHaveLength(1);
    expect(fake.made).toHaveLength(2);
  });

  it("backs off when recognition keeps ending at once, and gives up for the page after five waits", () => {
    const { fake, document } = mount({ recognition: { endAtOnce: true } });
    vi.advanceTimersByTime(1000);
    expect(fake.made).toHaveLength(3);
    vi.advanceTimersByTime(3500);
    expect(fake.made).toHaveLength(3);
    vi.advanceTimersByTime(1000);
    expect(fake.made.length).toBeGreaterThan(3);
    vi.advanceTimersByTime(120000);
    document.body.click();
    vi.advanceTimersByTime(120000);
    expect(fake.made).toHaveLength(15);
  });

  for (const refusal of [{ failWith: "not-allowed" }, { throwOnStart: true }] as FakeOptions[]) {
    it(`retries once, silently, on the first gesture when the browser refuses at load (${Object.keys(refusal)[0]})`, () => {
      const { fake, ears, document } = mount({ recognition: { ...refusal, refuseFirst: 1 } });
      vi.advanceTimersByTime(60000);
      expect(fake.made).toHaveLength(1);
      expect(ears()).toBe(0);
      expect(document.querySelector("[class^='juniper-keyword__']")).toBeNull();

      document.body.click();
      vi.advanceTimersByTime(50);
      expect(fake.running()).toHaveLength(1);
      expect(ears()).toBeGreaterThan(0);
    });
  }

  it("retries only once: a second refusal leaves it off however many gestures follow", () => {
    const { fake, document, ears } = mount({ recognition: { failWith: "not-allowed" } });
    vi.advanceTimersByTime(1000);
    document.body.click();
    vi.advanceTimersByTime(1000);
    document.body.click();
    document.body.click();
    vi.advanceTimersByTime(60000);
    expect(fake.made).toHaveLength(2);
    expect(fake.running()).toHaveLength(0);
    expect(ears()).toBe(0);
  });

  it("keeps nothing of what it hears that is not the keyword", () => {
    const { fake, window, document, start, requests, chat } = mount();
    const logged = vi.spyOn(window.console, "log");
    vi.advanceTimersByTime(50);
    const before = requests.length;
    fake.made[0].hear("my card number is four two four two");
    fake.made[0].hear("my card number is four two four two and the pin", true);
    vi.advanceTimersByTime(1000);

    expect(start).not.toHaveBeenCalled();
    expect(chat.isOpen()).toBe(false);
    expect(fake.running()).toHaveLength(1);
    expect(document.documentElement.outerHTML).not.toMatch(/four two/);
    const stored = [window.localStorage, window.sessionStorage].map((storage) =>
      Object.keys(storage).map((key) => key + storage.getItem(key)).join("|")).join("|");
    expect(stored).not.toMatch(/four two/);
    expect(requests.length).toBe(before);
    expect(logged).not.toHaveBeenCalled();
    expect(JSON.stringify(chat.state())).not.toMatch(/four two/);
    expect((chat.elements.input as HTMLInputElement).value).toBe("");
  });
});
