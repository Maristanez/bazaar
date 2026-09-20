# The Bazaar — Product

**Hack the North 2026 · 19–20 Sept · team of 3.** This file is the "what and why". It is written so a second-year student can follow it and an engineer can test against it.

Companion files, all in this `docs/` folder: [`SPEC.md`](SPEC.md) (the build spec — the source of truth for how) · [`ARCHITECTURE.md`](ARCHITECTURE.md) (diagrams, state machines, API shapes) · [`USE-CASES.md`](USE-CASES.md) (every flow, with acceptance criteria) · [`PLAN.md`](PLAN.md) (who builds what, when) · [`DEMO.md`](DEMO.md) (the demo script).

Words in **bold** the first time they matter are defined in the glossary (§15). Both this file and `USE-CASES.md` use those words in exactly that sense.

---

## 1. Summary

**The Bazaar is a Make-an-offer shopkeeper for a Shopify store.** A shopper names a price on the store's own product page and the store's AI shopkeeper haggles back. (A ChatGPT app is a planned second surface — not built on main.) It knows the shop (store notes, a sizing guide and policies, held as Backboard documents) and it knows the shopper (Backboard memory), so it looks for a deal that fits that person. It never gives a discount for free: every step down is a **trade**. When both sides agree, the deal settles into a real Shopify Checkout at the agreed total. It cannot lose the owner money, because the AI only ever picks from a **menu** of deals that plain code has already priced from the store's real costs. And before the owner switches it on, she rehearses her pricing rules in **the Gym**: 300 synthetic shoppers and 20 scripted attacks.

**The one-liner.** "Make an offer. Every Shopify store gets a shopkeeper that can't lose money."

**The one action.** Make an offer. Everything else in the product exists to answer that action safely.

**The core design rule.** The LLM picks from a menu; code writes the menu.

---

## 2. The problem

**2.1 The shopper's only move is to leave.** A shopper who thinks a price is too high cannot say so. They close the tab. Shopify's own blog puts cart abandonment at about 70%, with unexpected costs the top cause at about 47%, and cites Baymard's estimate of $260 billion a year in recoverable sales (shopify.com/blog/shopping-cart-abandonment).

**2.2 The merchant's only tool is a sale for everyone.** A public discount goes to every shopper, including the ones who would have paid full price, and it teaches customers to wait for the next sale. Shopify's own example: *"If an item that sells for $30 with a profit margin of $10 is discounted by 30%, the result is only $1 of profit"* (shopify.com/blog/no-discounting-strategy). The same blog points to bundling as the alternative: HiSmile's bundles became over 80% of orders and quadrupled average cart size (shopify.com/blog/bundling-for-retail).

**2.3 In AI chats the store is a silent catalog row.** Shopping is moving into AI chats. There, a store is a row in a list with a fixed price. Shopify says of AI channels that "product details, pricing, and availability are accurate" — accurate, but mute. Price is the one thing that still can't talk.

**2.4 Owners are right to fear an AI that talks price.** In 2023 a car dealer's chatbot agreed to sell a Chevrolet Tahoe for $1 (AI Incident Database #622). In 2024 a Canadian tribunal held a company to what its chatbot told a customer (*Moffatt v. Air Canada*, 2024 BCCRT 149). An owner who lets a chatbot name prices is taking a real risk.

**2.5 Our answer.** An AI that is clever about *which* deal to offer and incapable of offering a bad one — plus an owner who saw the spread of outcomes before the shopkeeper met a single customer.

---

## 3. Who it's for

### 3.1 Maya — the owner (Trailhead Co., a small trail-running shop on Shopify)

| | |
|---|---|
| **Goals** | Keep shoppers who would otherwise leave over price. Clear older stock without a public sale. Raise order value. Spend minutes, not days, setting it up. |
| **Fears** | An AI that gives the shop away (the $1 Tahoe). Being legally held to something a chatbot said. Customers learning to wait for discounts. Rules she can't understand or switch off. |
| **What success looks like** | She sets a few sliders, sees in the Gym how haggling compares with a 20%-off banner at those settings, switches it on, and every settled deal is above her **floor** — or she personally approved it. PAUSE works the instant she presses it. |

