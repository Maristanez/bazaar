# Codex log

**Why this file exists.** The OpenAI prize is judged on "what you built with the OpenAI API" **and** "how Codex helped you build it", and the demo must *"share one concrete way Codex improved your process or outcome."* OpenAI judges require **one concrete example in the demo** — this log is where it comes from. Keep it **from hour 0**; a log written on Sunday morning reads like one.

**How to use it.** One entry per real use, written at the time, by whoever ran it. Be specific: the actual prompt, what came back, what we kept, what we threw away. A bug Codex found is worth more than a file it wrote. Aim for at least three strong entries:

1. the engine's property tests (PLAN task B3)
2. the red-team script (B13)
3. one real bug it found

**Chosen for the demo sentence:** entry #____ — *"____________________________________________"* (decide by the Saturday-night checklist)

---

## Entries

### #1 — `<Sat HH:MM>` · `<name>` · `<task id, e.g. B3>`

- **Prompt** (paste it, trimmed):
  > …
- **What Codex produced:** …
- **What we kept:** …
- **What we changed or threw away, and why:** …
- **Outcome** (time saved, bug caught, test that now exists — with a commit hash or file path): …

### #2 — `<Sat HH:MM>` · `<name>` · `<task id>`

- **Prompt:**
  > …
- **What Codex produced:** …
- **What we kept:** …
- **What we changed or threw away, and why:** …
- **Outcome:** …

### #3 — `<Sat HH:MM>` · `<name>` · `<task id>`

- **Prompt:**
  > …
- **What Codex produced:** …
- **What we kept:** …
- **What we changed or threw away, and why:** …
- **Outcome:** …

<!-- Copy the block above for each new entry. Never edit an old entry to make it sound better — add a follow-up entry instead. -->


### B2 — 2026-09-19 · Bryan (BM) · menu builder

- **Prompt (trimmed):** Implement B2 with strict red → green, the $120/TR3 worked menu, bundles, alternatives, audit, ranking and final offers; preserve contracts and the worked formula test.
- **Produced:** `engine/src/menu.ts`, package exports, 14 menu tests; retained and adapted the pre-existing B2 draft to the requested API. First test failed on the old `main` API, then passed. Subsequent failing bundle, acceptance, final/gating, catalog-fact and list-rounding tests drove fixes.
- **Ambiguities:** `product/decision/audit` follows the user's API over the older Part B build notes. $140 on TR2 round 3 accepts, so the alternative test uses $125. Non-whole-dollar accepted offers round upward. Cost/floor failures drop. Explicit bundle and alternative formulas conflict with three literal §6.2 properties; recorded in `part-b-spec-notes.md` for B3 without changing SPEC. Unknown stock age carries no invented age fact; product type alone does not prove shared fit.
- **Review:** Standards and spec agents reviewed the diff; unsupported facts and unrounded public list totals were fixed with red/green regressions. The original worked-example floor loop is preserved.
- **Verification:** `pnpm test`: 43 passed, 200 ms; `pnpm typecheck`: green. No changes to contracts or `formulas.test.ts`.


### B3 — 2026-09-19 · Bryan (BM) · property tests

- **Prompt (trimmed):** Every engine clause of SPEC §6.2, 1,000 seeded runs, under ten seconds; never weaken tests. Owner then explicitly clarified raw-cent concession steps and bundle shoe-target safety, asked to remove the blocked reproducer and complete B3.
- **Produced:** Eleven replayable properties (seed 42, 1,000 each); arbitrary list > cost > 0 catalogs, ages 0–400/null, floors 0–100, offers 1¢–10×list, all rounds. Root `test:props`. B8 decline and B4 offer-id clauses are assigned to their owning suites by comment.
- **Red → green:** Original literal properties exposed contradictory spec clauses. After the owner's two explicit clarifications, strict raw-step tests failed on list 5¢ / cost 1¢ / age 75 / floor 0%: premature cent ceiling in `ask` distorted the curve. Removed that ceiling, preserving all shopper rounding and the protected worked example. The bundle property then found shoe 3.339¢ below target 4¢ for a floor-above-list input; `menu.ts` now drops that unsafe bundle. No tolerance or skipped tests was used.
- **Ambiguities resolved:** Steps shrink before rounding; rounded published asks never increase and round four equals rounded target. Held/final/else preserve cart target; bundles preserve main shoe target plus cart cost/floor. Above-list floors remain in generated inputs and must not publish unsafe quotes; raw discount-curve assertions apply where floor ≤ list. The no-lower-counter rule governs same-product A/acceptance; explicit replacement-cart pricing still permits cheaper alternatives. Details and concrete counterexamples are in `part-b-spec-notes.md`.
- **Correction received:** Read the updated goal file and `CODEX-READ-THIS-BEFORE-TASK-3.md`. Next commit aligns B2 names with PART-B-BUILD; B11 will use its exact persona table, single-policy API, layout functions and regenerated fixture. No model parameters have been tuned.
- **Verification/review:** `pnpm test:props`: 11 passed / 11,000 runs, 238 ms Vitest / **0.51 s wall**; `pnpm test`: 54 passed, 299 ms; typecheck green. Standards/spec reviews performed. Contracts and `formulas.test.ts` unchanged. B2 commit: `127af9f`.

