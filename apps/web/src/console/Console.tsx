import React, { useEffect, useRef, useState } from "react";
import type { ConsoleEvent, ConsoleState, Policy } from "@bazaar/contracts";
import type { ConsolePort } from "./data/port";
import { Approvals } from "./Approvals";
import { PolicyPanel } from "./PolicyPanel";
import { Feed } from "./Feed";
import { Race } from "./Race";
import { KeptBand } from "./KeptBand";
import { RedTeamSummary } from "./RedTeamSummary";
export function Console({ port, onSignOut }: { port: ConsolePort; onSignOut?: () => void }) {
  const policyRevision = useRef(0);
  const [state, setState] = useState<ConsoleState>();
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [streamMessage, setStreamMessage] = useState("");
  const [error, setError] = useState("");
  const [events, setEvents] = useState<ConsoleEvent[]>([]);
  const [gymDraft, setGymDraft] = useState<Pick<Policy, "floorPct" | "askOwner">>();
  const [adopting, setAdopting] = useState(false);
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
      if (event.kind === "settled") void reloadState();
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
  useEffect(() => {
    if (state?.pausePersistence !== "pending") return;
    let active = true;
    const timer = window.setInterval(() => {
      void port.load().then(snapshot => {
        if (!active || snapshot.pausePersistence !== "saved") return;
        setState(current => current && { ...current, pausePersistence: "saved" });
      }).catch(() => undefined);
    }, 1_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [port, state?.pausePersistence]);
  if (!state) return <main className="paper config-error">{error ? <><p role="alert">{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry</button></> : <p role="status">Loading Console…</p>}</main>;
  async function togglePause() {
    setBusy(true); setError("");
    try {
      const result = await port.setPaused(!state!.policy.paused);
      policyRevision.current++;
      setState(value => value && { ...value, pausePersistence: result.persistence, policy: { ...value.policy, paused: result.policy.paused, updatedAt: result.policy.updatedAt } });
    } catch { setError("Could not change pause. Please try again."); }
    finally { setBusy(false); }
  }
  async function adoptDraft() {
    if (!gymDraft || adopting) return;
    setAdopting(true); setError("");
    try { adopted(await port.setPolicy(gymDraft)); setGymDraft(undefined); }
    catch { setError("Could not adopt this policy. Your preview is still here; try again."); }
    finally { setAdopting(false); }
  }
  function adopted(policy: Policy) {
    policyRevision.current++;
    setState(value => value && { ...value, policy: { ...value.policy, floorPct: policy.floorPct, askOwner: policy.askOwner, updatedAt: policy.updatedAt } });
  }
  return <>
    <header className="topbar">
      <div className="brand"><span className="sticker" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21V3M5 6h12l3 3-3 3H5zM4 16h11" /></svg></span><h1>Trailhead Co.</h1><span className="console-label">Owner Console</span>{state.catalog && <span className={`catalog-source ${state.catalog.source === "shopify-admin" ? "" : "fallback"}`} role="status">{state.catalog.source === "shopify-admin" ? `Live from Shopify · ${state.products.length} products` : `Seed fallback · ${state.catalog.warnings[0] ?? "Shopify is unreachable"}`}</span>}</div>
      <div className="top-actions">{onSignOut && <button className="sign-out" onClick={onSignOut}>Sign out</button>}<span className={`status-pill ${state.policy.paused ? "paused" : ""}`} role="status">{state.policy.paused ? "Paused" : "Deals live"}</span>
        <button className="pause-button" disabled={busy} onClick={() => void togglePause()}>{state.policy.paused ? "Resume" : "PAUSE"}</button></div>
    </header>
    <main className="console-layout">
      {error && <p className="paper" role="alert">{error}</p>}
      {state.pausePersistence === "pending" && <p className="paper" role="status">{state.policy.paused ? "PAUSE is active on this server." : "Deals are live on this server."} Saving that state to Supabase is still retrying.</p>}
      {streamMessage && <p className="paper" role="status">{streamMessage}</p>}
      <KeptBand kpis={state.kpis} />
      <div className="console-columns">
        <Race products={state.products} policy={state.policy} draft={gymDraft} saving={adopting} onDraft={setGymDraft} onAdopt={() => void adoptDraft()} />
        <aside><Approvals approvals={state.pendingApprovals} port={port} onResolved={id => setState(value => value && { ...value, pendingApprovals: value.pendingApprovals.filter(approval => approval.id !== id) })} /><Feed events={events} /></aside>
      </div>
      <details className="more-settings"><summary>More settings</summary>
        <div className="more-grid"><PolicyPanel products={state.products} policy={state.policy} port={port} value={gymDraft ?? null} onPolicy={policy => { setGymDraft(undefined); adopted(policy); }} onDraft={setGymDraft} /><RedTeamSummary result={state.redteam} /></div>
      </details>
    </main>
  </>;
}
