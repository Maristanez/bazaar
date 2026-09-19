import { useEffect, useMemo, useRef, useState } from "react";
import type { GymResult, GymShopper, OwnerProduct, Policy } from "@bazaar/contracts";
import { runLiveGym, type LiveGymInput } from "../../../../packages/gym/src/live";
import type { NegotiationItem } from "../../../../packages/engine/src/negotiate";

type GymItem = NegotiationItem & { openToOffers: boolean };
type Persona = GymShopper["persona"];
type Filter = Persona | "all";
type PositionedDot = { id: number; x: number; y: number; shopper: GymShopper; state: "haggling" | GymShopper["outcome"] };

const PERSONAS: readonly { id: Persona; label: string }[] = [
  { id: "bargain", label: "Bargain hunter" },
  { id: "budgeted", label: "Budgeted runner" },
  { id: "impatient", label: "Impatient" },
  { id: "loyal", label: "Loyal" },
  { id: "lowballer", label: "Lowballer" },
];

const PLOT = { left: 58, right: 760, top: 40, baseline: 278 } as const;
const PILE = { left: 822, columns: 25, gap: 6.1 } as const;

function items(products: OwnerProduct[]): GymItem[] {
  return products.flatMap((product) => product.variants.map((variant) => ({
    variantId: variant.variantId,
    productId: product.productId,
    title: product.title,
    size: variant.size,
    productType: product.productType,
    list: variant.price,
    cost: variant.unitCost,
    stockedAt: product.stockedAt,
    inStock: variant.inStock,
    isAddOn: /accessor|sock|gaiter|flask|cap|bag|tote/i.test(`${product.productType || ""} ${product.title}`),
    openToOffers: product.openToOffers,
  })));
}

function invalidReason(main: GymItem | undefined): string | undefined {
  if (!main) return "No main product is available for rehearsal.";
  if (!main.inStock) return "This variant is out of stock, so it cannot enter the Gym.";
  if (main.cost === null) return "This variant is missing cost, so it is not open to offers.";
  if (!main.openToOffers) return "This product is not open to offers.";
  if (!Number.isSafeInteger(main.list) || !Number.isSafeInteger(main.cost) || main.list <= 0 || main.cost <= 0) return "This variant has invalid price data.";
  return undefined;
}

function xFor(price: number, cost: number, maximum: number): number {
  const ratio = (price - cost) / Math.max(1, maximum - cost);
  return PLOT.left + Math.min(1, Math.max(0, ratio)) * (PLOT.right - PLOT.left);
}

function layoutDots(result: GymResult, round: number, cost: number, maximum: number): PositionedDot[] {
  const binStacks = new Map<number, number>();
  let walked = 0;
  let owner = 0;

  return result.shoppers.map((shopper) => {
    const settled = round >= shopper.rounds.length;
    if (!settled) {
      const entry = shopper.rounds[Math.min(round - 1, shopper.rounds.length - 1)]!;
      return {
        id: shopper.id,
        x: xFor(entry.offer, cost, maximum) + ((shopper.id * 17) % 7) - 3,
        y: PLOT.top + 18 + ((shopper.id * 37) % 18) * 10,
        shopper,
        state: "haggling",
      };
    }

    if (shopper.outcome === "bought") {
      const bin = Math.max(0, Math.floor((shopper.agreed! - cost) / 500));
      const stack = binStacks.get(bin) ?? 0;
      binStacks.set(bin, stack + 1);
      return {
        id: shopper.id,
        x: xFor(shopper.agreed!, cost, maximum) + ((stack % 8) - 3.5) * 5.5,
        y: PLOT.baseline - 7 - Math.floor(stack / 8) * 6.5,
        shopper,
        state: "bought",
      };
    }

    if (shopper.outcome === "would_ask_owner") {
      const index = owner++;
      return {
        id: shopper.id,
        x: PILE.left + (index % PILE.columns) * PILE.gap,
        y: 127 - Math.floor(index / PILE.columns) * PILE.gap,
        shopper,
        state: "would_ask_owner",
      };
    }

    const index = walked++;
    return {
      id: shopper.id,
      x: PILE.left + (index % PILE.columns) * PILE.gap,
      y: 270 - Math.floor(index / PILE.columns) * PILE.gap,
      shopper,
      state: "walked",
    };
  });
}

