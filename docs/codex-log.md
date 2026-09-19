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
