# The Bazaar

**Hack the North 2026 · team of 3 · code window Sat 19 Sep 00:00 → Sun 20 Sep 08:00 EDT (32 h)**

> **Make an offer.** A shopkeeper AI for a Shopify store: a shopper names a price on the store's own page and it haggles back with trades, not free discounts, then opens a **real Shopify Checkout at the agreed price**. It can't lose the owner money, because the AI only picks from a menu of deals that plain code has already priced from the store's real costs. Before she switches it on, the owner rehearses it in **the Gym**: 300 synthetic shoppers and 20 scripted attacks against her own pricing rules.

**Status: built and running, 19 Sep.** `docs/PLAN.md` is the tracker; the documents in `docs/` describe the code as it is.

**Tracks:** Shopify "Hack Shopping with AI" (primary) · Backboard · OpenAI · HTN finalist · GoDaddy Registry (MLH). Selection locks on Devpost **Sat 14:00**.

---

## How it works, in one minute

Full explainer: **[`docs/HOW-IT-WORKS.md`](docs/HOW-IT-WORKS.md)**.

| Piece | What it is |
|---|---|
| **The shopkeeper** | What the shopper talks to: an AI that does the *talking* wrapped around an engine that does the *pricing*. |
| **The engine** | Pure maths, no AI. Turns cost, stock age, the round, the shopper's reason and the owner's settings into a **menu** of deals — a counter, bundles, a cheaper alternative — every one above the floor. |
| **The Console** | The owner's control room: a live feed of every haggle, the floor slider, the Approve / Decline card for thin-margin deals, and PAUSE. |
| **The Gym** | A simulator inside the Console: the owner tests a pricing policy on 300 synthetic hagglers, and watches a red-team fail to rob her, before a real customer arrives. |

**The LLM picks from the menu; code writes the menu.** One shopper turn is *understand* (Backboard LLM reads the message) → *build the menu* (the engine, code) → *choose + say* (Backboard LLM picks one option and words it) → *check* (code verifies the pick and every dollar figure) → the public card. On **Deal**, the Auditor re-checks cost and floor from fresh data, mints a one-use code, and the deal settles into Shopify Checkout. The AI never decides a price, so a jailbreak can at worst pick a different deal from a list where every deal is already profitable.

**It trades, it doesn't discount.** New stock barely moves; old stock bends toward the floor as it ages, a real reason earns a sharper price, and the owner's discount cap bounds all of it. A shopper who can't afford the new shoe is offered last season's at their budget, or a bundle — they leave with something, and the owner clears stock at a profit. Below the floor only the owner can say yes; at or below cost, never.

**The Gym tests the owner's policy, not our code.** 300 rule-based, seeded shoppers (not LLM agents — that is what makes A vs B reproducible) haggle against the real engine. The headline card answers *"does haggling beat a 20%-off banner?"* and is allowed to go red. The engine's own safety is proven separately, by fast-check property tests on the menu every shopper is priced from: 8 properties × 1,000 seeded cases, under a second (`pnpm test:props`).

---

## The applications

Three applications, served by four packages. Everything else in the repo supports them.

```
bazaar/
├── apps/
│   ├── server/        the application — shopper and owner HTTP, the negotiation turn, accept + mint, Shopify mirror, voice
│   ├── web/           the owner Console — kept band, the price race (the Gym), live rail, approvals, PAUSE
│   └── storefront/    the Shopify theme — the shopper chat and offer card; renders the server's public card
├── packages/
│   ├── engine/        pure pricing: the one menu every shopper is priced from, and its properties
│   ├── gym/           pure simulation: 300 seeded shoppers run against the same engine
│   ├── llm/           the Backboard client — every LLM call, each with a timeout and a code fallback
│   └── contracts/     shared types; the public card vs owner-only shapes
├── infra/             schema.sql, migrations, seed data, the red-team result
├── scripts/           redteam.ts, storefront-preview.mjs
├── tests/             purity.test.ts — engine and gym stay pure
└── docs/              see the doc map below
```

### Run it

```sh
pnpm install
cp .env.example .env            # fill in Backboard, Shopify and Supabase keys
pnpm test                       # 268 tests
pnpm test:props                 # the engine's properties alone
pnpm typecheck
pnpm start                      # builds the Console if needed; server on $PORT, Console at /console
pnpm --dir apps/web dev         # Console dev server (fixture adapter; VITE_CONSOLE_PORT=http for the real server)
node scripts/storefront-preview.mjs                      # theme preview against the local server
node --experimental-strip-types scripts/redteam.ts       # the 20 scripted attacks
```

The storefront theme is a Shopify CLI theme, outside the pnpm workspace: from `apps/storefront/`, `shopify theme dev --store b8wzw0-h3.myshopify.com`, and `shopify theme check` before pushing. Deploy is Railway (`railway.json`): `pnpm build`, then `pnpm start`, health check on `/health`.

## Doc map

```
├── README.md                 you are here
├── AGENTS.md                 routing and invariants for coding agents; CLAUDE.md imports it
└── docs/
    ├── HOW-IT-WORKS.md       the plain-language explainer — shopkeeper, engine, Console, Gym; read first
    ├── PRODUCT.md            what and why — problem, users, value, principles, scope, glossary
    ├── USE-CASES.md          actors, use cases with main/alternate flows, acceptance criteria
    ├── SPEC.md               the technical spec — rules, surfaces, pipeline, data, API, engine, guardrails, integrations, the Gym, types
    ├── ARCHITECTURE.md       every diagram — context, trust boundary, sequences, state machines, engine, data, deployment
    ├── PLAN.md               the plan AND the tracker — status board, checkbox tasks per part and owner, gates, cut order
    ├── DEMO.md               demo scripts, fallbacks, judge Q&A, Devpost checklist
    ├── codex-log.md          the Codex log OpenAI judges ask for
    └── design/brand/         Trailhead marks and lockups
```

