import React, { useEffect, useRef, useState } from "react";
import type { Approval } from "@bazaar/contracts";
import type { ConsolePort } from "./data/port";
import { money } from "./Feed";
export function Approvals({ approvals, port, onResolved }: { approvals: Approval[]; port: ConsolePort; onResolved(id: string): void }) {
  const [notice, setNotice] = useState("");
  return <div className="approvals">
    {notice && <p className="paper" role="status">{notice}</p>}
    {approvals.length === 0 && <section className="paper"><h2>Owner decisions</h2><p>No approvals pending.</p></section>}
    {approvals.map(approval => <ApprovalCard key={approval.id} approval={approval} port={port} onResolved={label => { setNotice(label); onResolved(approval.id); }} />)}
  </div>;
}
function ApprovalCard({ approval, port, onResolved }: { approval: Approval; port: ConsolePort; onResolved(label: string): void }) {
  const remaining = () => Math.max(0, Math.min(45, Math.ceil((Date.parse(approval.deadline) - Date.now()) / 1000)));
  const [seconds, setSeconds] = useState(remaining);
  const inFlight = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setSeconds(remaining()), 250);
    return () => clearInterval(timer);
  }, [approval.deadline]);
  useEffect(() => { if (seconds === 0) void decide("declined", true); }, [seconds]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function decide(decision: "approved" | "declined", timeout = false) {
    if (inFlight.current || (!timeout && Date.now() >= Date.parse(approval.deadline))) return;
    inFlight.current = true; setBusy(true); setError("");
    const expired = Date.now() >= Date.parse(approval.deadline);
    try { await port.resolveApproval(approval.id, expired ? "declined" : decision); onResolved(expired ? "Timed out · declined" : decision === "approved" ? "Approved" : "Declined"); }
    catch { inFlight.current = false; setError("Could not send your decision. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="paper approval-card" aria-label="Your decision" style={{ backgroundColor: "#f6d809" }}>
    <h2>Your decision</h2><p>This offer is below your floor, but above cost.</p>
    {approval.items.map(item => <p key={item.variantId}>{item.title}{item.size ? ` · size ${item.size}` : ""} × {item.qty}</p>)}
    <p className="approval-offer">{money(approval.offer)}</p>
    <p className="approval-profit">Profit {money(approval.profit)} · {approval.pctOverCost}% over cost</p>
    <p className="countdown-label">{seconds}s to decide</p>
    <div className="countdown-track" role="progressbar" aria-label="Decision time remaining" aria-valuemin={0} aria-valuemax={45} aria-valuenow={seconds}><span style={{ width: `${seconds / 45 * 100}%` }} /></div>
    <div className="decision-actions"><button disabled={busy || seconds === 0} onClick={() => void decide("approved")}>Approve</button><button className="secondary" disabled={busy || seconds === 0} onClick={() => void decide("declined")}>Decline</button></div>
    {error && <><p role="alert">{error}</p>{seconds === 0 && <button disabled={busy} onClick={() => void decide("declined", true)}>Retry timeout</button>}</>}
  </section>;
}
