> [!WARNING]
> **ARCHIVED — v2, superseded by [`../PLAN.md`](../PLAN.md) (v3).**
> This describes the **agent-to-agent** Bazaar: a buyer AI haggling with three merchant Deal Agents over a UCP extension. That design was dropped on 2026-09-18 because Anthropic's Project Deal (Apr 2026) had already demonstrated buyer/seller agent negotiation publicly. v3 is **human-to-agent**: one store, one shopkeeper pet, a human shopper.
>
> **Kept because** the policy engine, Strategist-as-phraser, Auditor, discount-code settlement, Console and Gym tier 1 all carried over unchanged in spirit — and because the UCP/MCP protocol detail here is the answer to *"what's next?"* on stage. Do not build from this file.

---

# The Bazaar — Product & Build Specification (v2)

**Hack the North 2026 · Sep 18–20 · 36 hours**
**Merchant-side Deal Agents that haggle with buyer agents over UCP, stress-tested in a simulation gym before they go live, settling into a real Shopify checkout — with the merchant fully in control.**

> Agentic commerce today is read-only on price. An agent can find a product and buy it, but the price is a static field. The Bazaar makes price a *conversation between agents*: every merchant gets a Deal Agent that negotiates in real time — using margin floors, inventory age, stock levels, bundles, and memory of past buyers — and settles the agreed terms into a genuine Shopify checkout. Before a merchant turns it on, they run it against hundreds of synthetic buyer agents in **the Gym** and see exactly what it would do to their margin. Haggling comes back to commerce, at machine scale, and the merchant sets the rules.

---

## 0. TL;DR for the team

| | |
|---|---|
| **What we ship** | (1) **Deal Agent** — merchant MCP server implementing `com.thebazaar.shopping.negotiation`, a vendor UCP extension, with a deterministic policy engine + LLM strategist + auditor. (2) **The Gym** — SimGym-style simulator: N synthetic buyer agents with personas negotiate against a policy; A/B two policies; see margin/win-rate/clearance before going live. (3) **Buyer Agent** — multi-agent shopper: scouts 3 stores, negotiates in parallel, evaluates, checks out. (4) **Arena** — live split-screen haggle UI with voice. (5) **Merchant Console** — policy sliders, Gym results, live feed with private reasoning, deal ledger, kill switch. |
| **Settlement** | Deal Agent mints a **single-use, 15-min, variant-scoped discount code** (Admin API `discountCodeBasicCreate`) → returns it inside UCP's own `request_constraints` discount-lock → buyer forwards it in `checkout.discounts.codes` on Shopify's real Checkout MCP → `continue_url` opens a **real Shopify checkout at the negotiated price**. |
| **The three unlocks** | ① UCP's spec has a worked example literally titled *"Locked negotiated discount codes"* — we are the thing that produces that lock. ② SimGym's own rubric says *"Pricing is … out of scope for what SimGym evaluates"* — the Gym fills that hole. ③ Backboard's assistant-level memory means Deal Agents *remember buyers* across negotiations — a haggler that learns. |
| **Tracks** | Primary: **HTN Finalist**, **Shopify**, **Backboard**, **Huawei openJiuwen Multi-Agent**, **OpenAI**. Cheap add-ons: **ElevenLabs** or Backboard voice. Optional (only if ahead): **Rox** via messy supplier cost-sheet ingestion. |
| **Demo moment** | Buyer: "Trail runners, size 10, budget $120, open to a bundle." Three Deal Agents bid live *out loud*. Buyer agent accepts → **real checkout tab opens at $115 + free socks**. Console shows margin protected. Then: **a judge haggles by voice with the Trailhead robot and can't get it below floor.** Then: the Gym shows the merchant saw this coming — 300 simulated buyers, +$4.10/unit vs a blanket sale. Then: kill switch. |
| **Hard rule** | Every demo path has an offline fallback. Nothing on stage depends on a third party being up. |

---

## 1. The idea, explained simply (use this in the pitch opener)

Imagine a robot helper. You tell it *"get me trail-running shoes, I have $120."* It finds shoes at $139 and… pays $139, or gives up. It can't do what your grandmother does at a garage sale: look at the seller and say *"would you take $115?"* Today's shopping agents can **read** a price. They can't **talk about** it.

The Bazaar gives every store its **own haggling robot**. Your robot asks; the store's robot counters; they land on $115 with socks; **a real Shopify checkout opens at $115 with socks in the cart.** Three seconds, not ten minutes.

Why would a store want that? Picture Maya, who owns Trailhead Co. She has 40 pairs of shoes that have sat for 94 days. Her options: (a) a **"20% OFF" banner** — everyone gets the cheap price, including people who'd pay full, and customers learn to wait for sales; or (b) let her robot **quietly** offer a better deal only to shoppers who ask, only on stock that isn't moving, **never below the line where she loses money**. She tells the robot three things — *never below $98; bend more as stock ages; you may throw in socks or free shipping, nothing else* — and goes to lunch. The robot can't break those rules: they're code, not a prompt. And she has a big red **PAUSE** button.

Before she trusts it, she puts the robot in **the Gym**: 300 fake shoppers with different personalities haggle against her rules overnight. She sees *"you'd win 61% of negotiations, average $114, $4.10/unit better than a blanket sale, 22 aged units cleared."* Then she flips it on.

---

## 2. Why this wins — and how to say it

### 2.1 Criteria mapping

| Criterion | Evidence in the demo |
|---|---|
| **WOW factor** (HTN) | Three AI agents haggling *aloud* in real time over a real product → real checkout. A judge tries to talk a robot down by voice and loses. Nobody in the room has seen this. |
| **Technical ability** (HTN) / **Technical Excellence** (Shopify) | Real UCP vendor extension (schema-composed, capability-negotiated). MCP server. Deterministic expected-margin optimizer, unit-tested. Multi-agent parallel orchestration across an org boundary. Monte-Carlo + LLM-persona simulation gym. Admin GraphQL settlement + real Checkout MCP hand-off. Cross-session memory via Backboard. LLM used for judgement (framing, bundle choice, persona), not math (floors, optimizer). |
| **Originality** (HTN) / **Innovation Factor** (Shopify) | Turns a price field into a protocol. Shopify's own dot.dev 2026 demos use "negotiate" for *capabilities* only. SimGym stops at pricing. We start there. |
| **Design** (HTN) | Arena makes machine negotiation legible: offer cards, spoken reasoning, utility gauges. Console: three sliders + Gym histogram; a merchant sets policy in 30 seconds. |
| **Impact Potential** (Shopify) | Clear aging inventory without blanket sales; capture price-sensitive buyers at *their* reservation price; bundles/shipping instead of race-to-the-bottom; and merchants can *see the outcome before shipping it* — the SimGym promise applied to pricing. Also: negotiated (non-advertised) prices are a real-world escape hatch for merchants bound by brand MAP policies that restrict *advertised* price. |
| **Backboard** ("we judge ambition; the more of the stack you use") | Memory (Pro) for buyer-agent reputation + merchant learning; RAG over supplier cost sheets and brand policy PDFs; tool calling for the Strategist; per-message model routing (cheap for 300 sim buyers, strong for live); `json_output`; SSE streaming into the Arena; TTS/STT for the voice haggle. Six surfaces, one API. |
| **Huawei multi-agent** | Seven agents, two organizations, communicating *only* over a protocol boundary. Parallel execution. Deterministic + LLM agents mixed. Emergent behaviour no single prompt encodes. |
| **OpenAI** | Structured outputs drive every offer; Codex built the MCP server, the optimizer property tests, and debugged the PUT-semantics bug. Keep a log of 3 concrete examples. |

