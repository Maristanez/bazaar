# Part B — build plan, in build order (Bryan)

How Part B of [`PLAN.md`](PLAN.md) §4 gets built from an **empty repo** across **Codex**, **Claude Design** and **Claude Code**. Task ids, owners and "Done when" lines are PLAN.md's; behaviour is SPEC.md's. Tick boxes in PLAN.md, not here.

**Read it top to bottom — the steps are in the order you build them.** Every step carries a tag:

- **SEQ** — do it after the step above; nothing else of yours can run meanwhile.
- **PAR** — runs at the same time as the step(s) named. In practice: Codex runs unattended in one lane while you sit in the other.
- **GATE** — a join; both lanes must be there before going on.

## 0. Frontend or backend first?

**Logic first — but design overlaps it, it doesn't wait for it.** Claude Design needs the *shape of the data* (`packages/contracts`) and SPEC §4.4 / §9.2 / §12, not a finished codebase. Those exist after step 2. So from step 4 on there are two lanes:

```
            step 1 → 2                (SEQ, ~50 min — this is the only true blocker)
                     │
   ┌─────────────────┴──────────────────┐
   LANE X — Codex, unattended           LANE Y — you, attended
   4 B1 ∥ 5 B4                          3  fixtures (subagent, not on the critical path)
   6 B2                                 4y D1 Console frame (Claude Design)
   7 B3 ∥ 8 B11                         6y D2 Gym static    (Claude Design)
   9 layout.ts                          8y shared theme + review/merge X's diffs
   └─────────────────┬──────────────────┘
                 GATE A  (engine + gym merged, D1 + D2 handed off)
   10 B5 → 11 B6                        10y S5 Console shell on fixtures
   └─────────────────┬──────────────────┘
                 GATE B  (core + check merged, shell up)
            12 S5 live → 13 S6 → 14 B12 → 15 S9 → 16 S7      (SEQ, Claude Code)
            ── 18:00 cut line ──
            17 D3 → 18 S8 → 19 S10                           (SEQ, only if not cut)
            20 stretch
```

**Directory ownership — this is what makes PAR safe:** Codex writes only `packages/engine`, `packages/gym`, `apps/server/src/core`. Claude Code writes only `apps/web/src/console` and the fixtures. `packages/contracts` changes only out loud (rule zero). The rest of `apps/server` is Platform's; `apps/web/src/storefront` and `packages/card` are Ritvik's.

---

## Phase 1 — foundations ✅ (steps 1–2 blocked everything; step 3 never did)

