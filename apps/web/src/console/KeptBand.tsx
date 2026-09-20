import React from "react";
import type { DealKpis } from "@bazaar/contracts";

const dollars = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Real settled deals only. Simulated figures never appear here (SPEC §4.4.2). */
export function KeptBand({ kpis }: { kpis?: DealKpis }) {
  const none = !kpis || kpis.deals === 0;
  const kept = kpis ? kpis.profitRecovered - Math.round(kpis.agentCostUsd * 100) : 0;
  return <section className="paper kept-band" aria-label="Real deals">
    <p className="kept-hero"><b>{none ? "—" : dollars(kept)}</b><span>{none ? "No deals yet" : `you kept · on ${kpis.deals} real ${kpis.deals === 1 ? "deal" : "deals"}`}</span></p>
    <p><b>{none ? "—" : kpis.customersSaved}</b><span>customers saved</span></p>
    <p><b>{none ? "—" : dollars(kpis.revenueRecovered)}</b><span>revenue recovered</span></p>
    <p><b className={!none && kpis.vsBanner < 0 ? "down" : undefined}>{none ? "—" : dollars(kpis.vsBanner)}</b><span>vs a 20% banner</span></p>
  </section>;
}