export function Gym({ products, policy, draft }: { products: OwnerProduct[]; policy: Policy; draft?: Pick<Policy, "floorPct" | "askOwner"> }) {
  const catalog = useMemo(() => items(products), [products]);
  const mains = useMemo(() => catalog.filter((item) => !item.isAddOn), [catalog]);
  const [selectedId, setSelectedId] = useState<string>();
  const [runAt, setRunAt] = useState<number>();
  const [selectedDot, setSelectedDot] = useState<number>();
  const [persona, setPersona] = useState<Filter>("all");
  const [round, setRound] = useState(4);
  const [animationKey, setAnimationKey] = useState(0);
  const timers = useRef<number[]>([]);
  const main = mains.find((item) => item.variantId === selectedId) ?? mains[0];
  const floorPct = draft?.floorPct ?? policy.floorPct;
  const askOwner = draft?.askOwner ?? policy.askOwner;
  const reason = invalidReason(main);

  const run = useMemo(() => {
    if (runAt === undefined || !main || reason) return { result: undefined, saved: undefined, error: undefined };
    const input: LiveGymInput = { main, catalog, floorPct, askOwner, seed: 42, n: 300, now: new Date(runAt) };
    try {
      const candidate = runLiveGym(input);
      const differs = floorPct !== policy.floorPct || askOwner !== policy.askOwner;
      return {
        result: candidate,
        saved: differs ? runLiveGym({ ...input, floorPct: policy.floorPct, askOwner: policy.askOwner }) : undefined,
        error: undefined,
      };
    } catch (error) {
      return { result: undefined, saved: undefined, error: error instanceof Error ? error.message : "The Gym could not run." };
    }
  }, [askOwner, catalog, floorPct, main, policy.askOwner, policy.floorPct, reason, runAt]);

  useEffect(() => () => timers.current.forEach((timer) => window.clearTimeout(timer)), []);
  useEffect(() => {
    if (animationKey === 0 || !run.result) return;
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    const reduceMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setRound(4);
      return;
    }
    setRound(1);
    timers.current = [2, 3, 4].map((value) => window.setTimeout(() => setRound(value), (value - 1) * 1000));
    return () => timers.current.forEach((timer) => window.clearTimeout(timer));
  }, [animationKey]);

  function startRun(): void {
    if (reason) return;
    setRunAt(Date.now());
    setSelectedDot(undefined);
    setAnimationKey((value) => value + 1);
  }

  function scrub(value: number): void {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
    setRound(value);
  }

  const maximum = Math.max(main?.list ?? 1, run.result?.bins.at(-1) ?? 1, run.saved?.bins.at(-1) ?? 1);
  const dots = run.result && main?.cost !== null && main?.cost !== undefined ? layoutDots(run.result, round, main.cost, maximum) : [];
  const savedDots = run.saved && main?.cost !== null && main?.cost !== undefined ? layoutDots(run.saved, round, main.cost, maximum) : [];
  const visibleOwner = dots.filter((position) => position.state === "would_ask_owner").length;
  const visibleWalked = dots.filter((position) => position.state === "walked").length;
  const dot = run.result?.shoppers.find((shopper) => shopper.id === selectedDot);
  const floor = main?.cost === null || main?.cost === undefined ? 0 : Math.max(main.cost + 1, Math.ceil(main.cost * (1 + floorPct / 100)));
  const banner = Math.round((main?.list ?? 0) * 0.8);
  const ask = run.result?.shoppers.find((shopper) => shopper.rounds[round - 1])?.rounds[round - 1]?.ask;
  const costX = main?.cost === null || main?.cost === undefined ? PLOT.left : xFor(main.cost, main.cost, maximum);
  const floorX = main?.cost === null || main?.cost === undefined ? PLOT.left : xFor(floor, main.cost, maximum);
  const splitCostFloorLabels = Math.abs(floorX - costX) < 64;

  return <section className="paper gym" aria-labelledby="gym-title">
    <div className="section-heading">
      <div><h2 id="gym-title">The Gym</h2><p>300 synthetic shoppers · rule-based · seed 42 · results may differ from real buyer behaviour.</p></div>
      <button onClick={startRun} disabled={Boolean(reason)}>{run.result ? "Run again" : "Run the Gym"}</button>
    </div>

    <div className="gym-controls">
      <label>Product
        <select value={main?.variantId ?? ""} onChange={(event) => { setSelectedId(event.target.value); setSelectedDot(undefined); }}>
          {mains.map((item) => <option value={item.variantId} key={item.variantId}>{item.title}{item.size ? ` · size ${item.size}` : ""}{!item.inStock ? " · out of stock" : item.cost === null ? " · missing cost" : item.stockedAt ? "" : " · new stock"}</option>)}
        </select>
      </label>
      <div className="gym-policy-readout"><strong>Candidate floor: cost + {floorPct}%</strong><span>{askOwner ? "Owner review on" : "Owner review off"}</span></div>
      <span className="gym-preview">{floorPct === policy.floorPct && askOwner === policy.askOwner ? "Saved policy" : "Preview · use Adopt above to save"}</span>
    </div>

    {reason && <p className="gym-invalid" role="status">{reason}</p>}
    {!reason && !run.result && <p className="gym-empty">Run a local rehearsal before changing the saved policy. The Gym uses the live priced menu with rule-based choices. It does not call Backboard or change saved policy.</p>}
    {run.error && <p className="gym-invalid" role="alert">{run.error}</p>}

    {run.result && main?.cost !== null && main?.cost !== undefined && <>
      <div className={`gym-headline ${run.result.profitVsBanner >= 0 ? "gym-win" : "gym-loss"}`}>
        <div><span>Profit vs a 20% off banner</span><strong>{run.result.profitVsBanner >= 0 ? "Haggling wins" : "Haggling loses"}</strong></div>
        <b>{signedMoney(run.result.profitVsBanner)}</b>
      </div>
      <div className="gym-metrics" aria-label="Candidate policy results">
        <span><strong>{run.result.bought}</strong> bought</span>
        <span><strong>{run.result.dealsMissed}</strong> deals missed</span>
        <span><strong>{run.result.wouldAskOwner}</strong> would ask you</span>
        <span><strong>{money(run.result.avgAgreed)}</strong> average agreed</span>
      </div>
      {run.saved && <p className="gym-compare"><strong>Policy comparison:</strong> Saved A · cost + {policy.floorPct}% · {signedMoney(run.saved.profitVsBanner)} vs banner <span aria-hidden="true">→</span> Candidate B · cost + {floorPct}% · {signedMoney(run.result.profitVsBanner)} vs banner.</p>}

      <div className="gym-toolbar">
        <div className="gym-round-control">
          <label htmlFor="gym-round">Round <output htmlFor="gym-round">{round} of 4</output></label>
          <input id="gym-round" type="range" min="1" max="4" step="1" value={round} onChange={(event) => scrub(Number(event.target.value))} aria-label="Animation round" />
          <button className="secondary gym-replay" onClick={() => setAnimationKey((value) => value + 1)}>Replay 3 seconds</button>
        </div>
        <div className="gym-legend" aria-label="Filter shoppers by persona">
          <button className={persona === "all" ? "selected" : ""} aria-pressed={persona === "all"} onClick={() => setPersona("all")}>All shoppers</button>
          {PERSONAS.map(({ id, label }) => <button key={id} className={`${persona === id ? "selected" : ""} gym-persona-${id}`} aria-pressed={persona === id} onClick={() => setPersona(id)}><span aria-hidden="true" />{label}</button>)}
        </div>
      </div>

      <div className="gym-chart-wrap">
        <svg className="gym-chart" viewBox="0 0 1000 340" role="list" aria-labelledby="gym-chart-title gym-chart-description">
          <title id="gym-chart-title">Synthetic shopper price swarm</title>
          <desc id="gym-chart-description">Candidate shoppers are coloured by persona. Settled buyers stack over agreed prices; shoppers who walked and shoppers requiring owner review collect in separate piles.</desc>
          <rect className="gym-thin-band" x={costX} y={PLOT.top} width={Math.max(0, floorX - PLOT.left)} height={PLOT.baseline - PLOT.top} />
          <line className="gym-axis" x1={PLOT.left} x2={PLOT.right} y1={PLOT.baseline} y2={PLOT.baseline} />
          <ReferenceLine x={costX} label="Cost" amount={main.cost} labelY={splitCostFloorLabels ? 296 : 306} />
          <ReferenceLine x={floorX} label="Floor" amount={floor} labelY={splitCostFloorLabels ? 324 : 306} />
          <ReferenceLine x={xFor(main.list, main.cost, maximum)} label="List" amount={main.list} />
          <line className="gym-reference gym-banner-line" x1={xFor(banner, main.cost, maximum)} x2={xFor(banner, main.cost, maximum)} y1={PLOT.top} y2={PLOT.baseline} />
          <text className="gym-banner-label" x={xFor(banner, main.cost, maximum)} y="28">20% banner {money(banner)}</text>
          {ask !== undefined && <><line className="gym-ask-line" x1={xFor(ask, main.cost, maximum)} x2={xFor(ask, main.cost, maximum)} y1={PLOT.top} y2={PLOT.baseline} /><text className="gym-ask-label" x={xFor(ask, main.cost, maximum)} y="48">R{round} example ask</text></>}
          <line className="gym-pile-divider" x1="798" x2="798" y1="34" y2="300" />
          <text className="gym-pile-title" x="822" y="32">Would ask you</text>
          <text className="gym-pile-count" x="975" y="32" textAnchor="end">{visibleOwner}</text>
          <text className="gym-pile-title" x="822" y="177">Walked</text>
          <text className="gym-pile-count" x="975" y="177" textAnchor="end">{visibleWalked}</text>
          {savedDots.map((position) => <circle key={`saved-${position.id}`} className="gym-dot-saved" cx={position.x} cy={position.y} r={position.state === "walked" || position.state === "would_ask_owner" ? 3.8 : 5.2} />)}
          {dots.map((position) => {
            const filtered = persona !== "all" && position.shopper.persona !== persona;
            const label = shopperLabel(position.shopper);
            return <g key={position.id} role="listitem" aria-label={label} aria-current={selectedDot === position.id ? "true" : undefined} tabIndex={filtered ? -1 : 0} className={`gym-svg-dot gym-persona-${position.shopper.persona} gym-state-${position.state} ${filtered ? "gym-dot-filtered" : ""} ${selectedDot === position.id ? "gym-dot-selected" : ""}`} style={{ transform: `translate(${position.x}px, ${position.y}px)` }} onClick={() => !filtered && setSelectedDot(position.id)} onKeyDown={(event) => { if (!filtered && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setSelectedDot(position.id); } }}>
              <circle cx="0" cy="0" r={position.state === "walked" || position.state === "would_ask_owner" ? 3.4 : 5} />
            </g>;
          })}
        </svg>
      </div>

      {dot ? <article className="gym-transcript" aria-live="polite">
        <header><div><strong>Shopper {dot.id} · {personaLabel(dot.persona)}</strong><span>Willingness {money(dot.willingness)}</span></div><button className="gym-close-transcript secondary" onClick={() => setSelectedDot(undefined)} aria-label="Close shopper transcript">Close</button></header>
        <ol>{dot.rounds.map((entry, index) => <li key={index}><b>Round {index + 1}</b><span>Shopper offered {money(entry.offer)}</span><span>Shopkeeper asked {money(entry.ask)}</span></li>)}</ol>
        <p className="gym-transcript-outcome"><strong>{outcomeText(dot)}</strong>{dot.trade ? ` · ${tradeText(dot.trade)}` : dot.missed ? " · deal missed" : ""}</p>
      </article> : <p className="gym-chart-help">Select any dot with a pointer or keyboard to inspect the transcript that produced it.</p>}
    </>}
  </section>;
}