### Step 1 · Scaffold the monorepo — **Claude Code** · SEQ · ✅ done (branch `part-b/scaffold`)
- Root: `package.json` (scripts `test`, `test:watch`, `typecheck`), `pnpm-workspace.yaml` (`packages/*`, `apps/*`), `.nvmrc` = 22, vitest 5 + fast-check 4 + TypeScript 7.
- **No build step.** Every package exports `./src/index.ts`; Vite, vitest and `tsx` consume source directly.
- `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `moduleResolution: bundler`) and **`tsconfig.pure.json`** (`lib: ES2023`, `types: []`) for `contracts`, `engine`, `gym`: no DOM and no node types, so `fetch`, `process`, `fs` — and `console` — do not typecheck there. Invariant 4 is enforced by the compiler.
- `tests/purity.test.ts` catches what no lib setting can: `Date.now()`, `new Date()`, `Math.random()`, `performance.now()`, `crypto` randomness in `engine` / `gym` source. Both guards were proven against planted violations.
- `packages/gym/src/workspace.test.ts` is a wiring tracer — delete it when B11 brings a real test that imports the engine.
- Browser / server packages (`apps/*`, `card`, `shopify`, `llm`) are their owners' to create: extend `tsconfig.base.json`, add a `typecheck` script, and they join `pnpm typecheck` automatically.
- **Done when:** `pnpm i && pnpm test && pnpm typecheck` green from a clean copy — verified.

### Step 2 · B0 contracts — ✅ done, without the sit-down (teammates review it in the PR)
- `packages/contracts/src/index.ts` is SPEC Appendix C transcribed, **with one change**: Appendix C's `PublicOption = Pick<Option, …>` is structural, so a full `Option` (with `ownerRank`, `facts`) was assignable to it with no error — B0's "Done when" was false as written. `PublicOption` now carries `{ ownerRank?: never; facts?: never }`; SPEC Appendix C is updated to match.
- `src/public.typetest.ts` is the compile-time test: an `Option` cannot pass as a `PublicOption` or ride inside a `ChatEvent`; stripping to the public fields compiles. It went red first against the verbatim transcription.
- **Still owed:** tell Ritvik and the Platform owner the types are in, and log the first codex-log entry (E1) when Codex first runs.

### Step 3 · Fixtures — **Fable 5.1 subagent** · ✅ done · *not on the critical path — it feeds lane Y only*

| File | What |
|---|---|
| `packages/gym/fixtures/seed42.json` + `index.ts` | Generated `GymResult`, seed 42, n 300, floorPct 25. **Disposable** — B11 regenerates it. Do not pin a test to it before then. |
| `packages/gym/src/invariants.ts` | **`gymResultProblems(result, { cost, floor }): string[]`** — pure. Written before B11 exists, so it **is B11's acceptance test**. |
| `packages/gym/src/fixture.test.ts` | 15 tests: the checker returns `[]`, spec literals (15 bins 7800…14800, persona split 90/105/45/30/30, every shopper's asks a prefix of `[14900, 13500, 12700, 12000]`), + 10 corruption cases locked red. |
| `apps/web/src/console/fixtures/{state,events,index}.ts` | `ConsoleState` + 10 `ConsoleEvent`s. Both surfaces, one `recalled` / `approval_requested` / `approval_resolved` / `settled`, **one `blocked` per layer**. Approval is $85 on TR2 → `$7 · 9% over cost`, reproducing SPEC §6.1. |

**Verified:** `pnpm test` 18 passed · `pnpm typecheck` clean · corrupting `bought` 195 → 196 goes red.

**Measured under seed 42 (not tuned — SPEC §9.3):** bought 195/300 · avgAgreed $136.56 · **profitVsBanner +$2,081** · dealsMissed 76 · wouldAskOwner 19 · trades: held 120, bundle 30, accepted 27, final 18.

**Two findings that need your decision:**
1. **Lowballers can never buy (0/30).** §A gives them willingness ≤ 0.75 × list = $111.75, below `ask(4)` = $120. 19 of 30 land in `would_ask_owner`, so they do drive the approval beat — but decide whether that exclusion is intended *before* B11 runs, because §9.3 forbids changing it afterwards.
2. **Haggling wins at floor 25 %,** so the headline card is teal. The demo's red → teal drag needs the floor where it loses — find it Saturday night (PLAN E3).

**Conventions B11 must match** (or the reused checker goes red): bundle `agreed` is the bundle total and **may exceed list**, so the **last bin is open-ended**; `rounds[].ask` holds the shopper-facing *rounded* ask. Offer ramp is `opening + (r−1)/patience × (willingness − opening)` — with `patience − 1` the last offer equals willingness and `trade: "final"` becomes unreachable.

---

## Phase 2 — two lanes (target: done by gate 1, Sat 09:00)

### LANE X — Codex

Every Codex prompt gets: the SPEC section pasted verbatim · the "Done when" line · "write the failing test first, then the code" · "pure: no `Date.now()`, `Math.random()`, I/O — time, seed and data are arguments (invariant 4)" · "touch only `<dir>`" · "do not edit tests marked `// SPEC — do not edit`". Each diff: you run `mattpocock-skills:code-review`, tick PLAN, log in `codex-log.md`.

#### Step 4 · B1 engine formulas · **PAR with 5 and 4y** · ~1.5 h
`packages/engine/src/{types,money,formulas}.ts`
```ts
type Item = { variantId: string; productId: string; title: string; size?: string; productType: string;
              list: number; cost: number | null; stockedAt: string | null; inStock: boolean; isAddOn: boolean };  // cents
toShopper(cents): number                       // ceil to whole dollars, returned in cents
urgency(stockedAt: string | null, now: Date): number      // null ⇒ 0
costOf(items): number | null                   // null if any cost missing ⇒ not open to offers
floorOf(items, floorPct): number
targetOf(items, mainUrgency, floorPct): number // bundle takes its MAIN product's urgency
ask(list, target, urgency, r: 1|2|3|4): number
```
**First test (do-not-edit):** SPEC §6 worked example — TR2 floor 9750, urgency 0.567, target → $120, asks $149 → $135 → $127 → $120; TR3 (12 d) target = $169. **Done when:** PLAN B1.

#### Step 5 · B4 offers · **PAR with 4** (needs only B0) · ~1 h
`apps/server/src/core/offers.ts` — pure functions over an injected store; `now` and `newId` are arguments.
```ts
createOffer(store, { negotiationId, option, now, newId }): Offer   // 15-min expiry; supersedes the negotiation's previous live offer
checkAcceptable(store, offerId, now): { ok: true; offer } | { ok: false; why: "unknown"|"expired"|"used"|"superseded" }
markUsed(store, offerId): void
```
**Done when:** PLAN B4 — the four rejects, four tests.

#### Step 6 · B2 menu builder · **SEQ after 4** · ~3 h
`packages/engine/src/menu.ts`
```ts
buildMenu(input: { main: Item; addOns: Item[]; catalog: Item[]; offer: number; budget?: number;
                   round: 1|2|3|4; floorPct: number; now: Date })
  : { outcome: "closed" }                                            // missing cost
  | { outcome: "accept"; total: number }                             // x ≥ ask(r): accept AT x
  | { outcome: "menu"; options: Option[];                            // contracts.Option — NO cost fields
      internals: Record<string, { cost: number; floor: number; target: number; profit: number }> };  // owner-side only
```
Rules exactly as SPEC §6 "On an offer of x": A held · B bundles (add-on part `cost + ½ margin`; shoe at `ask(r+1)` only if bundle profit ≥ A's profit; r = 4 uses `ask(4)`) · C something else (only if `x < target(p)` or `r ≥ 3`; same `productType`, in stock in the size, `target(q) ≤ max(x, budget)`, oldest first, alone and with each add-on, priced `max(target, min(ask, budget ?? x))`) · rank by profit then stock age · r = 4 ⇒ A is `kind: "final"`. `facts[]` are code-written strings ("stocked 94 days ago", "gaiters pair with this shoe"). `internals` is what B14 / the Auditor read — it never leaves the server.
**Done when:** PLAN B2 — the "$120 on the TR3" case plus the socks bundle = $147.

#### Step 7 · B3 property tests · **SEQ after 6, PAR with 8** · ~1.5 h
`packages/engine/src/properties.test.ts` — one `fc.property` per clause of SPEC §6.2, named after the clause, on the **rounded** figures, 1,000 runs. Arbitrary generators for `Item`, policy, round, offer. The decline-restates-final and accept-rejects clauses are tested in steps 5 / 10, referenced here by comment.
**Done when:** PLAN B3 — all green, suite < 10 s. **This is codex-log entry for the demo shortlist.**

#### Step 8 · B11 Gym run · **SEQ after 6, PAR with 7** *(pulled ahead of PLAN's slot — it needs only B2)* · ~2.5 h
`packages/gym/src/{rng,personas,run}.ts`
```ts
runGym(input: { main: Item; addOns: Item[]; floorPct: number; askOwner: boolean; seed: number; n: number; now: Date }): GymResult
compare(a: GymResult, b: GymResult): MetricDeltas
```
Uses `buildMenu` for every ask — no second pricing path. Behaviour model and persona numbers: **§A below** (they are gaps in SPEC; pin them *before* seeing results — SPEC §9.3).
**Done when:** PLAN B11 — **`gymResultProblems(runGym({ seed: 42, … }), { cost, floor })` returns `[]`** (step 3 wrote it; it is the red-before-green test) · same seed ⇒ deep-equal result · 300 in < 50 ms · `profitVsBanner < 0` at some floor. Paste step 3's "Conventions B11 must match" into the prompt. Then regenerate `fixtures/seed42.json` from the real run and add a test pinning it.

#### Step 9 · `layout.ts` *(new, small — tell the team)* · **SEQ after 8** · ~1 h
`packages/gym/src/layout.ts`
```ts
type DotPosition = { id: number; x: number; y: number; state: "haggling"|"settled"|"walked"; color: "persona"|"yellow" };  // x = price (cents), y = stack index
settle(result: GymResult, binWidth: number): DotPosition[]
frame(result: GymResult, binWidth: number, t: number /* 0..1 over R1→R4 */): { dots: DotPosition[]; askLine: number; round: 1|2|3|4 }
```
**Why:** S8's "Done when" (*Run settles into exactly the static histogram*) becomes a property — `frame(…, 1).dots` deep-equals `settle(…)`; every id exactly once; walked dots never in a bin. Drag = `settle`, release = `frame`.

### LANE Y — you, while Codex runs

#### Step 4y · D1 Console frame — **Claude Design** · PAR with 4–5 · time-box 45 min
**Give it:** SPEC §4.4 (region table + the red / yellow rule) · SPEC §12 · contracts `ConsoleEvent`, `Policy`, `Approval`, `OwnerProduct` · `events.json` + `state.json` · `mockups/index.html` *for look only*.
**Ask for:** one page, no tabs, desktop 1440 — top bar (store name · `Deals live`/`Paused` · red **PAUSE** always in frame) · left feed row anatomy (offer · floor · reason · menu A–F · pick · memory · surface tag · model / ms / cost) · **blocked row in red naming its layer** · right policy panel (floor slider cost + 0–60 %, ask-me switch, missing-cost red list, missing-`stocked_at` amber list, **Adopt**) · yellow Approve / Decline card (items, offer, profit `$7 · 9% over cost`, 45 s bar) · the empty Gym region as a placeholder · login screen (plain).
**States to demand:** paused · empty feed · approval pending / resolved / timed out · slider dirty (B ≠ A) vs clean.
**Out:** handoff bundle → `docs/design/d1/`.

#### Step 6y · D2 Gym, static — **Claude Design** · PAR with 6 · time-box 60 min
**Give it:** SPEC §9.2, §9.3 · `GymResult` / `GymShopper` types · `seed42.json` · D1's output.
**Ask for:** dot histogram (one dot per shopper, five persona colours from the §12 palette, grey outline histogram for policy A behind, reference lines list / floor / 20 %-banner, shaded cost → floor band, walked pile at the side labelled "deals missed") · six A-vs-B metric cards with **the headline card in both teal (wins) and red (loses)** · persona legend with counts, doubling as a filter · click-a-dot transcript popover (persona, willingness, offer / ask per round, trade, outcome) · the always-on label *"300 synthetic shoppers — rule-based, seeded (seed 42), results might differ from actual buyer behaviour"* · **Run the Gym** button, R1–R4 scrubber, Replay (static appearance only).
**Rules to state:** yellow = "would have asked you" only; coral = red-team and a losing headline only.
**Out:** `docs/design/d2/`.

#### Step 8y · Shared theme + reviews · PAR with 7–9 · ~30 min
With Ritvik: one `tailwind` theme (palette + Satoshi / Fredoka tokens) both routes import. Then review / merge whatever lane X has landed.

### GATE A
☐ B1 B2 B3 B4 B11 + `layout.ts` merged and ticked · ☐ real `seed42.json` committed · ☐ D1, D2 handoffs in `docs/design/` · ☐ ≥ 2 codex-log entries.

---

## Phase 3 — core + shell (gate 1 → Devpost, Sat 09:00 → 14:00)

### Step 10 · B5 core — **Codex** · SEQ after GATE A · PAR with 10y · ~3 h
`apps/server/src/core/{index,ports}.ts`. Needs Platform's **R5** (`db.ts`) and Ritvik's **R4** (mirror). **If either is late, don't wait:** code against the ports below and ship an in-memory fake; swap when R5 lands.
```ts
type Ports = { db: { getItems(): Item[]; getPolicy(): Policy; negotiations: Store<Negotiation>; offers: Store<Offer> };
               llm: { understand(text): Promise<Understood>; chooseAndSay(options, ctx): Promise<{ optionId: string; line: string }> };   // part D — stubbed here
               mint(offer): Promise<Settlement>;                      // Platform R6/R7 — stubbed
               emit: { chat(e: ChatEvent): void; console(e: ConsoleEvent): void };  // part D B14 — stubbed
               now(): Date; newId(): string };
