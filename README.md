# The Bazaar

**Hack the North 2026 · team of 3 · code window Sat 19 Sep 00:00 → Sun 20 Sep 08:00 EDT (32 h)**

> **Make an offer.** A shopkeeper AI for a Shopify store: a shopper names a price — on the store's own page, or inside ChatGPT — and it haggles back with trades, not free discounts, then opens a **real Shopify Checkout at the agreed price**. It can't lose the owner money, because the AI only picks from a menu of deals that plain code has already priced from the store's real costs. Before she switches it on, the owner rehearses it in **the Gym**: 300 synthetic shoppers and 20 scripted attacks against her own pricing rules.

**Status: final plan, 19 Sep.** The documents in `docs/` are live.

**Tracks:** Shopify "Hack Shopping with AI" (primary) · Backboard · OpenAI · HTN finalist · GoDaddy Registry (MLH). Selection locks on Devpost **Sat 14:00**.

---

## Doc map

```
bazaar/
├── README.md                 you are here: what this is, the doc map, who reads what, status
├── AGENTS.md                 routing for coding agents (Claude Code and Codex): which skill, when
├── CLAUDE.md                 imports AGENTS.md
├── docs/
│   ├── PRODUCT.md            what and why — problem, users, value, principles, scope, prize fit
│   ├── USE-CASES.md          actors, 27 use cases with main/alternate flows, acceptance criteria
│   ├── SPEC.md               the technical spec — rules, surfaces, pipeline, data, API, engine, guardrails, integrations, the Gym, types
│   ├── ARCHITECTURE.md       every diagram — context, containers, trust boundary, sequences, state machines, engine, data, deployment, API, the swarm
│   ├── PLAN.md               the plan AND the tracker — status board, checkbox tasks per lane, schedule, gates, cut order, stretch, risks, checklists
│   ├── DEMO.md               demo scripts, stage layout, fallbacks, judge Q&A, "don't say these", Devpost checklist
│   └── codex-log.md          the Codex log OpenAI judges ask for — fill it from hour 0
└── mockups/                  index.html — visual reference only (see note below)
```

| File | One line |
|---|---|
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | What we're building and why it wins |
| [`docs/USE-CASES.md`](docs/USE-CASES.md) | What each actor can do, step by step, with acceptance criteria |
| [`docs/SPEC.md`](docs/SPEC.md) | How the system behaves — **the technical source of truth** |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | The whole system as Mermaid diagrams |
| [`docs/PLAN.md`](docs/PLAN.md) | Who does what, when — **the plan is the tracker; there are no tickets** |
| [`docs/DEMO.md`](docs/DEMO.md) | What we say and show to judges |
| [`docs/codex-log.md`](docs/codex-log.md) | Evidence for the OpenAI prize |
| [`AGENTS.md`](AGENTS.md) / [`CLAUDE.md`](CLAUDE.md) | The same skill routing as below, for coding agents |

**Where files disagree:** about behaviour, `SPEC.md` wins. About who / when / order, `PLAN.md` wins. About what we say on stage, `DEMO.md` wins.

> **`mockups/index.html` is a visual reference only.** It was built against the earlier engine formulas, its update was stopped part-way, and its numbers are not authoritative. Take look and layout from it; take every formula and figure from `docs/SPEC.md` §6. Updating it is an optional, deferred task (`S-opt` in the plan).

---

## Who reads what

| You are | Read |
|---|---|
| **Everyone** | `PRODUCT.md` + `PLAN.md` (status board first) |
| 🧠 **Brain** | `SPEC.md` §6 engine, §7 guardrails, §5.1 pipeline, Appendix C + `ARCHITECTURE.md` §4–§7 |
| 🔌 **Rails** | `SPEC.md` §10 Shopify, §8 Backboard, §11 OpenAI, §5 hosting, §5.2 data, §5.3 HTTP + `ARCHITECTURE.md` §8–§11 |
| 🎭 **Stage** | `SPEC.md` §4 surfaces, §9 the Gym, §12 look and feel + `DEMO.md` + `ARCHITECTURE.md` §13 |
| **Pitch prep** | `DEMO.md` + `PRODUCT.md` |

Five minutes: `PRODUCT.md`, then `DEMO.md` §3. About to build: `PLAN.md` status board → your lane's next unticked box.

---

## Which skill to use, when

The team runs its engineering process through Claude Code skills.

| Phase | What it means here | Skill |
|---|---|---|
| Repo setup (once) | issue-tracker doc for reviews; fewer permission prompts | `/setup-matt-pocock-skills`, `fewer-permission-prompts` |
| Pick up work | find your next unticked task in `docs/PLAN.md` — the plan is the tracker, there are no tickets | — |
| Shared language + decisions | `packages/contracts`, the glossary, ADRs for the big calls | `mattpocock-skills:domain-modeling` |
| Seams | engine vs core vs surface adapters; `db.ts`; one card, two mounts | `mattpocock-skills:codebase-design` |
| External unknowns | Shopify token + discount fields, Apps SDK card metadata, Backboard limits | `mattpocock-skills:research` (saves to `research/`) |
| Open design questions | gate 0 ChatGPT card, swarm animation feel, ask-the-owner state model | `mattpocock-skills:prototype` |
| Build | anything with logic — engine gets property tests | `mattpocock-skills:tdd` |
| Human-only steps | Shopify Dev Dashboard, store settings, Supabase, Backboard, ChatGPT developer mode, host secrets, GoDaddy, Devpost | `mattpocock-skills:wizard` |
| UI design and polish | storefront, offer card, chat, Console — against SPEC's look-and-feel section | `impeccable` design skills (install the Impeccable plugin first if it isn't in your skill list) |
| The Gym's visuals | dot histogram, swarm, reference lines, red/teal headline | `dataviz` for the chart, `impeccable` for the polish pass |
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

**Per lane**
- 🧠 **Brain** — domain-modeling → codebase-design → tdd; diagnosing-bugs when needed.
- 🔌 **Rails** — wizard for every dashboard step, research for API unknowns, then tdd + run.
- 🎭 **Stage** — prototype, impeccable, dataviz, run + claude-in-chrome; writing-guidelines for Devpost.
- 👥 **Everyone** — code-review before merging, /handoff before sleeping, grilling before changing the plan.

[`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) at the repo root carry the same routing for coding agents (Claude Code and Codex); `CLAUDE.md` just imports `AGENTS.md`.

---

## The five decisions that shape everything

1. **The LLM picks from a menu; code writes the menu.** The LLM never sees a cost or a floor, so it can't leak one.
2. **The storefront leads; ChatGPT is the finale.** Same core, same card, two thin adapters.
3. **Two audiences, two channels.** The shopper gets a public card; everything else is owner-only, behind a login.
4. **One long-lived hosted server, state in memory, thin Supabase.** Exactly one instance — never serverless.
5. **The Gym is allowed to say she's losing.** Rule-based, seeded, labelled synthetic; the headline card goes red when haggling loses to a 20% banner.

## History

v2 (archived) was agent-to-agent negotiation over UCP; Anthropic's Project Deal made that read as a copy, so v3 pivoted to **a human talking to the shop's agent**. v3's plan and scope docs were replaced on 19 Sep by the documents in `docs/`.
