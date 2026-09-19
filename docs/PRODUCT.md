# The Bazaar — Product

**Hack the North 2026 · 19–20 Sept · team of 3.** This file is the "what and why". It is written so a second-year student can follow it and an engineer can test against it.

Companion files, all in this `docs/` folder: [`SPEC.md`](SPEC.md) (the build spec — the source of truth for how) · [`ARCHITECTURE.md`](ARCHITECTURE.md) (diagrams, state machines, API shapes) · [`USE-CASES.md`](USE-CASES.md) (every flow, with acceptance criteria) · [`PLAN.md`](PLAN.md) (who builds what, when) · [`DEMO.md`](DEMO.md) (the demo script).

Words in **bold** the first time they matter are defined in the glossary (§15). Both this file and `USE-CASES.md` use those words in exactly that sense.

---

## 1. Summary

**The Bazaar is a Make-an-offer shopkeeper for a Shopify store.** A shopper names a price — on the store's own product page, or inside ChatGPT through our app — and the store's AI shopkeeper haggles back. It knows the shop (store notes, a sizing guide and policies, held as Backboard documents) and it knows the shopper (Backboard memory), so it looks for a deal that fits that person. It never gives a discount for free: every step down is a **trade**. When both sides agree, the deal settles into a real Shopify Checkout at the agreed total. It cannot lose the owner money, because the AI only ever picks from a **menu** of deals that plain code has already priced from the store's real costs. And before the owner switches it on, she rehearses her pricing rules in **the Gym**: 300 synthetic shoppers and 20 scripted attacks.

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
| **What success looks like** | She sets one slider, sees in the Gym that haggling beats a 20%-off banner at that setting, switches it on, and every settled deal is above her **floor** — or she personally approved it. PAUSE works the instant she presses it. |

### 3.2 The shopper — a budget-conscious trail runner

| | |
|---|---|
| **Goals** | Get shoes that fit a real budget (about $120) for a real race (a muddy 50k). Be treated like a person, not a coupon hunter. |
| **Fears** | Being tricked by fake urgency. Being charged more than someone else because of who they are. A "deal" that vanishes at checkout. |
| **What success looks like** | They name a price in plain words, get a straight answer within 4 seconds, leave with something they can afford, and the Shopify Checkout total matches the card. |

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
| 2 | **The offer card** | One React component, mounted in two places. Shows the items, the list total struck through, the agreed total, the trade badge, a live 15-minute countdown, the **Deal** button and two honesty lines. It is the only binding offer. | Shopper |
| 3 | **Two surfaces** | **Storefront** (lead): Trailhead's own product pages with a shopkeeper sticker that opens a chat. **ChatGPT app** (second surface, the demo finale): three tools — `find_products`, `make_offer`, `accept_offer` — with the same card rendered inline. | Shopper |
| 4 | **The Console** | The owner's single page behind a Supabase login: live feed with private reasoning, red blocked rows, one floor slider, the "Ask me about thin-margin deals" switch, the Approve/Decline card, PAUSE, and the Gym. | Owner only |
| 5 | **The Gym** | A rehearsal space. 300 rule-based synthetic shoppers haggle against her pricing rules in the browser, shown as an agent swarm; plus a red-team of 20 scripted attacks. | Owner only |

A negotiation lives on one surface. It is not carried between the storefront and ChatGPT. The Console shows both surfaces in one feed.

---

## 5. How a deal works

### 5.1 The pricing maths (from `SPEC.md` §6)

```
floor(cart)  = cost(cart) × (1 + floor%)                      floor% is the owner's slider
urgency      = clamp((days since stocked − 60) / 60, 0, 1)    stock date = Shopify metafield bazaar.stocked_at
target(cart) = list − urgency × (list − floor)                where a haggle on this cart may END
ask(round)   = steps down from list to target over 4 rounds, with shrinking steps; ask(4) = target
```