### 3.2 The shopper — a budget-conscious trail runner

| | |
|---|---|
| **Goals** | Get shoes that fit a real budget (about $120) for a real race (a muddy 50k). Be treated like a person, not a coupon hunter. |
| **Fears** | Being tricked by fake urgency. Being charged more than someone else because of who they are. A "deal" that vanishes at checkout. |
| **What success looks like** | They name a price in plain words, get a straight answer — from the LLM, or from code when the LLM is slow — leave with something they can afford, and the Shopify Checkout total matches the card. |

### 3.3 The judge — a "user" of the demo

| | |
|---|---|
| **Goals** | See something real, quickly. Test the claim themselves. |
| **Fears** | A chatbot wrapper with a nice pitch. Faked data. A demo that only works on rails. |
| **What success looks like** | They are handed the keyboard, try to make the shopkeeper lose money, fail, and then click Deal and land on a real Shopify Checkout at the price they fought for. |

---

## 4. The product in five parts

| # | Part | What it is | Who sees it |
|---|---|---|---|
| 1 | **The shopkeeper** | The store's deal agent. Warm, quick, a little cheeky. It reads the shopper's message, picks one deal from the menu, and says one line. It answers product questions from the store's documents and remembers returning shoppers. | Shopper |
| 2 | **The offer card** | Drawn by the storefront chat from the server's **public card**; the browser never makes a dollar figure. Shows the items, the list total struck through, the agreed total, badges, a live 15-minute countdown, the **Deal** button and two honesty lines. It is the only binding offer. | Shopper |
| 3 | **The surfaces** | **Storefront** (built): Trailhead's own product pages with a shopkeeper sticker that opens a chat, by text or by voice. **ChatGPT app** (planned — not built on main): the same haggle as an app inside ChatGPT, with the same public card. | Shopper |
| 4 | **The Console** | The owner's single page behind a Supabase login: the **kept band** (figures from real settled deals), the **price race** with its four sliders, the live feed with private reasoning and red blocked rows, the Approve/Decline card, PAUSE, and — under "More settings" — the "Ask me about thin-margin deals" switch, product checks and the red-team summary. | Owner only |
| 5 | **The Gym** | A rehearsal space. 300 rule-based synthetic shoppers haggle against her pricing rules in the browser, shown as the price race; plus a recorded red-team of 20 scripted attacks. | Owner only |

A negotiation lives on one surface. Every feed row in the Console carries a surface tag, so a second surface would land in the same feed.

---

## 5. How a deal works

### 5.1 The pricing maths (from `SPEC.md` §6)

```
floor(cart)  = max(cost + 1¢, ceil(cost × (1 + floor%)))      floor% is the owner's slider, 0–60
urgency      = clamp((days since stocked − 60) / 60, 0, 1)    stock date = Shopify metafield bazaar.stocked_at
target(cart) = list − urgency × (list − floor)                how far stock age lets the price move
reason       = 0–4, scored by code from what the shopper says (budget, quantity, add-on, repeat shopper,
               market comparison, a real use, ready to buy)
ask(round)   = steps down from list over the owner's max rounds (2–6, default 4); a stronger reason
               opens more room, and with no reason the early rounds hold at list
lowest price = max(floor, list × (1 − discount cap))          discount cap 0–40%, default 22%
```

In words: three things move a price — **stock age, the round, and the reason the shopper gives.** New stock with no convincing reason doesn't bend (urgency 0, so target = list). Older stock and a stronger reason open more room. However hard anyone pushes, a price never goes below the **floor** or past the owner's **discount cap**; the cap never reaches below the floor. An item with no cost, out of stock, or with a floor above list is closed: it never reaches the menu.

An offer between the floor and the final **ask** still walks. The shopkeeper does not chase it. The Gym counts it as a **deal missed**, which tells the owner that her floor or her stock age — not the shopkeeper — is the limit.