### 2.2 One-sentence pitch per judge

- **VC:** "Every checkout protocol has a price field. We turn that field into a market. Whoever owns the negotiation layer between buyer agents and merchant agents owns the margin conversation for all of agentic commerce."
- **Shopify:** "A vendor extension on UCP, settled with the `request_constraints` discount-lock pattern from your own spec, previewed in a SimGym-style gym for the one thing SimGym says it doesn't cover — pricing."
- **Backboard:** "Every Deal Agent is a Backboard assistant. Its memory is why it haggles better with the same buyer the second time. Its documents are why it never breaks a brand's MAP policy. Its model routing is why we can afford 300 simulated buyers."
- **Huawei:** "The buyer's Scout, Negotiators and Evaluator share nothing with the merchant's Strategist, Policy Engine and Auditor — no memory, no prompts, no database. Only MCP messages cross the line."
- **OpenAI:** "Structured outputs on every offer. Here are three things Codex did that we couldn't have shipped without."

### 2.3 The "is this good for merchants?" answer (memorize)

> "The merchant never gives up control. Floors are hard code. The agent's objective isn't 'close' — it's *expected margin*: P(accept) × (price − cost). It lets lowballs walk. It's opt-in per product, so your hero SKU stays at list while 90-day-old stock finds its clearing price *without a public sale that trains customers to wait*. And before you flip it on, the Gym shows you the distribution of outcomes against 300 synthetic buyers. You're not trusting an AI with your margin; you're reading a histogram."

---

## 3. Where it actually runs (get this exact — judges will probe)

### 3.1 Four places, four owners

```
 ①  CHAT SURFACE             ②  BUYER AGENT BRAIN          ③  MERCHANT DEAL AGENT           ④  SHOPIFY
 where the human types       scouts, negotiates,           the store's haggling robot       catalog · cost · inventory
                             evaluates, closes             + its rules + its memory         discounts · cart · checkout

 our Arena / chatgpt.com     ours this weekend             one server per store, we host    {store}.myshopify.com
 (as connector) / Gemini…    (prod: OpenAI/Google/Shop)    (prod: merchant or Shopify)      nothing to deploy
```

The negotiation is **② ↔ ③**. The human sees only ① and, at the end, ④ (a real checkout page).

### 3.2 "UCP is a language, not a place"

UCP defines message shapes; someone must run a server that speaks it. Shopify runs one per store at `{store}/api/ucp/mcp` and it only knows: `search_catalog · lookup_catalog · get_product · create_cart · get_cart · update_cart · cancel_cart · create_checkout · get_checkout · update_checkout · complete_checkout · cancel_checkout`. There is **no `open_negotiation`**. Shopify's server can *apply* a price; it cannot *decide* one.

UCP explicitly allows vendor extensions (`com.{vendor}.shopping.{capability}`). Adding a word to the language doesn't make Shopify's server understand it — so **we run the server** that speaks UCP + our extension. The negotiation runs *on* UCP (envelope, `meta.ucp-agent`, capability declarations, `request_constraints`) but not *inside* Shopify's UCP server. Then the buyer hands the code to Shopify's server via standard `create_checkout`.

> Analogy: UCP is English. Shopify's server is a clerk trained to answer "what do you have / bag this / ring me up." We hire a second clerk who also speaks English and knows how to haggle — and hands you a coupon for the first clerk.

### 3.3 Discovery wrinkle

Shopify serves each store's `.well-known/ucp`; we can't add our capability to it. So the Deal Agent has **its own profile** on our host, and the buyer agent finds it via a **Bazaar directory**: `GET https://bazaar.dev/directory/{store-domain}` → `{ deal_agent: "https://trailhead.bazaar.dev" }` → read that host's `.well-known/ucp`. Unlisted stores → pay list price. Production path: merchant-registered extension endpoints in the Shopify-served profile, or Shopify hosting the capability. Wire format unchanged either way — that's why we build it as an extension now.

### 3.4 "Can users just do this in ChatGPT?"

Two different things:
- **ChatGPT's native Shopify shopping (Instant Checkout / ACP-UCP)** is a closed OpenAI↔Shopify integration. We *cannot* inject a negotiate step. It works natively only if a platform reads `com.thebazaar.shopping.negotiation` from a merchant profile and supports it — that's the *pitch*, not the demo.
- **ChatGPT / Claude as an MCP client (custom connectors / developer mode).** Expose the Buyer Agent as an MCP server with one tool, `find_and_negotiate(intent, budget, flexibilities)`. A user types in chatgpt.com → ChatGPT calls us → we haggle with 3 Deal Agents → return best deal + real checkout link. **Doable, ~2 h, post-H24 only.** Verify connector availability on Day 0. The haggle isn't *visible* inside ChatGPT, so the Arena stays the stage; the connector proves portability.

Say the distinction out loud. Precision here beats hand-waving.

---

## 4. Product definition

### 4.1 Actors

| Actor | Role |
|---|---|
| **Merchant** | Owns a Shopify store. Sets policy. Runs the Gym. Watches deals. Can pause instantly. |
| **Deal Agent** (merchant-side) | MCP server + internal agent team + Backboard assistant. Negotiates within policy, remembers buyers, mints settlement codes. |
| **The Gym** | Simulation harness. Spawns N synthetic buyer agents with personas against a policy (or two), reports outcome distributions. |
| **Buyer** | Human with intent, budget, flexibilities. |
| **Buyer Agent** (shopper-side) | Multi-agent system: discovers, negotiates across merchants in parallel, evaluates, checks out. Also a Backboard assistant (remembers the buyer). |
| **Shopify** | Source of truth for catalog, cost, inventory, discounts, cart, checkout. We never replicate pricing logic; we produce a code and let Shopify price the checkout. |

### 4.2 User stories

**Merchant**
- M1. Enable negotiation per product/collection; set a **margin floor** (% over unit cost or absolute).
- M2. Set **urgency** — how aggressively to concede as inventory ages / stock piles up.
- M3. Enable **levers**: price, bundle add-ons (whitelist), free shipping, quantity discount.
- M4. Upload **constraint documents** (brand MAP policy PDF, supplier cost sheet CSV) — the agent respects them.
- M5. **Run the Gym** on a policy (or A vs B) and read: win rate, avg agreed price, margin vs blanket-sale counterfactual, aged units cleared, regret. Adopt the winner in one click.
- M6. See **every negotiation live** with private reasoning; a ledger of settled deals; what the agent *remembered* about a returning buyer.
- M7. **Pause all negotiation** instantly; set an **approval threshold** above which the agent asks first.

**Buyer**
- B1. State intent, budget, flexibilities (bundle, timing, brand), delegation level.
- B2. Agent finds it across stores, negotiates with all **at once**, shows offers as they land.
- B3. Pick one (or delegate) → **real checkout** at negotiated terms.
- B4. Next session, the agent already knows my size and that I like bundles.

### 4.3 Non-goals (say them if asked)
- No `complete_checkout` / autonomous payment. Buyer pays in Shopify's checkout. (Trust tier + better demo.)
- No Universal Cart (waitlist). One checkout per merchant.
- No Shopify Function for pricing. Codes are sufficient and faster; Function is v2.
- No merchant-to-merchant collusion. Each Deal Agent sees only its negotiation; the *buyer* holds the competitive information.
- Gym personas are synthetic and labelled as such. We do not claim calibration to real shoppers this weekend (that's exactly the SimGym team's multi-year job — say so).