In words: **new stock doesn't bend** (urgency 0, so target = list). **Very old stock can reach the floor** (urgency 1, so target = floor). Stock age alone decides how far the price may move. There is no fixed "maximum bend" percentage.

An offer between the floor and the final **ask** still walks. The shopkeeper does not chase it. The Gym counts it as a **deal missed**, which tells the owner that her floor or her stock age — not the shopkeeper — is the limit.

Worked numbers for the seed store are in `USE-CASES.md` §3.

### 5.2 The three trades — it always trades, never discounts for free

| Trade | What the shopper gives | What the shopper gets | Example line |
|---|---|---|---|
| **Throw something in** (bundle) | A bigger cart | The add-on at cost plus half its margin — and next round's shoe price now, if the bundle's profit in dollars stays at least as high as the plain offer's | "Add the gaiters and I'll do $149.97 for both." |
| **Held price** | A purchase now | This round's ask, held for 15 minutes. The expiry is real: the offer and the discount code both die. | "$134.53 if we close it now. I'll hold it 15 minutes." |
| **Something else that fits** | Taking older stock | A recommended product of the same type, in their size, oldest stock first. It is priced to meet the shopper's stated budget when that budget lies between the item's target and its current ask; never below target. | "Those just landed, so I can't move on them. But last season's Trail Runner 2 is the same fit — $120." |

Up to four offers per negotiation (four **rounds**). Questions and small talk are free — they don't use a round. If the shopper offers at or above the current ask, the shopkeeper simply accepts at the shopper's number; it never counters below their own offer.

### 5.3 The three zones

| Zone | Example: Trail Runner 2, cost $78, floor 25% → $97.50 | Rule |
|---|---|---|
| At or below cost | ≤ $78.00 | **Never.** Nobody can override this — not the shopper, the LLM, or the owner. |
| **Thin-margin zone** (cost → floor) | $78.01 – $97.49 | The owner decides live, through an Approve/Decline card. The shopper sees only "Let me check with the owner…". 45 seconds, once per negotiation, storefront only, and only if "Ask me" is on. After Decline or a timeout, the shopkeeper restates its own final offer — it does not drop to the floor. |
| At or above floor | ≥ $97.50 | The shopkeeper deals alone (within the asks above). |

### 5.4 The menu rule — six steps, one of them an LLM

| # | Step | Done by | What it may do |
|---|---|---|---|
| 1 | Understand the sentence | OpenAI API (storefront) · ChatGPT itself (ChatGPT app) | Turn words into `{kind, amount, budget, quantity, size, wants}`. 2.5 s timeout → a regex. |
| 2 | Validate | Code | Reject negative, zero, absurd, non-CAD amounts; unknown products; quantity tricks. |
| 3 | Write the menu | Code (the engine) | Read real cost and stock date from Shopify; list every deal that clears the floor. Nothing else can ever be offered. |
| 4 | Choose + say | LLM (an OpenAI model via Backboard, with memory and store documents) | Pick one **option** id and write one line. It never sees costs or floors. 4 s timeout → option A + a template line. |
| 5 | Check | Code | The id is on the menu · every dollar figure in the line belongs to that option · every reason is a true fact the engine supplied · no cost/floor/margin talk. Any failure → option A + template. |
| 6 | Settle | Code (the Auditor) + Shopify | On Deal: re-read fresh cost, re-check the floor, then mint a single-use, 15-minute discount code scoped to the exact items, with a minimum subtotal so removing an item voids it. Settles into Shopify Checkout. |

---

## 6. Product principles

