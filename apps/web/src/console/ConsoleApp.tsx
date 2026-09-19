import React, { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Console } from "./Console";
import type { ConsoleAuth, ConsolePort } from "./data/port";
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
  return <main className="login"><form className="paper login-form" onSubmit={event => void signIn(event)}>
    <h1>Trailhead Co.</h1><h2>Owner sign in</h2><p>Your shop. Your rules.</p>
    <label>Email<input type="email" name="email" autoComplete="username" required /></label>
    <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>
    {error && <p role="alert">{error}</p>}<button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
  </form></main>;
}
