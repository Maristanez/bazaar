export type PublicConfig = { supabaseUrl: string; supabaseAnonKey: string };

function isAnonJwt(value: string): boolean {
  if (!value.startsWith("eyJ")) return false;
  try {
    const payload = JSON.parse(Buffer.from(value.split(".")[1] || "", "base64url").toString("utf8"));
    return payload?.role === "anon";
  } catch {
    return false;
  }
}

export function publicConfig(env: Record<string, string | undefined>): PublicConfig | null {
  const supabaseUrl = env.SUPABASE_URL?.trim();
  const supabaseAnonKey = (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY)?.trim();
  if (!supabaseUrl || !supabaseAnonKey || /secret|service[_-]?role/i.test(supabaseAnonKey)) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
  } catch { return null; }
  if (!supabaseAnonKey.startsWith("sb_publishable_") && !isAnonJwt(supabaseAnonKey)) return null;
  return { supabaseUrl, supabaseAnonKey };
}