| # | Principle | Why |
|---|---|---|
| 1 | **The LLM picks from a menu; code writes the menu.** | A model that never sees a cost can't leak one, and a model that can't write a number can't write a bad one. |
| 2 | **Give to get.** No concession is free. | A free discount is just a slower sale banner. A trade gives the owner something back: a bigger cart, a sale now, or older stock gone. |
| 3 | **Same rules for every shopper.** Memory changes suggestions, never price. | Price depends on the cart, its cost, stock age and the round — never on who you are. That is what makes it fair. |
| 4 | **Opt-in, disclosed, rule-based — never covert personalised pricing.** | Shopify's own writing on dynamic pricing warns of shopper backlash against hidden personalised prices. We are the opposite and say so. |
| 5 | **Reasons must be true facts.** | "Last season's" is only said when the engine supplied that fact. No invented scarcity. The 15 minutes is real because the code really expires. |
| 6 | **The card is the only binding offer.** It reads "You're talking to Trailhead Co's deal agent", "Only the offer on this card is binding", and "before tax & shipping". | *Moffatt v. Air Canada*: a company can be held to what its chatbot says. So we make exactly one thing binding, and label it. |
| 7 | **Never at or below cost — nobody can override.** | One rule the owner never has to think about. |
| 8 | **The owner is in the loop for close calls.** | The thin-margin zone is a judgement call; a person makes it, with the profit in dollars in front of her. |
| 9 | **Never wait on an LLM longer than 4 s.** | A dead chat loses the shopper. Every LLM call has a timeout and a code fallback. |
| 10 | **PAUSE wins instantly, on every surface.** | An owner who can stop it in one click will dare to start it. |
| 11 | **Two audiences, two channels.** | The shopper sees the negotiation; the owner sees everything else. See §7. |
| 12 | **Say "settles into Shopify Checkout", never "our checkout".** | It is true, and Shopify's API terms forbid replacing Shopify Checkout. We don't. |

---

## 7. What each side sees (rule 11)

| Thing | Shopper (storefront chat, ChatGPT card) | Owner (Console, behind login) |
|---|---|---|
| Chat messages and the shopkeeper's line | Yes | Yes |
| The one picked offer, on the **public card** | Yes — items, list total, agreed total, badges, countdown | Yes |
| The rest of the menu (options not picked), owner ranking | **No** | Yes |
| Cost, floor, target, profit in $ and % | **No** | Yes |
| The shopkeeper's private reasoning (composed in code from facts, the pick and recalled memory) | **No** | Yes |
| Blocked attempts, and the layer that blocked them | **No** — they just get an in-character reply | Yes — red rows |
| Approve/Decline card | **No** — at most the sentence "Let me check with the owner…" and a 45 s bar | Yes — yellow card |
| PAUSE control | No — they see "The owner's paused deals — list price stands." | Yes |
| The Gym, personas, policies, red-team | **No** — not reachable from any shopper surface | Yes |
| Shopify Checkout | Yes | — |

The server sends the shopper's browser and the ChatGPT card a stripped **public card only**. In the demo the shopper surface and the Console sit side by side; that is a presentation layout for judges, not something a shopper can reach.

---

## 8. The Gym and the swarm

**The idea.** Shopify's SimGym exists because small merchants don't have enough traffic for an A/B test to converge, so it sends synthetic shoppers — each with a persona, a budget and an intent — to compare two themes (shopify.engineering/simgym). Maya can't A/B test a price floor on a dozen visitors a day either. **SimGym compares themes; the Gym compares pricing rules.**

**What it is.** 300 rule-based synthetic shoppers in five **personas** (Bargain hunter 30% · Budgeted runner 35% · Impatient 15% · Loyal 10% · Lowballer 10%). Seeded, so a run is reproducible. It runs in the browser, on the same engine the live shopkeeper uses. There is no LLM in it.

**What it shows — the agent swarm.**

