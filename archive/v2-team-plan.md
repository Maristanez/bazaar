> [!WARNING]
> **ARCHIVED — v2, superseded by [`../PLAN.md`](../PLAN.md) (v3).**
> Companion to [`v2-spec.md`](v2-spec.md). Describes the **Arena** (three columns racing) rather than v3's storefront-plus-pet, and a 4-person framing of the split.
>
> **Kept because** the three-lane structure (P1 Brain / P2 Rails / P3 Stage), the "three contracts in the first 30 minutes" rule, and the UX rules survived into v3. The clock in §5 is correct; §8's schedule is not — use `../PLAN.md` §13.

---

# The Bazaar — plain-English component map & 3-person split

Companion to `v2-spec.md`. The spec is the *what*. This is the *what you see* and *who builds it*.

---

## 1. The whole thing in one paragraph

A shopper's AI says "trail runners, $120, I'd take socks." Three stores each run their own haggling robot. The three robots bid against each other, out loud, in three seconds. The best one mints a real single-use discount code and a **real Shopify checkout tab opens at the negotiated price**. The store owner never loses control: her floor is hard-coded, her reasoning is private, and before turning it on she ran 300 fake shoppers against her rules and read a histogram. That's it. Everything below exists to make those two sentences literally true on stage.

---

## 2. There are only two screens

Every component in the spec is either **a screen a human looks at** or **machinery that makes one number on a screen true**. If a component doesn't buy a pixel, it doesn't ship this weekend.

| Screen | Who it's for | The feeling it has to create |
|---|---|---|
| **Arena** (65% of the display) | The buyer — and the judge | *"They're negotiating. I can follow it."* Three columns racing, offer cards landing with spoken reasoning, one ★ winner, a Buy button that opens a real checkout. |
| **Merchant Console** (35%) | Maya, the store owner | *"I'm still in charge."* The private reasoning the buyer can't see, three sliders, the Gym histogram, a red PAUSE. |

Nothing else has a UI. Stop building anything that doesn't feed these two.

---

## 3. Component map — every piece, by the pixel it buys

### The merchant's robot (one server per store)

| Piece | What it really is | The pixel it buys | Who sees it |
|---|---|---|---|
| **Protocol** (`com.thebazaar.shopping.negotiation`) | zod schemas + a JSON file on a URL | The *shape* of an offer card. Invisible, but every card in the Arena is one of these messages. | Nobody — until a judge asks "is this real UCP?" and you open the `.well-known/ucp`. |
| **Policy Engine** | ~120 lines of pure TypeScript. No network, no LLM. | **The number on the card.** And the moment the judge can't get below $98. | Buyer sees the price; merchant sees `floor $98 · urgency 0.71`. |
| **Strategist** (Backboard LLM) | Picks *which* engine-approved option, then writes one sentence about it. | **The sentence in quotes.** `"Had these a while and I'd like them on a trail, not a shelf."` | Buyer reads it; merchant reads the *private* version. |
| **Memory** (Backboard Memory Pro) | A note saved per buyer profile URL. | The 🧠 chip: *"Welcome back — you closed at 8% off last time."* | Both. This is the beat that gets the "wait, what?" |
| **Auditor** | An `if` statement and a regex, run right before minting. | **A red event in the Console:** *blocked — policy_violation*. | Merchant. Demo this on purpose. |
| **Settlement** | One Admin GraphQL call → a 15-minute single-use code. | **The toast:** `total $115.00 — matches agreed ✓` and then the real checkout tab. | Everyone. This is the whole demo. |
| **Shopify Sync** | A 60-second cron into SQLite. | The numbers inside the private-reasoning line: `94 d · 40 units · 0.3/d`. | Merchant. Makes the robot feel grounded in a real store. |

### The buyer's robot (one process)

| Piece | What it really is | The pixel it buys |
|---|---|---|
| **Orchestrator** | Parse one sentence into `{query, budget, flexibilities}`. | The typed/spoken intent at the top of the Arena. |
| **Scout** | Look up 3 stores, find the variant. | The three columns *appearing*, each with a list price. |
| **Negotiator ×3** | The same loop, run in parallel. | The rounds ticking down each column at the same time. Parallelism is the visual. |
| **Evaluator** | One utility formula. | The **★ best** badge and the ranking bar at the bottom. |
| **Closer** | `create_cart` → `create_checkout` with the code. | The real checkout tab. Plus the assertion that makes the toast honest. |

### The Gym (no live traffic, runs offline)

It is *the policy engine in a for-loop, 300 times*. That's the entire trick. The value is not the simulation — it's the picture.

