import React, { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Console } from "./Console";
import type { ConsoleAuth, ConsolePort } from "./data/port";
import "./login.css";
export function ConsoleApp({ port, auth }: { port: ConsolePort; auth: ConsoleAuth }) {
  const [signedIn, setSignedIn] = useState<boolean>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void auth.session().then(value => { if (active) setSignedIn(value); }).catch(() => { if (active) setSignedIn(false); });
    return () => { active = false; };
  }, [auth]);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try { await auth.signIn(String(fields.get("email")), String(fields.get("password"))); setSignedIn(true); }
    catch { setError("Could not sign in. Check your email and password, then try again."); }
    finally { setBusy(false); }
  }
  async function signOut() {
    try { await auth.signOut(); setSignedIn(false); }
    catch { setError("Could not sign out. Please try again."); }
  }
  if (signedIn === undefined) return <p className="loading" role="status">Opening Console…</p>;
  if (signedIn) return <><Console port={port} onSignOut={() => void signOut()} />{error && <p role="alert">{error}</p>}</>;
  return <main className="login">
    <section className="login-story" aria-label="Trailhead Co. Owner Console">
      <svg className="login-trail" viewBox="0 0 600 800" preserveAspectRatio="none" aria-hidden="true"><path d="M-20 790 C 120 760, 260 700, 380 690 S 560 640, 540 520 S 470 330, 560 200 S 600 60, 640 20" /></svg>
      <p className="login-brand"><span className="sticker" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21V3M5 6h12l3 3-3 3H5zM4 16h11" /></svg></span>Trailhead Co.</p>
      <h1>Your shop. Your rules.</h1>
      <ul>
        <li>See what your shopkeeper earned you, deal by deal.</li>
        <li>Try a rule on 300 shoppers before a real one meets it.</li>
        <li>One button stops every deal, everywhere.</li>
      </ul>
    </section>
    <form className="login-form" onSubmit={event => void signIn(event)}>
      <h2>Owner sign in</h2>
      <p className="login-sub">Sign in to run your shopkeeper.</p>
      <label>Email<input type="email" name="email" autoComplete="username" required /></label>
      <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>
      {error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      <p className="login-note">Only the shop owner can sign in. Shoppers never see this page.</p>
    </form>
  </main>;
}