---

## Who reads what

| You are | Read |
|---|---|
| **Everyone** | `PRODUCT.md` + `PLAN.md` (status board first) |
| ⚙️ **B. Engine, core, Gym + Console** (Bryan) | `SPEC.md` §6 engine, §5.1 pipeline, §9 the Gym, §4.4 Console, Appendix C + `ARCHITECTURE.md` §4–§7 |
| 🔌 **C. Platform** · 🤖 **D. Agents + guardrails** | `SPEC.md` §10 Shopify, §5 hosting, §5.2 data, §5.3 HTTP · §8 Backboard, §7 guardrails + `ARCHITECTURE.md` §8–§11 |
| 🛍️ **A. Storefront + Shopify store** (Ritvik) | `SPEC.md` §4.1–4.3 surfaces, §10 seed + sync, §12 look and feel + `DEMO.md` + `ARCHITECTURE.md` §13 |
| **Pitch prep** | `HOW-IT-WORKS.md` §6–§7 (say it right) + `DEMO.md` + `PRODUCT.md` |

Two minutes: `HOW-IT-WORKS.md`. Five minutes: `PRODUCT.md`, then `DEMO.md` §3. About to build: `PLAN.md` status board → your part's next unticked box.

---

## Which skill to use, when

The team runs its engineering process through Claude Code skills.

| Phase | What it means here | Skill |
|---|---|---|
| Repo setup (once) | issue-tracker doc for reviews; fewer permission prompts | `/setup-matt-pocock-skills`, `fewer-permission-prompts` |
| Pick up work | find your next unticked task in `docs/PLAN.md` — the plan is the tracker, there are no tickets | — |
| Shared language + decisions | `packages/contracts`, the glossary, ADRs for the big calls | `mattpocock-skills:domain-modeling` |
| Seams | the engine's package interface; `infra/db.ts`; the Console's `data/port.ts` | `mattpocock-skills:codebase-design` |
| External unknowns | Shopify token + discount fields, Apps SDK card metadata, Backboard limits | `mattpocock-skills:research` (saves to `research/`) |
| Open design questions | gate 0 ChatGPT card, swarm animation feel, ask-the-owner state model | `mattpocock-skills:prototype` |
| Build | anything with logic — engine gets property tests | `mattpocock-skills:tdd` |
| Human-only steps | Shopify Dev Dashboard, store settings, Supabase, Backboard, ChatGPT developer mode, host secrets, GoDaddy, Devpost | `mattpocock-skills:wizard` |
| UI design and polish | storefront, offer card, chat, Console — against SPEC's look-and-feel section | `impeccable` design skills (install the Impeccable plugin first if it isn't in your skill list) |
| The Gym's visuals | the price race, reference lines, red/teal headline | `dataviz` for the chart, `impeccable` for the polish pass |
| Something's broken | any bug or slow reply | `mattpocock-skills:diagnosing-bugs`, then lock the fix with `tdd` |
| See it working | gates 1 and 2, the real checkout total, the card in ChatGPT | `run`, `claude-in-chrome` |
| Before merging | every PR | `mattpocock-skills:code-review` (the prefixed one) |
| Before the demo | Console login, RLS, service-role key, rule 11 | `security-review` |
| Merge conflicts | three people, one repo | `mattpocock-skills:resolving-merge-conflicts` |
| A new pivot | default answer: "it's in the spec" | `mattpocock-skills:grilling` |
| Sleep rotation / end of session | update Now/Next/Blocked in PLAN.md, then | `/handoff` |
| Editing AGENTS.md / CLAUDE.md / a skill | | `mattpocock-skills:writing-for-agents` |
| Questions about the docs | "where is X decided?" | `/graphify` over `docs/` |
| Prose for judges | Devpost page, README polish | `writing-guidelines` |

**Per part**
- ⚙️ **B. Engine, core, Gym + Console** — domain-modeling → codebase-design → tdd; diagnosing-bugs when needed.
- 🔌 **C. Platform** · 🤖 **D. Agents** — wizard for every dashboard step, research for API unknowns, then tdd + run.
- 🛍️ **A. Storefront** (and the Console / Gym UI in B) — prototype, impeccable, dataviz, run + claude-in-chrome; writing-guidelines for Devpost.
- 👥 **Everyone** — code-review before merging, /handoff before sleeping, grilling before changing the plan.

[`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) at the repo root carry the same routing for coding agents (Claude Code and Codex); `CLAUDE.md` just imports `AGENTS.md`.

---

## The five decisions that shape everything

1. **The LLM picks from a menu; code writes the menu.** The LLM never sees a cost or a floor, so it can't leak one.
2. **The storefront leads.** A ChatGPT surface is planned as the finale and is not built on `main`.
3. **Two audiences, two channels.** The shopper gets a public card; everything else is owner-only, behind a login.
4. **One long-lived hosted server, state in memory, thin Supabase.** Exactly one instance — never serverless.
5. **The Gym is allowed to say she's losing.** Rule-based, seeded, labelled synthetic; the headline card goes red when haggling loses to a 20% banner.

## History

v2 (archived) was agent-to-agent negotiation over UCP; Anthropic's Project Deal made that read as a copy, so v3 pivoted to **a human talking to the shop's agent**. v3's plan and scope docs were replaced on 19 Sep by the documents in `docs/`.
