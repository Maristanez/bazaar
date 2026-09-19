import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (key) {
    let publicKey = key.startsWith("sb_publishable_");
    try { publicKey ||= JSON.parse(Buffer.from(key.split(".")[1] || "", "base64url").toString("utf8")).role === "anon"; } catch { /* Not an anon JWT. */ }
    if (!publicKey || /secret|service[_-]?role/i.test(key)) throw new Error("VITE_SUPABASE_ANON_KEY must contain a public publishable or anon key. Refusing to bundle private credentials.");
  }
  return {
    plugins: [react(), tailwindcss()],
    server: { proxy: { "/api": "http://127.0.0.1:3000" } },
  };
});
