import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountWidget } from "./widget.ts";

// A stand-in for Chrome's SpeechRecognition. `running` is the truth the ear is checked against.
function fakeRecognition(window: any, options: { failWith?: string; endAtOnce?: boolean } = {}) {
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
      if (options.failWith) {
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

type Setup = { optedIn?: boolean; flag?: boolean; handsfree?: boolean; recognition?: Parameters<typeof fakeRecognition>[1]; unsupported?: boolean };

function mount(setup: Setup = {}) {
  let fake = { made: [] as any[], running: () => [] as any[] };
  const start = vi.fn();
  const mounted = mountWidget({
    features: ["keyword"],
    before: (window) => {
      if (!setup.unsupported) fake = fakeRecognition(window, setup.recognition);
      if (setup.optedIn) window.localStorage.setItem("bazaar:keyword", "1");
      if (setup.flag !== undefined) window.BazaarChatFlags = { keyword: setup.flag };
      if (setup.handsfree !== false) {
        window.document.addEventListener("bazaar-chat:ready", () => {
          window.BazaarChat.handsfree = { start, stop: vi.fn(), isOn: () => false };
        });
      }
    },
  });
  const ears = () => mounted.document.querySelectorAll(".juniper-keyword__ear").length;
  const voice = (on: boolean) =>
    mounted.document.dispatchEvent(new mounted.window.CustomEvent("bazaar-voice:state", { detail: { on, state: on ? "listening" : "off" } }));
  const button = () => mounted.document.querySelector("[data-juniper-keyword-toggle]") as HTMLButtonElement | null;
  return { ...mounted, fake, start, ears, voice, button };
}

describe("V8 the Jarvis keyword", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("opens hands-free when the shopper says Jarvis with the chat closed, and stops its own recogniser first", () => {
    const { fake, start, ears } = mount({ optedIn: true });
    vi.advanceTimersByTime(50);
    expect(fake.running()).toHaveLength(1);
    expect(ears()).toBe(1);

    fake.made[0].hear("hey jarvis could you do one twenty");
    vi.advanceTimersByTime(400);

    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]).toEqual([]);
    expect(fake.running()).toHaveLength(0);
    expect(ears()).toBe(0);
  });

  it("falls back to opening the chat when hands-free is not there", () => {
    const { fake, chat } = mount({ optedIn: true, handsfree: false });
    vi.advanceTimersByTime(50);
    fake.made[0].hear("Jarvis");
    vi.advanceTimersByTime(400);
    expect(chat.isOpen()).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(fake.running()).toHaveLength(0);
  });

  it("shows the ear exactly while a recogniser runs, and says so on the document", () => {
    const { fake, ears, chat, document } = mount({ optedIn: true });
    const armed: boolean[] = [];
    document.addEventListener("bazaar-keyword:state", (event: any) => armed.push(event.detail.armed));
    expect(ears()).toBe(fake.running().length);
    vi.advanceTimersByTime(50);
    expect([fake.running().length, ears()]).toEqual([1, 1]);
    expect(document.querySelector(".juniper-keyword__ear")?.getAttribute("aria-label")).toBe("Listening for 'Jarvis'");
    expect(document.querySelector("[data-ai-chat-toggle] .juniper-keyword__ear")).not.toBeNull();

    chat.open();
    expect([fake.running().length, ears()]).toEqual([0, 0]);
    chat.close();
    vi.advanceTimersByTime(600);
    expect([fake.running().length, ears()]).toEqual([1, 1]);
    expect(armed).toEqual([true, false, true]);
  });

  it("puts an ear on the hands-free pill as well when there is one", () => {
    const { document, ears, chat } = mount({ optedIn: true });
    const pill = document.createElement("div");
    pill.setAttribute("data-juniper-pill", "");
    chat.elements.widget.appendChild(pill);
    vi.advanceTimersByTime(50);
    expect(ears()).toBe(2);
    expect(pill.querySelector(".juniper-keyword__ear")).not.toBeNull();
  });

  it("never constructs a recogniser when the theme flag is off, even with the opt-in remembered", () => {
    const { fake, document, chat } = mount({ optedIn: true, flag: false });
    vi.advanceTimersByTime(10000);
    chat.open();
    chat.close();
    vi.advanceTimersByTime(10000);
    expect(fake.made).toHaveLength(0);
    expect(document.querySelector(".juniper-keyword__control")).toBeNull();
    expect(document.querySelector(".juniper-keyword__ear")).toBeNull();
  });

  it("injects nothing where the browser has no speech recognition", () => {
    const { document } = mount({ optedIn: true, unsupported: true });
    vi.advanceTimersByTime(1000);
    expect(document.querySelector("[class^='juniper-keyword__']")).toBeNull();
  });

  it("listens to nothing before the shopper clicks Turn on Hey Jarvis, then remembers the choice", () => {
    const first = mount();
    vi.advanceTimersByTime(5000);
    first.chat.open();
    first.chat.close();
    vi.advanceTimersByTime(5000);
    expect(first.fake.made).toHaveLength(0);
    expect(first.button()?.textContent).toBe("Turn on Hey Jarvis");
    expect(first.document.querySelector(".juniper-keyword__note")?.textContent).toMatch(/Chrome's speech service/);

    first.chat.open();
    first.button()!.click();
    expect(first.window.localStorage.getItem("bazaar:keyword")).toBe("1");
    expect(first.document.querySelector(".juniper-keyword__status")?.textContent).toBe("Hey Jarvis is on");
    expect(first.fake.running()).toHaveLength(0);
    first.chat.close();
    vi.advanceTimersByTime(600);
    expect(first.fake.running()).toHaveLength(1);

    first.chat.open();
    first.button()!.click();
    expect(first.window.localStorage.getItem("bazaar:keyword")).toBeNull();
    first.chat.close();
    vi.advanceTimersByTime(5000);
    expect(first.fake.running()).toHaveLength(0);
  });

  it("re-arms on a later mount from the remembered opt-in", () => {
    const { fake, button } = mount({ optedIn: true });
    vi.advanceTimersByTime(50);
    expect(fake.running()).toHaveLength(1);
    expect(button()?.textContent).toBe("Turn off");
    expect(fake.made[0]).toMatchObject({ continuous: true, interimResults: true, lang: "en-US" });
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
    const { fake, voice, ears } = mount({ optedIn: true });
    vi.advanceTimersByTime(50);
    voice(true);
    expect([fake.running().length, ears()]).toEqual([0, 0]);
    vi.advanceTimersByTime(5000);
    expect(fake.running()).toHaveLength(0);
    voice(false);
    vi.advanceTimersByTime(400);
    expect(fake.running()).toHaveLength(0);
    vi.advanceTimersByTime(200);
    expect([fake.running().length, ears()]).toEqual([1, 1]);
  });

  it("steps aside while push-to-talk records", () => {
    const { fake, chat } = mount({ optedIn: true });
    vi.advanceTimersByTime(50);
    chat.setMood("listening");
    expect(fake.running()).toHaveLength(0);
    chat.setMood("idle");
    vi.advanceTimersByTime(600);
    expect(fake.running()).toHaveLength(1);
  });

  it("pauses while the tab is hidden", () => {
    const { fake, window, document } = mount({ optedIn: true });
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
    const { fake } = mount({ optedIn: true });
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(20000);
    fake.made[0].end();
    expect(fake.running()).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(fake.running()).toHaveLength(1);
    expect(fake.made).toHaveLength(2);
  });

  it("backs off when recognition keeps ending at once, and gives up for the page after five waits", () => {
    const { fake, window, button } = mount({ optedIn: true, recognition: { endAtOnce: true } });
    vi.advanceTimersByTime(1000);
    expect(fake.made).toHaveLength(3);
    vi.advanceTimersByTime(3500);
    expect(fake.made).toHaveLength(3);
    vi.advanceTimersByTime(1000);
    expect(fake.made.length).toBeGreaterThan(3);
    vi.advanceTimersByTime(120000);
    expect(fake.made).toHaveLength(15);
    expect(button()?.textContent).toBe("Turn on Hey Jarvis");
    expect(window.localStorage.getItem("bazaar:keyword")).toBe("1");
  });

  it("disarms quietly when the browser refuses the microphone, and leaves the control to try again", () => {
    const { fake, window, button, ears } = mount({ optedIn: true, recognition: { failWith: "not-allowed" } });
    vi.advanceTimersByTime(60000);
    expect(fake.made).toHaveLength(1);
    expect(ears()).toBe(0);
    expect(window.localStorage.getItem("bazaar:keyword")).toBeNull();
    expect(button()?.textContent).toBe("Turn on Hey Jarvis");
  });

  it("keeps nothing of what it hears that is not the keyword", () => {
    const { fake, window, document, start, requests, chat } = mount({ optedIn: true });
    const logged = vi.spyOn(window.console, "log");
    vi.advanceTimersByTime(50);
    const before = requests.length;
    fake.made[0].hear("my card number is four two four two");
    fake.made[0].hear("my card number is four two four two and the pin", true);
    vi.advanceTimersByTime(1000);

    expect(start).not.toHaveBeenCalled();
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