Worked numbers for the seed store are in `USE-CASES.md` §3.

### 5.2 The three trades — it always trades, never discounts for free

| Trade | What the shopper gives | What the shopper gets | Example line |
|---|---|---|---|
| **Throw something in** (bundle) | A bigger cart | The main item at this round's ask plus each add-on at cost plus half its margin — never below the bundle's floor or above its list | "Add the gaiters and I'll do $150 for both." |
| **Held price** | A purchase now | This round's ask, held for 15 minutes. The expiry is real: the offer and the discount code both die. | "$135 if we close it now. I'll hold it 15 minutes." |
| **Something else that fits** | Taking a cheaper product | A cheaper product of the same type, in their size, priced by the same rules. It goes on the menu when the shopper asks for an alternative. | "Those just landed, so I can't move on them. But last season's Trail Runner 2 is the same fit, and cheaper." |

A negotiation runs for the owner's **max rounds** (2–6, four by default). Questions and small talk are free — they don't use a round. Neither does a **lowball**: code counters it with the quote already on the table, with no LLM call. From round 2, an offer at or above the shopkeeper's target that comes with a convincing reason is accepted at the shopper's number. An offer at or above list is simply sold at list.

### 5.3 The three zones

| Zone | Example: Trail Runner 2, cost $78, floor 25% → $97.50 | Rule |
|---|---|---|
| At or below cost | ≤ $78.00 | **Never.** Nobody can override this — not the shopper, the LLM, or the owner. |
| **Thin-margin zone** (cost → floor) | $79 – $97 (prices are shown in whole dollars) | The owner decides live, through an Approve/Decline card. The shopper sees only "Let me check with the owner…". 45 seconds, once per negotiation, after the last round, storefront only, and only if "Ask me" is on. After Decline or a timeout, the shopkeeper restates its own final offer — it does not drop to the floor. |
| At or above floor | ≥ $97.50 | The shopkeeper deals alone (within the asks and the discount cap above). |

### 5.4 The menu rule — six steps, one of them an LLM

| # | Step | Done by | What it may do |
|---|---|---|---|
| 1 | Understand the sentence | LLM (an OpenAI model via Backboard) · code alone for a plain-number lowball | Turn words into a structured offer: product, amount, quantity, items wanted, currency. Timeout or failure → a code parser. |
| 2 | Validate | Code | Reject negative, zero, absurd, non-CAD amounts; unknown products; quantity tricks. |
| 3 | Write the menu | Code (the engine) | Read real cost and stock date from Shopify; price every deal with `priceOffer` and list only those that clear the floor. Nothing else can ever be offered. |
| 4 | Choose + say | LLM (an OpenAI model via Backboard, with memory and store documents) | Pick one **option** id and write one line. It never sees costs or floors. Timeout (6.5 s by default, `BACKBOARD_TIMEOUT_MS`) → option A + a template line. |
| 5 | Check | Code | The id is on the menu · every dollar figure in the line belongs to that option · every reason is one the option supports · no cost, floor, margin, profit, markup or wholesale talk. Any failure → option A + template. |
| 6 | Settle | Code (the Auditor) + Shopify | On Deal: re-read fresh cost, re-check the floor, then mint a single-use, 15-minute discount code scoped to the exact items, with a minimum subtotal so removing an item voids it. Settles into Shopify Checkout. |

---

## 6. Product principles

