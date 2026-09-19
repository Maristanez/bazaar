# Codex log

**Why this file exists.** The OpenAI prize is judged on "what you built with the OpenAI API" **and** "how Codex helped you build it", and the demo must *"share one concrete way Codex improved your process or outcome."* OpenAI judges require **one concrete example in the demo** — this log is where it comes from. Keep it **from hour 0**; a log written on Sunday morning reads like one.

**How to use it.** One entry per real use, written at the time, by whoever ran it. Be specific: the actual prompt, what came back, what we kept, what we threw away. A bug Codex found is worth more than a file it wrote. Aim for at least three strong entries:

1. the engine's property tests (PLAN task B3)
2. the red-team script (B13)
3. one real bug it found

**Chosen for the demo sentence:** entry #____ — *"____________________________________________"* (decide by the Saturday-night checklist)

---

## Entries

### #1 — `Sat 09:10` · `Ritvik` · `S1 setup`

- **Prompt:**
  > I want to make a Shopify store. Scaffold the theme and prepare live preview against the development store.
- **What Codex produced:** A Shopify CLI-ready Skeleton theme, verified it with Theme Check, and added the theme to the Bazaar repository as `shopify-theme/`.
- **What we kept:** The isolated theme starter and its documented `shopify theme dev` command.
- **What we changed or threw away, and why:** We did not merge generated Liquid files into `apps/web`; the app's storefront task still depends on the shared contracts and should stay within the pnpm architecture.
- **Outcome:** `shopify-theme/` contains a clean Shopify Skeleton baseline; Theme Check inspected 39 files with no offenses.

### #2 — `Sat 09:32` · `Ritvik` · `S2 theme preview`

- **Prompt** (paste it, trimmed):
  > keep the plan.md updated with whatever you do. lets get closer to building the reality
- **What Codex produced:** A public-catalog bridge in the Shopify theme: Liquid emits published product names, prices, type, availability and URL into JSON; the scripted chat reads it before answering product and price questions.
- **What we kept:** The browser only receives public storefront data. The copy explicitly says private cost, floors, and discount codes require the server app.
- **What we changed or threw away, and why:** We did not pretend this is the real haggle. The Admin API/server path remains required for safe offers and checkout settlement.
- **Outcome** (time saved, bug caught, test that now exists — with a commit hash or file path): The demo widget now reflects live storefront prices while preserving the plan's security boundary.

### #3 — `<Sat HH:MM>` · `<name>` · `<task id>`

- **Prompt:**
  > lets build all of plan a
- **What Codex produced:** The first A-lane foundation slice: Trailhead seed fixtures, store notes, sizing guide, policy copy, current-product Liquid context, `localStorage` shopper identity with `?shopper=demo`, and a non-binding preview offer card in the Shopify chat.
- **What we kept:** The demo chat behaves closer to the planned storefront while still preserving the rule that only a server-generated card can be binding.
- **What we changed or threw away, and why:** We did not enable a fake Deal button. It stays disabled until R6/R7 can mint a real Shopify discount code and checkout permalink.
- **Outcome:** Plan A can now be demoed as a product-aware storefront preview while the tracker clearly shows the API credentials and server settlement blockers.

### #4 — `<Sat HH:MM>` · `<name>` · `<task id>`

- **Prompt:**
  > …
- **What Codex produced:** …
- **What we kept:** …
- **What we changed or threw away, and why:** …
- **Outcome:** …

<!-- Copy the block above for each new entry. Never edit an old entry to make it sound better — add a follow-up entry instead. -->
