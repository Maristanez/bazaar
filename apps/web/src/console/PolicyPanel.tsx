import React, { useState } from "react";
import type { OwnerProduct, Policy } from "@bazaar/contracts";
import type { ConsolePort } from "./data/port";
export function PolicyPanel({ policy, products, port, onPolicy }: { policy: Policy; products: OwnerProduct[]; port: ConsolePort; onPolicy(policy: Policy): void }) {
  const [draft, setDraft] = useState<Pick<Policy, "floorPct" | "askOwner"> | null>(null);
  const { floorPct, askOwner } = draft ?? policy;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = floorPct !== policy.floorPct || askOwner !== policy.askOwner;
  async function adopt() {
    if (saving || !dirty) return;
    setSaving(true); setError("");
    try { onPolicy(await port.setPolicy({ floorPct, askOwner })); setDraft(null); }
    catch { setError("Could not adopt this policy. Your preview is still here; try again."); }
    finally { setSaving(false); }
  }
  return <section className="paper policy-panel" aria-labelledby="policy-title">
    <h2 id="policy-title">Your policy</h2>
    <p className="muted">Set the room your shopkeeper has to negotiate.</p>
    <label className="floor-label" htmlFor="floor-slider">Floor: cost + {floorPct}%</label>
    <input id="floor-slider" type="range" min="0" max="60" step="1" value={floorPct} disabled={saving} onChange={event => setDraft({ floorPct: Number(event.target.value), askOwner })} />
    <div className="slider-scale" aria-hidden="true"><span>Cost + 0%</span><span>Cost + 60%</span></div>
    <label className="ask-switch"><span>Ask me about thin-margin deals</span><input type="checkbox" role="switch" checked={askOwner} disabled={saving} onChange={event => setDraft({ floorPct, askOwner: event.target.checked })} /></label>
    <div className="adopt-row"><div><p className="saved-policy">Saved policy · cost + {policy.floorPct}%</p><p className="preview-state" role="status">{dirty ? "Preview · not adopted" : "Your saved policy is active."}</p></div><button disabled={!dirty || saving} onClick={() => void adopt()}>{saving ? "Adopting…" : "Adopt"}</button></div>
    {error && <p role="alert">{error}</p>}
    <div className="product-flags"><h3>Product checks</h3><ul aria-label="Flagged products">{products.filter(product => product.missingCost || product.missingStockedAt).map(product => <li key={product.productId} aria-label={product.title} style={{ backgroundColor: product.missingCost ? "#f3675a" : "#e8d6b9" }}>
      <strong>{product.title}</strong>
      {product.missingCost && <span>missing cost — not open to offers</span>}
      {product.missingStockedAt && <span>no stock date — treated as new stock</span>}
    </li>)}</ul></div>
  </section>;
}
