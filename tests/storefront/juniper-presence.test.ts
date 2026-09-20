import { describe, expect, it } from "vitest";
import { mountWidget } from "./widget.ts";

// A fake Web Audio + mic + frame clock. `rig.mic` and `rig.reply` are the loudness (0..1) the analysers report.
function fakeAudio(options: { throwOnElementSource?: boolean } = {}) {
  const rig = {
    mic: 0,
    reply: 0,
    getUserMediaCalls: 0,
    contexts: [] as any[],
    tracks: [] as { stopped: boolean }[],
    elementSources: 0,
    audios: [] as any[],
    frames: [] as ((now: number) => void)[],
    /** Runs `count` animation frames. */
    frame(count = 1) {
      for (let index = 0; index < count; index += 1) {
        const due = rig.frames.splice(0);
        due.forEach((callback) => callback(index * 16));
      }
    },
    before(window: any) {
      window.requestAnimationFrame = (callback: (now: number) => void) => { rig.frames.push(callback); return rig.frames.length; };
      window.cancelAnimationFrame = () => {};
      class FakeAnalyser {
        fftSize = 2048;
        smoothingTimeConstant = 0;
        source = "mic";
        get frequencyBinCount() { return this.fftSize / 2; }
        connect(node: unknown) { return node; }
        disconnect() {}
        level() { return this.source === "mic" ? rig.mic : rig.reply; }
        getByteTimeDomainData(data: Uint8Array) {
          const swing = Math.round(this.level() * 127);
          for (let index = 0; index < data.length; index += 1) data[index] = 128 + (index % 2 ? swing : -swing);
        }
        getByteFrequencyData(data: Uint8Array) { data.fill(Math.round(this.level() * 255)); }
      }
      class FakeContext {
        state = "running";
        destination = {};
        analysers: FakeAnalyser[] = [];
        constructor() { rig.contexts.push(this); }
        createAnalyser() { const analyser = new FakeAnalyser(); this.analysers.push(analyser); return analyser; }
        createMediaStreamSource() { return { connect: (node: FakeAnalyser) => { node.source = "mic"; return node; }, disconnect() {} }; }
        createMediaElementSource() {
          if (options.throwOnElementSource) throw new Error("InvalidStateError");
          rig.elementSources += 1;
          return { connect: (node: FakeAnalyser) => { node.source = "reply"; return node; }, disconnect() {} };
        }
        resume() { this.state = "running"; return Promise.resolve(); }
        suspend() { this.state = "suspended"; return Promise.resolve(); }
        close() { this.state = "closed"; return Promise.resolve(); }
      }
      window.AudioContext = FakeContext;
      window.MediaRecorder = function MediaRecorder() {};
      window.URL.createObjectURL = () => "blob:reply";
      window.URL.revokeObjectURL = () => {};
      window.Audio = class FakeAudio {
        paused = true;
        ended = false;
        played = 0;
        handlers: Record<string, (() => void)[]> = {};
        constructor() { rig.audios.push(this); }
        addEventListener(name: string, handler: () => void) { (this.handlers[name] = this.handlers[name] || []).push(handler); }
        removeEventListener() {}
        fire(name: string) { (this.handlers[name] || []).slice().forEach((handler) => handler()); }
        play() { this.paused = false; this.played += 1; this.fire("play"); return Promise.resolve(); }
        pause() { this.paused = true; this.fire("pause"); }
      };
      Object.defineProperty(window.navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            rig.getUserMediaCalls += 1;
            const track = { stopped: false, stop() { this.stopped = true; } };
            rig.tracks.push(track);
            return { getTracks: () => [track] };
          }
        }
      });
    }
  };
  return rig;
}

function mount(rig: ReturnType<typeof fakeAudio>) {
  const mounted = mountWidget({ features: ["presence"], before: rig.before, routes: { "/api/voice/config": () => ({ enabled: true }) } });
  const { window, document, chat } = mounted;
  const widget = chat.elements.widget as HTMLElement;
  return {
    ...mounted,
    widget,
    level: () => Number(widget.style.getPropertyValue("--juniper-level") || 0),
    mouth: () => Number(widget.style.getPropertyValue("--juniper-mouth") || 0),
    bars: () => Array.from(chat.elements.wave.querySelectorAll("i")).map((bar: any) => Number(bar.style.getPropertyValue("--juniper-bar") || 0)),
    click: () => document.dispatchEvent(new window.Event("pointerdown", { bubbles: true })),
    voice: (on: boolean, state: string) => document.dispatchEvent(new window.CustomEvent("bazaar-voice:state", { detail: { on, state } })),
    /** Sends a turn with spoken replies on, and returns the Audio element the chat plays the reply through. */
    async speak() {
      await mounted.settle();
      chat.setSpokenReplies(true);
      chat.send("Could you do better?");
      for (let index = 0; index < 6; index += 1) await mounted.settle();
      return rig.audios[rig.audios.length - 1];
    }
  };
}

