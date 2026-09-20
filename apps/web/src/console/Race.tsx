import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GymResult, OwnerProduct, Policy, PolicySettings } from "@bazaar/contracts";
import { raceLayout, runLiveGym, type LiveGymInput, type RaceDot } from "@bazaar/gym";
import { SETTING_RANGES, floorOf, resolveSettings } from "@bazaar/engine";
import { invalidReason, items } from "./gymItems";

type Draft = Pick<Policy, "floorPct" | "askOwner"> & { settings?: PolicySettings };
const W = 980, X0 = 60, X1 = 950, CLOUD_TOP = 46, CLOUD_BOTTOM = 150, BASE = 330, PER_ROW = 6, STEP_MS = 1050;
type PillKey = "floor" | "maxOff" | "rounds" | "lowball";
const PILLS: { key: PillKey; label: string }[] = [{ key: "floor", label: "Floor" }, { key: "maxOff", label: "Max off" }, { key: "rounds", label: "Rounds" }, { key: "lowball", label: "Lowball" }];
const OUTCOMES: Record<RaceDot["kind"], { label: string; fill: string; stroke?: string }> = {
  list: { label: "Paid list", fill: "var(--color-teal)" },
  saved: { label: "Saved by your shopkeeper", fill: "#19c3c3" },
  bundle: { label: "Bought a bundle", fill: "#3a8f8a" },
  owner: { label: "Would ask you", fill: "#f6d809", stroke: "var(--color-bark)" },
  missed: { label: "Walked — a deal missed", fill: "transparent", stroke: "#5c503e" },
  walked: { label: "Walked away", fill: "transparent", stroke: "#a49885" },
  deciding: { label: "Still deciding", fill: "#cdbfa6" },
};
const PERSONA_LABEL: Record<RaceDot["persona"], string> = { bargain: "Bargain hunter", budgeted: "On a budget", impatient: "Impatient", loyal: "Loyal customer", lowballer: "Lowballer" };
const money = (cents: number) => `${cents < 0 ? "−" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-CA")}`;
const jitter = (id: number, salt: number) => (((id * 2654435761 + salt * 40503) >>> 0) % 1000) / 1000;

/** Figures for one Gym run. Every number is derived from the run itself. */
function figures(result: GymResult, list: number, cost: number) {
  const banner = Math.round(list * 0.8);
  const bannerProfit = result.shoppers.filter(shopper => shopper.willingness >= banner).length * (banner - cost);
  const profit = result.profitVsBanner + bannerProfit;
  const noShopkeeper = result.shoppers.filter(shopper => shopper.willingness >= list).length * (list - cost);
  return { profit, vsNoShopkeeper: profit - noShopkeeper, vsBanner: result.profitVsBanner };
}