function ReferenceLine({ x, label, amount, labelY = 306 }: { x: number; label: string; amount: number; labelY?: number }) {
  return <g><line className={`gym-reference gym-${label.toLowerCase()}-line`} x1={x} x2={x} y1={PLOT.top} y2={PLOT.baseline} /><text className="gym-axis-label" x={x} y={labelY} textAnchor={label === "Cost" ? "start" : label === "List" ? "end" : "middle"}><tspan x={x}>{label}</tspan><tspan x={x} dy="14">{money(amount)}</tspan></text></g>;
}

function personaLabel(persona: Persona): string { return PERSONAS.find((item) => item.id === persona)?.label ?? persona; }
function money(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }
function signedMoney(cents: number): string { return `${cents >= 0 ? "+" : "−"}${money(Math.abs(cents))}`; }
function shopperLabel(shopper: GymShopper): string { return `Shopper ${shopper.id}, ${personaLabel(shopper.persona)}, ${outcomeText(shopper)}`; }
function outcomeText(shopper: GymShopper): string { return shopper.outcome === "bought" ? `Bought at ${money(shopper.agreed!)}` : shopper.outcome === "would_ask_owner" ? "Would ask owner" : "Walked"; }
function tradeText(trade: NonNullable<GymShopper["trade"]>): string { return trade === "bundle" ? "bundle trade" : trade === "accepted" ? "shopper offer accepted" : trade === "final" ? "final held price" : "held price"; }