- **Owner SPEC amendment received before B11:** §6.2 now explicitly drops carts with floor above list, including acceptance, and includes bundles in the same-product offer bound. Two further seeded red cases (27¢ list / 28¢ floor; 1700¢ bundle below a rounded 1800¢ offer) drove the corresponding menu guards. Included the owner-authored SPEC change in this B3 commit.


### B2 naming alignment — 2026-09-19 · Bryan (BM)

- **Owner correction:** Follow PART-B-BUILD Step 6 so teammates use the same engine boundary. Renamed inputs to `main` plus explicit `addOns`, and results to `outcome` / `internals`. All prior assertions and pricing behavior are preserved; callers now pass the exact add-ons previously derived from their catalogs.
- **Red → green:** New API test first failed typecheck on the former `product` input. All 54 tests and typecheck pass after the rename. No contracts changed. This is the separately requested rename-only implementation commit; B3 and its owner-authored SPEC clarification are in `6c35065`.


### B11 — 2026-09-19 · Bryan (BM) · Gym run and layout

- **Prompt (trimmed):** Follow the corrected Task 3 and PART-B-BUILD §§A/8/9: exact persona rates/ranges, seeded single-policy run, compare, settle/frame, real fixture, <50 ms, and banner crossover.
- **Produced:** Pure `rng.ts`, `personas.ts`, `run.ts`, `layout.ts`; exported `runGym`, `compare`, `settle`, `frame`, `PERSONAS` and types. Engine `auditAccepted` and `addOnPart` supply the missing accepted-result audit and shared add-on arithmetic, so Gym/core never duplicate live pricing. Replaced the workspace tracer with real imports/tests; regenerated and pinned `fixtures/seed42.json`.
- **Red → green:** First test called the absent run through `gymResultProblems`. Further cycles drove comparison/layout/export/fixture behavior. Review found a real bundle bug: checking only the highest-ranked bundle discarded affordable lower-ranked bundles; the first qualifying bundle in engine rank is now selected. A reordered-shopper regression fixed the final ask line incorrectly depending on the last shopper's shorter transcript. A yellow-dot test fixed would-ask positions while preserving bought histogram counts.
- **Owner correction applied:** Single-policy `{main,addOns,floorPct,askOwner,seed,n,now}` API replaces the original A/B wrapper; exact §A probabilities replace boolean temptation; offer ramp divides by patience, threshold uses willingness + 0.6×add-on list; scope is one main product, no recommendations. Added layout and fixture regeneration. The correction file was read and removed on completion as requested. B2 naming alignment is `ef1d4ba`.
- **Ambiguities:** "Best bundle" means best owner-ranked qualifying bundle, without changing personas or thresholds. Yellow `settled` means a final animation position, not a purchase; yellow dots occupy the thin-margin band, outside bought counts. `frame` uses only observed asks, holding the latest observed one if everyone exits early. The single-policy plan specializes SPEC's A/B comparison: callers run each policy and call `compare`. No remaining B2 behavior conflict beyond the owner-resolved §6.2 clauses. The plan's original cent-valued examples yield to SPEC's upward whole-dollar display rule.
- **Real fixture differences:** Same 195 bought and 30 bundle trades; now avgAgreed 13662¢ (was 13656), profitVsBanner +209140¢ (was +208140), wouldAskOwner 20 (was 19), dealsMissed 76; accepted/held/bundle/final = 29/118/30/18. These are outputs of the real seeded run, not tuned targets. No fixture-test literal was weakened or changed; all previous invariants/UI-state assertions still pass, plus exact regeneration equality.
- **Verification/review:** `pnpm test` **67/67**, 349 ms; typecheck green. Warmed 300-shopper run **2.43 ms** on Node/Vitest. Seed 42 / TR2 / fixed now: floor **42%** is first negative vs banner, 25% positive. 100 seeded layout property runs cover population/seed/floor variation; final frame exactly equals settle and every shopper appears once. Spec and standards reviews passed; engine helpers remain pure. Contracts and protected worked example unchanged.
