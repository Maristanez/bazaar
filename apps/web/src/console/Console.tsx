import React, { useEffect, useRef, useState } from "react";
import type { ConsoleEvent, ConsoleState, Policy } from "@bazaar/contracts";
import type { ConsolePort } from "./data/port";
import { Approvals } from "./Approvals";
import { PolicyPanel } from "./PolicyPanel";
import { Feed } from "./Feed";
export function Console({ port, onSignOut }: { port: ConsolePort; onSignOut?: () => void }) {
  const policyRevision = useRef(0);
  const [state, setState] = useState<ConsoleState>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [streamMessage, setStreamMessage] = useState("");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<ConsoleEvent[]>([]);
  useEffect(() => {
    let active = true;
    const approvalEvents: ConsoleEvent[] = [];
    let loadVersion = 0;
    function applyApproval(snapshot: ConsoleState, event: ConsoleEvent): ConsoleState {
      if (!event.approval) return snapshot;
      return { ...snapshot, pendingApprovals: [
        ...snapshot.pendingApprovals.filter(approval => approval.id !== event.approval!.id),
        ...(event.approval.status === "requested" ? [event.approval] : []),
      ] };
    }
    async function reloadState() {
      const version = ++loadVersion;
      const since = approvalEvents.length;
      const revision = policyRevision.current;
      try {
        const snapshot = await port.load();
        if (active && version === loadVersion) {
          const refreshed = approvalEvents.slice(since).reduce(applyApproval, snapshot);
          setState(current => current && revision !== policyRevision.current ? { ...refreshed, policy: current.policy } : refreshed);
          setError("");
        }
      } catch { if (active) setError("Could not load Console. Please try again."); }
    }
    setError("");
    void reloadState();
    let connectedBefore = false;
    const unsubscribe = port.subscribe(event => {
      if (!active) return;
      setEvents(rows => [event, ...rows].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)));
      if (event.approval) {
        approvalEvents.push(event);
        setState(value => value && applyApproval(value, event));
      }
    }, connection => {
      if (!active) return;
      setStreamMessage(connection === "connected" ? "" : connection === "unauthorized" ? "Feed authorization expired. Sign in again or wait for session refresh." : "Feed disconnected. Reconnecting…");
      if (connection === "connected") {
        if (connectedBefore) void reloadState();
        connectedBefore = true;
      }
    });
    return () => { active = false; unsubscribe(); };
  }, [port, attempt]);
  if (!state) return <main className="paper config-error">{error ? <><p role="alert">{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry</button></> : <p role="status">Loading Console…</p>}</main>;
  async function togglePause() {
    setBusy(true); setError("");
    try {
      const policy = await port.setPaused(!state!.policy.paused);
      policyRevision.current++;
      setState(value => value && { ...value, policy: { ...value.policy, paused: policy.paused, updatedAt: policy.updatedAt } });
    } catch { setError("Could not change pause. Please try again."); }
    finally { setBusy(false); }
  }
  function adopted(policy: Policy) {
    policyRevision.current++;
    setState(value => value && { ...value, policy: { ...value.policy, floorPct: policy.floorPct, askOwner: policy.askOwner, updatedAt: policy.updatedAt } });
  }
  return <>
    <header className="topbar">
      <div className="brand"><span className="sticker" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21V3M5 6h12l3 3-3 3H5zM4 16h11" /></svg></span><h1>Trailhead Co.</h1><span className="console-label">Owner Console</span></div>
      <div className="top-actions">{onSignOut && <button className="sign-out" onClick={onSignOut}>Sign out</button>}<span className={`status-pill ${state.policy.paused ? "paused" : ""}`} role="status">{state.policy.paused ? "Paused" : "Deals live"}</span>
        <button className="pause-button" disabled={busy} onClick={() => void togglePause()}>{state.policy.paused ? "Resume" : "PAUSE"}</button></div>
    </header>
    <main className="console-layout">
      {error && <p className="paper" role="alert">{error}</p>}
      {streamMessage && <p className="paper" role="status">{streamMessage}</p>}
      <div className="console-columns"><Feed events={events} /><aside><PolicyPanel products={state.products} policy={state.policy} port={port} onPolicy={adopted} /><Approvals approvals={state.pendingApprovals} port={port} onResolved={id => setState(value => value && { ...value, pendingApprovals: value.pendingApprovals.filter(approval => approval.id !== id) })} /></aside></div>
      <section className="paper gym" aria-labelledby="gym-title"><div className="section-heading"><div><h2 id="gym-title">The Gym</h2><p>Rehearse your pricing rules before shoppers meet them.</p></div><button disabled>Run the Gym</button></div></section>
    </main>
  </>;
}
