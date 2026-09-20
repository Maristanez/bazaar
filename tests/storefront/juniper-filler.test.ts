import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountWidget } from "./widget.ts";

type FakeAudio = { src: string; volume: number; currentTime: number; playing: boolean; plays: number };

function mount(options: { speakFails?: boolean; voiceConfig?: boolean } = {}) {
  const audios: FakeAudio[] = [];
  const timing = { chatDelay: 0 };
  let urls = 0;
  const mounted = mountWidget({
    features: ["filler"],
    chat: () => ({ reply: "Here is what I can do." }),
    routes: { "/api/voice/config": () => ({ enabled: Boolean(options.voiceConfig) }) },
    before: (window) => {
      window.setTimeout = setTimeout; window.clearTimeout = clearTimeout;
      const plain = window.fetch;
      window.fetch = (input: string, init: any) => {
        const path = new URL(String(input), "https://bazaar.test").pathname;
        if (path === "/api/voice/speak" && options.speakFails) return plain(input, init).then(() => ({ ok: false, status: 503 }));
        if (path !== "/api/chat" || !timing.chatDelay) return plain(input, init);
        return new Promise((resolve) => setTimeout(resolve, timing.chatDelay)).then(() => plain(input, init));
      };
      window.URL.createObjectURL = () => `blob:filler-${(urls += 1)}`;
      window.URL.revokeObjectURL = () => {};
      window.MediaRecorder = function () {};
      Object.defineProperty(window.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: () => Promise.reject(new Error("no mic in tests")) } });
      window.Audio = function (src: string) {
        const audio: any = { src, volume: 1, currentTime: 0, playing: false, plays: 0, addEventListener() {}, removeEventListener() {} };
        audio.play = () => { audio.playing = true; audio.plays += 1; return Promise.resolve(); };
        audio.pause = () => { audio.playing = false; };
        audios.push(audio);
        return audio;
      };
    },
  });
  const { window, document, requests } = mounted;
  const voice = (on: boolean, state: string) => document.dispatchEvent(new window.CustomEvent("bazaar-voice:state", { detail: { on, state } }));
  const spoken = () => requests.filter((request) => request.path === "/api/voice/speak");
  const fillers = () => audios.filter((audio) => audio.src.indexOf("blob:filler-") === 0);
  return { ...mounted, timing, voice, spoken, fillers, plays: () => fillers().reduce((sum, audio) => sum + audio.plays, 0) };
}

