import type { ConsoleEvent, Option } from "@bazaar/contracts";

// One afternoon of the live feed, in time order, following SPEC §6's arithmetic: TR2 list $149 / cost $78 /
// floor $97.50 / target $119.82, asks 149 → 135 → 127 → 120; TR3 list $169 / cost $95 / floor $118.75, urgency 0.
// `reasoning` is what code composes from the engine's facts, the pick and the recalled memory (§4.4).
const V = {
  tr3: "gid://shopify/ProductVariant/410012",
  tr2: "gid://shopify/ProductVariant/410022",
  socks: "gid://shopify/ProductVariant/410041",
  gaiters: "gid://shopify/ProductVariant/410051",
  flask: "gid://shopify/ProductVariant/410061",
};
const tr3 = { variantId: V.tr3, title: "Trail Runner 3", size: "10", qty: 1 };
const tr2 = { variantId: V.tr2, title: "Trail Runner 2", size: "10", qty: 1 };
const socks = { variantId: V.socks, title: "Merino socks", qty: 1 };
const gaiters = { variantId: V.gaiters, title: "Trail gaiters", qty: 1 };
const flask = { variantId: V.flask, title: "Soft flask", qty: 1 };

const openai = (ms: number, costUsd: number) => ({ provider: "openai", model: "gpt-5-mini", ms, costUsd });
const backboard = (ms: number) => ({ provider: "backboard", model: "gpt-5-mini", ms, costUsd: null });

// "$120 on the TR3", round 1 — the worked example. New stock holds at list; the bundles carry it; TR2 is the
// "something else" (12000 < target 16900 triggers it). ownerRank orders by profit: gaiters 8550 · flask 8200 ·
// socks 8000 · held 7400 · TR2 + gaiters 5400 · TR2 alone 4200.
const tr3Menu: Option[] = [
  { id: "A", kind: "held", items: [tr3], listTotal: 16900, total: 16900, ownerRank: 4, facts: ["stocked 12 days ago", "price holds at list"] },
  { id: "B", kind: "bundle", items: [tr3, socks], listTotal: 18700, total: 18100, ownerRank: 3, facts: ["stocked 12 days ago", "socks pair with this shoe"] },
  { id: "C", kind: "bundle", items: [tr3, gaiters], listTotal: 20400, total: 19250, ownerRank: 1, facts: ["stocked 12 days ago", "gaiters pair with this shoe"] },
  { id: "D", kind: "bundle", items: [tr3, flask], listTotal: 19400, total: 18600, ownerRank: 2, facts: ["stocked 12 days ago", "flask pairs with this shoe"] },
  { id: "E", kind: "else", items: [tr2, gaiters], listTotal: 18400, total: 14400, ownerRank: 5, facts: ["last season's model", "stocked 94 days ago", "gaiters pair with this shoe", "meets a $120 budget for the shoe"] },
  { id: "F", kind: "else", items: [tr2], listTotal: 14900, total: 12000, ownerRank: 6, facts: ["last season's model", "stocked 94 days ago", "meets a $120 budget"] },
];

// TR2, round 2 — held $135 and the three bundles. Only the gaiters bundle keeps profit ≥ held with the shoe at
// ask(3), so it is the one whose shoe part steps down ($126.47 + $23.50 → $150).
const tr2Round2Menu: Option[] = [
  { id: "A", kind: "held", items: [tr2], listTotal: 14900, total: 13500, ownerRank: 2, facts: ["stocked 94 days ago", "held 15 min"] },
  { id: "B", kind: "bundle", items: [tr2, socks], listTotal: 16700, total: 14700, ownerRank: 3, facts: ["stocked 94 days ago", "socks pair with this shoe"] },
  { id: "C", kind: "bundle", items: [tr2, gaiters], listTotal: 18400, total: 15000, ownerRank: 1, facts: ["stocked 94 days ago", "gaiters pair with this shoe"] },
  { id: "D", kind: "bundle", items: [tr2, flask], listTotal: 17400, total: 15200, ownerRank: 4, facts: ["stocked 94 days ago", "flask pairs with this shoe"] },
];

const tr2Round1Menu: Option[] = [
  { id: "A", kind: "held", items: [tr2], listTotal: 14900, total: 14900, ownerRank: 2, facts: ["stocked 94 days ago", "round 1 holds at list"] },
  { id: "B", kind: "bundle", items: [tr2, socks], listTotal: 16700, total: 16100, ownerRank: 3, facts: ["stocked 94 days ago", "socks pair with this shoe"] },
  { id: "C", kind: "bundle", items: [tr2, gaiters], listTotal: 18400, total: 17250, ownerRank: 1, facts: ["stocked 94 days ago", "gaiters pair with this shoe"] },
  { id: "D", kind: "bundle", items: [tr2, flask], listTotal: 17400, total: 16600, ownerRank: 4, facts: ["stocked 94 days ago", "flask pairs with this shoe"] },
];

const tr2Round3Held: Option = { id: "A", kind: "held", items: [tr2], listTotal: 14900, total: 12700, ownerRank: 1, facts: ["stocked 94 days ago", "held 15 min"] };