export function Race({ products, policy, draft, saving, onDraft, onAdopt }: { products: OwnerProduct[]; policy: Policy; draft?: Draft; saving?: boolean; onDraft(next: Draft): void; onAdopt(): void }) {
  const catalog = useMemo(() => items(products), [products]);
  // Oldest stock first: it has the most room to bend, so the race opens where haggling actually happens.
  const mains = useMemo(() => catalog.filter(item => !item.isAddOn && !invalidReason(item)).sort((a, b) => Date.parse(a.stockedAt ?? "9999") - Date.parse(b.stockedAt ?? "9999")), [catalog]);
  const [selectedId, setSelectedId] = useState<string>();
  const [round, setRound] = useState(99);
  const [hover, setHover] = useState<number | undefined>(undefined);
  const [pill, setPill] = useState<PillKey>("floor");
  const [runAt] = useState(() => Date.now());
  const timer = useRef<number | undefined>(undefined);
  const main = mains.find(item => item.variantId === selectedId) ?? mains[0];
  const floorPct = draft?.floorPct ?? policy.floorPct, askOwner = draft?.askOwner ?? policy.askOwner;
  const settings = resolveSettings({ ...policy.settings, ...draft?.settings });
  const savedSettings = resolveSettings(policy.settings);
  const settingsDirty = settings.discountCapPct !== savedSettings.discountCapPct || settings.maxRounds !== savedSettings.maxRounds || settings.lowballCutoffPct !== savedSettings.lowballCutoffPct;
  const dirty = floorPct !== policy.floorPct || askOwner !== policy.askOwner || settingsDirty;

  const run = useMemo(() => {
    if (!main) return undefined;
    const input: LiveGymInput = { main, catalog, floorPct, askOwner, seed: 42, n: 300, now: new Date(runAt), settings };
    try {
      const candidate = runLiveGym(input);
      const savedInput: LiveGymInput = { ...input, floorPct: policy.floorPct, askOwner: policy.askOwner, settings: savedSettings };
      return { candidate, saved: dirty ? runLiveGym(savedInput) : candidate };
    } catch { return undefined; }
  }, [askOwner, catalog, dirty, floorPct, main, policy.askOwner, policy.floorPct, runAt, settings.discountCapPct, settings.lowballCutoffPct, settings.maxRounds, savedSettings.discountCapPct, savedSettings.lowballCutoffPct, savedSettings.maxRounds]);

  const stop = () => { if (timer.current !== undefined) window.clearInterval(timer.current); timer.current = undefined; };
  function play() {
    stop();
    if (!run || (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) { setRound(99); return; }
    const last = raceLayout(run.candidate, main!.list, 99).rounds;
    let at = 0; setRound(0);
    timer.current = window.setInterval(() => { at += 1; if (at >= last) { stop(); setRound(99); } else setRound(at); }, STEP_MS);
  }
  useEffect(() => stop, []);

  if (!main || !run) return <section className="paper race" aria-labelledby="race-title"><h2 id="race-title">Try it on 300 shoppers</h2><p className="muted">No product is ready to simulate: each needs a cost in Shopify and stock on hand.</p></section>;

  const cost = main.cost!, list = main.list, floor = floorOf(cost, floorPct);
  const race = raceLayout(run.candidate, list, round), settled = race.round >= race.rounds;
  const final = raceLayout(run.candidate, list, 99), before = raceLayout(run.saved, list, 99);
  const now = figures(run.candidate, list, cost), was = figures(run.saved, list, cost);
  const top = Math.max(list, ...run.candidate.shoppers.map(shopper => shopper.agreed ?? 0)) * 1.04, low = cost * 0.94;
  const x = (cents: number) => X0 + (Math.min(Math.max(cents, low), top) - low) / (top - low) * (X1 - X0);
  const place = (dot: RaceDot) => dot.state === "bought"
    ? { x: x(dot.bucket!) - 22 + (dot.seat! % PER_ROW) * 9, y: BASE - 6 - Math.floor(dot.seat! / PER_ROW) * 9 }
    : { x: x(dot.willingness) + (jitter(dot.id, 1) - 0.5) * 10, y: CLOUD_TOP + jitter(dot.id, 2) * (CLOUD_BOTTOM - CLOUD_TOP) };
  const change = (next: number, prev: number, format: (value: number) => string) => settled && next !== prev
    ? <i className={next > prev ? "up" : "down"}>{next > prev ? "▲" : "▼"} {format(Math.abs(next - prev))}</i> : null;
  const hovered = hover === undefined ? undefined : run.candidate.shoppers.find(shopper => shopper.id === hover);
  const used = new Set(final.dots.map(dot => dot.kind));

  function updateSetting<K extends keyof PolicySettings>(key: K, value: PolicySettings[K]) {
    onDraft({ floorPct, askOwner, settings: { ...policy.settings, ...draft?.settings, [key]: value } });
  }
  const offAfter = (pct: number) => money(Math.round(list * (1 - pct / 100)));
  const shareOfList = (pct: number) => money(Math.round(list * (pct / 100)));
  const pillConfig: Record<PillKey, { valueLabel: string; sentence: string; min: number; max: number; value: number; dirty: boolean; ariaLabel: string; onChange(value: number): void }> = {
    floor: {
      valueLabel: `${floorPct}% · ${money(floor)}`,
      sentence: "The lowest price your shopkeeper may agree to on its own. Raise it and each sale earns more, but more shoppers walk.",
      min: 0, max: 60, value: floorPct, dirty: floorPct !== policy.floorPct,
      ariaLabel: `Floor: cost + ${floorPct}%`,
      onChange: value => onDraft({ floorPct: value, askOwner, settings: draft?.settings }),
    },
    maxOff: {
      valueLabel: `${settings.discountCapPct}% · ${offAfter(settings.discountCapPct)}`,
      sentence: "The steepest cut off list your shopkeeper will ever offer, no matter how hard someone haggles.",
      min: SETTING_RANGES.discountCapPct[0], max: SETTING_RANGES.discountCapPct[1], value: settings.discountCapPct, dirty: settings.discountCapPct !== savedSettings.discountCapPct,
      ariaLabel: `Max off: ${settings.discountCapPct}% off list`,
      onChange: value => updateSetting("discountCapPct", value),
    },
    rounds: {
      valueLabel: `${settings.maxRounds}`,
      sentence: "How many rounds of back-and-forth your shopkeeper will haggle before settling or walking away.",
      min: SETTING_RANGES.maxRounds[0], max: SETTING_RANGES.maxRounds[1], value: settings.maxRounds, dirty: settings.maxRounds !== savedSettings.maxRounds,
      ariaLabel: `Rounds: ${settings.maxRounds}`,
      onChange: value => updateSetting("maxRounds", value),
    },
    lowball: {
      valueLabel: settings.lowballCutoffPct === 0 ? "off" : `${settings.lowballCutoffPct}% · ${shareOfList(settings.lowballCutoffPct)}`,
      sentence: "Offers below this share of list are turned away as lowballs outright. Set it to off to consider every offer.",
      min: SETTING_RANGES.lowballCutoffPct[0], max: SETTING_RANGES.lowballCutoffPct[1], value: settings.lowballCutoffPct, dirty: settings.lowballCutoffPct !== savedSettings.lowballCutoffPct,
      ariaLabel: `Lowball cutoff: ${settings.lowballCutoffPct}% of list`,
      onChange: value => updateSetting("lowballCutoffPct", value),
    },
  };
  const active = pillConfig[pill];

  return <section className="paper race" aria-labelledby="race-title">
    <div className="race-head">
      <div><h2 id="race-title">Try it on 300 shoppers</h2>
        <label className="muted">Simulated on <select aria-label="Product" value={main.variantId} onChange={event => { setSelectedId(event.target.value); setRound(99); }}>{mains.map(item => <option key={item.variantId} value={item.variantId}>{item.title}{item.size ? ` · ${item.size}` : ""} · {money(item.list)}</option>)}</select> · never added to your real figures</label></div>
      <div className="race-figures">
        <p><b>{settled ? final.customersSaved : race.customersSaved}</b><span>customers saved {change(final.customersSaved, before.customersSaved, String)}</span></p>
        <p><b className={now.profit < 0 ? "down" : undefined}>{money(now.profit)}</b><span>profit {change(now.profit, was.profit, money)}</span></p>
      </div>
    </div>
    <p className="race-versus"><span className={now.vsNoShopkeeper < 0 ? "down" : "up"}>{money(Math.abs(now.vsNoShopkeeper))} {now.vsNoShopkeeper < 0 ? "less" : "more"} than no shopkeeper</span> · <span className={now.vsBanner < 0 ? "down" : "up"}>{money(Math.abs(now.vsBanner))} {now.vsBanner < 0 ? "less" : "more"} than a 20% banner</span></p>
    <svg className="race-stage" viewBox={`0 0 ${W} 372`} role="img" aria-label={`300 simulated shoppers. ${final.customersSaved} customers saved, profit ${money(now.profit)}.`} onMouseLeave={() => setHover(undefined)}>
      <rect x={x(cost)} y={CLOUD_TOP - 14} width={Math.max(0, x(floor) - x(cost))} height={BASE - CLOUD_TOP + 14} fill="#e8d6b9" opacity=".5" />
      <line x1="0" x2={W} y1={BASE} y2={BASE} stroke="#a49885" />
      <text x="0" y="18">what each shopper would pay →</text><text x="0" y={BASE + 34}>price they paid →</text>
      {[["cost", cost], ["floor", floor], ["list", list]].map(([label, cents]) => <text key={label} x={x(cents as number)} y={BASE + 18} textAnchor="middle">{label} {money(cents as number)}</text>)}
      {race.dots.map(dot => { const at = place(dot), look = OUTCOMES[dot.kind];
        return <circle key={dot.id} className="race-dot" r={hover === dot.id ? 6.5 : 4.2} fill={look.fill} stroke={look.stroke ?? "none"} strokeWidth="1.5" style={{ transform: `translate(${at.x}px, ${at.y}px)`, transitionDelay: `${Math.round(jitter(dot.id, 3) * 260)}ms` }} onMouseEnter={() => setHover(dot.id)} />; })}
      <g className="race-ask" style={{ transform: `translateX(${x(race.typicalAsk)}px)` }}><line y1={CLOUD_TOP - 22} y2={BASE} stroke="#9c2a1f" strokeWidth="2.5" /><text y={CLOUD_TOP - 28} textAnchor="middle">{race.round === 0 ? `asking ${money(list)}` : `round ${race.round} · typical ask ${money(race.typicalAsk)}`}</text></g>
    </svg>
    <ul className="race-key" aria-label="Outcomes">{(Object.keys(OUTCOMES) as RaceDot["kind"][]).filter(kind => used.has(kind) || kind === "deciding").map(kind => <li key={kind} style={{ "--fill": OUTCOMES[kind].fill, "--ring": OUTCOMES[kind].stroke ?? "transparent" } as React.CSSProperties}>{OUTCOMES[kind].label}</li>)}</ul>
    <p className="race-tip" role="status">{hovered ? <><b>{PERSONA_LABEL[hovered.persona]}</b> · would pay up to <b>{money(hovered.willingness)}</b> · {hovered.rounds.map((entry, index) => `round ${index + 1}: offered ${money(entry.offer)}, asked ${money(entry.ask)}`).join(" · ")} · {hovered.outcome === "bought" ? <>bought at <b>{money(hovered.agreed!)}</b>{hovered.agreed! < list && hovered.trade !== "bundle" ? " — a customer saved" : ""}</> : hovered.outcome === "would_ask_owner" ? "would ask you to decide" : hovered.missed ? "walked — a deal missed" : "walked away"}</> : "Point at a shopper to see what happened to them."}</p>
    <div className="race-strip">
      <div className="race-pill-row" role="tablist" aria-label="Setting">
        {PILLS.map(entry => <button key={entry.key} type="button" role="tab" aria-selected={pill === entry.key} className={`pill ${pill === entry.key ? "selected" : ""}`} onClick={() => setPill(entry.key)}>
          {entry.label}{pillConfig[entry.key].dirty && <span className="pill-dot" aria-hidden="true" />}
        </button>)}
      </div>
      <label className="race-slide" htmlFor={`race-${pill}`}><span><span>{PILLS.find(entry => entry.key === pill)!.label}</span><output>{active.valueLabel}</output></span>
        <input id={`race-${pill}`} aria-label={active.ariaLabel} type="range" min={active.min} max={active.max} step="1" value={active.value} disabled={saving} onChange={event => { stop(); setRound(99); active.onChange(Number(event.target.value)); }} onMouseUp={play} onTouchEnd={play} onKeyUp={play} /></label>
      <div className="race-actions"><button className="quiet" onClick={play}>▶ Play</button><button disabled={!dirty || saving} onClick={onAdopt}>{saving ? "Adopting…" : "Adopt"}</button></div>
      <p className="muted">{active.sentence}</p>
      <p className="race-state"><span className="saved-policy">Saved policy · cost + {policy.floorPct}%</span> · <span role="status">{dirty ? "Preview · not adopted" : "Your saved policy is active."}</span></p>
    </div>
  </section>;
}
