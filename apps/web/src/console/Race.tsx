import React, { useEffect, useMemo, useRef, useState } from "react";
import type { GymResult, OwnerProduct, Policy, PolicySettings } from "@bazaar/contracts";
import { raceLayout, runLiveGym, type RaceDot, type LiveGymInput } from "@bazaar/gym";
import { SETTING_RANGES, floorOf, resolveSettings } from "@bazaar/engine";
import { invalidReason, items } from "./gymItems";

type Draft = Pick<Policy, "floorPct" | "askOwner"> & { settings?: PolicySettings };
type PillKey = "floor" | "maxOff" | "rounds" | "lowball";
const PILLS: { key: PillKey; label: string }[] = [{ key: "floor", label: "Floor" }, { key: "maxOff", label: "Max off" }, { key: "rounds", label: "Rounds" }, { key: "lowball", label: "Lowball" }];
const PERSONA_LABEL: Record<RaceDot["persona"], string> = { bargain: "Bargain hunter", budgeted: "On a budget", impatient: "Impatient", loyal: "Loyal customer", lowballer: "Lowballer" };
const money = (cents: number) => `${cents < 0 ? "−" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-CA")}`;
const jitter = (id: number, salt: number) => (((id * 2654435761 + salt * 40503) >>> 0) % 1000) / 1000;

// One outcome bucket per group of shoppers. Order reads left-to-right as "how it went, best case first".
type GroupKey = "list" | "saved" | "bundle" | "owner" | "walked";
const GROUPS: { key: GroupKey; title: string; fill: string; stroke?: string; outline?: boolean }[] = [
  { key: "list", title: "Paid full price", fill: "var(--color-teal)" },
  { key: "saved", title: "Got a better deal", fill: "#19c3c3" },
  { key: "bundle", title: "Bought a bundle", fill: "#3a8f8a" },
  { key: "owner", title: "Would ask you", fill: "#f6d809", stroke: "var(--color-bark)" },
  { key: "walked", title: "Walked away", fill: "transparent", stroke: "#8a7f6c", outline: true },
];
function groupOf(dot: RaceDot): GroupKey {
  if (dot.kind === "list" || dot.kind === "saved" || dot.kind === "bundle" || dot.kind === "owner") return dot.kind;
  return "walked";
}
function outcomeLine(dot: RaceDot, list: number): string {
  const persona = PERSONA_LABEL[dot.persona];
  if (dot.kind === "list") return `${persona} · paid full price, ${money(dot.price!)}`;
  if (dot.kind === "saved") return `${persona} · got a better deal at ${money(dot.price!)} (list is ${money(list)})`;
  if (dot.kind === "bundle") return `${persona} · bought a bundle for ${money(dot.price!)}`;
  if (dot.kind === "owner") return `${persona} · borderline offer — would ask you to decide`;
  if (dot.kind === "missed") return `${persona} · walked away — would have paid up to ${money(dot.willingness)}, more than your floor`;
  return `${persona} · walked away — wasn't willing to pay your floor`;
}

/** Figures for one Gym run. Every number is derived from the run itself. */
function figures(result: GymResult, list: number, cost: number) {
  const banner = Math.round(list * 0.8);
  const bannerProfit = result.shoppers.filter(shopper => shopper.willingness >= banner).length * (banner - cost);
  const profit = result.profitVsBanner + bannerProfit;
  const noShopkeeper = result.shoppers.filter(shopper => shopper.willingness >= list).length * (list - cost);
  return { profit, vsNoShopkeeper: profit - noShopkeeper, vsBanner: result.profitVsBanner };
}

const W = 980, COLUMNS = 10, DOT_DX = 13, DOT_DY = 11, ZONE_GAP = 16, ZONE_TOP = 74, DOT_PAD = 16;