---

## 5. System architecture

```
┌──────────────────────────────  BUYER SIDE  ───────────────────────────────┐
│  Buyer ──chat/voice──▶ Orchestrator ──▶ Backboard assistant (buyer memory) │
│                             │                                              │
│         ┌───────────────────┼─────────────────────┐                        │
│         ▼                   ▼                     ▼                        │
│      Scout            Negotiator ×N            Evaluator ──▶ Closer        │
│  (Catalog MCP +       (parallel, bounded,      (utility)    (Cart MCP →    │
│   Bazaar directory)    one per merchant)                     Checkout MCP →│
│                             │                                continue_url) │
└─────────────────────────────┼──────────────────────────────────────────────┘
                              │  MCP / JSON-RPC over HTTPS
                              │  com.thebazaar.shopping.negotiation
┌─────────────────────────────┼─────────────────────  MERCHANT SIDE ×3  ─────┐
│                             ▼                                              │
│                ┌── Deal Agent MCP server ──┐                               │
│                │ open / counter / accept   │                               │
│                └────────────┬──────────────┘                               │
│                             ▼                                              │
│   Policy Engine ◀──▶ Strategist (Backboard assistant) ◀──▶ Bundle Composer │
│   (code: floors,      memory: this buyer, what closes                      │
│    urgency,           docs: MAP policy, cost sheet                          │
│    optimizer)         tools: get_offer_options, lookup_buyer_history        │
│                             │                                              │
│                             ▼                                              │
│                          Auditor (code + doc check)                        │
│                             │                                              │
│                             ▼                                              │
│                Settlement ── Admin GraphQL discountCodeBasicCreate         │
│                                                                            │
│   The Gym ── spawns N synthetic buyers (parametric + Backboard personas)   │
│              against Policy A / Policy B → outcome distributions           │
│   Shopify Sync ── Admin GraphQL: unitCost, inventory, sell-through         │
│   Merchant Console ── sliders · Gym · live feed · ledger · kill switch      │
└────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Shopify dev store (×3)
       Storefront Catalog MCP · Cart MCP · Checkout MCP · Admin API
```

### 5.1 The protocol boundary (Huawei)
Buyer team and merchant team share **no memory, no prompts, no database**. They exchange only structured UCP messages. The Negotiator doesn't know the floor; the Strategist doesn't know what other merchants offered. Emergent behaviour (buyer plays merchants off each other; merchant chooses a bundle over a price cut; merchant softens for a buyer it remembers as reliable) comes from coordination, not from one prompt playing seven roles.

### 5.2 Where the LLM is and isn't

| Decision | Who | Why |
|---|---|---|
| Can we go below $X? | **Policy Engine** (code) | Hard guarantee. Never trust an LLM with a floor. |
| Which price maximises expected margin this round? | **Policy Engine** (code) | Explainable, unit-testable. |
| Does this buyer's history change our opening? | **Strategist** reading **Backboard memory**; engine applies a bounded prior shift (±5% of concession range max) | Memory informs, never overrides. |
| Bundle vs price cut? Which add-on? | **Strategist + Bundle Composer** (LLM, whitelist-constrained, validated) | Judgement about intent. |
| Does this violate the brand's MAP / supplier terms? | **Auditor** (code) + **Backboard RAG** over uploaded docs | Second, independent check. |
| How to phrase the offer? | **Strategist** (LLM) | Persuasion is language. |
| Which merchant offer is best for the buyer? | **Evaluator** (code utility) + LLM explanation | Deterministic ranking; LLM explains. |
| How does a synthetic buyer behave in the Gym? | Parametric sampler (fast, 300 buyers) + optional LLM persona (Backboard, cheap model) for flavour | Speed first, realism second. |

---

## 6. Protocol: `com.thebazaar.shopping.negotiation`

Vendor UCP extension per spec namespace governance, extending `dev.ucp.shopping.checkout` and `dev.ucp.shopping.cart`. Host schema at `https://thebazaar.dev/ucp/schemas/negotiation.json` (buy the domain — also a GoDaddy MLH entry) so authority binding passes.

### 6.1 Deal Agent profile (`GET /.well-known/ucp`)

```json
{
  "ucp": {
    "version": "2026-08-25",
    "services": {
      "dev.ucp.shopping": [{
        "version": "2026-08-25", "transport": "mcp",
        "spec": "https://ucp.dev/2026-08-25/specification/overview/",
        "schema": "https://ucp.dev/2026-08-25/services/shopping/mcp.openrpc.json",
        "endpoint": "https://trailhead.bazaar.dev/mcp"
      }]
    },
    "capabilities": {
      "dev.ucp.shopping.checkout": [{ "version": "2026-08-25", "spec": "…", "schema": "…" }],
      "dev.ucp.shopping.discount":  [{ "version": "2026-08-25", "spec": "…", "schema": "…",
                                       "extends": ["dev.ucp.shopping.checkout","dev.ucp.shopping.cart"] }],
      "com.thebazaar.shopping.negotiation": [{
        "version": "2026-09-19",
        "spec": "https://thebazaar.dev/ucp/spec/negotiation",
        "schema": "https://thebazaar.dev/ucp/schemas/negotiation.json",
        "extends": ["dev.ucp.shopping.checkout", "dev.ucp.shopping.cart"],
        "config": { "max_rounds": 4, "levers": ["price","bundle","free_shipping"],
                    "offer_ttl_seconds": 900, "shopify_domain": "trailhead-co.myshopify.com" }
      }]
    }
  }
}
```

### 6.2 MCP tools

All take `meta.ucp-agent.profile`. Amounts in minor units. The buyer agent's **profile URL is its identity** — this is the key Backboard memory is stored against.

**`open_negotiation`**
```json
{ "meta": { "ucp-agent": { "profile": "https://buyer.bazaar.dev/.well-known/ucp" } },
  "negotiation": {
    "line_items": [{ "item": { "id": "gid://shopify/ProductVariant/4770…" }, "quantity": 1 }],
    "buyer_context": { "intent": "Trail runners for a 50k in October; open to socks or a flask bundle",
                       "flexibilities": ["bundle","free_shipping"], "address_country": "CA", "currency": "CAD" },
    "opening_offer": { "total": 11000, "currency": "CAD" } } }
```
→
```json
{ "ucp": { "version": "2026-08-25",
           "capabilities": { "com.thebazaar.shopping.negotiation": [{ "version": "2026-09-19" }] } },
  "negotiation": {
    "id": "nego_01J8…", "status": "open", "round": 1, "max_rounds": 4,
    "expires_at": "2026-09-19T19:14:00Z", "list_total": 14900,
    "offer": { "id": "off_01J8…", "total": 11900, "currency": "CAD",
               "line_items": [{ "item": { "id": "gid://…/shoe" }, "quantity": 1, "unit_price": 11900 },
                              { "item": { "id": "gid://…/socks" }, "quantity": 1, "unit_price": 0 }],
               "levers": [{ "type": "bundle", "item": { "id": "gid://…/socks" } }],
               "expires_at": "2026-09-19T19:14:00Z" },
    "public_reasoning": "Had these a while and I'd like them on a trail, not a shelf. $119 with a pair of merino socks in.",
    "messages": [] } }
```

**`counter_offer`** — `{ "id": "nego_…", "counter": { "total": 11500, "currency": "CAD", "note": "$115 with the socks?" } }` → same shape, `round: 2`, or `status: "declined"` with `messages[].code: "below_reservation"`.

