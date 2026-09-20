# Graph Report - bazaar  (2026-09-19)

## Corpus Check
- 170 files · ~155,089 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1526 nodes · 3576 edges · 89 communities (85 shown, 3 thin omitted)
- Extraction: 93% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 230 edges (avg confidence: 0.92)
- Token cost: 337,581 input · 0 output

## Community Hubs (Navigation)
- Gym Simulation and Price Race
- Backboard LLM Client
- Red-Team Harness
- Storefront Chat and Offer Card
- Product: Console, Policy, Glossary
- Supabase Data Adapter
- Console Build and Theme Integration
- Server Application Core
- Technical Spec: Pipeline and Surfaces
- Console Data Port Seam
- Codex Log and Agent Tasks
- Demo Script and Judge Pitch
- Shared Contracts and Owner Runtime
- Plan: Engine, Gym, Console Tasks
- Plan: Storefront and Shopify Platform
- Catalog Item Selection
- Owner Use Cases and Console
- Negotiation Turn Handlers
- Shopper Turn Flow and Guardrails
- Workspace Root Config
- Console Page Components
- Pricing Engine: priceOffer and Audit
- Console Fixtures and Tests
- Architecture Decisions and Fallbacks
- Accept Flow, Auditor, Red-Team
- Store Notes and Trade Principle
- README: Three Applications
- Agent Guide and Invariants
- Plan Tracker and Risks
- How It Works Explainer
- Server Package Manifest
- Engine Interface: Floor and Add-ons
- Menu Properties (fast-check)
- Shopper Message Parsing
- Approval and Negotiation State Machines
- Offer Card and Contracts Tasks
- Six-Step Pipeline and Check
- Money Helpers and Approval Total
- Owner Runtime: Policy and Approvals
- Server, Hosting and Data Tasks
- R15: Console state + owner routes
- Appendix C: shared types
- The Bazaar — Use Cases
- storefront-preview.mjs
- UC-S9 — Deal → Shopify Checkout
- compilerOptions
- check.ts
- events.ts
- Menu — deals the engine wrote for this t
- buildNegotiationMenu()
- gym/package.json
- llm/package.json
- syncMirror()
- application-security.test.ts
- public.typetest.ts
- The deal engine
- engine/package.json
- application-settlement.test.ts
- Design System: Trailhead Owner Console
- ConsoleEvent
- negotiation-menu.test.ts
- application-multiproduct.test.ts
- railway.json
- application-kpis-privacy.test.ts
- application-kpis.test.ts
- application-settings.test.ts
- application.test.ts
- owner/redteam.ts
- Shopify Skeleton Theme README
- web/tsconfig.json
- contracts/package.json
- UC-S10 — Haggle inside ChatGPT (planned 
- packages/engine — writes and prices the 
- negotiate.test.ts
- tsconfig.json
- application-check-fallback.test.ts
- server/tsconfig.json
- Console()
- B10: /mcp tools (planned, not built)
- tsconfig.pure.json
- application-menu.test.ts
- application-voice.test.ts
- redteam-state.test.ts
- contracts/tsconfig.json
- engine/tsconfig.json
- gym/tsconfig.json
- llm/tsconfig.json
- index.js

## God Nodes (most connected - your core abstractions)
1. `createBazaarServer()` - 118 edges
2. `PRODUCT.md — what and why` - 99 edges
3. `The Bazaar — Use Cases` - 42 edges
4. `The Bazaar Technical Spec` - 40 edges
5. `vitest` - 38 edges
6. `makeOfferTurn()` - 35 edges
7. `Codex log` - 33 edges
8. `buildNegotiationMenu()` - 31 edges
9. `priceOffer()` - 29 edges
10. `HOW-IT-WORKS.md — plain-language explainer` - 27 edges

## Surprising Connections (you probably didn't know these)
- `Money: cents, shopper totals rounded up` --references--> `toShopper()`  [AMBIGUOUS]
  docs/SPEC.md → packages/engine/src/money.ts
- `CR1: Real-deal KPIs` --references--> `listDeals()`  [AMBIGUOUS]
  docs/PLAN.md → apps/server/src/infra/db.ts
- `B7: The Auditor` --references--> `auditOffer()`  [AMBIGUOUS]
  docs/PLAN.md → packages/engine/src/negotiate.ts
- `Accept flow (POST /api/accept)` --references--> `auditOffer()`  [AMBIGUOUS]
  docs/SPEC.md → packages/engine/src/negotiate.ts
- `Personas (pinned, rule-based)` --references--> `PERSONAS`  [AMBIGUOUS]
  docs/SPEC.md → packages/gym/src/personas.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Six-step negotiation pipeline** — docs_product_understand_step, docs_product_validate_step, docs_product_menu, docs_product_choose_say_step, docs_product_the_check, docs_product_auditor, docs_product_settle [EXTRACTED 1.00]
- **Engine pricing maths: what bounds and moves an ask** — docs_product_cost, docs_product_floor, docs_product_urgency, docs_product_target, docs_product_buyer_reason, docs_product_ask, docs_product_discount_cap, docs_product_max_rounds [EXTRACTED 1.00]
- **Store knowledge held as Backboard documents** — infra_seed_policy, infra_seed_sizing_guide, infra_seed_store_notes, docs_product_backboard [INFERRED 0.95]
- **One shopper turn pipeline** — docs_spec_step_understand, docs_spec_step_validate, docs_spec_step_score_and_gate, docs_spec_step_build_the_menu, docs_spec_step_choose_and_say, docs_spec_step_check, docs_spec_step_card [EXTRACTED 1.00]
- **Guardrail layers that stop a losing deal** — docs_spec_guardrail_validate, docs_spec_guardrail_engine, docs_spec_guardrail_check, docs_spec_guardrail_offer_ids, docs_spec_guardrail_auditor, docs_spec_guardrail_shopify_code [EXTRACTED 1.00]
- **Gate 1 critical chain** — docs_plan_task_r1, docs_plan_task_r2, docs_plan_task_r6, docs_plan_task_r7, docs_plan_task_s1, docs_plan_task_s4, docs_plan_gate_1 [EXTRACTED 1.00]
- **Six guardrail layers an attack meets in order** — docs_architecture_layer_1_validate, docs_architecture_packages_engine, docs_architecture_the_check, docs_architecture_layer_4_offer_ids, docs_architecture_auditor, docs_architecture_layer_6_shopify_code [EXTRACTED 1.00]
- **Three views of one negotiation — shopper, Backboard, owner** — docs_architecture_shopper_visible_zone, docs_architecture_backboard_partial_view, docs_architecture_owner_only_zone, docs_architecture_server_zone [EXTRACTED 1.00]
- **UC-D1 demo beat: last round, ask the owner, decline, Deal** — docs_use_cases_uc_s7_final_offer, docs_use_cases_uc_s8_thin_margin_offer, docs_use_cases_uc_o8_approve_or_decline_a_thin_margin_deal, docs_use_cases_uc_s9_deal [EXTRACTED 1.00]

## Communities (89 total, 3 thin omitted)

### Community 0 - "Gym Simulation and Price Race"
Cohesion: 0.06
Nodes (55): invalidReason(), Draft, figures(), jitter(), money(), OUTCOMES, PERSONA_LABEL, PillKey (+47 more)

### Community 1 - "Backboard LLM Client"
Cohesion: 0.09
Nodes (48): ProductCard, assistantList(), BackboardChoice, BackboardClient, BackboardClientConfig, BackboardError, BackboardOfferUnderstanding, BackboardOfferUnderstandingInput (+40 more)

### Community 2 - "Red-Team Harness"
Cohesion: 0.09
Nodes (51): offersUrl(), asObject(), ATTACK_NAMES, AttackResult, BackboardAttempt, Boundary, cardSafety(), checkedOffer() (+43 more)

### Community 3 - "Storefront Chat and Offer Card"
Cohesion: 0.08
Nodes (40): products(), acceptOffer(), acceptUrl(), addMessage(), addOfferCard(), addProductCard(), apiUrl(), askEndpoint() (+32 more)

### Community 4 - "Product: Console, Policy, Glossary"
Cohesion: 0.08
Nodes (51): Judge Q&A, Headline: more or less than a 20% banner — allowed to go red, Console regions: kept band, price race, live feed, Approve/Decline card, PAUSE, More settings, Live feed — one row per decision; blocked attempts in red, PRODUCT.md — what and why, Agent cost, Ask — the shopkeeper's price for the round, Ask the owner — 45-second Approve/Decline request (+43 more)

### Community 5 - "Supabase Data Adapter"
Cohesion: 0.09
Nodes (39): OwnerDatabase, appendPolicy(), bearerToken(), clientsWithoutSettingsColumn, createSupabaseDb(), createSupabaseServerClient(), dealFromRow(), DealInput (+31 more)

### Community 6 - "Console Build and Theme Integration"
Cohesion: 0.05
Nodes (40): dependencies, @bazaar/contracts, @bazaar/engine, @bazaar/gym, react, react-dom, @supabase/supabase-js, devDependencies (+32 more)

### Community 7 - "Server Application Core"
Cohesion: 0.11
Nodes (26): createBazaarServer(), answerWithBackboard(), availableAlternativeFor(), catalogReply(), deterministicReply(), dollarsToCents(), escapeRegExp(), fallbackReply() (+18 more)

### Community 8 - "Technical Spec: Pipeline and Surfaces"
Cohesion: 0.10
Nodes (32): #15 Backboard price intent and ElevenLabs voice, B6 the check entry, Goals: what winning each prize takes, Prize: Backboard, Prize: HTN finalist, Prize: Shopify 'Hack Shopping with AI' (primary), Stretch list and not-building list, B6: The check (+24 more)

### Community 9 - "Console Data Port Seam"
Cohesion: 0.11
Nodes (20): Policy preview — slider updates local preview, Adopt commits once through the port, Owner Console README, Console configuration — VITE_CONSOLE_PORT, VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, ConsoleAuth — Supabase Auth for session only, fails closed, ConsolePort — the one data seam (src/console/data/port.ts), Fixture adapter — fixturePort.ts, development default, HTTP adapter — httpPort.ts, production default, fresh Bearer token, ConsoleApp() (+12 more)

### Community 10 - "Codex Log and Agent Tasks"
Cohesion: 0.11
Nodes (30): Codex log, #10 Profit-protecting negotiator, #11 Per-shopper Backboard memory, #12 Explicit combo offer repair, #13 Smarter cart and discount handling, #14 Conversation intelligence repair (gpt-5.6-terra), #2 Public-catalog bridge in theme, #3 Plan A storefront foundation (+22 more)

### Community 11 - "Demo Script and Judge Pitch"
Cohesion: 0.11
Nodes (30): DEMO.md — the demo, Backboard and OpenAI — 2 minutes each, Beat 7: ChatGPT finale (planned, not built on main), Beat 5: the Gym price race, banner figure in red, Beat 3: hand over the keyboard — try to make it lose money, Beat 4: thin-margin Approve card, Decline, Deal into real Shopify Checkout, Beat 6: PAUSE, codex-log.md — one concrete Codex example (+22 more)

### Community 12 - "Shared Contracts and Owner Runtime"
Cohesion: 0.10
Nodes (23): ownerKpis(), dealKpis(), ApprovalRecord, ApprovalRequest, OwnerRuntime, OwnerRuntimeDb, PublishedConsoleEvent, product (+15 more)

### Community 13 - "Plan: Engine, Gym, Console Tasks"
Cohesion: 0.14
Nodes (29): B11 Gym run and layout entry, S5 Console shell entry, Console redesign CR0-CR7, Cut order, Part B: Engine, Gym + Console (Bryan), B11: Gym run, B12: Gym picture and figures (closed by CR2), CR0: Console layout prototype (+21 more)

### Community 14 - "Plan: Storefront and Shopify Platform"
Cohesion: 0.13
Nodes (27): #6 Real offer path: mirror, accept, mint, Devpost submission (Sat 14:00 hard), Gate 1: real Shopify Checkout from the storefront (Sat 09:00), Part A: Storefront + Shopify store (Ritvik), Part C: Platform (Ricardo), Prize: GoDaddy Registry (MLH), R1: Shopify app and scopes, R13: GoDaddy Registry domain (+19 more)

### Community 15 - "Catalog Item Selection"
Cohesion: 0.16
Nodes (23): accessoryMention(), CatalogItem, CatalogPayload, explicitModelWords(), explicitProduct(), hasAuthoritativeProduct(), hasConcreteProduct(), hasUnknownNamedProduct() (+15 more)

### Community 16 - "Owner Use Cases and Console"
Cohesion: 0.16
Nodes (25): Gym placeholder — 480px paper panel, Adopt — POST /api/policy, new policies row, governs the next turn, apps/web — the Console, owner only, Auth boundary — Bearer Supabase token, fails closed, RLS on with no public policies, deals table — cost and floor as audited, Dot lifecycle — deciding, bought, owner, walked, Flow 4e — owner login and a policy change, src/infra/db.ts — Supabase (+17 more)

### Community 17 - "Negotiation Turn Handlers"
Cohesion: 0.12
Nodes (24): currentCard(), enrichPublicProduct(), findProductFromPayload(), isStudentDiscountRequest(), latestNegotiationOffer(), makeOfferFromPayload(), makeOfferTurn(), negotiationFor() (+16 more)

### Community 18 - "Shopper Turn Flow and Guardrails"
Cohesion: 0.15
Nodes (24): Do's and Don'ts, Live feed — evidence surface; blocked rows name one layer, Backboard partial view — never sees cost, floor, margin, ConsoleEvent — owner stream carrying everything, Decision 10 — feed reasoning composed in code, Decision 1 — one card after the check, Flow 4a — a storefront shopper turn, Guardrail layers — validate, engine, check, offer ids, auditor, Shopify code (+16 more)

### Community 19 - "Workspace Root Config"
Cohesion: 0.08
Nodes (23): devDependencies, @bazaar/contracts, fast-check, @types/node, typescript, vitest, engines, node (+15 more)

### Community 20 - "Console Page Components"
Cohesion: 0.15
Nodes (14): ApprovalCard(), Approvals(), Feed(), FeedRow(), money(), FIVE, dollars(), KeptBand() (+6 more)

### Community 21 - "Pricing Engine: priceOffer and Audit"
Cohesion: 0.19
Nodes (20): Seed data and worked numbers — Trailhead Co., TR2/TR3/Ridge Lite, Thin-margin zone — above cost, below floor, askFor(), auditOffer(), curveStep(), discountCapOf(), maxRoundsOf(), maxSellerDiscount() (+12 more)

### Community 22 - "Console Fixtures and Tests"
Cohesion: 0.24
Nodes (8): createFixturePort(), events, SHOE_SIZES, state, ConsoleState, react, @testing-library/react, vitest

### Community 23 - "Architecture Decisions and Fallbacks"
Cohesion: 0.13
Nodes (21): apps/server — one hosted node:http process, apps/storefront — Trailhead Shopify theme, chat and offer card, Backboard — every LLM call, memory, store documents, Decision 11 — one long-lived Railway instance, Decision 12 — after a decline the final offer is restated, Decision 13 — every LLM call through Backboard, Decision 15 — lowballs countered by code, Decision 4 — no Gym endpoint (+13 more)

### Community 24 - "Accept Flow, Auditor, Red-Team"
Cohesion: 0.13
Nodes (20): Merge-ready integration, Gym and storefront fixes, B13: Red-team script + verifier, B4: Offers: ids, expiry, supersede, single use, B7: The Auditor, Accept flow (POST /api/accept), Type: Deal, Rule 7: Deal binds to a live offer id, Table: deals (+12 more)

### Community 25 - "Store Notes and Trade Principle"
Cohesion: 0.15
Nodes (20): It always trades, never discounts for free, Worked example: Trail Runner 3 shopper with $120 steered to Trail Runner 2, Bundle — add-on at cost plus half its margin, Held price — this round's ask held 15 minutes, Principle: give to get — no concession is free, Problem: the merchant's only tool is a sale for everyone, Something else — a cheaper product of the same type, Trade — what the shopper gives to get a lower price (+12 more)

### Community 26 - "README: Three Applications"
Cohesion: 0.17
Nodes (20): The Gym's honesty rules, Prize fit (Shopify, Backboard, OpenAI, HTN, GoDaddy Registry), Shopify SimGym (inspiration), README.md — The Bazaar, The applications: three apps served by four packages, apps/server — shopper and owner HTTP, negotiation turn, accept + mint, apps/storefront — the Shopify theme (chat and offer card), apps/web — the owner Console (+12 more)

### Community 27 - "Agent Guide and Invariants"
Cohesion: 0.16
Nodes (17): AGENTS.md — agent guide, Done: check passes, tests green, PLAN box ticked, code-review run, Invariant 1: the LLM picks from the menu; every dollar figure originates in packages/engine, Invariant 2: every offer and minted deal is above cost; below floor only with owner approval, Invariant 4: packages/engine and packages/gym are pure, Invariant 6: keys come from server env vars; browser carries only the Supabase anon key, Invariant 7: deals settle into Shopify Checkout, Invariants — every change keeps these true (+9 more)

### Community 28 - "Plan Tracker and Risks"
Cohesion: 0.11
Nodes (19): Human step: apply policy_settings migration, Checklists (first hour, Saturday night, Sunday morning), Finding: haggling stays behind the 20% banner on TR2 seed 42, How to use this tracker, Human steps outstanding, Part 0: Everyone, The Bazaar Plan and tracker, Risk: host restarts, sleeps or scales (+11 more)

### Community 29 - "How It Works Explainer"
Cohesion: 0.19
Nodes (18): HOW-IT-WORKS.md — plain-language explainer, The engine — pure maths, no AI, How we know the engine is safe: 8 fast-check properties, The four pieces: shopkeeper, engine, Console, Gym, The Gym tests the owner's policy, not our code, One run drives everything on screen, Stock age, the round and the stated reason move the price — inside floor and cap, The red-team — 20 attacks · 0 economic breaches (+10 more)

### Community 30 - "Server Package Manifest"
Cohesion: 0.12
Nodes (16): dependencies, @bazaar/contracts, @bazaar/engine, @bazaar/llm, @supabase/supabase-js, @bazaar/contracts, @bazaar/engine, @supabase/supabase-js (+8 more)

### Community 31 - "Engine Interface: Floor and Add-ons"
Cohesion: 0.16
Nodes (13): GymItem, items(), floorOf(), isAddOn(), PACKAGE, NegotiationAudit, NegotiationItem, NegotiationMirror (+5 more)

### Community 32 - "Menu Properties (fast-check)"
Cohesion: 0.15
Nodes (13): B3 property tests entry, B3: Property tests (fast-check), fast-check property tests (8 properties x 1,000 runs, seed 42), Step 4: Build the menu, The menu (options lettered from A, option A is the code fallback), NegotiationOffer, rankNegotiationMenu(), menuInput (+5 more)

### Community 33 - "Shopper Message Parsing"
Cohesion: 0.21
Nodes (16): deterministicOfferUnderstanding(), isOfferIntent(), isPerUnitOffer(), normalizeSearchText(), parseMoney(), parseMoneyWords(), parseNumberWords(), parseOfferTerms() (+8 more)

### Community 34 - "Approval and Negotiation State Machines"
Cohesion: 0.23
Nodes (16): The Bazaar — Architecture, Approval state machine — requested, approved, declined, timed_out, Build order dependency graph, Decision 14 — rounds are owner-set 2–6, Engine formulas — cost, floor, urgency, base target, step, ask, discount cap, Flow 4d — ask the owner, Gate 1 — Sat 09:00 — offer, card, Deal, real checkout, Gate 2 — Sun 00:00 — full demo 3 times (+8 more)

### Community 35 - "Offer Card and Contracts Tasks"
Cohesion: 0.17
Nodes (16): #1 Shopify theme scaffold, Rule zero: shared contracts first, B0: packages/contracts shared types, B1: Engine formulas, S1: The offer card (seven states), S11: Deal trail, faces, cream paper, Team: four parts, three people, Rule 6: The card is the only binding offer (+8 more)

### Community 36 - "Six-Step Pipeline and Check"
Cohesion: 0.19
Nodes (15): Invariant 5: every LLM call has a timeout and a code fallback, Discount code minimum subtotal voids a shrunk cart, Check, then Audit (code), Fallback: held price + template line, 6.5 s LLM timeout with code fallback, Auditor — re-checks cost and floor at Deal time, Final offer — option A of the last round, Layer — a guardrail that can block an attempt (+7 more)

### Community 37 - "Money Helpers and Approval Total"
Cohesion: 0.20
Nodes (11): lowballCounter(), resolveShopperApproval(), isAnonJwt(), publicConfig, header, toShopper — rounds every shopper-facing total up to a whole dollar, formatMoney(), toShopper() (+3 more)

### Community 38 - "Owner Runtime: Policy and Approvals"
Cohesion: 0.19
Nodes (10): assertPolicy(), clone(), createOwnerRuntime(), publish(), resolveTerminal(), schedulePauseRetry(), serializeMutation(), transitionApproval() (+2 more)

### Community 39 - "Server, Hosting and Data Tasks"
Cohesion: 0.16
Nodes (15): #5 Railway Node chat server, B5 core entry, R14 follow-up: merchant domain correction, Critical path, Known limits (in-memory state, orphan code on failed revocation), B5: Server prices only through @bazaar/engine, R12: Hosting: one long-lived instance, R14: Thin Supabase (+7 more)

### Community 40 - "R15: Console state + owner routes"
Cohesion: 0.18
Nodes (15): Owner Console integration and live verification, Final submit, code and deploy freeze (Sun 08:00), Gate 2: full demo 3x on hosted URL (Sun 00:00), Status board (Now / Next / Blocked), B8: Approvals, B9: PAUSE, R15: Console state + owner routes, Ask the owner (+7 more)

### Community 41 - "Appendix C: shared types"
Cohesion: 0.20
Nodes (15): B14: Event bus, S12: Offline replay, Type: ChatEvent, Type: ConsoleEvent, Type: ConsoleState, GET /api/console/state, GET /api/console/stream (SSE), Type: GymResult / GymShopper (+7 more)

### Community 42 - "The Bazaar — Use Cases"
Cohesion: 0.30
Nodes (15): The Bazaar — Use Cases, Judge (actor), Shopper (actor), Traceability — use case to test files, UC-D1 — The judge tries to make it lose money, UC-O6 — Run and read the red-team, UC-O9 — PAUSE and resume, UC-S11 — Store is paused (+7 more)

### Community 43 - "storefront-preview.mjs"
Cohesion: 0.22
Nodes (14): Run it — pnpm test, test:props, start; Railway deploy, emptyProduct(), escapeHtml(), jsonForScript(), loadProducts(), port, proxyApi(), readBody() (+6 more)

### Community 44 - "UC-S9 — Deal → Shopify Checkout"
Cohesion: 0.31
Nodes (14): Accept — audit, mint, record, Auditor — auditOffer at accept time (guardrail layer 5), Discount code mint — discountCodeBasicCreate, single use, scoped, min subtotal, no combining, Flow 4c — deal and settle, Flow 4f — Shopify sync and the 24-hour token, Shopify — theme, Admin API and Checkout, Shopify mirror — token, sync, mint, Shopper (actor) (+6 more)

### Community 45 - "compilerOptions"
Cohesion: 0.14
Nodes (13): compilerOptions, allowImportingTsExtensions, exactOptionalPropertyTypes, isolatedModules, module, moduleResolution, noEmit, noUncheckedIndexedAccess (+5 more)

### Community 46 - "check.ts"
Cohesion: 0.24
Nodes (11): check(), CheckInput, CheckResult, dollars(), neutralOffer(), normalize(), c1, held (+3 more)

### Community 47 - "events.ts"
Cohesion: 0.15
Nodes (10): flask, gaiters, socks, tr2, tr2Round1Menu, tr2Round2Menu, tr2Round3Held, tr3 (+2 more)

### Community 48 - "Menu — deals the engine wrote for this t"
Cohesion: 0.18
Nodes (13): Pitch material: problem, answer, Shopify stats, one-liners, The one-liner for judges, Make an offer — the one action, Menu — deals the engine wrote for this turn, Core design rule: the LLM picks from a menu; code writes the menu, Moffatt v. Air Canada, 2024 BCCRT 149, The offer card, Principle: the card is the only binding offer (+5 more)

### Community 49 - "buildNegotiationMenu()"
Cohesion: 0.35
Nodes (12): alternativesFor(), buildNegotiationMenu(), bundleContains(), findRequestedAddOn(), inventorySafe(), mirrorFor(), normalize(), priceCandidate() (+4 more)

### Community 50 - "gym/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @bazaar/contracts, @bazaar/engine, exports, @bazaar/contracts, @bazaar/engine, name, private (+4 more)

### Community 51 - "llm/package.json"
Cohesion: 0.15
Nodes (12): dependencies, @bazaar/contracts, @bazaar/engine, exports, @bazaar/contracts, @bazaar/engine, name, private (+4 more)

### Community 52 - "syncMirror()"
Cohesion: 0.26
Nodes (12): acceptOffer(), centsToDecimal(), checkoutUrl(), getShopifyToken(), hasShopifyCredentials(), mintDiscount(), safeSyncMirror(), seedMirror() (+4 more)

### Community 53 - "application-security.test.ts"
Cohesion: 0.23
Nodes (9): currentPolicy(), INITIAL_POLICY, ownerRequest(), publishDecision(), readStream(), request(), servers, start() (+1 more)

### Community 54 - "public.typetest.ts"
Cohesion: 0.27
Nodes (10): Invariant 3: shopper surfaces receive the public card only, What each side sees (shopper vs owner), Public card — stripped offer sent to the shopper, Rule 11: two audiences, two channels, ChatEvent, OfferCard, PublicOption, leaked (+2 more)

### Community 55 - "The deal engine"
Cohesion: 0.22
Nodes (11): Repo reorganised: one engine, apps central, Buyer reason scoring (signals 0-4), The deal engine, Rule 2: Give to get, Setting: Lowball cutoff, Lowball rule and code counter, Max discount table by score and step, Missing data rules (no cost closed; no stocked_at = new stock) (+3 more)

### Community 56 - "engine/package.json"
Cohesion: 0.18
Nodes (10): dependencies, @bazaar/contracts, exports, @bazaar/contracts, name, private, scripts, typecheck (+2 more)

### Community 57 - "application-settlement.test.ts"
Cohesion: 0.22
Nodes (4): discountedOffer(), servers, shopperRequest(), start()

### Community 58 - "Design System: Trailhead Owner Console"
Cohesion: 0.29
Nodes (10): Design System: Trailhead Owner Console, Approval card — the only sun-yellow surface, 45-second bar, Palette — trail teal, cream, coral, sky, bark, sun, amber, Feed row — offer/floor, reasoning, menu, picked option, memory, surface, metadata, Layout — 1360px two-column grid, sticky top bar, single column below 760px, PAUSE / Resume button — coral, always in the sticky top bar, Product flags — missing cost coral, missing stocked_at amber, The Semantic Accent Rule (+2 more)

### Community 59 - "ConsoleEvent"
Cohesion: 0.44
Nodes (8): isConsoleEvent(), items(), number(), optional(), record(), string(), connect(), ConsoleEvent

### Community 60 - "negotiation-menu.test.ts"
Cohesion: 0.22
Nodes (9): analyzeBuyerReason(), NegotiationMenuInput, gaiters, input(), now, ridge, socks, tr2 (+1 more)

### Community 61 - "application-multiproduct.test.ts"
Cohesion: 0.25
Nodes (4): database(), PublicProduct, servers, start()

### Community 62 - "railway.json"
Cohesion: 0.22
Nodes (8): build, buildCommand, builder, deploy, healthcheckPath, healthcheckTimeout, startCommand, $schema

### Community 63 - "application-kpis-privacy.test.ts"
Cohesion: 0.25
Nodes (5): DEALS, FORBIDDEN, POLICY, servers, start()

### Community 64 - "application-kpis.test.ts"
Cohesion: 0.25
Nodes (4): DEALS, POLICY, servers, start()

### Community 65 - "application-settings.test.ts"
Cohesion: 0.29
Nodes (3): db(), servers, start()

### Community 67 - "owner/redteam.ts"
Cohesion: 0.36
Nodes (7): Artifact, ArtifactAttack, count(), emptyRedTeamResult(), LAYERS, loadRedTeamResult(), summarizeRedTeamArtifact()

### Community 68 - "Shopify Skeleton Theme README"
Cohesion: 0.36
Nodes (8): Shopify Skeleton Theme README, Blocks — nestable pieces within sections, critical.css — essential CSS for every page, Schema guidelines — CSS variables for single properties, classes for multiple, Sections — reusable Liquid modules with schema, Shopify CLI — theme dev / init, JSON templates, Theme architecture — assets, blocks, config, layout, locales, sections, snippets, templates

### Community 69 - "web/tsconfig.json"
Cohesion: 0.25
Nodes (7): compilerOptions, jsx, lib, types, extends, include, ../../tsconfig.base.json

### Community 70 - "contracts/package.json"
Cohesion: 0.25
Nodes (7): exports, name, private, scripts, typecheck, type, version

### Community 71 - "UC-S10 — Haggle inside ChatGPT (planned "
Cohesion: 0.43
Nodes (7): API surface — HTTP endpoints, ChatGPT app — planned surface, not built on main, Decision 16 — ChatGPT surface planned, not built, Flow 4b — the same turn from ChatGPT (planned, not built), MCP tools — find_products, make_offer, accept_offer (planned, not built), Deliberately out of scope, and open points, UC-S10 — Haggle inside ChatGPT (planned — not built on main)

### Community 72 - "packages/engine — writes and prices the "
Cohesion: 0.43
Nodes (7): Buyer reason score — analyzeBuyerReason 0–4, Engine property tests — 8 properties × 1,000 seeded runs (seed 42), Lowball rule — isLowball shared by server and Gym, Engine flowchart — from an incoming offer to a menu, packages/engine — writes and prices the menu (pure), Engine and gym purity — zero I/O, imports by package name only, System: Engine

### Community 73 - "negotiate.test.ts"
Cohesion: 0.29
Nodes (5): BuyerReason, addOn, mirror, now, shoe

### Community 74 - "tsconfig.json"
Cohesion: 0.29
Nodes (6): compilerOptions, lib, types, extends, include, ./tsconfig.base.json

### Community 75 - "application-check-fallback.test.ts"
Cohesion: 0.47
Nodes (5): db(), dollars(), expectOnlyCardFigures(), offerWith(), servers

### Community 76 - "server/tsconfig.json"
Cohesion: 0.33
Nodes (5): compilerOptions, types, extends, include, ../../tsconfig.base.json

### Community 77 - "Console()"
Cohesion: 0.47
Nodes (5): Console(), adoptDraft(), adopted(), applyApproval(), reloadState()

### Community 78 - "B10: /mcp tools (planned, not built)"
Cohesion: 0.47
Nodes (6): Gate 0: custom card in ChatGPT, or a clear no (Sat 12:00), B10: /mcp tools (planned, not built), S3: Gate 0 widget (planned, not built), Planned MCP tools: find_products, make_offer, accept_offer, Decision: the storefront surface leads, Surface B: ChatGPT app (planned, not built)

### Community 79 - "tsconfig.pure.json"
Cohesion: 0.33
Nodes (5): compilerOptions, lib, types, extends, ./tsconfig.base.json

### Community 80 - "application-menu.test.ts"
Cohesion: 0.50
Nodes (3): db(), servers, start()

### Community 81 - "application-voice.test.ts"
Cohesion: 0.67
Nodes (3): database(), servers, start()

### Community 83 - "contracts/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.pure.json

### Community 84 - "engine/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.pure.json

### Community 85 - "gym/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.pure.json

### Community 86 - "llm/tsconfig.json"
Cohesion: 0.50
Nodes (3): extends, include, ../../tsconfig.base.json

## Ambiguous Edges - Review These
- `listDeals()` → `CR1: Real-deal KPIs`  [AMBIGUOUS]
  docs/PLAN.md · relation: references
- `toShopper()` → `Money: cents, shopper totals rounded up`  [AMBIGUOUS]
  docs/SPEC.md · relation: references
- `negotiate.ts` → `Lowball rule and code counter`  [AMBIGUOUS]
  docs/SPEC.md · relation: references
- `auditOffer()` → `B7: The Auditor`  [AMBIGUOUS]
  docs/PLAN.md · relation: references
- `auditOffer()` → `Accept flow (POST /api/accept)`  [AMBIGUOUS]
  docs/SPEC.md · relation: references
- `PERSONAS` → `Personas (pinned, rule-based)`  [AMBIGUOUS]
  docs/SPEC.md · relation: references
- `ChatGPT app — planned surface, not built on main` → `Negotiation turn — understand, validate, menu, choose and say, card`  [AMBIGUOUS]
  docs/ARCHITECTURE.md · relation: references
- `The Gym — the price race` → `Gym placeholder — 480px paper panel`  [AMBIGUOUS]
  apps/web/DESIGN.md · relation: conceptually_related_to

## Knowledge Gaps
- **313 isolated node(s):** `name`, `private`, `type`, `start`, `typecheck` (+308 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 395 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **3 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `listDeals()` and `CR1: Real-deal KPIs`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `toShopper()` and `Money: cents, shopper totals rounded up`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `negotiate.ts` and `Lowball rule and code counter`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `auditOffer()` and `B7: The Auditor`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `auditOffer()` and `Accept flow (POST /api/accept)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `PERSONAS` and `Personas (pinned, rule-based)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `ChatGPT app — planned surface, not built on main` and `Negotiation turn — understand, validate, menu, choose and say, card`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._