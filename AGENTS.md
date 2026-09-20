# The Bazaar — agent guide

A Make-an-offer shopkeeper for one Shopify store. Hack the North 2026, three people, final submit **Sun 20 Sep 08:00 EDT**. The global skill spine applies; this file adds only what is specific to this repo.

## Where the code lives

Three applications under `apps/`, served by four packages:

- `apps/server` — the application: routes, the negotiation turn, accept and mint, owner runtime. Prices only through `@bazaar/engine`.
- `apps/web` — the owner Console. Reaches the server through the `data/port.ts` seam (HTTP adapter; fixture adapter in dev).
- `apps/storefront` — the Shopify theme. Renders the server's public card. Read `apps/storefront/README.md` before changing or deploying it.
- `packages/engine` · `gym` · `llm` · `contracts` — import them by package name (`@bazaar/engine`); each package's `src/index.ts` is its interface. Relative imports inside packages carry the `.ts` extension, because the server runs the source under Node's strip-types runtime.

## Where things are decided

- `docs/PLAN.md` — **the tracker**. Read before starting any work: take the next unticked task in your part (§4 is sectioned by owner). There are no tickets.
- `docs/SPEC.md` — read when building or changing behaviour: engine maths, the six-step pipeline, guardrails, API, shared types, Shopify and Backboard integration.
- `docs/ARCHITECTURE.md` — read when you need a flow, a state machine, a trust boundary, or the build-order graph.
- `docs/USE-CASES.md` — read when writing tests: every use case carries Given / When / Then acceptance criteria.
- `docs/PRODUCT.md` — read when a change touches what the product is or who sees what. The glossary lives here; use its words in code.
- `docs/DEMO.md` — read when touching anything the demo shows, or writing for judges.
- `research/` — findings from `mattpocock-skills:research`, created by the first run. Read before researching an external API; the answer may already be there.
- `docs/codex-log.md` — append an entry whenever Codex produced something we kept.

## Invariants — every change keeps these true

1. **The LLM picks from the menu; code writes the menu.** Every dollar figure a shopper sees originates in `packages/engine`.
2. **Every offer and every minted deal is above cost.** Below the owner's floor only with an owner approval on record.
3. **Shopper surfaces receive the public card only** (`PublicOption`: items, totals, line, countdown). The menu, cost, floor, profit, reasoning and the Gym travel only over owner endpoints behind the Supabase token.
4. **`packages/engine` and `packages/gym` are pure.** Time, seed and data arrive as arguments, so the same code runs on the server and in the browser.
5. **Every LLM call has a timeout and a code fallback** — option A plus a template line.
6. **Keys are read from server environment variables.** The browser bundle carries the Supabase publishable (anon) key and nothing else.
7. Deals "settle into Shopify Checkout".

## Skills — what differs in this repo

- **Work intake:** the `docs/PLAN.md` tracker stands in for `/to-spec`, `/to-tickets`, `/triage` and `/implement`. Build a task with `mattpocock-skills:tdd` directly; its "Done when" line is the first failing test.
- **Engine work:** `tdd` with fast-check properties — invariants 1 and 2 are properties of `buildNegotiationMenu` in `packages/engine/src/properties.test.ts` (`pnpm test:props`).
- **Dashboard steps** (Shopify Dev Dashboard, store settings, Supabase, Backboard, ChatGPT developer mode, host secrets, GoDaddy, Devpost): `mattpocock-skills:wizard`.
- **UI design and polish** (storefront, offer card, chat, Console): the `impeccable` design skills, against the look-and-feel section of `docs/SPEC.md`. If `impeccable` is missing from the skill list, ask the human to install it before designing.
- **Gym visuals** (the price race, reference lines): `dataviz` for the chart, `impeccable` for the polish pass.
- **Unknown external behaviour:** `mattpocock-skills:research`, saved to `research/`; then update the "Unverified" list in `docs/SPEC.md`.
- **Gate checks** (real checkout total, the card inside ChatGPT): `run` with `claude-in-chrome`.
- **Before gate 2:** `security-review` against invariants 3 and 6.
- **Plan changes:** `mattpocock-skills:grilling` first. A decision lands in `docs/SPEC.md` and `docs/PLAN.md` in the same commit.
- **Session end or sleep rotation:** overwrite your part's Now / Next / Blocked block in `docs/PLAN.md`, then `/handoff`.

## Done

A task is done when its "Done when" check passes, tests are green, its box in `docs/PLAN.md` is ticked in the same commit, and `mattpocock-skills:code-review` has run on the diff.