**`accept_offer`** — requires `meta["idempotency-key"]`. Response is **the settlement** — the spec's *"Locked negotiated discount codes"* pattern:
```json
{ "ucp": { "version": "2026-08-25",
    "capabilities": { "dev.ucp.shopping.discount": [{ "version": "2026-08-25" }],
                      "com.thebazaar.shopping.negotiation": [{ "version": "2026-09-19" }] },
    "request_constraints": { "required": ["discounts"],
      "properties": { "discounts": { "required": ["codes"],
                      "properties": { "codes": { "const": ["BZR-7K2M-Q9"] } } } } } },
  "negotiation": { "id": "nego_01J8…", "status": "settled",
    "settlement": { "discount_code": "BZR-7K2M-Q9", "expires_at": "2026-09-19T19:29:00Z", "single_use": true,
      "line_items": [{ "item": { "id": "gid://…/shoe" }, "quantity": 1 }, { "item": { "id": "gid://…/socks" }, "quantity": 1 }],
      "agreed_total": 11500, "shopify_domain": "trailhead-co.myshopify.com",
      "permalink_fallback": "https://trailhead-co.myshopify.com/cart/4770…:1,4771…:1?discount=BZR-7K2M-Q9" } } }
```

**`get_negotiation`** — current state (arena, retries).

### 6.3 State machine

```
 open_negotiation ─▶ open ──counter (r<max)──▶ countered ──┐
                      │ ◀───────────────────────────────────┘
                      │ accept_offer            under floor & no lever
                      ▼                                   ▼
                   settled (code minted, 15-min TTL)    declined
                      │ TTL without order
                      ▼
                   expired (discountCodeDeactivate)
```
Rules: bounded rounds; every offer has `expires_at`; one settlement per negotiation; `accept_offer` idempotent; the Deal Agent never reveals floor/cost/urgency; `public_reasoning` is curated, `private_reasoning` goes only to the console.

---

## 7. Merchant side — the Deal Agent

### 7.1 Shopify Sync (Admin GraphQL, every 60 s)

Custom app per store; scopes `read_products, read_inventory, read_orders, write_discounts` (+ `write_inventory` if doing Rox cost ingestion).

```graphql
query DealInputs($first: Int!, $after: String) {
  productVariants(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id title sku price compareAtPrice createdAt
      product { id title tags productType createdAt }
      inventoryItem { id tracked unitCost { amount currencyCode }
        inventoryLevels(first: 5) { nodes { location { name }
          quantities(names: ["available","on_hand"]) { name quantity } updatedAt } } } } } }
```
```graphql
query Sales($q: String!) { orders(first: 250, query: $q) {
  nodes { createdAt lineItems(first: 50) { nodes { variant { id } quantity } } } } }
```
`q = "created_at:>=2026-08-20 status:any"`.

| Feature | Formula |
|---|---|
| `cost` | `unitCost.amount` (null → policy default margin on price; flagged in console) |
| `list` | `price` |
| `stock` | Σ available |
| `age_days` | now − max(product.createdAt, last restock) — seed backdated `createdAt` via CSV |
| `velocity` | units / 30 d |
| `days_of_supply` | stock / max(velocity, 0.05), cap 365 |

### 7.2 Policy

```ts
type NegotiationPolicy = {
  enabled: boolean;
  floor: { type: "margin_pct"; value: 0.25 } | { type: "absolute"; amount: 9800 };
  urgency: { age_threshold_days: 60; dos_threshold_days: 90; max_urgency_discount: 0.20 };
  levers: { price: true;
            bundle: { enabled: true; whitelist: ["gid://…/Socks","gid://…/Flask"]; max_bundle_cost: 1200 };
            free_shipping: { enabled: true; cost_estimate: 1200 };
            quantity: { enabled: false } };
  memory: { enabled: true; max_prior_shift: 0.05 };          // how much buyer history may move the curve
  constraints: { documents: ["map_policy.pdf","supplier_costs.csv"] };  // Backboard RAG
  max_rounds: 4; offer_ttl_seconds: 900;
  approval_required_above_discount_pct: 0.30;
  per_buyer_rate_limit: { negotiations_per_hour: 5 };
};
```

### 7.3 Policy Engine (deterministic — this is what you unit-test)

```
reservation  = max(cost × (1 + floor_margin), absolute_floor, map_floor_if_any)   // never cross
urgency      = clamp(w1·σ((age_days − age_thr)/15) + w2·σ((days_of_supply − dos_thr)/30), 0, 1)
target       = max(list − urgency × max_urgency_discount × list, reservation)

// memory prior (bounded): buyer history from Backboard → shift ∈ [−max_prior_shift, +max_prior_shift]
//   e.g. "this buyer agent accepted at 8% off twice, never lowballs" → open 3% lower, concede faster
//   e.g. "this buyer agent opened at 40% off and walked 3 times" → hold list for round 1
target_adj   = clamp(target + shift × (list − reservation), reservation, list)

β            = 1 + urgency                                 // urgent stock concedes faster
concession(r)= ((r − 1)/(max_rounds − 1)) ^ (1/β)
price(r)     = list − concession(r) × (list − target_adj)

// expected-margin optimiser over candidates c ∈ [max(price(r), buyer_counter), list], step 1%
P_accept(c)  = σ((buyer_counter − c)/τ),  τ = 0.06 × list
E[margin](c) = P_accept(c) × (c − cost_of_everything_offered)
p*           = argmax E[margin]  s.t.  c ≥ reservation

// levers when buyer_counter < reservation on price alone:
//   bundle:        (buyer_counter − bundle_cost) ≥ reservation_shoe  → offer bundle at buyer_counter
//   free_shipping: (buyer_counter − shipping_cost) ≥ reservation     → offer
//   else → decline (or hold at reservation one more round)
```

Tests: floor never crossed (property test over random policies/counters); urgency monotonic; memory shift bounded; optimizer never returns < reservation; declined when no lever closes gap.

### 7.4 Strategist — a Backboard assistant

One Backboard **assistant per Deal Agent** (per store). One **thread per negotiation**. Memory is assistant-scoped, so it carries across negotiations and buyers.

```http
POST https://app.backboard.io/api/threads/messages
X-API-Key: …
{
  "assistant_id": "asst_trailhead",
  "thread_id": "<per negotiation; omit on round 1>",
  "system_prompt": "You are Trailhead Co's deal strategist. You may only choose among the offer options the policy engine gives you. Never state cost, floor, or urgency numbers. Output JSON.",
  "content": "<round context: buyer intent, counter, round, engine-approved options, buyer profile URL>",
  "tools": [ get_offer_options, lookup_buyer_history, check_constraints ],
  "memory_pro": "Auto",
  "memory_response_citation": true,
  "llm_provider": "openai", "model_name": "gpt-4.1",
  "stream": true
}
```

- **Tool calling**: on `status: REQUIRES_ACTION` / SSE `tool_submit_required`, we run the tool locally (engine, memory lookup, doc check) and `POST /threads/tool-outputs`.
- **Memory**: after settlement/decline we send a `send_to_llm: "false"` summary message so Memory Pro saves *"Buyer https://buyer.bazaar.dev accepted 115/149 with socks bundle; opened at 74% of list; 2 rounds."* Next time that profile URL appears, `retrieved_memories` comes back and the console shows *"Remembered: reliable closer, bundle-responsive."*
- **Documents (RAG)**: merchant uploads `map_policy.pdf` and `supplier_costs.csv` to the assistant (assistant-scoped documents). `check_constraints` asks the assistant to cite the relevant clause; the Auditor treats a MAP floor as a hard `map_floor_if_any`.
- **Output contract** (zod-validated):
  ```ts
  { chosen_option_id: string;             // MUST be one of engine-approved options
    public_reasoning: string;             // ≤ 280 chars, no cost/floor/urgency numbers
    private_reasoning: string;            // console only
    memory_note?: string }                // what to remember about this buyer
  ```
  Validation failure or 4 s timeout → engine's default option + template text. **Never block the demo on the LLM.**

