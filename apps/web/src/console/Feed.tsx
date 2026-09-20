import React, { useState } from "react";
import type { ConsoleEvent } from "@bazaar/contracts";
export const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);

const SHOWN = 3;

export function Feed({ events }: { events: ConsoleEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events : events.slice(0, SHOWN);
  const more = events.length - SHOWN;
  return <section className="paper feed" aria-labelledby="feed-title">
    <div className="section-heading"><h2 id="feed-title">Live feed</h2><span>{events.length} events</span></div>
    <p className="muted">Every offer. Every decision. Both surfaces.</p>
    <div className="feed-rows" aria-live="polite" aria-relevant="additions">
      {events.length === 0 && <p className="empty">Waiting for the first offer.</p>}
      {visible.map((event, index) => <FeedRow key={`${event.at}-${event.negotiationId}-${event.kind}-${index}`} event={event} />)}
    </div>
    {more > 0 && <button className="quiet feed-toggle" onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : `Show all ${events.length}`}</button>}
  </section>;
}
function FeedRow({ event }: { event: ConsoleEvent }) {
  const picked = event.menu?.find(option => option.id === event.picked);
  const blocked = event.kind === "blocked";
  return <article className="feed-row" aria-label={blocked ? `blocked · ${event.blockedBy}` : event.kind}
    style={blocked ? { backgroundColor: "#f3675a" } : undefined}>
    <div className="row-prices">{event.offer !== undefined && <span>Offer <b>{money(event.offer)}</b></span>}
      {event.floor !== undefined && <span>Floor <b>{money(event.floor)}</b></span>}
      {blocked && <strong>Blocked · {event.blockedBy}</strong>}</div>
    <p>{event.reasoning}</p>
    {event.menu && <ul className="menu-options" aria-label="Menu">{event.menu.map(option => <li key={option.id}>
      <b>{option.id}</b> {option.items.map(item => item.title).join(" + ")} · {money(option.total)}
    </li>)}</ul>}
    {event.picked && <p className="pick">Picked {event.picked}{picked && <> · {picked.items.map(item => item.title).join(" + ")} <b>{money(picked.total)}</b></>}</p>}
    {event.memory && <p className="memory">Memory: “{event.memory}”</p>}
    <footer><span className="surface-chip">{event.surface === "storefront" ? "Storefront" : "ChatGPT"}</span>
      {event.llm && <small>{event.llm.model} · {event.llm.ms} ms · cost_usd {event.llm.costUsd === null ? "unreported" : `$${event.llm.costUsd.toFixed(4)}`}</small>}</footer>
  </article>;
}