findProducts(ports, query): ProductCard[]
makeOffer(ports, { negotiationId?, shopperId, surface, productId, size?, text | amount }): AsyncIterable<ChatEvent>
acceptOffer(ports, offerId): Promise<Settlement | Blocked>
```
`makeOffer` runs SPEC §5.1 steps 1–6 with the step-2 validate rules. **Done when:** PLAN B5 — a full turn end to end with the LLM stubbed; both adapters would call only these three.

### Step 11 · B6 the check — **Codex** · SEQ after 10 · ~1.5 h
`apps/server/src/core/check.ts`: `check(line, optionId, menu): { ok: true } | { ok: false; why }` — id on the menu · every `$` in the line ∈ that option's numbers · every reason maps to a `fact` · no cost / floor / margin / profit / wholesale words. Any fail ⇒ option A + template line + `ConsoleEvent{ kind:"blocked", blockedBy:"check" }`.
**Done when:** PLAN B6 — the four attacks, four tests. **Then hand B5 / B6 to part D** (they block B7, B8, B9, B13, B14).

### Step 10y · S5 Console shell on fixtures — **Claude Code** · PAR with 10–11 · ~2 h
`apps/web/src/console/` from the D1 handoff: layout, top bar + PAUSE, feed list with red blocked rows, policy panel and Approve card as presentational components. Data comes from one hook, `useConsole()`, which today returns the fixtures. Supabase login stubbed behind the same hook.
**Done when:** `/console` renders every D1 state from fixtures.

### GATE B
☐ B5, B6 merged, handed to part D · ☐ `/console` up on fixtures.

---

## Phase 4 — Console + Gym UI (Devpost → gate 2) — all **SEQ**, all **Claude Code**, keep-first order

| Step | Task | Needs from others | Build | Done when |
|---|---|---|---|---|
| **12** | **S5 live** ~0.5 h | R15 routes, B14 bus, R14 auth | Swap `useConsole()` to `GET /api/console/state` + `fetch`-based SSE (`@microsoft/fetch-event-source`) with the Bearer token, auto-reconnect. **If they're late, stay on fixtures and keep going** — this step floats. | A haggle on the left → a feed row in < 1 s |
| **13** | **S6** ~1.5 h | R15 `POST /api/policy` | Slider sets policy **B** locally (no server call while dragging); Adopt posts it and B becomes A | Adopt changes the floor on the very next shopper turn |
| **14** | **B12** ~2 h | — | Canvas 2D from D2. `runGym` for A (saved) and B (slider) in the browser on `state.products`; positions from `settle()`; metric cards from `compare()`. `dataviz` skill for the pass. | PLAN B12 — incl. headline card red when `profitVsBanner < 0`; dragging re-settles instantly |
| **15** | **S9** ~1.5 h | — | Hit-test on the canvas → transcript popover; legend click filters | Any dot shows persona, willingness, rounds, trade, outcome |
| **16** | **S7** ~1 h | B8 (part D) | Approve / Decline → `POST /api/approvals/:id`; 45 s bar from `deadline` | Both buttons and the timeout resolve the shopper's pending card |

Codex in this phase (PAR, unattended): **cross-review each Console diff for invariant 3** — "can any shopper route, `ChatEvent` or the web storefront bundle carry menu, cost, floor, profit or Gym data?" A real find is the demo's codex-log sentence.

### ── Sat 18:00 cut line (PLAN §7) ── if behind, stop here; steps 17–19 are cut #3.

| Step | Task | Build | Done when |
|---|---|---|---|
| **17** | **D3 motion** — Claude Design · 45 min | Storyboard R1 → R4: ask line stepping, settle-and-drop easing, walked-pile fade, yellow turn, scrubber; red dots hitting the wall at the cost line, labelled by layer; "20 attacks · 0 breaches" card. → `docs/design/d3/` | Handed off |
| **18** | **S8** ~2 h (was 3 — geometry is in `layout.ts`) | `requestAnimationFrame` drives `t`; draw `frame(result, t)`; scrubber sets `t`; **no animation while dragging** | Run ends on exactly the step-14 histogram |
| **19** | **S10** ~1.5 h · needs B13 | Replay `state.redteam.attacks` — never re-run attacks in the browser. Note `blockedBy` may be `shopify_code` (five labels, not four) | Each dot bounces off its layer; card matches the JSON |

### Step 20 · Stretch, after gate 2, PLAN §8 order only — B15, B16 (Codex), S15 (Claude Code).

---

## §A. Gaps in SPEC this plan pins — confirm, then land in SPEC §9.1 in the same commit

SPEC names the personas but gives no numbers and no shopper behaviour. These are proposed defaults. **Fix them before the first run and don't touch them after** (SPEC §9.3: never tune to flatter). All fractions are of the main product's list price.

| Persona | Share | Willingness | Opening offer | Patience | Bundle-tempted |
|---|---|---|---|---|---|
| bargain | 30 % | 0.70–0.90 | 0.55–0.70 | 4 | 30 % |
| budgeted | 35 % | 0.78–0.98 | 0.70–0.85 | 3 | 50 % |
| impatient | 15 % | 0.85–1.05 | 0.80–0.95 | 2 | 20 % |
| loyal | 10 % | 0.95–1.10 | 0.88–1.00 | 3 | 60 % |
| lowballer | 10 % | 0.50–0.75 | 0.30–0.50 | 4 | 10 % |

**Measured, seed 42:** these ranges exclude lowballers from buying entirely (willingness ≤ $111.75 < `ask(4)` $120) — see step 3, finding 1.

- **RNG:** mulberry32 in `gym/src/rng.ts`, seeded; uniform draws within each range, **rounded to whole dollars**; opening clamped ≤ willingness (the impatient and loyal ranges overlap).
- **Scope:** one main product (TR2) + the three add-ons; no "something else" (SPEC §9.3).
- **Each round r ≤ patience:** `offer(r)` = linear from opening to willingness across the persona's patience. If `offer ≥ ask(r)` → bought at the offer (`accepted`). Else if `ask(r) ≤ willingness` → bought at the ask (`held`, or `final` at r = 4). Else if bundle-tempted and the best bundle total ≤ willingness + 0.6 × add-on list → `bundle`. Else next round.
- **Out of patience:** last offer `x`; `cost < x < floor` and ask-owner on → `would_ask_owner` (counted as not closed). Otherwise `walked`; `missed = willingness ≥ floor`.
- **Banner counterfactual:** same 300; buys at `0.8 × list` iff `willingness ≥ 0.8 × list`. `profitVsBanner = Σ haggle profit − Σ banner profit` (cents).
- **`aovUplift`:** Σ add-on parts ÷ `bought` (cents). **Bins:** $5 wide, cost → list.
- **Add-ons need a marker.** The engine must know what is an add-on; nothing in SPEC says how. Proposed: `productType === "Add-on"` in the seed → `Item.isAddOn`. **Tell Ritvik before R3.**

## §B. Risks of this split

| Risk | Mitigation |
|---|---|
| Codex edits a test to make it pass | SPEC-derived tests marked do-not-edit; review reads the test diff first |
| Design invents a field | Types pasted into every session; implementation against real types makes drift a compile error |
| Design eats the night | Time-boxes 45 / 60 / 45; step 14 (static) ships before any motion |
| R5 / R15 / B14 / B8 land late | Ports + fakes (step 10), fixtures behind `useConsole()` (step 10y); step 12 floats |
| You become the bottleneck reviewing | Review at lane-Y boundaries (after 4y, 6y, 8y), not on every Codex ping |