### 7.5 Auditor (code + doc check)

Right before minting: `agreed_total ≥ reservation`, discount % ≤ approval threshold (or approved), rate limit OK, kill switch off, `public_reasoning` passes a numbers-leak regex, and `check_constraints` returned no violation. Rejection → `status: "declined"`, `messages[].code: "policy_violation"`, red console event. **Demo this deliberately.**

### 7.6 Settlement (Admin GraphQL)

One order-level amount-off code = `list_total_of_cart − agreed_total`, variant-scoped, single-use, 15 min.

```graphql
mutation MintDeal($input: DiscountCodeBasicInput!) {
  discountCodeBasicCreate(basicCodeDiscount: $input) {
    codeDiscountNode { id } userErrors { field code message } } }
```
```json
{ "input": { "title": "Bazaar deal nego_01J8…", "code": "BZR-7K2M-Q9",
  "startsAt": "2026-09-19T19:14:00Z", "endsAt": "2026-09-19T19:29:00Z",
  "usageLimit": 1, "appliesOncePerCustomer": true, "customerSelection": { "all": true },
  "customerGets": { "value": { "discountAmount": { "amount": "34.00", "appliesOnEachItem": false } },
    "items": { "products": { "productVariantsToAdd": ["gid://…/shoe","gid://…/socks"] } } },
  "combinesWith": { "orderDiscounts": false, "productDiscounts": false, "shippingDiscounts": true } } }
```
- Bundle = socks are a normal cart line; the one code absorbs their price. Free shipping = fold into total (recommended) or second `discountCodeFreeShippingCreate`.
- Expiry without order → `discountCodeDeactivate`. `orders/create` webhook with the code → `redeemed`, ledger updated, memory note saved.

---

## 8. The Gym — SimGym for pricing policy

**Positioning line:** "SimGym sends 2,000 robots into your store to test a theme. Its own rubric says pricing is out of scope. The Gym sends 300 robots to haggle with your Deal Agent and tells you what happens to your margin *before* a real buyer does."

### 8.1 What it does
- Merchant picks a product (or collection) and **Policy A** (and optionally **Policy B**).
- Gym spawns **N synthetic buyer agents** (default 300) that run the *real* negotiation protocol against the *real* Deal Agent code path (in-process, `simulate: true`, no Shopify writes, no code minting).
- Reports, per policy:

| Metric | Meaning |
|---|---|
| Win rate | % negotiations that settled |
| Avg agreed price / avg discount | where deals land |
| **Margin vs counterfactuals** | vs *list price only* (many buyers walk) and vs *blanket X% sale* (everyone gets it) |
| Aged units cleared | how much 60+/90+-day stock moved |
| **Regret** | settled deals where the buyer's reservation was higher than agreed (money left on table) + walked buyers whose reservation was ≥ floor (deals missed) |
| Round distribution | how long haggles take |
| Lever usage | how often bundles/shipping closed |
| Histogram of agreed prices | the picture that sells it |

- **Adopt** button writes the winning policy live.

### 8.2 Synthetic buyers

Two tiers — build tier 1 first, it's 2 hours and the visuals are the value:

**Tier 1 — parametric personas (fast, no LLM):**
```ts
type Persona = { name: string; reservation_frac: [number, number];   // fraction of list the buyer will pay, sampled
                 open_frac: [number, number]; patience: 1|2|3|4;      // max rounds before walking
                 flex: ("bundle"|"free_shipping")[]; lever_value: Record<string, number>; share: number };
const PERSONAS: Persona[] = [
  { name: "Bargain hunter",  reservation_frac: [0.70,0.85], open_frac: [0.55,0.70], patience: 4, flex: ["bundle","free_shipping"], lever_value:{bundle:1500,free_shipping:1000}, share: 0.30 },
  { name: "Budgeted runner", reservation_frac: [0.82,0.95], open_frac: [0.75,0.85], patience: 3, flex: ["bundle"], lever_value:{bundle:1800}, share: 0.35 },
  { name: "Impatient",       reservation_frac: [0.85,1.00], open_frac: [0.80,0.90], patience: 1, flex: [], lever_value:{}, share: 0.15 },
  { name: "Loyal / brand",   reservation_frac: [0.95,1.05], open_frac: [0.90,1.00], patience: 2, flex: ["free_shipping"], lever_value:{free_shipping:1200}, share: 0.10 },
  { name: "Lowballer",       reservation_frac: [0.50,0.65], open_frac: [0.40,0.55], patience: 4, flex: ["bundle"], lever_value:{bundle:800}, share: 0.10 },
];
```
Each sim buyer runs the same `open → counter… → accept/walk` loop against the Deal Agent's engine (Strategist bypassed or template-only). 300 buyers × ≤4 rounds finishes in seconds. Deterministic seed for reproducible demos.

**Tier 2 — LLM personas via Backboard (post-H24):** for a sample of 20–30 buyers, drive the buyer with Backboard using a cheap routed model (`llm_provider: "openrouter", model_name: "openrouter/auto", openrouter: { cost_tier: "low" }`, `json_output: true`) and a persona system prompt. Show their *quotes* in the Gym UI ("As a first-time trail runner I really just wanted the socks…"). This is the SimGym vibe — and the `cost_usd` field lets you show "300 simulated buyers cost $0.41."

### 8.3 Gym UI (in Merchant Console)
- Left: Policy A vs Policy B slider panels.
- Center: two overlaid histograms of agreed price with list/floor/blanket-sale lines.
- Right: metric cards (win rate, margin uplift vs blanket sale, aged units cleared, regret), lever pie, persona breakdown.
- Bottom: 5 sample negotiations as mini-transcripts (tier 2 quotes if available).
- **Adopt Policy B** → toast "Policy live for Trailhead Trail Runner 2."

### 8.4 Why judges care
- Shopify: "commerce intelligence & data insights" + "merchant superpowers" themes in one; explicit SimGym lineage; honest about the calibration gap.
- HTN: the histogram *moving* as you drag the floor slider is a legitimately satisfying visual.
- Backboard: cheap-model routing + `cost_usd` telemetry is exactly "the more of the stack you use."

---

## 9. Backboard integration map (for the Backboard pitch)

| Backboard feature | Where we use it | What the judge sees |
|---|---|---|
| **Assistants + threads** | One assistant per Deal Agent (store) and one for the Buyer Agent; one thread per negotiation | Clean state model; no conversation-history plumbing of our own |
| **Memory Pro** (assistant-scoped, cross-thread) | Deal Agent remembers buyer agents by profile URL; Buyer Agent remembers the human (size, brands, budget style) | Console: *"Remembered: reliable closer, bundle-responsive"*; Arena: *"Welcome back — size 10, still open to bundles?"* with `memory_response_citation` |
| **Documents / RAG** (assistant-scoped) | Brand MAP policy PDF, supplier cost CSV uploaded per store | Auditor blocks a deal citing *"MAP policy §3: minimum advertised $129 — private negotiated price OK, public listing not"* |
| **Tool calling** (`REQUIRES_ACTION` → `/threads/tool-outputs`) | Strategist calls `get_offer_options`, `lookup_buyer_history`, `check_constraints` | LLM proposes; code constrains |
| **Per-message model routing** | Strong model for live Strategist; `openrouter/auto` low-cost tier for Gym personas | Gym card: *"300 simulated buyers · $0.41"* |
| **`json_output`** | Gym persona buyers, Evaluator explanations | Structured everywhere |
| **SSE streaming** | Strategist `content_streaming` → Arena offer card types out live | Theatre |
| **Voice (TTS/STT)** | Agents speak `public_reasoning`; judge haggles by voice | The finalist moment |
| **`cost_usd` / `context_usage`** | Console telemetry panel | "You built that this weekend?" |