| Piece | The pixel it buys |
|---|---|
| Parametric personas (5 of them, a table of numbers) | The persona breakdown pie, and honesty when a judge asks "calibrated?" — *"No. Synthetic, and we label it."* |
| Monte-Carlo runner | **The histogram.** |
| Counterfactuals (list-only, blanket 20% sale) | The line that matters: *"+$4.10/unit better than a blanket sale."* |
| Adopt button | A toast: *"Policy live."* One click, huge trust signal. |

**The single best interaction in the product:** drag the floor slider → the histogram moves in real time. Build that. It's worth more than three backend features.

---

## 4. Simplified architecture — 15 boxes become 6

The spec draws seven agents across two orgs. That's the *pitch* framing and you should keep saying it. But what you **build** is:

```
2 screens        Arena · Merchant Console
3 processes      deal-agent (×3 by env var, one codebase) · buyer-agent · gym runner (in-process)
1 job            shopify-sync
```

Cut or fold, explicitly:

| In the spec | Do this instead | Why |
|---|---|---|
| **Bundle Composer** as its own agent | A whitelist array + one `if` inside the Strategist prompt | It was never a separate thing. |
| **Bazaar directory service** | `directory.json`, static file on Vercel | It's a lookup table. |
| **Gym tier 2** (LLM personas) | Only after the H24 gate | Tier 1 buys the histogram; tier 2 buys quotes. |
| **ChatGPT/Claude connector** (§10.2) | Cut. Say it in Q&A as the production path. | 2 h for zero stage time. |
| **Huawei JiuwenSwarm wrapper** | Document the mapping in the README | The protocol boundary *is* the multi-agent story. |
| **Rox cost-sheet ingestion** | Cut | Off the critical path. |
| **Approvals inbox** | One toggle + one line in the feed | The kill switch carries the control story. |
| **3 fully-configured stores** | 3 stores, but only **Trailhead** gets docs + memory + all levers | Summit only has to decline. Ridgeline only has to say "welcome back". |

---

## 5. The real clock (the spec's §13 is wrong)

Per `../reference/hackathon-rules.md`: code **Sat 00:00 → Sun 08:00 EDT = 32 h**. Devpost + all sponsor prize selections by **Sat 14:00**. Sponsor judging **Sun 09:45–11:45**; HTN round 1 in rooms, top 2 advance to a 4-min demo at 12:00.

Friday night is **not** build time. It is accounts, stores, seed CSVs, installs, and verification — explicitly allowed in advance, and the single highest-leverage six hours you have.

With three people on a 32-hour clock, **sleep is a scheduled resource, not a failure.** Rotate: each person takes one 4-hour block between H14 and H26 so that two are always awake and nobody is incoherent at 09:45 Sunday.

---

## 6. The three lanes

Merge the spec's four roles (A protocol/engine · B Shopify · C buyer+gym · D surfaces) like this. The seam is chosen so the two ugliest external dependencies — Shopify auth and Backboard latency — never land on the same person as the UI.

### 🧠 P1 — BRAIN (the merchant's robot)
`packages/protocol` · `packages/policy-engine` · `packages/gym` · `apps/deal-agent`

Owns the math and the thing that speaks UCP. Zero front-end, zero Shopify Admin.

- Protocol zod schemas + `negotiation.json` + the four MCP tools
- Policy engine: reservation, urgency, concession curve, expected-margin optimizer — **with property tests** (this is the "technical excellence" exhibit; a judge may ask to see a test run)
- Strategist via Backboard (tools, memory, validated output, 4 s timeout → template)
- Auditor + state machine + TTL expiry
- **Gym runner**: the engine in a loop, personas, metrics, counterfactuals — headless, emits JSON

*Why these together:* the Gym is the policy engine called 300 times. Same person, same file, one afternoon.

### 🔌 P2 — RAILS (everything that touches a real company)
`packages/shopify` · `packages/backboard` · `apps/buyer-agent` · `infra/seed` · `infra/well-known`

Owns every credential and every call that can 401 at 3 a.m.

- Shopify sync (Admin GraphQL → SQLite: cost, stock, age, velocity)
- Settlement plumbing: `discountCodeBasicCreate`, `discountCodeDeactivate`, order webhook → ledger
- Closer: Cart MCP → Checkout MCP with `discounts.codes`, total assertion, **and the permalink fallback proven working**
- Buyer agent: orchestrator, scout, negotiators (parallel), evaluator
- Thin Backboard client (SSE + tool-outputs) — P1 consumes it
- All seed data, `.well-known` profiles, directory.json

*Why these together:* one person holds all the tokens and all the vendor docs. External flakiness stays in one lane.

### 🎭 P3 — STAGE (both screens, the voice, the demo)
`apps/arena` · `apps/merchant-console` · `packages/ui` · the event bus · the demo

Never blocked, because the event bus is mocked from hour zero.