describe("juniper-presence — the halo, the wave and the mouth follow real audio", () => {
  it("never opens the microphone before voice is turned on", async () => {
    const rig = fakeAudio();
    const { click, settle, chat } = mount(rig);
    click();
    chat.open();
    rig.frame(3);
    await settle();
    expect(rig.getUserMediaCalls).toBe(0);
    expect(rig.contexts.length).toBe(0);
  });

  it("holds the level and the bars at 0 in silence, and raises them with a loud voice", async () => {
    const rig = fakeAudio();
    const { click, voice, settle, level, bars, chat } = mount(rig);
    click();
    voice(true, "listening");
    await settle();
    expect(rig.getUserMediaCalls).toBe(1);

    rig.frame(5);
    expect(level()).toBe(0);
    expect(bars().every((bar) => bar === 0)).toBe(true);
    expect(chat.elements.wave.classList.contains("juniper-presence--live")).toBe(true);

    rig.mic = 0.8;
    rig.frame(5);
    expect(level()).toBeGreaterThan(0.5);
    expect(level()).toBeLessThanOrEqual(1);
    expect(bars().some((bar) => bar > 0.5)).toBe(true);

    rig.mic = 0;
    rig.frame(120);
    expect(level()).toBe(0);
  });

  it("opens one stream however many listening states arrive", async () => {
    const rig = fakeAudio();
    const { click, voice, settle } = mount(rig);
    click();
    voice(true, "listening");
    voice(true, "hearing");
    voice(true, "listening");
    await settle();
    expect(rig.getUserMediaCalls).toBe(1);
  });

  it("stops the stream's tracks and drops the level when voice turns off", async () => {
    const rig = fakeAudio();
    const { click, voice, settle, level, widget, chat } = mount(rig);
    click();
    voice(true, "hearing");
    await settle();
    rig.mic = 0.9;
    rig.frame(4);
    expect(level()).toBeGreaterThan(0);

    voice(false, "off");
    expect(rig.tracks[0].stopped).toBe(true);
    expect(rig.contexts[0].state).not.toBe("running");
    expect(level()).toBe(0);
    expect(widget.classList.contains("juniper-presence--listening")).toBe(false);
    expect(chat.elements.wave.classList.contains("juniper-presence--live")).toBe(false);
  });

  it("stops a stream that arrives after voice was already turned off", async () => {
    const rig = fakeAudio();
    const { click, voice, settle } = mount(rig);
    click();
    voice(true, "listening");
    voice(false, "off");
    await settle();
    expect(rig.tracks.every((track) => track.stopped)).toBe(true);
  });

  it("follows the legacy push-to-talk through the listening mood", async () => {
    const rig = fakeAudio();
    const { click, settle, chat } = mount(rig);
    click();
    chat.setMood("listening");
    await settle();
    expect(rig.getUserMediaCalls).toBe(1);
    chat.setMood("idle");
    expect(rig.tracks[0].stopped).toBe(true);
  });

  it("waits for a gesture before touching Web Audio when voice was restored on load", async () => {
    const rig = fakeAudio();
    const { click, voice, settle } = mount(rig);
    voice(true, "listening");
    await settle();
    expect(rig.contexts.length).toBe(0);
    expect(rig.getUserMediaCalls).toBe(0);
    click();
    await settle();
    expect(rig.getUserMediaCalls).toBe(1);
  });

  it("moves the mouth with the reply audio and holds it at 0 when the audio is paused or over", async () => {
    const rig = fakeAudio();
    const { click, speak, mouth } = mount(rig);
    click();
    const audio = await speak();
    expect(audio.played).toBe(1);
    expect(rig.elementSources).toBe(1);

    rig.reply = 0.7;
    rig.frame(4);
    expect(mouth()).toBeGreaterThan(0.4);

    audio.paused = true;
    rig.frame(2);
    expect(mouth()).toBe(0);

    audio.paused = false;
    rig.frame(3);
    expect(mouth()).toBeGreaterThan(0);

    audio.fire("ended");
    expect(mouth()).toBe(0);
    rig.frame(3);
    expect(mouth()).toBe(0);
  });

  it("leaves playback alone when createMediaElementSource throws", async () => {
    const rig = fakeAudio({ throwOnElementSource: true });
    const { click, speak, mouth, chat } = mount(rig);
    click();
    const audio = await speak();
    expect(audio.played).toBe(1);
    expect(chat.state().mood).toBe("speaking");
    rig.reply = 0.9;
    rig.frame(3);
    expect(mouth()).toBe(0);
  });

  it("does nothing, and breaks nothing, without Web Audio", async () => {
    const { chat, document, window, settle } = mountWidget({ features: ["presence"] });
    document.dispatchEvent(new window.CustomEvent("bazaar-voice:state", { detail: { on: true, state: "listening" } }));
    await settle();
    expect(chat.send("Hello")).toBe(true);
  });
});