| On screen | Meaning |
|---|---|
| One dot per shopper, coloured by persona | The population. The legend doubles as a filter. |
| "Run the Gym" — about 3 seconds of animation over rounds 1→4 | Dots step toward what they would pay while the shopkeeper's ask line steps down. |
| Settled dots drop into price bins | The histogram of agreed prices *is* the settled swarm. |
| Dots fading into a "walked" pile | Shoppers who left. Labelled "deals missed" when they would have paid at least the floor. |
| Yellow dots | Ended in the thin-margin zone: "would have asked you". Counted as not closed. |
| Grey outline vs coloured dots | The saved policy vs the policy under the slider. **Adopt** makes the candidate live. |
| Reference lines and a shaded band | List, floor, the 20%-off-banner price; the cost → floor band is shaded. |
| Click a dot | That one synthetic shopper's transcript: persona, willingness to pay, offer and ask per round, which trade closed it, outcome. |
| Headline card | **Profit vs a 20%-off banner.** Teal when haggling wins at this floor, **red when it loses**. |
| Red-team wall | 20 red dots charge a wall drawn at the cost line and bounce off; per-layer block counts; "20 attacks · 0 breaches". |

**How to read it.** Drag the floor slider. While dragging, the dots re-settle instantly. If the headline is red, haggling is losing to a plain banner at that floor. Move the slider until it turns teal. Finding the floor where haggling wins is why she rehearses. Then Adopt.

**The honesty rules.**