export function Race({ products, policy, draft, saving, onDraft, onAdopt }: { products: OwnerProduct[]; policy: Policy; draft?: Draft; saving?: boolean; onDraft(next: Draft): void; onAdopt(): void }) {
  const catalog = useMemo(() => items(products), [products]);
  // One entry per product, not per size: a shoe's three sizes all haggle the same way. Oldest stock
  // first — it has the most room to bend, so the visualization opens where haggling actually happens.
  const mains = useMemo(() => {
    const byProduct = new Map<string, (typeof catalog)[number]>();
    for (const item of catalog) {
      if (item.isAddOn || invalidReason(item) || byProduct.has(item.productId)) continue;
      byProduct.set(item.productId, item);
    }
    return [...byProduct.values()].sort((a, b) => Date.parse(a.stockedAt ?? "9999") - Date.parse(b.stockedAt ?? "9999"));
  }, [catalog]);
  const [selectedId, setSelectedId] = useState<string>();
  const [settled, setSettled] = useState(true);
  const [hover, setHover] = useState<number | undefined>(undefined);
  const [pill, setPill] = useState<PillKey>("floor");
  const [runAt] = useState(() => Date.now());
  const replayTimer = useRef<number | undefined>(undefined);
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

  function play() {
    if (window.clearTimeout) window.clearTimeout(replayTimer.current);
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setSettled(true); return; }
    setSettled(false);
    replayTimer.current = window.setTimeout(() => setSettled(true), 60);
  }
  useEffect(() => () => window.clearTimeout(replayTimer.current), []);

  if (!main || !run) return <section className="paper race" aria-labelledby="race-title"><h2 id="race-title">Try it on 300 shoppers</h2><p className="muted">No product is ready to simulate: each needs a cost in Shopify and stock on hand.</p></section>;

  const cost = main.cost!, list = main.list, floor = floorOf(cost, floorPct);
  const final = raceLayout(run.candidate, list, 99), before = raceLayout(run.saved, list, 99);
  const now = figures(run.candidate, list, cost), was = figures(run.saved, list, cost);

  const groups = GROUPS.map(group => ({ ...group, dots: final.dots.filter(dot => groupOf(dot) === group.key) }));
  const missedCount = final.dots.filter(dot => dot.kind === "missed").length;
  const maxRows = Math.max(1, ...groups.map(group => Math.ceil(group.dots.length / COLUMNS)));
  const zoneWidth = COLUMNS * DOT_DX + DOT_PAD;
  const totalWidth = groups.length * zoneWidth + (groups.length - 1) * ZONE_GAP;
  const startX = (W - totalWidth) / 2;
  const zoneX = new Map(groups.map((group, index) => [group.key, startX + index * (zoneWidth + ZONE_GAP)]));
  const gridBottom = ZONE_TOP + maxRows * DOT_DY + 16;
  const height = gridBottom + (missedCount > 0 ? 46 : 26);
  const crowdCenterY = 26;

  function posFor(dot: RaceDot, seat: number, key: GroupKey): { x: number; y: number } {
    if (!settled) return { x: W / 2 + (jitter(dot.id, 1) - 0.5) * (W - 60), y: crowdCenterY + (jitter(dot.id, 2) - 0.5) * 24 };
    const zx = zoneX.get(key)!;
    return { x: zx + DOT_PAD / 2 + (seat % COLUMNS) * DOT_DX, y: ZONE_TOP + Math.floor(seat / COLUMNS) * DOT_DY };
  }

  const change = (next: number, prev: number, format: (value: number) => string) => next !== prev
    ? <i className={next > prev ? "up" : "down"}>{next > prev ? "▲" : "▼"} {format(Math.abs(next - prev))}</i> : null;
  const hovered = hover === undefined ? undefined : final.dots.find(dot => dot.id === hover);

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
        <label className="muted">Simulated on <select aria-label="Product" value={main.variantId} onChange={event => { setSelectedId(event.target.value); setSettled(true); }}>{mains.map(item => <option key={item.variantId} value={item.variantId}>{item.title} · {money(item.list)}</option>)}</select> · never added to your real figures</label></div>
      <div className="race-figures">
        <p><b>{final.customersSaved}</b><span>customers saved {change(final.customersSaved, before.customersSaved, String)}</span></p>
        <p><b className={now.profit < 0 ? "down" : undefined}>{money(now.profit)}</b><span>profit {change(now.profit, was.profit, money)}</span></p>
      </div>
    </div>
    <p className="race-versus"><span className={now.vsNoShopkeeper < 0 ? "down" : "up"}>{money(Math.abs(now.vsNoShopkeeper))} {now.vsNoShopkeeper < 0 ? "less" : "more"} than no shopkeeper</span> · <span className={now.vsBanner < 0 ? "down" : "up"}>{money(Math.abs(now.vsBanner))} {now.vsBanner < 0 ? "less" : "more"} than a 20% banner</span></p>
    <svg className="race-stage" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`300 simulated shoppers. ${final.customersSaved} customers saved, profit ${money(now.profit)}.`} onMouseLeave={() => setHover(undefined)}>
      {groups.map(group => {
        const zx = zoneX.get(group.key)!, rectH = maxRows * DOT_DY + 8;
        return <g key={group.key}>
          <rect x={zx - 4} y={ZONE_TOP - 30} width={zoneWidth} height={rectH + 34} rx="12" fill={group.outline ? "#f3ead9" : group.fill} fillOpacity={group.outline ? 1 : 0.1} />
          <text className="group-count" x={zx - 4 + zoneWidth / 2} y={ZONE_TOP - 10} textAnchor="middle" fill={group.outline ? "#5c503e" : group.fill}>{group.dots.length}</text>
          <text className="group-title" x={zx - 4 + zoneWidth / 2} y={ZONE_TOP + rectH + 16} textAnchor="middle">{group.title}</text>
          {group.key === "walked" && missedCount > 0 && <text className="group-note" x={zx - 4 + zoneWidth / 2} y={ZONE_TOP + rectH + 32} textAnchor="middle">{missedCount} would've paid more than your floor</text>}
        </g>;
      })}
      {final.dots.map((dot, index) => {
        const key = groupOf(dot);
        const seat = groups.find(group => group.key === key)!.dots.indexOf(dot);
        const at = posFor(dot, seat, key);
        const look = GROUPS.find(group => group.key === key)!;
        return <circle key={dot.id} className="race-dot" r={hover === dot.id ? 6 : 3.6} fill={look.fill} stroke={look.stroke ?? "none"} strokeWidth="1.4"
          style={{ transform: `translate(${at.x}px, ${at.y}px)`, transitionDelay: `${Math.round(jitter(dot.id, 3) * 320)}ms` }}
          onMouseEnter={() => setHover(dot.id)} />;
      })}
    </svg>
    <div className="race-below">
      <button className="quiet" onClick={play}>▶ Replay</button>
      <p className="race-tip" role="status">{hovered ? outcomeLine(hovered, list) : "Point at a shopper to see what happened to them."}</p>
    </div>
    <div className="race-strip">
      <div className="race-pill-row" role="tablist" aria-label="Setting">
        {PILLS.map(entry => <button key={entry.key} type="button" role="tab" aria-selected={pill === entry.key} className={`pill ${pill === entry.key ? "selected" : ""}`} onClick={() => setPill(entry.key)}>
          {entry.label}{pillConfig[entry.key].dirty && <span className="pill-dot" aria-hidden="true" />}
        </button>)}
      </div>
      <label className="race-slide" htmlFor={`race-${pill}`}><span><span>{PILLS.find(entry => entry.key === pill)!.label}</span><output>{active.valueLabel}</output></span>
        <input id={`race-${pill}`} aria-label={active.ariaLabel} type="range" min={active.min} max={active.max} step="1" value={active.value} disabled={saving} onChange={event => { active.onChange(Number(event.target.value)); }} onMouseUp={play} onTouchEnd={play} onKeyUp={play} /></label>
      <div className="race-actions"><button disabled={!dirty || saving} onClick={onAdopt}>{saving ? "Adopting…" : "Adopt"}</button></div>
      <p className="muted">{active.sentence}</p>
      <p className="race-state"><span className="saved-policy">Saved policy · cost + {policy.floorPct}%</span> · <span role="status">{dirty ? "Preview · not adopted" : "Your saved policy is active."}</span></p>
    </div>
  </section>;
}
