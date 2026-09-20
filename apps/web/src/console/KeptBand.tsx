import React from "react";
import type { DealKpis } from "@bazaar/contracts";

const dollars = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Real settled deals only. Simulated figures never appear here (SPEC §4.4.2). */
export function KeptBand({ kpis }: { kpis?: DealKpis }) {
  const none = !kpis || kpis.deals === 0;
  if (none) return <section className="paper kept-band kept-band-empty" aria-label="Real deals">
    <p>Your shopkeeper hasn't settled a real deal yet. Once one closes, this bar shows what you kept, how many customers it saved, and how it stacks up against a flat 20% banner.</p>
  </section>;
  const kept = kpis.profitRecovered - Math.round(kpis.agentCostUsd * 100);
  return <section className="paper kept-band" aria-label="Real deals">
    <p className="kept-hero"><b>{dollars(kept)}</b><span>you kept · on {kpis.deals} real {kpis.deals === 1 ? "deal" : "deals"}</span></p>
    <p><b>{kpis.customersSaved}</b><span>customers saved</span></p>
    <p><b>{dollars(kpis.revenueRecovered)}</b><span>revenue recovered</span></p>
    <p><b className={kpis.vsBanner < 0 ? "down" : undefined}>{dollars(kpis.vsBanner)}</b><span>vs a 20% banner</span></p>
  </section>;
}