- Arena: three columns, offer cards, utility bars, Buy best → toast
- Console: live feed with private reasoning, sliders, ledger, memory panel, PAUSE
- **Gym charts**: overlaid histograms, metric cards, the slider→histogram interaction
- Voice: TTS on `public_reasoning`, STT → `counter_offer`, push-to-talk
- `DEMO_OFFLINE=1` replay, the backup capture, and rehearsal discipline

*Why alone:* two full front-ends and the voice loop is the biggest single block of work here. Don't dilute it. P1 rolls onto this lane after H24.

---

## 7. The three contracts — agree these in the first 30 minutes

This is the whole reason three people can work in parallel. Write these files **before** anyone builds behind them, then everyone mocks the other two.

1. **`NegotiationEvent`** (P1 → P3). One TypeScript type, one WebSocket channel. P3 builds the entire Arena against a recorded array of these before P1's server exists. *This also becomes `DEMO_OFFLINE` replay for free.*
2. **`Settlement`** (P1 ↔ P2). `{discount_code, agreed_total, line_items[], expires_at, permalink_fallback}`. P2 can mint and redeem real codes hours before the engine picks a price.
3. **`GymResult`** (P1 → P3). The metrics JSON. P3 builds the histograms against a hand-written fixture.

Rule: **nobody waits.** If a lane is blocked, it is because a contract wasn't written.

---

## 8. Schedule

| Window | 🧠 P1 Brain | 🔌 P2 Rails | 🎭 P3 Stage |
|---|---|---|---|
| **Fri evening** *(setup, not code)* | Backboard: 4 assistants, upload MAP pdf + cost csv, smoke-test memory + a tool call | **3 dev stores, custom apps, tokens. Verify `POST {store}/api/ucp/mcp` and verify `?discount=CODE` permalink applies.** Buy domain, Vercel project | Wireframe both screens on paper. Install everything. Test the mic |
| **H0–H6** *(Sat 00:00–06:00)* | Write the 3 contracts. Protocol schemas. MCP `tools/list` + stub `open_negotiation` returning a fixed counter | Sync one store → SQLite. `mintDiscount()` → **redeem a real code in a real checkout by hand** | Arena shell driven by a fake event array. Console shell |
| **H6 GATE** | ─── **Fake negotiation → real code → real checkout at that price.** If this is not true at 06:00, stop everything else and fix only this. ─── | | |
| **H6–H14** | Policy engine + property tests. Strategist w/ template fallback. Auditor | 3 stores synced. Closer: cart → checkout + total assertion. Permalink fallback wired | Arena on live events. Console feed + sliders + PAUSE |
| **H14 HARD** | ─── **Devpost submitted with every sponsor prize selected. 14:00 Sat. No exceptions.** ─── | | |
| **H14–H24** | Gym runner + metrics + counterfactuals (done by H20). Then help P3 | Buyer agent end-to-end: scout → 3 parallel negotiators → evaluator → closer. Ledger + webhook | Gym charts + **slider→histogram**. Memory panel. Offline replay mode |
| **H24 GATE** *(Sun 00:00)* | ─── **Full run 3× untouched: haggle → checkout → console → lowball declined → kill switch → Gym. Record the backup capture now.** ─── | | |
| **H24–H30** | Voice with P3. Pre-seed Ridgeline memory so "welcome back" fires. Gym tier 2 *only if* voice is done | Harden: retries, timeouts, re-mint once, offline pre-minted code | Voice haggle loop. Rehearse with P2 playing the judge |
| **H30–H32** *(→ Sun 08:00)* | ─── Submit final · `codex-log.md` (3 concrete Codex items) · README · **all three rehearse 5×, 2:45 with Q&A buffer** ─── | | |

---

## 9. Three UX rules that decide whether this lands

1. **Every machine decision gets one human sentence.** A price with no reasoning is a number; a price with `"Had these a while and I'd like them on a trail"` is a character. This is the entire difference between a dashboard and a stage.
2. **The merchant's control is always visible on screen.** The floor line drawn on the histogram, the PAUSE button in frame at all times, the private/public split stated out loud. The most dangerous judge question is *"why would a merchant want this?"* — the UI should answer it before it's asked.
3. **Label the synthetic as synthetic.** The Gym says "300 synthetic buyers" on the card. Volunteering the limitation is what makes the rest of the numbers believable.

---

## 10. The two things most likely to kill this

- **`/api/ucp/mcp` isn't enabled on a dev store.** Verify tonight, not Saturday. The permalink path (`/cart/{v}:{q}?discount=CODE`) is a real checkout and a legitimate primary path — but only if it's proven before code starts.
- **P3 becomes the bottleneck at H20** because two front-ends plus voice is more than a third of the work. This is why P1 moves onto the Stage lane after the Gym runner lands. Plan it; don't discover it.