Fallback: every Backboard call has a timeout and a local default (engine option + template text; ElevenLabs or browser SpeechSynthesis for voice; memory off). If Backboard is down on stage, the demo still runs — we just lose the "remembered you" beat.

---

## 10. Buyer side — the Buyer Agent

| Agent | Tools | Output |
|---|---|---|
| **Orchestrator** | Backboard (buyer assistant, memory Auto) | `Intent {query, budget, options, flexibilities, delegation}`; recalls prior preferences |
| **Scout** | Bazaar directory; Storefront Catalog MCP `search_catalog`/`get_product` per store (Global Catalog if creds) | Candidates `{store, variant_id, list, availability, negotiable}` |
| **Negotiator ×N** | Deal Agent MCP | Parallel, bounded; opens at `budget × 0.92`, linear concession to `budget`, prefers matching levers; publishes rounds to event bus |
| **Evaluator** | — | `U = −total + Σ lever_value(flex) + rating_bonus − shipping_penalty`; ranks live; declares winner |
| **Closer** | Cart MCP `create_cart`; Checkout MCP `create_checkout` | Real `continue_url` |

### 10.1 Closer — real Shopify calls
Endpoint per store: `https://{shop}.myshopify.com/api/ucp/mcp`. Anonymous tier suffices (catalog, cart, checkout build). Every call includes `meta.ucp-agent.profile` → `https://buyer.bazaar.dev/.well-known/ucp` (static JSON; model on `shopify.dev/ucp/agent-profiles/examples/2026-08-25/`).

1. `create_cart` with settlement `line_items`, `context.address_country`, `attribution.utm_source: "the_bazaar"`.
2. `create_checkout` with `cart_id`, `checkout.buyer.email`, **`checkout.discounts.codes: ["BZR-7K2M-Q9"]`** — docs are explicit that cart codes are *not* auto-forwarded on conversion.
3. Assert `totals[type=total]` == `agreed_total` (+tax/shipping). Display the match. This is the "it actually worked" beat.
4. Open `continue_url` (+`?utm_source=the_bazaar`). `requires_escalation` is expected at anonymous tier — buyer pays in Shopify's checkout.

**Fallbacks (test Day 1):** cart permalink `https://{shop}/cart/{v}:{q},{v}:{q}?discount=CODE` (no MCP, no auth, real checkout). Then Storefront API `cartCreate` + `cartDiscountCodesUpdate` → `checkoutUrl`.

### 10.2 Buyer Agent as an MCP server (post-H24)
Route `/mcp` on the buyer-agent process with one tool `find_and_negotiate`. Add as a ChatGPT/Claude connector. Returns best deal summary + `continue_url`. See §3.4.

---

## 11. Surfaces

### 11.1 Arena (the stage)
Three columns, offer-card timelines, spoken reasoning, utility bars, "Buy best" → toast (code minted · cart created · **checkout total matches agreed** ✓) → real checkout tab.

```
┌ Ridgeline Running ────────┐ ┌ Summit Outfitters ───────┐ ┌ Trailhead Co ────────────┐
│ list $139                 │ │ list $135                │ │ list $149                │
│ ● R1  $124   "This        │ │ ● R1  $129  "Fresh       │ │ ● R1  $119 + socks       │
│   season's colourway…"    │ │   stock, popular size…"  │ │   "Had these a while…"   │
│ ◦ you: $115 + socks?      │ │ ◦ you: $115?             │ │ ◦ you: $115 + socks?     │
│ ● R2  $115 + socks ✓      │ │ ● R2  $127  ✗ declined   │ │ ● R2  $115 + socks +     │
│                           │ │                          │ │    free ship  ★ best     │
│ 🧠 "Welcome back — you    │ │                          │ │                          │
│    closed with us at 8%   │ │                          │ │                          │
│    off last time."        │ │                          │ │                          │
└───────────────────────────┘ └──────────────────────────┘ └──────────────────────────┘
   Evaluator: Trailhead U=−103  Ridgeline U=−107  Summit U=−127        [🎤 Haggle live] [Buy best ▶]
```

**🎤 Haggle live** — a human (a judge!) speaks to a chosen Deal Agent. STT → `counter_offer` with `note` → Strategist → TTS reply. The engine still governs; the judge cannot get below floor. Cap at 3 exchanges; show the floor *after* they give up. This is the finalist moment — rehearse it.

### 11.2 Merchant Console
- **Live feed** with private reasoning: *"floor $98 · urgency 0.71 (94 d, 40 units, 0.3/d) · memory: reliable closer (+shift −0.03) · P(accept @115)=0.62 · E[margin]=$10.5"*.
- **Policy** per product: floor / urgency / max-discount sliders, lever toggles, bundle whitelist, memory toggle, documents upload.
- **Gym** (§8.3).
- **Ledger**: agreed vs list, margin protected vs blanket sale, aged units cleared, code redemption status.
- **Memory**: what the agent knows about each buyer profile; "forget" button (privacy story).
- **Pause** (kill switch) + **Approvals** inbox.
- **Telemetry**: Backboard `cost_usd`, tokens, latency per negotiation.

---

## 12. Stack & repo

```
bazaar/
├── packages/
│   ├── protocol/          # zod schemas for the negotiation extension + JSON Schema export
│   ├── policy-engine/     # pure TS, vitest property tests, zero I/O
│   ├── gym/               # personas, Monte-Carlo runner, metrics, counterfactuals
│   ├── shopify/           # Admin GraphQL client, UCP MCP client (catalog/cart/checkout), permalink
│   ├── backboard/         # thin client: messages (SSE), tool-outputs, documents, assistants
│   └── ui/                # shared components
├── apps/
│   ├── deal-agent/        # Hono + @modelcontextprotocol/sdk (Streamable HTTP); STORE env selects tenant
│   ├── buyer-agent/       # orchestrator + agents; OpenAI structured outputs; /mcp route for connectors
│   ├── arena/             # Vite + React; WS; voice
│   └── merchant-console/  # Vite + React + Polaris-style; Gym charts (recharts/visx)
├── infra/
│   ├── seed/              # 3 store CSVs (products, costs, backdated createdAt), add-ons, map_policy.pdf, supplier_costs.csv
│   └── well-known/        # buyer + 3 merchant profiles, negotiation.json, directory.json
└── docs/                  # this spec, demo script, judge Q&A, codex-log.md
```

- Node 22, pnpm, TypeScript, SQLite (`better-sqlite3`).
- LLM: OpenAI via Backboard for Strategist/Evaluator/personas (one API, model routing); direct OpenAI SDK as fallback path.
- Deploy: one box (Fly/Railway/Vultr) or laptop + Cloudflare Tunnel with stable subdomains for 3 Deal Agents + buyer profile. Static `.well-known` + directory on Vercel. **Profiles must be public HTTPS, no redirects** — Shopify fetches them.
- Voice: Backboard TTS/STT primary; ElevenLabs alternate (MLH prize); browser SpeechSynthesis as fallback.
- Huawei: if < 2 h, wrap buyer-side agents in JiuwenSwarm/WorkSwarm primitives; else document the mapping.