| # | Principle | Why |
|---|---|---|
| 1 | **The LLM picks from a menu; code writes the menu.** | A model that never sees a cost can't leak one, and a model that can't write a number can't write a bad one. |
| 2 | **Give to get.** No concession is free. | A free discount is just a slower sale banner. A trade gives the owner something back: a bigger cart, a sale now, or older stock gone. |
| 3 | **Same rules for every shopper.** Memory changes suggestions, never price. | Price depends on the cart, its cost, stock age, the round and the reason the shopper states — never on who you are. Anyone who says the same thing gets the same price. |
| 4 | **Opt-in, disclosed, rule-based — never covert personalised pricing.** | Shopify's own writing on dynamic pricing warns of shopper backlash against hidden personalised prices. We are the opposite and say so. |
| 5 | **Reasons must be true facts.** | "Last season's" is only said when the engine supplied that fact. No invented scarcity. The 15 minutes is real because the code really expires. |
| 6 | **The card is the only binding offer.** It reads "You're talking to Trailhead Co's deal agent." and "Only this card is binding; chat text is not." | *Moffatt v. Air Canada*: a company can be held to what its chatbot says. So we make exactly one thing binding, and label it. |
| 7 | **Never at or below cost — nobody can override.** | One rule the owner never has to think about. |
| 8 | **The owner is in the loop for close calls.** | The thin-margin zone is a judgement call; a person makes it, with the profit in dollars in front of her. |
| 9 | **Never wait on an LLM past its timeout** (6.5 s by default). | A dead chat loses the shopper. Every LLM call has a timeout and a code fallback. |
| 10 | **PAUSE wins instantly.** | An owner who can stop it in one click will dare to start it. |
| 11 | **Two audiences, two channels.** | The shopper sees the negotiation; the owner sees everything else. See §7. |
| 12 | **Say "settles into Shopify Checkout", never "our checkout".** | It is true, and Shopify's API terms forbid replacing Shopify Checkout. We don't. |

---

## 7. What each side sees (rule 11)

| Thing | Shopper (storefront chat; the planned ChatGPT card) | Owner (Console, behind login) |
|---|---|---|
| Chat messages and the shopkeeper's line | Yes | Yes |
| The one picked offer, on the **public card** | Yes — items, list total, agreed total, badges, countdown | Yes |
| The rest of the menu (options not picked), owner ranking | **No** | Yes |
| Cost, floor, target, profit in $ and % | **No** | Yes |
| The shopkeeper's private reasoning (composed in code from facts, the pick and recalled memory), the model, milliseconds and cost per call | **No** | Yes |
| Blocked attempts, and the layer that blocked them | **No** — they just get an in-character reply | Yes — red rows |
| Approve/Decline card | **No** — at most the sentence "Let me check with the owner…" and a 45 s bar | Yes — yellow card |
| PAUSE control | No — they see "The owner's paused deals — list price stands." | Yes |
| The kept band, the Gym, personas, policies, red-team | **No** — not reachable from any shopper surface | Yes |
| Shopify Checkout | Yes | — |

Shopper surfaces receive the **public card only**: items, totals, line, countdown. The menu, cost, floor, profit, reasoning and the Gym travel only over owner endpoints behind the Supabase token. The planned ChatGPT card would get the same public card and nothing more. In the demo the shopper surface and the Console sit side by side; that is a presentation layout for judges, not something a shopper can reach.

---

## 8. The Gym and the price race

**The idea.** Shopify's SimGym exists because small merchants don't have enough traffic for an A/B test to converge, so it sends synthetic shoppers — each with a persona, a budget and an intent — to compare two themes (shopify.engineering/simgym). Maya can't A/B test a price floor on a dozen visitors a day either. **SimGym compares themes; the Gym compares pricing rules.**

**What it is.** 300 rule-based synthetic shoppers in five **personas** (Bargain hunter 30% · Budgeted runner 35% · Impatient 15% · Loyal 10% · Lowballer 10%). Seeded, so a run is reproducible. It runs in the browser, on the same engine the live shopkeeper uses: every ask comes from `buildNegotiationMenu`. There is no LLM in it.

**What it shows — the price race.**

