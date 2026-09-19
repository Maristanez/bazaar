import { createFixtureAuth } from "./auth";
import { createFixturePort } from "./fixturePort";
import { createHttpPort } from "./httpPort";
import type { ConsoleAuth, ConsolePort } from "./port";
type Environment = { DEV?: boolean; VITE_CONSOLE_PORT?: string; VITE_SUPABASE_URL?: string; VITE_SUPABASE_ANON_KEY?: string };
export async function createRuntime(env: Environment): Promise<{ port: ConsolePort; auth: ConsoleAuth; fixture: boolean }> {
  if (env.VITE_CONSOLE_PORT !== "http") return { port: createFixturePort(), auth: createFixtureAuth(env.DEV === true), fixture: true };
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) throw new Error("Configure the Supabase URL and public anon key for owner sign in.");
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
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
