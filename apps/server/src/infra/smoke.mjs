import { createSupabaseDb } from "./db.ts";

const db = createSupabaseDb();
const merchant = await db.healthCheck();
const policy = await db.loadLatestPolicy();

console.log(JSON.stringify({
  ok: true,
  merchant: { id: merchant.id, shopDomain: merchant.shopDomain },
  policy,
}, null, 2));