export const events = [
  {
    at: "2026-09-19T14:31:08.000Z", surface: "chatgpt", negotiationId: "neg_01J8Q3ZV1N", shopperId: "shp_chatgpt_7f2a", kind: "blocked", blockedBy: "validate",
    reasoning: "offer −$5 on TR2 · blocked · validate: amount must be a positive CAD figure",
    offer: -500, cost: 7800, floor: 9750, round: 1,
  },
  {
    at: "2026-09-19T14:33:40.000Z", surface: "chatgpt", negotiationId: "neg_01J8Q42K9P", shopperId: "shp_chatgpt_b31c", kind: "decision",
    reasoning: "offer $100 on TR2 · floor $98 · round 1 holds at list · menu A–D · picked A (held $149)",
    offer: 10000, menu: tr2Round1Menu, picked: "A", floor: 9750, cost: 7800, target: 11982, ask: 14900, profit: 7100, round: 1,
    llm: openai(812, 0.0009),
  },
  {
    at: "2026-09-19T14:35:02.000Z", surface: "storefront", negotiationId: "neg_01J8Q45R3T", shopperId: "shp_store_e9d4", kind: "recalled",
    reasoning: "shopper recognised · Backboard thread 3 turns · memory: \"muddy 50k\"",
    memory: "muddy 50k", threadId: "thr_bb_9c1f2e",
    llm: backboard(214),
  },
  {
    at: "2026-09-19T14:35:03.000Z", surface: "storefront", negotiationId: "neg_01J8Q45R3T", shopperId: "shp_store_e9d4", kind: "decision",
    reasoning: "offer $120 on TR3 · floor $119 · new stock, won't bend · menu A–F · picked E (TR2 + gaiters $144) · memory: \"muddy 50k\"",
    offer: 12000, menu: tr3Menu, picked: "E", floor: 11875, cost: 9500, target: 16900, ask: 16900, profit: 5400, round: 1, memory: "muddy 50k", threadId: "thr_bb_9c1f2e",
    llm: openai(1140, 0.0014),
  },
  {
    at: "2026-09-19T14:36:51.000Z", surface: "storefront", negotiationId: "neg_01J8Q47D2W", shopperId: "shp_store_4a70", kind: "blocked", blockedBy: "engine",
    reasoning: "offer $20 on Cap · blocked · engine: no cost in Shopify → not open to offers",
    offer: 2000, round: 1,
  },
  {
    at: "2026-09-19T14:38:19.000Z", surface: "chatgpt", negotiationId: "neg_01J8Q42K9P", shopperId: "shp_chatgpt_b31c", kind: "decision",
    reasoning: "offer $125 on TR2 · floor $98 · ask $135 · menu A–D · picked B (TR2 + socks $147)",
    offer: 12500, menu: tr2Round2Menu, picked: "B", floor: 9750, cost: 7800, target: 11982, ask: 13500, profit: 6300, round: 2,
    llm: openai(934, 0.0011),
  },
  {
    at: "2026-09-19T14:40:47.000Z", surface: "chatgpt", negotiationId: "neg_01J8Q42K9P", shopperId: "shp_chatgpt_b31c", kind: "blocked", blockedBy: "check",
    reasoning: "offer $126 on TR2 · ask $127 · blocked · check: line quoted $110, not a figure of option A · sent A (held $127) with the template line",
    offer: 12600, menu: [tr2Round3Held], picked: "A", floor: 9750, cost: 7800, target: 11982, ask: 12700, profit: 4900, round: 3,
    llm: openai(1021, 0.0012),
  },
  {
    at: "2026-09-19T14:52:00.000Z", surface: "storefront", negotiationId: "neg_01J8Q4HX7R", shopperId: "shp_store_c218", kind: "approval_requested",
    reasoning: "offer $85 on TR2 after final $120 · below floor $98, above cost $78 · asked owner · $7 · 9% over cost · 45 s",
    offer: 8500, floor: 9750, cost: 7800, target: 11982, ask: 12000, profit: 700, round: 4,
    approval: { id: "apr_01J8Q4M3ZK", negotiationId: "neg_01J8Q4HX7R", items: [tr2], offer: 8500, cost: 7800, profit: 700, pctOverCost: 9, deadline: "2026-09-19T14:52:45.000Z", status: "requested" },
  },
  {
    at: "2026-09-19T14:52:31.000Z", surface: "storefront", negotiationId: "neg_01J8Q4HX7R", shopperId: "shp_store_c218", kind: "approval_resolved",
    reasoning: "owner approved $85 on TR2 · $7 · 9% over cost · live offer, badge \"owner approved\"",
    offer: 8500, floor: 9750, cost: 7800, profit: 700, round: 4,
    approval: { id: "apr_01J8Q4M3ZK", negotiationId: "neg_01J8Q4HX7R", items: [tr2], offer: 8500, cost: 7800, profit: 700, pctOverCost: 9, deadline: "2026-09-19T14:52:45.000Z", status: "approved" },
  },
  {
    at: "2026-09-19T14:54:12.000Z", surface: "chatgpt", negotiationId: "neg_01J8Q42K9P", shopperId: "shp_chatgpt_b31c", kind: "blocked", blockedBy: "auditor",
    reasoning: "accept A ($127 on TR2) · blocked · auditor: TR2 unit cost changed in Shopify since the menu was built · no code minted, re-quoting from fresh costs",
    offer: 12700, cost: 7800, floor: 9750, round: 3,
  },
  {
    at: "2026-09-19T14:55:40.000Z", surface: "storefront", negotiationId: "neg_01J8Q45R3T", shopperId: "shp_store_e9d4", kind: "settled",
    reasoning: "settled E (TR2 + gaiters $144) · list $184 · profit $54 · code BZR-7K2M-Q9 · checkout",
    offer: 14400, cost: 9000, floor: 11250, profit: 5400, round: 1, memory: "muddy 50k", threadId: "thr_bb_9c1f2e",
  },
] satisfies ConsoleEvent[];
