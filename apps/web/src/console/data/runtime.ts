import { createHttpPort } from "./httpPort";
import type { ConsoleAuth, ConsolePort } from "./port";
type Environment = { DEV?: boolean; VITE_CONSOLE_PORT?: string; VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string };
type PublicConfigResponse = { supabaseUrl: string; supabaseAnonKey: string };
function validPublicConfig(input: unknown): input is PublicConfigResponse {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Partial<PublicConfigResponse>;
  if (typeof value.supabaseUrl !== "string") return false;
  try {
    const url = new URL(value.supabaseUrl);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return false;
  } catch { return false; }
  if (typeof value.supabaseAnonKey !== "string" || /secret|service[_-]?role/i.test(value.supabaseAnonKey)) return false;
  if (value.supabaseAnonKey.startsWith("sb_publishable_")) return true;
  try { return JSON.parse(atob(value.supabaseAnonKey.split(".")[1] || "")).role === "anon"; } catch { return false; }
}
export async function createRuntime(env: Environment, fetchImpl: typeof fetch = globalThis.fetch): Promise<{ port: ConsolePort; auth: ConsoleAuth; fixture: boolean }> {
  if (env.VITE_CONSOLE_PORT === "fixture" || (env.DEV === true && env.VITE_CONSOLE_PORT !== "http")) {
    // The fixture adapter loads on demand, so its canned state stays out of the production bundle's entry chunk.
    const [{ createFixturePort }, { createFixtureAuth }] = await Promise.all([import("./fixturePort"), import("./auth")]);
    return { port: createFixturePort(), auth: createFixtureAuth(env.DEV === true), fixture: true };
  }
  let supabaseUrl = env.VITE_SUPABASE_URL;
  let supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    let response: Response;
    try { response = await fetchImpl("/api/public-config"); } catch { throw new Error("Owner sign in is unavailable: configure public Supabase auth or serve /api/public-config."); }
    if (!response.ok) throw new Error("Owner sign in is unavailable: configure public Supabase auth or serve /api/public-config.");
    let body: unknown;
    try { body = await response.json(); } catch { throw new Error("Owner sign in is unavailable: /api/public-config returned invalid JSON."); }
    const candidate = body as Partial<PublicConfigResponse>;
    if (!validPublicConfig(candidate)) throw new Error("Owner sign in is unavailable: /api/public-config returned invalid public auth settings.");
    supabaseUrl = candidate.supabaseUrl;
    supabaseAnonKey = candidate.supabaseAnonKey;
  }
  if (!validPublicConfig({ supabaseUrl, supabaseAnonKey })) throw new Error("Owner sign in is unavailable: invalid public auth settings.");
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(supabaseUrl, supabaseAnonKey);
  const auth: ConsoleAuth = {
    async session() { const { data, error } = await client.auth.getSession(); if (error) throw error; return !!data.session; },
    async signIn(email, password) { const { error } = await client.auth.signInWithPassword({ email, password }); if (error) throw error; },
    async signOut() { const { error } = await client.auth.signOut(); if (error) throw error; },
  };
  return { auth, fixture: false, port: createHttpPort({ token: async () => {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session?.access_token ?? null;
  } }) };
}