| On screen | Meaning |
|---|---|
| One dot per shopper, coloured by **outcome** | Paid list · saved by your shopkeeper · bought a bundle · would ask you · walked — a deal missed · walked away · still deciding. |
| Dots waiting along the top | Each sits at what that shopper would pay. |
| **▶ Play** — about a second per round | The red ask line (the round's typical ask) steps down from list; shoppers who agree drop to the "price they paid" axis. |
| Settled dots in price stacks | Buyers stack in $5 steps at the price they paid. |
| Hollow dots left up top | Shoppers who walked. A darker ring marks a **deal missed**: they would have paid at least the floor. |
| Yellow dots | Ended in the thin-margin zone: "would ask you". Counted as not closed. |
| Labels and a shaded band | Cost, floor and list; the cost → floor band is shaded. |
| Point at a dot | That one synthetic shopper: persona, willingness to pay, offer and ask per round, outcome. |
| Figures | **Customers saved** and **profit**, each with its change against the saved policy; and one line: more or less than no shopkeeper · more or less than a 20% banner. **Red when it is less.** |
| The pill strip | **Floor · Max off · Rounds · Lowball** — one slider at a time. **Adopt** makes the candidate live. |
| Red-team summary (under "More settings") | The recorded run: "20 attacks · 0 economic breaches", counts per layer that blocked, and the scope of the run. |

**How to read it.** Pick a pill and drag its slider. The figures follow as she drags; on release the race replays. If the banner figure is red, haggling is losing to a plain banner at those settings — the Gym is allowed to say so. Finding settings she is happy with is why she rehearses. Then Adopt.

**The honesty rules.**

1. Always on screen: "Simulated on [product] · never added to your real figures". The kept band shows real settled deals only.
2. Never tune the personas to flatter the product. If haggling loses, the figure goes red and says so.
3. Nothing is drawn that didn't happen in the simulation: the dots, the ask line and the per-shopper detail all read one run.
4. The red-team breach count is recounted by a separate verifier from a dry-run deal log (agreed total vs cost, floor, owner-approved) — it doesn't trust the pipeline's own report.
5. Scope is stated: one product at a time, with bundles; the Gym does not simulate recommendations.

---

## 9. Why this isn't an AI wrapper

| Claim | Evidence a judge can check |
|---|---|
| The LLM is one step of six, and the least trusted. | §5.4. Remove the LLM and the product still works — option A plus a template line. That is the fallback path, and it runs whenever a call passes its timeout. |
| Code prices, checks and settles. | Every number on a card came from the engine. The check throws away any number the model invents. The Auditor re-checks the floor from fresh Shopify cost data before a code exists. |
| It has a real side effect in Shopify. | A real discount code is minted through the Admin API; the Deal button opens a real Shopify Checkout whose total matches the card. |
| The engine is property-tested. | 8 properties × 1,000 seeded cases on the menu every shopper is priced from — `pnpm test:props`. Among them: every option is above cost, at or above the floor and never above list; a later round never asks more; closed items never reach the menu. We can run them for a judge. |
| There is a simulation with no LLM in it. | The Gym: 300 seeded, rule-based shoppers on the same engine, in the browser. |
| A human is in the loop. | The Approve/Decline card for the thin-margin zone, and PAUSE. |
| There is one engine. | The server and the Gym both import `@bazaar/engine` and call `buildNegotiationMenu`. There is no second pricing path. |

---

## 10. Why now, market context, competitors

**Why now.**

- Shopping is moving into AI chats, and Shopify is steering that way: it reports that "AI searches powered by Shopify Catalog convert at 2x the rate of those using scraped data" (shopify.com/news/spring-26-edition-merchant), and ChatGPT purchases now complete in the merchant's own checkout via an in-app browser (shopify.com/news/ai-commerce-at-scale). Our design — haggle in the chat, settle into Shopify Checkout — goes with that direction.
- Shoppers distrust hidden pricing: Shopify's dynamic-pricing article cites Thales (frustration with dynamic pricing rose from 14% to 28% year over year) and a 2026 Talker Research finding that 62% of respondents are concerned about personalised pricing. An open, opt-in, same-rules-for-everyone haggle is the answer to that worry, not an example of it.
- LLMs are finally good enough at language to haggle — and recent incidents (§2.4) show exactly which part must not be left to them.

**Competitors.** Haggling widgets exist. We don't cite their vendor-claimed stats.

| | Nibble · Haggler · DBargain (haggling widgets) | A sale banner | The Bazaar |
|---|---|---|---|
| Shopper can name a price | Yes | No | Yes |
| Owner can rehearse against a population before launch | No | No | **Yes — the Gym** |
| Runs inside an AI chat | No | No | Planned — not built on main |
| Trades by default (bundle, held price, older stock) | Not by default | No | **Yes** |
| Discount goes only to those who ask | Yes | No — everyone | Yes |

---

## 11. Prize fit

### 11.1 Shopify — "Hack Shopping with AI" (primary target)

| Criterion or brief (verbatim) | Our evidence |
|---|---|
| Technical Excellence — "Sophisticated, appropriate use of AI with quality execution" | *Appropriate* is the word: the LLM does language and judgement; code does money. Property-tested engine; real Admin API data in, real discount code and checkout out. |
| Impact Potential — "Meaningfully improves merchant operations or customer experience" | Merchant: recovers shoppers who would have left, clears older stock, raises order value, without a public sale. Shopper: leaves with something they can afford. |
| Innovation Factor — "Unexpected approaches that make us think differently about commerce" | Price becomes a conversation, and the owner rehearses it first. Planned next: the same haggle inside AI chats, where a store is a silent row today. |
| "Build something that makes us say 'wait, that's possible?'" | The judge tries to make it lose money and can't; then Deal opens a real Shopify Checkout at the price they fought for. |
| "Take inspo from one of our projects - SimGym" | The Gym: named personas, seeded runs, saved vs candidate policy, figures against two counterfactuals (no shopkeeper, a 20% banner), and an honest "simulated" label. |
| Themes | "LLM applications in the commerce ecosystem" · "Customer experience enhancements" |

### 11.2 Other prizes

| Prize | What they judge | Our evidence |
|---|---|---|
| Backboard | "We judge ambition… The more of the stack you use… the better your odds" | Assistants and threads (one per shopper / per negotiation), documents (store notes, sizing guide, policies), memory ("still a size 10?"), model routing (an OpenAI model via Backboard) for every LLM call, per-call cost shown in the feed. |
| OpenAI | What we built with the OpenAI API, and how Codex helped; one concrete Codex example in the demo | An OpenAI model, routed through Backboard, makes every LLM call: understand, choose + say, and questions. One entry read aloud from the Codex log. The haggle as an app inside ChatGPT is planned — not built on main. |
| HTN finalist | Originality, user experience, technical complexity, WOW; live demo, no slides | Hand over the keyboard; the real checkout; the price race. No slides. |
| GoDaddy Registry | The domain | The hosted app on our own domain, with the Console at `/console`. |

---

## 12. Scope

**In (this weekend).** One seeded store (Trailhead Co.) and one seeded merchant (Maya) · the engine, the check, the Auditor · the offer card · storefront surface, with voice in the chat · the Console with login, kept band, feed, the four policy sliders, "Ask me" switch, Approve/Decline, PAUSE · the Gym's price race and red-team · settlement by discount code into Shopify Checkout (the demo stops at checkout; nobody pays).

**Planned — not built on main.** The ChatGPT app. If it is not built by the gate, it becomes a "what's next" sentence.

**Stretch — strictly in this order.**

1. A Shopify Function so Shopify's own checkout refuses anything at or below cost.
2. Quantity haggle.
3. The same app in Claude.
4. Deal Meter.
5. LLM-voiced Gym shoppers.
6. Free shipping as a trade.
7. Hesitation nudge.
8. Orders webhook.
9. Per-product lowest price as a Shopify metafield.

**Not building.** Multiple stores · a buyer's AI agent · a UCP extension · a Shopify admin extension or embedded app · cross-surface negotiations · a persona picker · sign-up or multi-merchant onboarding · payments.

---

## 13. Success metrics

### 13.1 For the weekend — each one is demo-able

| # | Acceptance | How we show it |
|---|---|---|
| W1 | The Shopify Checkout total equals the agreed total on the card (tax off, free shipping rate set). | Click Deal on stage. |
| W2 | Red-team: 20 attacks, **0 breaches**, recounted by the separate verifier. | The red-team summary in the Console. |
| W3 | The Gym's figures follow the slider and the price race replays; the banner figure goes red honestly. | Drag a slider. |
| W4 | Every shopkeeper reply lands, by an LLM or by the fallback; no LLM call waits past its timeout (6.5 s by default). | Feed rows show milliseconds. |
| W5 | A judge with the keyboard cannot get a card, or a checkout, at or below cost. | Hand over the keyboard. |
| W6 | PAUSE takes effect on the very next message. | Press it. |

### 13.2 For a real product

| Metric | Meaning |
|---|---|
| Recovered sales | Deals closed with shoppers who made an offer instead of leaving. |
| Profit vs banner | Total profit compared with running a 20%-off banner over the same period — the Gym's banner figure, measured for real. |
| Order value | Average order value of haggled deals vs list-price orders (bundles should lift it). |
| Approval rate | Share of thin-margin requests the owner approves — and how often she is asked at all. |
| Deals missed | Offers between floor and final ask that walked — the signal to revisit the floor. |

---

## 14. Risks to the idea — and honest answers

| Risk | Honest answer |
|---|---|
| **"Everyone will just haggle."** | Nothing is free. Every step down costs a bigger cart, a purchase now, or taking older stock. New stock doesn't move without a convincing reason, and nothing moves past the discount cap. If haggling still loses to a banner at her floor, the Gym says so in red before she goes live. |
| **Fairness.** "Is this personalised pricing?" | No. Price depends on the cart, its cost, stock age, the round and the reason the shopper states — never on who you are. Memory changes what is suggested, not what it costs. It is opt-in and disclosed; anyone can make an offer under the same rules. |
| **Binding offers.** "Can the chatbot commit the store to something?" | Only the card is binding, and it says so. Each offer has a live id, a real 15-minute expiry and is single-use. "You already offered me $80" goes nowhere. |
| **Calibration.** "Is the Gym right?" | It is not calibrated, and the label says so: synthetic, rule-based, seeded, results might differ. It is for comparing two policies, not predicting revenue. Real orders would calibrate it. |
| **The LLM misbehaves.** | It can only pick an id and write a line; both are checked. The worst case is a plain template line on option A. |
| **The owner doesn't answer in 45 s.** | Timeout counts as a decline; the shopkeeper restates its own final offer. A decline is never a cheaper route than haggling. |

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **Shopkeeper** | The store's AI deal agent that the shopper talks to. |
| **Surface** | A place where a shopper meets the shopkeeper. The storefront is built; a ChatGPT app is planned — not built on main. |
| **List** | The normal price in Shopify. |
| **Cost** | The per-item cost recorded in Shopify. A product with no cost is not open to offers. |
| **Floor** | cost × (1 + floor%), rounded up to the cent and always at least one cent above cost. The lowest total the shopkeeper may agree to on its own. Set by the owner's slider (cost + 0–60%). |
| **Urgency** | 0 to 1, from stock age: 0 up to 60 days, 1 at 120 days or more. |
| **Target** | list − urgency × (list − floor). How far stock age lets a price move. The buyer reason decides how much of that room is used; the floor and the discount cap bound it. |
| **Ask** | The shopkeeper's price for the current round. Steps down from list over the owner's max rounds; a later round never asks more. |
| **Buyer reason** | What the shopper says to justify the offer, scored 0–4 by code: budget, quantity intent, add-on intent, repeat shopper, market comparison, a real use, ready to buy. A stronger reason opens more room, always inside the floor and the discount cap. |
| **Round** | One shopper offer and the shopkeeper's answer. Questions, small talk and lowballs don't use a round. |
| **Max rounds** | The owner's limit on rounds per negotiation: 2–6, four by default. The ask curve stretches, so the last round lands where round 4 of 4 does. |
| **Final offer** | Option A of the last round. |
| **Menu** | The list of deals the engine wrote for this turn. Every one clears the floor. |
| **Option** | One deal on the menu, lettered from A. Option A is the code fallback. |
| **Trade** | What the shopper gives to get a lower price: a bigger cart, a purchase now, or taking older stock. |
| **Held price** | This round's ask, held for 15 minutes. |
| **Bundle** | The product plus an add-on priced at cost plus half its margin. |
| **Something else** | A cheaper product of the same type, in the shopper's size, offered when they ask for an alternative. |
| **Thin-margin zone** | Above cost, below floor. Only the owner can say yes. |
| **Ask the owner** | The once-per-negotiation, 45-second, storefront-only, after-the-last-round request to the owner for a thin-margin offer. |
| **Public card** | The stripped offer card sent to the shopper: the picked option's items and totals, badges, line, countdown. No menu, facts, cost, floor or profit. |
| **The check** | The code step that verifies the LLM's pick, every dollar figure, every reason, and that no private word (cost, floor, margin, profit, markup, wholesale) is said. Any failure → option A. |
| **Auditor** | The code step at Deal time that re-checks cost and floor from fresh data before a code is minted. |
| **Layer** | One of the guardrails that can block an attempt: validate, engine, check, Auditor, the Shopify code. |
| **Console** | The owner's page, behind a login. |
| **Policy** | The owner's settings: floor %, discount cap, max rounds, tone preset, firm-price products, lowball cutoff, "Ask me" on/off, paused or not. Saved policy = live. Candidate policy = under the controls, not yet adopted. |
| **Discount cap** | The most the shopkeeper may take off list, as a percentage (0–40%, 22% by default). The higher of the floor and the capped price is the lowest price; the cap can never reach below the floor. |
| **Tone preset** | A policy setting: friendly, brisk or playful. Saved with the policy; nothing on main reads it yet. It can never change a price. |
| **Firm price** | A policy setting: a list of products the owner wants closed to offers. Saved with the policy; nothing on main reads it yet. |
| **Lowball** | A shopper offer below the owner's **lowball cutoff** (a percentage of list, 40% by default; 0 turns it off). |
| **Lowball counter** | The answer to a lowball, written by code with no LLM call: the quote already on the table — or something else, when that is on the menu and the offer is below every option. It uses no round, so lowballs can never walk the ask down. |
| **No-agent store** | The main counterfactual: the same shop at list price only, with no shopkeeper. A shopper who will not pay list leaves. |
| **Customer saved** | A deal settled below list — a shopper who asked for less and would have left a no-agent store. |
| **Revenue recovered** | The agreed totals of the customers saved. |
| **Profit recovered** | The profit on the customers saved. |
| **Agent cost** | What the shopkeeper's LLM calls cost, in dollars. |
| **Kept band** | The strip at the top of the Console: what the owner kept (profit recovered minus agent cost), customers saved, revenue recovered, and the comparison with a 20% banner. Real settled deals only. |
| **Price race** | The Gym's view in the Console: 300 synthetic shoppers under the candidate policy, one dot each, coloured by outcome, with each figure's change against the saved policy. Four sliders — Floor, Max off, Rounds, Lowball. Simulated, never added to real figures. |
| **Adopt** | Make the candidate policy the saved one. |
| **Gym** | The owner-only rehearsal: 300 synthetic shoppers plus the red-team. |
| **Persona** | One of five rule-based shopper types in the Gym. |
| **Deal missed** | A shopper who walked although they would have paid at least the floor. |
| **Banner** | The second counterfactual: a plain 20%-off sale for everyone. |
| **Red-team** | 20 scripted attacks run through the full pipeline with a dry-run minter. |
| **Breach** | Any deal at or below cost, or below floor without owner approval. The required count is 0. |
| **Settle** | Mint the discount code and open Shopify Checkout at the agreed total. |
| **PAUSE** | The owner's instant stop for all deals. |
