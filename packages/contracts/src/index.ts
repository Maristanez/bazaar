// Shared types — SPEC Appendix C, transcribed. Types only. All money is in cents.
// Nobody changes this file without saying so out loud (PLAN rule zero).

export type Option = { id: string; kind: "held" | "bundle" | "else" | "final" | "owner";
                  items: { variantId: string; title: string; size?: string; qty: number; thrownIn?: boolean; listPrice?: number /* one unit's public list price */ }[];
                  listTotal: number; total: number; ownerRank: number; facts: string[] };   // cents; NO cost fields
// Option is SERVER + CONSOLE only. The shopper's browser and the ChatGPT card get PublicOption.
// The `never` fields are the one departure from Appendix C: a bare Pick is structural, so a full Option would
// pass as a PublicOption silently. With them, leaking owner-side fields to a shopper surface is a compile error.
export type PublicOption = Pick<Option, "id" | "kind" | "items" | "listTotal" | "total"> & { ownerRank?: never; facts?: never };

// ── PUBLIC: the only shapes a shopper route or the ChatGPT card may send (rule 11) ──
export type ProductCard = { productId: string; title: string; image: string; listPrice: number; sizes?: string[]; openToOffers: boolean };
export type OfferCard = { negotiationId: string; offerId: string;
                   status: "live"|"pending_owner"|"superseded"|"accepted"|"expired"|"declined"|"paused";
                   round: number; maxRounds: number /* owner-set, 2–6 */; option: PublicOption; line: string; mood: "idle"|"thinking"|"offended"|"tempted"|"deal";
                   badges: string[];                 // ready-made display strings ("＋ socks", "last season's") — the card never gets facts
                   trail: { label: string; amount: number; by: "shopper"|"shop" }[];
                   expiresAt: string; pendingUntil?: string;   // pendingUntil drives the 45 s bar on a pending_owner card
                   disclosure: [string, string] };
export type Settlement = { offerId: string; code: string | null; agreedTotal: number; checkoutUrl: string; expiresAt: string };
export type ChatEvent = { t: "products"; items: ProductCard[] } | { t: "card"; card: OfferCard } | { t: "text"; delta: string }  // delta = CHECKED text only
               | { t: "settled"; settlement: Settlement } | { t: "paused" };

// ── OWNER-ONLY: Console routes behind the Supabase token. May carry everything. ──
export type TonePreset   = "friendly"|"brisk"|"playful";
export type PolicySettings = {                 // owner settings beyond the floor (SPEC §4.4.1). All optional: absent = the default.
  discountCapPct?: number;                     // 0–40 off list, default 22
  maxRounds?: number;                          // 2–6, default 4
  lowballCutoffPct?: number;                   // 0–80 of list, default 40; 0 = off
  tone?: TonePreset;                           // default "friendly"
  firmPriceProductIds?: string[];
};
export type Policy       = { floorPct: number; askOwner: boolean; paused: boolean; updatedAt: string; settings?: PolicySettings };
export type PausePersistence = "saved"|"pending";
export type PauseResult = { policy: Policy; persistence: PausePersistence };
export type OwnerProduct = ProductCard & { variants: { variantId: string; size?: string; price: number; unitCost: number|null; inStock: boolean }[];
                                    productType: string; stockedAt: string|null; missingCost: boolean /* red */; missingStockedAt: boolean /* amber, urgency 0 */ };
export type Approval     = { id: string; negotiationId: string; items: Option["items"]; offer: number; cost: number; profit: number; pctOverCost: number;  // same basis as the floor slider
                      deadline: string; status: "requested"|"approved"|"declined"|"timed_out" };
export type ConsoleEvent = { at: string; surface: "storefront"|"chatgpt"; negotiationId: string; shopperId: string;
                      kind: "decision"|"blocked"|"approval_requested"|"approval_resolved"|"settled"|"recalled";
                      reasoning: string;               // composed by CODE from engine facts + the pick + recalled memory; never LLM self-explanation
                      offer?: number; menu?: Option[]; picked?: string; floor?: number; cost?: number; target?: number; ask?: number; profit?: number;
                      round?: number; memory?: string; threadId?: string; approval?: Approval;
                      blockedBy?: "validate"|"engine"|"check"|"auditor"; llm?: { provider: string; model: string; ms: number; costUsd: number|null } };
export type Deal         = { id: string; merchantId: string; offerId: string; surface: "storefront"|"chatgpt"; items: Option["items"];
                      listTotal: number; agreedTotal: number; cost: number; floor: number; profit: number; ownerApproved: boolean;
                      code: string | null; createdAt: string };                             // mirrors the `deals` table, column for column
export type DealKpis     = { deals: number; customersSaved: number; revenueRecovered: number; profitRecovered: number; vsBanner: number; agentCostUsd: number };  // cents, except agentCostUsd; real settled deals only
export type CatalogStatus = { source: "shopify-admin"|"seed-fallback"; loadedAt: string|null; warnings: string[] };
export type ConsoleState = { policy: Policy; pausePersistence: PausePersistence; products: OwnerProduct[]; pendingApprovals: Approval[]; redteam: RedTeamResult;
                      kpis?: DealKpis; kpisByProduct?: Record<string, DealKpis>; catalog?: CatalogStatus };   // additive, owner-only (SPEC §4.4.2)
export type RedTeamLayer = "validate"|"engine"|"check"|"auditor"|"shopify_code";
export type RedTeamResult = {
  ranAt: string;
  attacks: { name: string; blockedBy: RedTeamLayer|null; passed: boolean; outcome: string }[];
  breaches: number;                                                                        // required: 0, recounted by the verifier
  scope: {
    mode: "isolated";
    server: string;
    backboard: string;
    shopify: string;
    database: string;
    liveShopifyValidated: false;
    productionRequests: number;
    productionDatabaseWrites: number;
    dryRunDiscounts: number;
    settlementRows: number;
  };
};
export type GymShopper = { id: number; persona: "bargain"|"budgeted"|"impatient"|"loyal"|"lowballer"; willingness: number;
                    rounds: { offer: number; ask: number }[];
                    outcome: "bought"|"walked"|"would_ask_owner"; agreed?: number; trade?: "accepted"|"held"|"bundle"|"final";
                    missed?: boolean };                                                     // walked although willingness ≥ floor
export type GymResult  = { seed: number; n: number; floorPct: number; bought: number; avgAgreed: number; bins: number[]; counts: number[];
                    profitVsBanner: number;          // < 0 ⇒ the headline card goes red and says haggling loses to the banner
                    aovUplift: number; wouldAskOwner: number; dealsMissed: number;
                    shoppers: GymShopper[] };        // one run drives the chart, the animation and the transcripts