1. Always on screen: "300 synthetic shoppers — rule-based, seeded, results might differ from actual buyer behaviour." (SimGym's own help page carries the same caveat about its results.)
2. Never tune the personas to flatter the product. If haggling loses, the card goes red and says so.
3. Nothing is drawn that didn't happen in the simulation: the chart, the animation and the transcripts all read one run.
4. The red-team breach count is recounted by a separate verifier from a dry-run deal log (agreed total vs cost, floor, owner-approved) — it doesn't trust the pipeline's own report.
5. Scope is stated: one product with bundles; the Gym does not simulate recommendations.

---

## 9. Why this isn't an AI wrapper

| Claim | Evidence a judge can check |
|---|---|
| The LLM is one step of six, and the least trusted. | §5.4. Remove the LLM and the product still works — option A plus a template line. That is the fallback path, and it runs whenever a call passes 4 s. |
| Code prices, checks and settles. | Every number on a card came from the engine. The check throws away any number the model invents. The Auditor re-checks the floor from fresh Shopify cost data before a code exists. |
| It has a real side effect in Shopify. | A real discount code is minted through the Admin API; the Deal button opens a real Shopify Checkout whose total matches the card. |
| The engine is property-tested. | fast-check properties (e.g. nothing is ever at or below cost; asks never rise; urgency 0 means the price never moves). We can run them for a judge. |
| There is a simulation with no LLM in it. | The Gym: 300 seeded, rule-based shoppers on the same engine, in the browser. |
| A human is in the loop. | The Approve/Decline card for the thin-margin zone, and PAUSE. |
| The core is surface-independent. | Both surfaces call the same three core functions (`findProducts`, `makeOffer`, `acceptOffer`) and mount the same card. |

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
| Runs inside an AI chat | No | No | **Yes — a ChatGPT app** |
| Trades by default (bundle, held price, older stock) | Not by default | No | **Yes** |
| Discount goes only to those who ask | Yes | No — everyone | Yes |

---

## 11. Prize fit

### 11.1 Shopify — "Hack Shopping with AI" (primary target)

| Criterion or brief (verbatim) | Our evidence |
|---|---|
| Technical Excellence — "Sophisticated, appropriate use of AI with quality execution" | *Appropriate* is the word: the LLM does language and judgement; code does money. Property-tested engine; real Admin API data in, real discount code and checkout out. |
| Impact Potential — "Meaningfully improves merchant operations or customer experience" | Merchant: recovers shoppers who would have left, clears older stock, raises order value, without a public sale. Shopper: leaves with something they can afford. |
| Innovation Factor — "Unexpected approaches that make us think differently about commerce" | Price becomes a conversation — including inside AI chats, where a store is a silent row today. And the owner rehearses it first. |
| "Build something that makes us say 'wait, that's possible?'" | The judge tries to make it lose money and can't; then Deal opens a real Shopify Checkout at the price they fought for. |
| "Take inspo from one of our projects - SimGym" | The Gym: named personas, seeded runs, saved vs candidate policy, one headline metric against a counterfactual, SimGym's own caveat on the card. |
| Themes | "LLM applications in the commerce ecosystem" · "Customer experience enhancements" |

### 11.2 Other prizes

| Prize | What they judge | Our evidence |
|---|---|---|
| Backboard | "We judge ambition… The more of the stack you use… the better your odds" | Assistants and threads (one per shopper / per negotiation), documents (store notes, sizing guide, policies), memory ("still a size 10?"), model routing (an OpenAI model via Backboard), streaming, per-call cost shown in the feed. |
| OpenAI | What we built with the OpenAI API, and how Codex helped; one concrete Codex example in the demo | OpenAI API directly for the storefront's understand step (Structured Outputs); the haggle as an app inside ChatGPT; one entry read aloud from the Codex log. |
| HTN finalist | Originality, user experience, technical complexity, WOW; live demo, no slides | Hand over the keyboard; the real checkout; the moving swarm. No slides. |
| GoDaddy Registry | The domain | The hosted app on our own domain: storefront at the root, Console at `/console`, ChatGPT connector at `/mcp`. |

---

## 12. Scope

**In (this weekend).** One seeded store (Trailhead Co.) and one seeded merchant (Maya) · the engine, the check, the Auditor · the offer card · storefront surface · ChatGPT app (if the render gate passes; otherwise a "what's next" sentence) · the Console with login, feed, floor slider, "Ask me" switch, Approve/Decline, PAUSE · the Gym swarm and red-team · settlement by discount code into Shopify Checkout (the demo stops at checkout; nobody pays) · offline demo replay.

**Stretch — strictly in this order.**

1. A Shopify Function so Shopify's own checkout refuses anything at or below cost.
2. Quantity haggle.
3. The same app in Claude.
4. Deal Meter.
5. LLM-voiced Gym shoppers.
6. Free shipping as a trade.
7. Hesitation nudge.
8. Voice.
9. Orders webhook.
10. Per-product lowest price as a Shopify metafield.

**Not building.** Multiple stores · a buyer's AI agent · a UCP extension · a Shopify admin extension or embedded app · cross-surface negotiations · a persona picker · sign-up or multi-merchant onboarding · payments.

---

## 13. Success metrics

### 13.1 For the weekend — each one is demo-able

| # | Acceptance | How we show it |
|---|---|---|
| W1 | The Shopify Checkout total equals the agreed total on the card (tax off, free shipping rate set). | Click Deal on stage. |
| W2 | Red-team: 20 attacks, **0 breaches**, recounted by the separate verifier. | The red-team wall and card. |
| W3 | The Gym redraws live as the slider moves; the headline turns red or teal honestly. | Drag the slider. |
| W4 | Every shopkeeper reply lands within 4 s, by an LLM or by the fallback. | Feed rows show milliseconds. |
| W5 | A judge with the keyboard cannot get a card, or a checkout, at or below cost. | Hand over the keyboard. |
| W6 | PAUSE takes effect on the very next message, on both surfaces. | Press it. |

### 13.2 For a real product

| Metric | Meaning |
|---|---|
| Recovered sales | Deals closed with shoppers who made an offer instead of leaving. |
| Profit vs banner | Total profit compared with running a 20%-off banner over the same period — the Gym's headline, measured for real. |
| Order value | Average order value of haggled deals vs list-price orders (bundles should lift it). |
| Approval rate | Share of thin-margin requests the owner approves — and how often she is asked at all. |
| Deals missed | Offers between floor and final ask that walked — the signal to revisit the floor. |

---

## 14. Risks to the idea — and honest answers

| Risk | Honest answer |
|---|---|
| **"Everyone will just haggle."** | Nothing is free. Every step down costs a bigger cart, a purchase now, or taking older stock. New stock doesn't move at all. If haggling still loses to a banner at her floor, the Gym says so in red before she goes live. |
| **Fairness.** "Is this personalised pricing?" | No. Price depends on the cart, its cost, stock age and the round — never on who you are. Memory changes what is suggested, not what it costs. It is opt-in and disclosed; anyone can make an offer under the same rules. |
| **Binding offers.** "Can the chatbot commit the store to something?" | Only the card is binding, and it says so. Each offer has a live id, a real 15-minute expiry and is single-use. "You already offered me $80" goes nowhere. |
| **Calibration.** "Is the Gym right?" | It is not calibrated, and the label says so: synthetic, rule-based, seeded, results might differ. It is for comparing two policies, not predicting revenue. Real orders would calibrate it. |
| **The LLM misbehaves.** | It can only pick an id and write a line; both are checked. The worst case is a plain template line on option A. |
| **The owner doesn't answer in 45 s.** | Timeout counts as a decline; the shopkeeper restates its own final offer. A decline is never a cheaper route than haggling. |

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **Shopkeeper** | The store's AI deal agent that the shopper talks to. |
| **Surface** | A place where a shopper meets the shopkeeper: the storefront, or the ChatGPT app. |
| **List** | The normal price in Shopify. |
| **Cost** | The per-item cost recorded in Shopify. A product with no cost is not open to offers. |
| **Floor** | cost × (1 + floor%). The lowest total the shopkeeper may agree to on its own. Set by the owner's slider (cost + 0–60%). |
| **Urgency** | 0 to 1, from stock age: 0 up to 60 days, 1 at 120 days or more. |
| **Target** | list − urgency × (list − floor). The lowest price a haggle on that cart may end at without the owner. |
| **Ask** | The shopkeeper's price for the current round. Steps down from list to target over four rounds, with shrinking steps. |
| **Round** | One shopper offer and the shopkeeper's answer. Up to four. Questions and small talk don't use a round. |
| **Final offer** | The round-4 option A, at ask(4) = target. |
| **Menu** | The list of deals the engine wrote for this turn. Every one clears the floor. |
| **Option** | One deal on the menu (A = held price, B… = bundles, C… = something else). |
| **Trade** | What the shopper gives to get a lower price: a bigger cart, a purchase now, or taking older stock. |
| **Held price** | This round's ask, held for 15 minutes. |
| **Bundle** | The product plus an add-on priced at cost plus half its margin. |
| **Something else** | A recommended product of the same type that fits the shopper's budget. |
| **Thin-margin zone** | Above cost, below floor. Only the owner can say yes. |
| **Ask the owner** | The once-per-negotiation, 45-second, storefront-only request to the owner for a thin-margin offer. |
| **Public card** | The stripped offer card sent to the shopper: the picked option's items and totals, badges, line, countdown. No menu, facts, cost, floor or profit. |
| **The check** | The code step that verifies the LLM's pick, every dollar figure, and every reason. |
| **Auditor** | The code step at Deal time that re-checks cost and floor from fresh data before a code is minted. |
| **Layer** | One of the guardrails that can block an attempt: validate, engine, check, offer ids, Auditor, the Shopify code. |
| **Console** | The owner's page, behind a login. |
| **Policy** | The owner's settings: floor %, "Ask me" on/off, paused or not. Saved policy = live. Candidate policy = under the slider. |
| **Adopt** | Make the candidate policy the saved one. |
| **Gym** | The owner-only rehearsal: 300 synthetic shoppers plus the red-team. |
| **Swarm** | The Gym's view: every synthetic shopper drawn as a dot. |
| **Persona** | One of five rule-based shopper types in the Gym. |
| **Deal missed** | A shopper who walked although they would have paid at least the floor. |
| **Banner** | The counterfactual: a plain 20%-off sale for everyone. |
| **Red-team** | 20 scripted attacks run through the full pipeline with a dry-run minter. |
| **Breach** | Any deal at or below cost, or below floor without owner approval. The required count is 0. |
| **Settle** | Mint the discount code and open Shopify Checkout at the agreed total. |
| **PAUSE** | The owner's instant stop for all deals on all surfaces. |