---

## 13. Build plan — 36 h, 4 people

Roles: **A** protocol + Deal Agent + engine · **B** Shopify plumbing + seeds + settlement · **C** buyer agents + Backboard + Gym · **D** Arena + Console + voice + demo.

### Pre-event (accounts, stores, data — not project code)
- [ ] 3 dev stores: *Ridgeline Running*, *Summit Outfitters*, *Trailhead Co*. Same core SKU + 2–3 add-ons each. Different `unitCost`, stock, backdated `createdAt`. Set Cost per item in Admin.
- [ ] Custom app per store; scopes above; copy Admin tokens.
- [ ] **Verify `POST {store}/api/ucp/mcp` → `tools/list` works on a dev store.** If not, permalink is the primary Closer path — plan for it now. Also verify `?discount=CODE` permalink applies on your store.
- [ ] Backboard account + API key; create 4 assistants (3 stores + buyer); upload `map_policy.pdf` + `supplier_costs.csv` to Trailhead's assistant; smoke-test `/threads/messages` with `memory_pro: "Auto"` and a tool call.
- [ ] Dev Dashboard → Catalog credentials (optional, Global Catalog).
- [ ] Buy `thebebazaar.dev` (or similar); Vercel for static hosting.
- [ ] Verify ChatGPT/Claude connector availability for the post-H24 bonus.
- [ ] Devpost registered; sponsor prize selection deadline **Sat 2:00 PM EDT**.
- [ ] `npm i -g @shopify/ucp-cli`; `ucp catalog search --business https://{store}.myshopify.com --set /query='trail runner'`.

### Friday night (H0–H6) — touch everything real once
| Who | Deliverable |
|---|---|
| A | `protocol` schemas; `deal-agent` MCP `tools/list` + stub `open_negotiation` (fixed counter); `.well-known/ucp` served |
| B | `shopify-sync` for one store → SQLite; `mintDiscount()` creates a real code; redeem manually in checkout; **permalink fallback verified** |
| C | Orchestrator intent parse via Backboard `json_output`; Scout hits Storefront Catalog MCP for one store; Backboard client w/ SSE + tool-outputs |
| D | Arena shell with fake event stream; Console shell |
| **H6 gate** | Fake negotiation → real code → real checkout at that price. If this exists by 2 AM, you finish. |

### Saturday (H6–H24) — make it real
| Who | Deliverable |
|---|---|
| A | Policy Engine + tests; Strategist via Backboard (tools, memory, validated output, template fallback); Auditor; state machine + TTL job |
| B | All 3 stores synced; sell-through; `discountCodeDeactivate`; order webhook → ledger; Cart+Checkout MCP client with `discounts.codes`; total assertion |
| C | Negotiator/Evaluator/Closer; event bus → WS; **Gym tier 1** (personas, runner, metrics, counterfactuals) by H18; memory notes saved post-settlement |
| D | Arena live; Console: feed w/ private reasoning, sliders, kill switch, ledger; **Gym charts** by H22 |
| **H14 (Sat 2 PM)** | **Devpost sponsor selections submitted.** |
| **H24 gate** | Full demo (haggle → checkout → console → lowball → kill switch → Gym) runs 3× untouched. Record a backup capture. |

### Sunday (H24–H36) — theatre & hardening (in priority order; stop when time's up)
1. **Voice haggle** (D + C, 2 h): Backboard TTS on offers; STT → `counter_offer`; rehearse with a teammate playing "judge."
2. **Memory beat** (C, 1 h): pre-seed Ridgeline's assistant memory with one prior negotiation from the buyer profile so "welcome back" fires on stage.
3. **Gym tier 2** (C, 1.5 h): 20 LLM-persona buyers via Backboard low-cost routing; quotes + `cost_usd` card.
4. **ChatGPT connector** (C, 2 h) — only if 1–3 are done.
5. `DEMO_OFFLINE=1` replay mode; test it. Judge Q&A drill (§15). ≤2-min video. README with architecture + `codex-log.md` (3 concrete Codex contributions). Rehearse pitch 5×; 2:45 + Q&A buffer.

---

## 14. Demo script (3 min, live, no slides)

**Setup:** Arena left 65%, Trailhead Console right 35%. Console shows policy (floor 25%, urgency high, all levers) and yesterday's Gym result already on screen. Tabs pre-opened. Offline toggle within reach. Mic tested.

1. **(0:00) Hook.** "Every AI shopping agent can find you a product and buy it. Not one can *ask for a better price*. Price is still a static field. We made it a negotiation — and we let the merchant rehearse it first."
2. **(0:20) Buyer speaks.** *"Trail runners, men's 10, budget $120 CAD, I'd take socks in a bundle."* Orchestrator parses; Ridgeline column shows 🧠 *"Welcome back — you closed at 8% off last time."* Scout finds the shoe at 3 stores; all three advertise the negotiation capability.
3. **(0:40) The haggle.** Three columns light up; round-1 cards land *spoken*. Point at Trailhead's private reasoning on the console: *"94 d · 40 units · 0.3/d → urgency 0.71 · floor $98 · memory: new buyer."* "The buyer can't see this. Only Maya can."
4. **(1:15) Counter.** $115 + socks everywhere. Summit declines ("fresh stock"). Ridgeline: $115 + socks. Trailhead: $115 + socks + free shipping. Evaluator ranks Trailhead.
5. **(1:35) Settlement.** *Buy best.* Toast: "Minted BZR-… · cart created · **total $115.00 — matches agreed ✓**." **Real Shopify checkout tab opens** with the shoe, the socks, $115. Pause. Let them look.
6. **(1:55) The Gym.** Flip to console Gym tab: *"Before Maya turned this on, 300 synthetic buyers haggled with it. Win rate 61%. $4.10/unit better than a 20% blanket sale. 22 aged units cleared. Cost to simulate: 41 cents."* Drag the floor slider; histogram moves.
7. **(2:15) Guardrails, live.** "Who wants to try to beat it?" Hand a judge the mic. They lowball the Trailhead robot by voice; it counters, politely, twice; won't cross $98. Then flip **Pause** → next request: *"Negotiations paused by the merchant."*
8. **(2:45) Close.** "Merchants advertise this like any UCP capability. Agents that don't understand it pay list. The ones that do — negotiate. That's the whole internet of commerce getting a bid and an ask, with the merchant holding the floor." Stop.

**If Wi-Fi dies:** `DEMO_OFFLINE`. Arena replays a recorded negotiation; checkout opens via pre-minted permalink (still real). Gym is local anyway. Say "cached run, same code path."

---

## 15. Judge Q&A — prepared answers

