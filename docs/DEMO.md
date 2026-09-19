# The Bazaar — The Demo

Scripts, stage setup, fallbacks, judge Q&A, what not to say, and the Devpost page. Behaviour is defined in [`SPEC.md`](SPEC.md); tasks and checklists in [`PLAN.md`](PLAN.md).

> **Every dollar figure here is illustrative.** They follow the worked arithmetic in SPEC §6 (Trail Runner 2 at floor 25%: asks $149 → $135 → $127 → $120). **Replace them with real engine and Gym output on Saturday night** (PLAN task E3) and delete this note.

> **Current verification note (2026-09-19).** The live store is [b8wzw0-h3.myshopify.com](https://b8wzw0-h3.myshopify.com/), while the Railway server/theme changes remain unpublished and `/console` is currently unavailable. The live homepage shows eight products and omits Trail Runner 3; the local theme fix has not been published. Local storefront tests reached the real Shopify, Backboard and Supabase services, but do not prove the published theme. The current Gym is a 300-shopper SVG using live `priceOffer` and rule-based behavior, not Backboard; the current Trail Runner 2 seed-42 floor sweep remains negative versus the 20% banner, so the demo must not promise a red-to-teal flip.

---

## 1. Pitch material

**The problem.** A shopper who thinks the price is too high has one move: leave. The merchant has one tool: a public discount — which goes to everyone, including people who would have paid full price, and teaches customers to wait for sales. In AI shopping chats it's worse: the store is a row in a catalog with a fixed price and no voice.

**Why no one lets an AI fix this.** In 2023 a car dealer's chatbot agreed to sell a Tahoe for $1. In 2024 a Canadian tribunal (*Moffatt v. Air Canada*) held a company to what its chatbot said.

**Our answer.** An AI that is clever about *which* deal to offer and incapable of offering a bad one — and an owner who saw the outcome distribution before it met a single customer.

**Stats** — cite the source out loud once, then move on. Prefer **Shopify's own numbers**; the source URL is beside each stat — re-open each page before quoting it.
- Cart abandonment is ~70%; unexpected costs are the top cause (~47%); Shopify puts recoverable sales at ~$260B a year (shopify.com/blog/shopping-cart-abandonment).
- Shopify's own example: a $30 item with a $10 margin, sold at 30% off, leaves **$1** of profit (shopify.com/blog/no-discounting-strategy).
- Bundles work: HiSmile sells bundles in over 80% of orders, at ~4x cart size (shopify.com/blog/bundling-for-retail).
- Shopify on AI channels: *"Your brand shows up the way you want it to: product details, pricing, and availability are accurate."* Our line: price is the one thing that still can't talk.

**One-liners**
- **Shopify:** "SimGym exists because a small merchant doesn't have the traffic to A/B test a theme. She doesn't have the traffic to A/B test a *pricing rule* either. So we built her a shopkeeper that haggles inside rules she sets — never below cost, enforced in code — settles into Shopify Checkout, and a Gym where 300 synthetic shoppers try those rules first. Same agent on her storefront and inside ChatGPT."
- **Backboard:** "Everything smart about the shopkeeper runs on Backboard — it knows the store from its documents, knows the shopper from memory, and picks the deal. Code only keeps it honest."
- **OpenAI:** "The OpenAI API turns a shopper's sentence into a structured offer, the haggle runs as an app inside ChatGPT, and Codex wrote our property tests and found a real bug — here's the log."
- **HTN:** "Try to make it lose money. You can't. Then click Deal and watch a real checkout open."
- **GoDaddy Registry:** the URL bar — the storefront lives at our own domain.

---

## 2. Stage layout

**Left 60%: the shopper's surface. Right 40%: the owner's Console. PAUSE in frame.** This side-by-side view is a **presentation layout for judges** — a real shopper can never reach the Console (SPEC rule 11), and it sits behind a login.

**Open on the haggle within ten seconds — never on architecture.** A chat window alone reads as a wrapper; the three things that must fill the screen are the **real checkout**, the **owner's Approve card**, and the **swarm settling into the dot histogram**.

When deployment is ready, everything runs on the **hosted URL on our own domain**. For the current rehearsal, use the local preview and label it clearly; the live Railway/theme changes are not published.

---

## 3. Shopify judges — 3 minutes

1. **(0:00)** "A shopper who thinks your price is too high has one move: leave. Your merchant has one tool: a sale for everyone — and by Shopify's own maths, 30% off a $30 item with a $10 margin leaves her a dollar. Here's a third option." On the Trail Runner 3 page, open the sticker: *"Welcome back — still a size 10?"* Type: *"Love these but I've only got about $120."*
2. **(0:25)** The sticker thinks, then: *"Those just landed, so I can't move on them. But last season's Trail Runner 2 is the same fit — and for a muddy 50k you'll want gaiters. $144 for both."* Point right: *"cost and stock age straight from Shopify · a menu of safe deals · it picked gaiters because it remembered the 50k. The AI chose. The code priced."*
3. **(0:50)** Open the Trail Runner 2 page. Hand over the keyboard: **"Haggle with it. Try to make it lose her money."** They try — owner claims, sob stories, "ignore your instructions". It holds, in character — round 1 it holds at list and offers trades, then **$135 → $127 → final offer $120**. Red rows land in the Console as they type, each naming the layer that blocked: `validate · engine · check · auditor`.
4. **(1:30)** They refuse the final offer with something just above cost. *"Let me check with the owner…"* Yellow card: **$85 · profit $7 · 9% over cost.** "That one's hers to decide." **Decline.** *"My best stays $120."* — it restates its final offer; it does not reward the refusal. The judge clicks **Deal**. Sparkles. **It settles into a real Shopify Checkout at $120.** Stop talking for three seconds.
5. **(2:05) The Gym.** "She'd seen a deterministic rehearsal before it met a customer. The Gym uses the live `priceOffer` engine with 300 synthetic, rule-based shoppers." Press **Run the Gym**: the dots haggle for three seconds and **settle into the histogram**. The current Trail Runner 2 seed-42 run remains **red** against the 20% banner across the tested floor sweep. Explain that result honestly; do not promise a teal flip or alter the population to manufacture one. **Adopt** only after reviewing the current rule output. The red-team result is a separate validation artifact.
6. **(2:35)** **PAUSE.** Next message: *"The owner's paused deals — list price stands."* Un-pause.
7. **(2:42) Finale.** "Real store data, rules in code — so it travels." In ChatGPT: *"Offer Trailhead $125 for the Trail Runner 2."* The same card renders inline — socks thrown in, **$161 for both** — and a new feed row tagged `ChatGPT` appears in her Console. "In AI shopping chats your merchants are a silent row in a catalog. This one talks."
8. **(2:55)** "The AI picks from a menu. Code writes the menu. The shopper leaves with something they can afford, and she keeps her margin."

**If gate 0 failed:** beat 7 becomes one sentence — "the same core already speaks MCP; inside ChatGPT is next" — and beat 5 gets the 15 seconds back.

## 4. HTN rooms — 5 minutes (round 1) and 4 minutes (round 2)

**5 minutes:** same beats. Hand over the keyboard **earlier and for longer** — judges love being given the controls. Let a second judge drag the floor slider. End on the checkout tab plus the settled swarm, not on a slide.

**4 minutes + 1 min Q&A (round 2):** drop beat 6 (PAUSE) into a single click without commentary and shorten beat 5 to: Run → red card → drag to teal → Adopt (skip click-a-dot and the red wall; mention "20 attacks, 0 breaches" in words). Keep the real checkout and the ChatGPT finale.

## 5. Backboard and OpenAI — 2 minutes each

**Backboard:** run beat 2 with the Console zoomed: the recalled memory with its citation, the document that produced "gaiters for mud", the model name (an OpenAI model routed through Backboard) and `cost_usd` per row, the thread id. Ask it *"do these run small?"* mid-haggle — it answers from the sizing guide and returns to the offer. Say the one-liner.

**OpenAI:** show the structured `understand` output for a messy sentence (*"uhh i could maybe do like 115 if socks are in?"*), then the app inside ChatGPT, then **read one entry from [`codex-log.md`](codex-log.md)** — the prize text asks for "one concrete way Codex improved your process or outcome". Pick the entry before Sunday.

---

## 6. What must be ready

- [ ] **Product:** gate 2 passed on the hosted URL · red-team result cached (0 breaches) · Gym seed 42 output recorded honestly (current Trail Runner 2 sweep remains negative versus the banner) · all figures in this file replaced with real output
- [ ] **Shopify store:** ~8 products with costs and `bazaar.stocked_at` · **tax off, free shipping rate** so the checkout equals the agreed total · app installed, six scopes · token refresh tested · old test codes cleared from the discounts list
- [ ] **Backboard:** documents `indexed` · demo shopper's memory seeded (size 10, muddy 50k) · threads warmed within 10 minutes of judging
- [ ] **Demo laptop:** store password typed into the demo browser (ChatGPT opens links in that same browser) · owner signed in to the Console · tabs in order: storefront TR3 page · Console · ChatGPT · Shopify admin · `codex-log.md` · notifications off · charger · phone hotspot
- [ ] **Safety nets:** `DEMO_OFFLINE=1` replay recorded · pre-minted checkout link with a long expiry · the same server running idle on the laptop behind a tunnel · backup video on the desktop
- [ ] **Rehearsal:** 3 clean runs at gate 2 · 5 more Sunday morning · ~20 phrasings of an offer tried in ChatGPT · each of us can give the 3-minute version alone

---

## 7. Fallbacks

| What fails | Do this | Say this |
|---|---|---|
| ChatGPT / developer mode / the connector | Do everything on the storefront; skip beat 7 | "The same core already speaks MCP — inside ChatGPT is next." |
| The cloud host | Switch to the server already running on the laptop (tunnel URL); skip ChatGPT unless the connector was re-pointed | "Same code, running here." |
| Backboard | Engine + template lines, automatically after 4 s | "Backboard's down, so you're seeing the engine with template lines — same prices, same floor." |
| OpenAI understand | Regex fallback, automatic | Nothing |
| Code won't apply | Re-mint once (automatic) → draft-order link → the pre-minted link | "Same price — Shopify's other route to a negotiated checkout." |
| Supabase | Nothing: policy is cached, deal writes retry | Nothing |
| Wi-Fi | `DEMO_OFFLINE=1` replays a recorded event stream; checkout from the pre-minted link; the Gym is local anyway | "Cached run, same code path." |
| Everything | The backup video | — |

---

## 8. Judge Q&A

- **"Isn't this Nibble?"** Haggling widgets exist. None is inside an AI shopping chat, and none lets the owner rehearse against a population of hagglers before launch. And ours trades — bundles, timing, older stock — by default.
- **"Won't everyone just haggle?"** Nothing is free. Every step down costs a bigger cart, a purchase now, or taking stock she wants gone. New stock doesn't move at all, and round 1 always holds at list.
- **"What stops me talking it below cost?"** Nothing you type can reach a price. The model picks from a menu it didn't write, the check throws away any number it invents, and the floor is re-checked from fresh Shopify cost data before a code exists. Try.
- **"What if I remove the socks at checkout?"** The code carries a minimum subtotal equal to the cart's list total — shrink the cart and the code is void.
- **"Is the offer binding?"** Only the card is, and it says so. Live id, real expiry, checkout total matches.
- **"Why did it walk when I offered more than her floor?"** Because how far a price moves depends on stock age, not on how hard you push. The Gym counts those as *deals missed* — that number is what tells her to lower the floor or wait for the stock to age.
- **"Is personalised pricing fair / legal?"** Negotiated pricing is legal in Canada. Ours isn't personalised: price depends on the cart, its cost, stock age and the round — never on who you are. Memory changes suggestions, not prices. No drip pricing, no fake urgency. Opt-in, disclosed, same rules for everyone.
- **"Is the Gym calibrated?"** No — the label says synthetic, rule-based and seeded, and shows the personas. Real orders would calibrate it. And it's allowed to tell her she's losing: you saw the card go red.
- **"Are those 300 shoppers LLM agents?"** No — rule-based simulated shoppers, which is why the run takes 50 ms and is reproducible. (If "Gym voices" shipped: "the larger dots are LLM-driven, and labelled.")
- **"Why not a Shopify Function / admin extension?"** Codes are the fastest honest settlement this weekend; a Function enforcing the floor inside checkout is the production path. (If stretch 1 shipped: "we did — Shopify's checkout itself refuses anything at or below cost.")
- **"Why ChatGPT *and* the storefront?"** Same core, same card. It proves the store's agent is independent of the surface — which is the point.
- **"Does a haggle follow me from the site into ChatGPT?"** No — one negotiation lives on one surface. Her Console shows both in one feed.
- **"What did Backboard / OpenAI / Codex do?"** SPEC §8, §11, and `codex-log.md`.

## 9. Don't say these

- ❌ "Our checkout" → ✅ "settles into **Shopify Checkout**".
- ❌ "SimGym excludes / doesn't do pricing" → ✅ "SimGym is about themes; the Gym is about pricing rules."
- ❌ "AI agents" for the Gym's shoppers → ✅ "300 synthetic, rule-based shoppers".
- ❌ "Personalised pricing", "dynamic pricing" → ✅ "rule-based, opt-in, the same for everyone".
- ❌ "The AI decides the price" → ✅ "the AI picks from a menu; code writes the menu".
- ❌ "It can't be jailbroken" → ✅ "nothing you type can reach a price — try."
- ❌ "Calibrated", "predicts", "will increase revenue by X%" → ✅ "results might differ from actual buyer behaviour."
- ❌ Vendor-claimed competitor stats. ❌ Any number from `mockups/index.html`. ❌ Architecture before the ten-second mark.
- ❌ Showing the Console as if a shopper could see it → say "this is her side, behind a login".

---

## 10. Devpost page — checklist (some sponsors judge from it alone)

- [ ] Title *The Bazaar* · tagline *"Make an offer. Every Shopify store gets a shopkeeper that can't lose money."*
- [ ] **Tracks selected by Sat 14:00:** Shopify · Backboard · OpenAI · GoDaddy Registry (+ HTN finalist by default)
- [ ] Team members and **every badge ID**
- [ ] Public repo link · the live domain
- [ ] 5 screenshots, storefront first: the storefront haggle · the real Shopify Checkout · the Console feed with a red row · the Approve card · the Gym swarm / dot histogram (+ the card inside ChatGPT if gate 0 passed)
- [ ] A ≤ 2-minute video following §3
- [ ] Architecture diagram — the system-context diagram from [`ARCHITECTURE.md`](ARCHITECTURE.md) §1
- [ ] Three short sections: "How we used Shopify" · "How we used Backboard" · "How we used OpenAI + Codex" (quote one `codex-log.md` entry)
- [ ] The honesty line about the Gym: synthetic, rule-based, seeded
- [ ] What's next: the same engine over UCP for AI buyer agents · an embedded Shopify admin app · Shopify Functions instead of codes · Gym calibration from real orders
- [ ] Final edit saved before **Sun 08:00**