describe("V11 — spoken filler while the shopkeeper picks", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fetches nothing and plays nothing while spoken replies are off", async () => {
    const { chat, timing, spoken, plays } = mount();
    timing.chatDelay = 4000;
    chat.send("Could you do better?");
    await vi.advanceTimersByTimeAsync(6000);
    expect(spoken().length).toBe(0);
    expect(plays()).toBe(0);
  });

  it("fetches nothing just from voice turning on — only lazily, on the first turn", async () => {
    const { chat, voice, spoken } = mount();
    voice(true, "listening");
    await vi.advanceTimersByTimeAsync(10);
    voice(true, "thinking");
    voice(true, "listening");
    await vi.advanceTimersByTimeAsync(200);
    expect(spoken().length).toBe(0);

    chat.send("Could you do better?");
    await vi.advanceTimersByTimeAsync(10);
    const lines = spoken().map((request) => request.body.text);
    expect(lines.length).toBe(3);
    expect(new Set(lines).size).toBe(3);
    for (const line of lines) expect(line).not.toMatch(/\d|\$/);
  });

  it("plays no filler when the reply is fast", async () => {
    const { chat, voice, timing, plays } = mount();
    voice(true, "listening");
    await vi.advanceTimersByTimeAsync(10);
    timing.chatDelay = 1000;
    chat.send("Could you do better?");
    await vi.advanceTimersByTimeAsync(5000);
    expect(plays()).toBe(0);
  });

  it("plays exactly one filler when the reply is slow, a little quieter, and stops it when the reply lands", async () => {
    const { chat, voice, timing, plays, fillers } = mount();
    voice(true, "listening");
    await vi.advanceTimersByTimeAsync(10);
    timing.chatDelay = 6000;
    chat.send("Could you do better?");
    await vi.advanceTimersByTimeAsync(1400);
    expect(plays()).toBe(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(plays()).toBe(1);
    const playing = fillers().find((audio) => audio.playing) as FakeAudio;
    expect(playing.volume).toBeCloseTo(0.85);
    await vi.advanceTimersByTimeAsync(3000);
    expect(plays()).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(playing.playing).toBe(false);
    expect(playing.currentTime).toBe(0);
    expect(plays()).toBe(1);
  });

  it("rotates through the clips from one slow turn to the next", async () => {
    const { chat, voice, timing, fillers } = mount();
    voice(true, "listening");
    await vi.advanceTimersByTimeAsync(10);
    timing.chatDelay = 2000;
    chat.send("Could you do better?");
    await vi.advanceTimersByTimeAsync(3000);
    chat.send("And for two?");
    await vi.advanceTimersByTimeAsync(3000);
    const played = fillers().filter((audio) => audio.plays > 0).map((audio) => audio.src);
    expect(played.length).toBe(2);
    expect(new Set(played).size).toBe(2);
  });

  it("stops the filler when the chat closes, and plays none once voice is off again", async () => {
    const { chat, voice, timing, fillers, plays } = mount();
    voice(true, "listening");
    await vi.advanceTimersByTimeAsync(10);
    timing.chatDelay = 5000;
    chat.open();
    chat.send("Could you do better?");
    await vi.advanceTimersByTimeAsync(1600);
    expect(plays()).toBe(1);
    chat.close();
    expect(fillers().some((audio) => audio.playing)).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);

    voice(false, "off");
    chat.send("And for two?");
    await vi.advanceTimersByTimeAsync(6000);
    expect(plays()).toBe(1);
  });

  it("cuts a playing filler the instant setSpokenReplies(false) fires the seam's spoken-replies event — no click needed", async () => {
    const { chat, timing, plays, fillers } = mount({ voiceConfig: true });
    await vi.advanceTimersByTimeAsync(10);
    chat.setSpokenReplies(true);
    timing.chatDelay = 6000;
    chat.send("Could you do better?");
    await vi.advanceTimersByTimeAsync(1600);
    expect(plays()).toBe(1);
    const playing = fillers().find((audio) => audio.playing) as FakeAudio;
    chat.setSpokenReplies(false);
    expect(playing.playing).toBe(false);
  });

  it("works from the speaker toggle alone, with no hands-free in the page", async () => {
    const { chat, timing, spoken, plays } = mount({ voiceConfig: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(chat.setSpokenReplies(true)).toBe(true);
    chat.send("Hello there");
    await vi.advanceTimersByTimeAsync(100);
    expect(spoken().filter((request) => /shelf|see what|Hmm/.test(request.body.text)).length).toBe(3);
    // The first reply was read aloud through the same fake Audio; while it plays, a filler would talk over it.
    const before = plays();
    timing.chatDelay = 3000;
    chat.send("Could you do better?");
    await vi.advanceTimersByTimeAsync(1600);
    expect(plays()).toBe(before);
    chat.stopSpeaking();
    await vi.advanceTimersByTimeAsync(3000);
    const settled = plays();
    chat.stopSpeaking();
    chat.send("And for two?");
    await vi.advanceTimersByTimeAsync(1600);
    expect(plays()).toBe(settled + 1);
  });

  it("tries a failed clip once more and then gives up, playing nothing", async () => {
    const { chat, voice, timing, spoken, plays } = mount({ speakFails: true });
    voice(true, "listening");
    await vi.advanceTimersByTimeAsync(10);
    voice(false, "off");
    voice(true, "listening");
    await vi.advanceTimersByTimeAsync(10);
    expect(spoken().length).toBe(0); // nothing before the shopper has said anything
    timing.chatDelay = 4000;
    chat.send("Could you do better?");
    await vi.advanceTimersByTimeAsync(6000);
    expect(spoken().length).toBe(6);
    expect(plays()).toBe(0);
  });

  it("writes no figure anywhere in the filler file", () => {
    const source = readFileSync(fileURLToPath(new URL("../../apps/storefront/assets/juniper-filler.js", import.meta.url)), "utf8");
    const strings = source.match(/'[^'\n]*'/g) || [];
    for (const text of strings.filter((entry) => / /.test(entry))) expect(text).not.toMatch(/\d|\$/);
  });
});
