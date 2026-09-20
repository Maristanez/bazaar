// Throwaway entry: this repo's server with an in-memory owner database, so a
// design walkthrough never reads or writes the shared Supabase policy.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const REPO = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
for (const line of readFileSync(`${REPO}/.env`, "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const i = t.indexOf("=");
  const k = t.slice(0, i).trim();
  if (k.startsWith("SUPABASE_")) continue;
  if (process.env[k] === undefined) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}
const { createBazaarServer } = await import(`${REPO}/apps/server/src/application.js`);
let policy = { floorPct: 25, askOwner: true, paused: false, updatedAt: new Date().toISOString() };
const ownerDb = {
  merchantId: "critique",
  async loadLatestPolicy() { return { ...policy }; },
  async appendPolicy(next) { policy = { ...next, updatedAt: new Date().toISOString() }; return { ...policy }; },
  async verifyBearerToken() { return null; },
  async insertDeal(deal) { return { ...deal, id: "deal", profit: deal.agreedTotal - deal.cost, createdAt: new Date().toISOString() }; },
};
const server = await createBazaarServer({ ownerDb });
const port = Number(process.env.WALKTHROUGH_PORT || 3217);
server.listen(port, () => console.log(`walkthrough server on :${port} (in-memory owner policy)`));