- **"Why would a merchant want to get haggled down?"** They don't; they price-discriminate *privately*. Floors are hard; the optimizer maximizes E[margin]; it declines lowballs; and the Gym shows the distribution before they commit. It replaces the blanket sale, not list price.
- **"Won't buyer agents always lowball?"** Bounded rounds + floors + rate limits make it cost time and win nothing. And the Deal Agent *remembers*: habitual lowballers get list for round one. Reputation is memory.
- **"Doesn't this leak cost data?"** Never. Only `public_reasoning` leaves the merchant, under a rule forbidding cost/floor/urgency numbers; the Auditor regex-checks it. Cost stays in Admin API scope.
- **"Isn't this just discount codes?"** The code is the *settlement rail*; UCP's own spec shows locked negotiated codes. The product is the protocol + policy engine + memory + gym that decide *what* code to mint and *when*.
- **"Why MCP/UCP and not your own API?"** Then it only works with our buyer agent. As a UCP extension, any compliant platform can adopt it by reading one schema.
- **"Is the Gym calibrated to real shoppers?"** No — and we say so. Tier 1 is parametric personas; tier 2 is LLM personas. SimGym spent a year and 48 B200s calibrating browsing behaviour; we're showing the *shape* of the tool. Real-negotiation outcomes flow back into the ledger and would calibrate personas in v2.
- **"What about brand MAP policies?"** MAP typically constrains *advertised* price, not transacted price. A private, single-use, negotiated code isn't an advertisement — that's exactly why merchants who can't run public sales can run this. And the Auditor RAGs the brand's actual policy document to enforce a hard floor if it says otherwise.
- **"Multi-agent or prompt chain?"** Seven agents, two orgs, communicating only over a protocol boundary; parallel; deterministic mixed with LLM; emergent behaviour no single prompt encodes.
- **"What did Codex do?"** Read from `codex-log.md`: three specific, verifiable items.
- **"What did Backboard do that OpenAI's API alone couldn't?"** Cross-thread memory keyed on a buyer identity with citations; assistant-scoped document RAG for MAP checks; per-message model routing that made 300 sim buyers cost 41 cents; TTS/STT for the live haggle — all one API.
- **"Allowed on Shopify?"** Discounts via Admin API, checkout via public Checkout MCP, catalog via public Catalog MCP. No scraping, no replicated pricing, UCP namespace governance for the extension.

---

## 16. Risks & mitigations

| Risk | L | Mitigation |
|---|---|---|
| `/api/ucp/mcp` not enabled on dev stores | M | Verify pre-event; permalink `?discount=` primary fallback; Storefront API second. Still a real checkout. |
| Agent profile fetch fails | M | Static JSON on Vercel, no redirects, `curl -I` test; Shopify example profile URL as emergency. |
| LLM/Backboard latency drags the haggle | H | Engine pre-computes options; LLM only writes copy; 4 s timeout → template; stream cards as engine decides. |
| Voice haggle misfires on stage | M | Push-to-talk; visible transcript; cap 3 exchanges; teammate as backup "judge"; browser SpeechSynthesis fallback. |
| Memory beat doesn't fire | M | Pre-seed the memory the night before; verify `retrieved_memories` non-empty in rehearsal; fallback text if empty. |
| Code not applied at checkout | M | Assert total; re-mint once; else permalink. Test `combinesWith` Day 1. |
| Gym looks like fake numbers | M | Show the persona table + seed; label "synthetic"; show the counterfactual formulas on hover. Honesty is the defence. |
| Scope creep | H | Hard gates at H6 and H24. Sunday list is strictly ordered. |
| Wi-Fi | ~C | `DEMO_OFFLINE` + pre-minted code + recorded video. |

---

## 17. v2 (when asked "what's next")
- **Shopify Function** discounts: per-checkout dynamic pricing, no code to leak.
- **Gym calibration** from real ledger outcomes; personas learned from a store's actual negotiation history.
- **A2A transport** binding for non-MCP platforms.
- **Group deals**: "if 5 buyer agents commit in 10 minutes, everyone gets $110."
- **Cross-merchant bundles** into Universal Cart when it leaves waitlist.
- **Propose `dev.ucp.shopping.negotiation`** to the UCP governing body — this hackathon *is* the reference implementation.

---

## Appendix A — Seed data

| Store | Shoe cost | List | Stock | Age | Velocity | Add-ons | Policy |
|---|---|---|---|---|---|---|---|
| Ridgeline Running | $82 | $139 | 18 | 45 d | 0.6/d | Socks ($18, cost $6) | Balanced; floor 25%; bundle on; **memory pre-seeded for buyer profile** |
| Summit Outfitters | $88 | $135 | 60 | 12 d | 1.4/d | Flask ($25, cost $9) | Tight; floor 35%; price only; max 8% |
| Trailhead Co | $78 | $149 | 40 | 94 d | 0.3/d | Socks, Gaiters | Urgent; floor 25%; all levers; max 30%; **MAP policy doc uploaded (min advertised $129)** |

Buyer: $120 CAD, size 10, flexibilities bundle + free shipping. Expected: Summit declines below ~$124; Ridgeline $115 + socks; Trailhead $115 + socks + free ship. Gym on Trailhead Policy A (floor 25%, urgency high): win ≈ 61%, avg ≈ $114, uplift vs 20% blanket ≈ +$4.10/unit.

## Appendix B — Environment

```
# deal-agent (per store)
STORE_DOMAIN=trailhead-co.myshopify.com   ADMIN_TOKEN=shpat_…   PUBLIC_URL=https://trailhead.bazaar.dev
BACKBOARD_API_KEY=…   BACKBOARD_ASSISTANT_ID=asst_trailhead
OPENAI_API_KEY=…   ELEVENLABS_API_KEY=…   DEMO_OFFLINE=0

# buyer-agent
BUYER_PROFILE_URL=https://buyer.bazaar.dev/.well-known/ucp
BAZAAR_DIRECTORY_URL=https://bazaar.dev/directory
SHOPIFY_STORES=ridgeline-running.myshopify.com,summit-outfitters.myshopify.com,trailhead-co.myshopify.com
BACKBOARD_ASSISTANT_ID=asst_buyer
```

## Appendix C — Backboard call cheat-sheet

```http
POST https://app.backboard.io/api/threads/messages      # main call; SSE when stream=true
  X-API-Key: …  Content-Type: application/json
  { content, thread_id?, assistant_id, system_prompt?, tools?, stream?, llm_provider?, model_name?,
    memory: "Auto"|"Readonly"|"off"  |  memory_pro: "Auto"|"Readonly",  memory_response_citation?,
    web_search?: "Auto", json_output?, thinking?, openrouter?: {cost_tier|sort|providers}, send_to_llm?: "false" }
  → { content, thread_id, status: COMPLETED|REQUIRES_ACTION|…, tool_calls[], retrieved_memories[],
      retrieved_files[], cost_usd, context_usage, reasoning? }

POST /threads/tool-outputs                              # after REQUIRES_ACTION / tool_submit_required
GET  /threads/{id}                                      # inspect a negotiation transcript
multipart files[] on /threads/messages                  # thread-scoped docs; assistant-scoped via SDK documents API
```

## Appendix D — References
- Shopify agentic docs: `shopify.dev/docs/agents` (Catalog / Cart MCP / Checkout MCP / auth tiers / profiles)
- UCP spec 2026-08-25: overview (namespace governance, extensions, **request_constraints → "Locked negotiated discount codes"**), shopping/cart, shopping/checkout
- Admin GraphQL: `discountCodeBasicCreate`, `discountCodeDeactivate`, `productVariants`, `inventoryItem.unitCost`, `inventoryLevel.quantities`
- `@shopify/ucp-cli` for smoke-testing MCP calls
- SimGym: `shopify.engineering/simgym` ("2,000 robots walk into a shop"); help.shopify.com/manual/online-store/simgym
- Backboard: `docs.backboard.io` (concepts/messages, memory, tool-calling, documents)
- Huawei openJiuwen: `github.com/openJiuwen-ai/jiuwenswarm`
- Museum of Hack the North: `museum.hackthenorth.com` — finalists are visceral; plan the stage moment
