# Negotiation UX — handoff

Written Sat 19 Sep 2026, late evening; state updated Sun 20 Sep 00:50. The plan is now built: read "State" below and the "What is left" section of the plan. The block under "Prompt for the next agent" is the prompt Phase 2 was built from, kept for the record; it no longer describes open work.

## Where everything is

| Thing | Location |
|---|---|
| The plan (tasks 1–8, owners, gate) | [`negotiation-ux-plan.md`](negotiation-ux-plan.md) |
| The critique behind it (19/40, priority issues, personas) | `.impeccable/critique/2026-09-20T02-57-38Z__apps-storefront-assets-chat-demo-js.md` |
| The approved look, clickable, with voice | https://claude.ai/artifact/264h2oq8KSsGVhWYJMD1UB — private to Bryan's account until shared from the page's Share menu |
| Browser walkthrough harness | [`scripts/chat-walkthrough/`](../scripts/chat-walkthrough/README.md) |
| Phase 1 code | commit `093c92d` on `main`, pushed |

## State

- **Done and pushed:** task 1 (off-script haggling restates the card, no round spent) and task 3 (card fits the pane, "Deal at $X", replaced offers collapse to a row), `093c92d`.
- **Done, uncommitted in the working tree:** tasks 4–8, plus the bug the code review of `093c92d` found (a bare number after haggling words was swallowed as a question). 301 tests and typecheck green. What each task built is written under that task in the plan.
- **Live:** the theme, pushed to the live Shopify theme `161251000517` and checked on the real product page. How to change, test and deploy it: [`apps/storefront/README.md`](../apps/storefront/README.md).
- **Not live:** the server half (engine wording, shopper-language badges, `listPrice`, the `offended` mood, the Juniper prompt). It needs a commit and a push to `main`, and Railway was still serving code from before `093c92d` at the last check. The theme works against the older server: every new card field is optional.
- **Human steps left:** Bryan's word to commit and push; the Railway deploy; the eight product descriptions in Shopify admin (copy in `infra/seed/trailhead-products.csv`).
- **Skipped on purpose:** task 2. `SPEC.md` §3 rule 8 specifies the pause line.
- **Decided by Bryan:** Phase 1 then Phase 2; warm trail-shop owner persona; replaced offers collapse to one line; voice chat is part of the design; prototype the look before building it; **look A, "Trail chat"**; the shopkeeper is called **Juniper**.

## Where a change goes

| Changing | Build in | Reaches the live site by |
|---|---|---|
| What the shopper sees: panel, card, sticker, product page | `apps/storefront/` | `shopify theme push` |
| What the shopkeeper does: routing, rounds, accept, voice endpoints | `apps/server/` | push to `main` (Railway) |
| Every price, and the code fallback lines | `packages/engine/` | ships inside the server |
| The shopkeeper's wording when the model answers | prompt in `packages/llm/src/backboard.ts`; assistant + documents in the Backboard dashboard | prompt with the server; the rest by hand |
| Owner Console | `apps/web/` | built and served by the server |

If the theme needs a new field on the card, ship the server first.

## Prompt for the next agent

```
You are continuing UX work on "The Bazaar", a Make-an-offer AI shopkeeper for one Shopify store (Hack the North 2026, final submit Sun 20 Sep 08:00 EDT). Repo: /Users/bryanmaristanez/Documents/3rd year/hackathons/Hack The North/ideas/bazaar (pnpm workspace, Node >= 22, branch main, remote origin = github.com/Maristanez/bazaar).

READ FIRST, in this order: AGENTS.md (repo rules and the 7 invariants), docs/negotiation-ux-handoff.md (state and where things are), docs/negotiation-ux-plan.md (the plan you are executing), .impeccable/critique/2026-09-20T02-57-38Z__apps-storefront-assets-chat-demo-js.md (the critique behind it, score 19/40), docs/SPEC.md §4.1 (offer card), §4.2 (storefront chat), §12 (look and feel).

## What is already done
- Phase 1 is committed and pushed to origin/main as 093c92d:
  - Task 1 (server): "what's the best you can do?" and similar phrases during a live offer return the current card with a line saying what would move the price; no round is spent. See isPriceMoveQuestion and standingOfferReply in apps/server/src/application.js, tests in apps/server/src/application-off-script.test.ts.
  - Task 3 (theme): the offer card fits the message pane at 1440x900 and 390x844, Deal is a full-width "Deal at $X" button, replaced offers collapse to a "Round N · $X" row, quick prompts hide once an offer exists, all controls >= 44px. Palette and fonts were deliberately NOT changed.
  - Task 2 was SKIPPED on purpose: docs/SPEC.md §3 rule 8 specifies that a paused store answers every message with the pause line. Do not change it.
- 278 tests and typecheck were green at that commit. mattpocock-skills:code-review has NOT been run on 093c92d; run it before building on top, and fix anything real it finds.
- A teammate (Ritvik) already changed the chat placeholder to "Make an offer..." and the static quick prompts to "Make it $5 less" / "Student discount" / "Gift me socks" (commit 1559e36). Keep that copy unless the plan replaces it.
- The server half is pushed (Railway deploys from main). The THEME is NOT published to Shopify yet: that needs `shopify theme push` from apps/storefront with a human login to b8wzw0-h3.myshopify.com. Do not attempt the login yourself; ask Bryan.

## The approved look
A clickable prototype of the new look is published at https://claude.ai/artifact/264h2oq8KSsGVhWYJMD1UB (read it with the Artifact tool, action "read"). Bryan said "this is a good design" and asked for voice to be included, which it now is. It has three looks (A Trail chat, B Deal slip, C Trail map). Bryan has NOT said which look he picked. His earlier choices (card stays in the conversation, replaced offers collapse to one line) match look A. CONFIRM THE LOOK WITH BRYAN BEFORE BUILDING; if he is unreachable, build A.
Decisions already made by Bryan: persona is a warm trail-shop owner (plain-spoken, a little wry, talks about runs and gear); replaced offers collapse to one line; voice chat must be part of the design.
Placeholders in the prototype that are NOT decisions: the name "Juniper", DM Sans (stand-in for Satoshi, which SPEC §12 specifies and the server serves from /fonts/), the round-4 figure $141, and the line "shoes $149 + socks $18" (the public card carries no per-item prices today).

## What to build: Phase 2, then stretch (tasks 4-8 in docs/negotiation-ux-plan.md)
4. Shopkeeper identity (theme): die-cut sticker mark in the launcher, header and beside replies; mood driven by the card's existing `mood` field; animated thinking state (replies take 3.5-7.7s); replace "AI chat" / "LIVE AI + OFFERS" copy; SPEC §12 palette (teal #004c4c, sky #ccffff, coral #f3675a, sun #f6d809, pink #ff598b, bark #2f1604, cream #fdf3e3) and type (Fredoka headings, Satoshi body). Coral needs bark text, not white, to pass contrast.
   Voice, as in the prototype: a speaker toggle in the header, a mic button beside Send, a "listening" composer state with waveform and a stop-and-send button, and a "reading this aloud" indicator with Stop on the spoken reply. This restyles controls that already exist in apps/storefront/assets/chat-demo.js (voiceToggle, micButton, startRecording, speakReply; ElevenLabs endpoints /api/voice/config, /speak, /transcribe). New decision to implement: when /api/voice/config says voice is unavailable, hide the mic and speaker entirely instead of showing "Voice needs setup".
5. Suggestion chips that change after an offer (before: "I'm buying two", "Student budget"...; after: "Is that your best?", "Meet me in the middle", "Skip the socks", "What would move it?"; final round: fewer). Cheapest route: chips carry NO dollar figures, so no contract or engine change. If a chip must show an amount, the figure comes from packages/engine and travels on the public card only (invariants 1 and 3), built with tdd.
6. Card copy and conversation shape: replace engine vocabulary shown to shoppers ("reason: quantity intent", "bundle value", "Shop $161", "Round 2 $40"); the reason shown must match what the shopper said or be dropped; give the final round a distinct look; make fallback lines sound like the persona. The robotic fallback lines come from packages/engine/src/negotiate.ts (reasonPrefix ~line 269, counter line ~131). The LLM voice is the prompt at packages/llm/src/backboard.ts lines 7-23, which already says "warm, quick, and a little cheeky, like a market trader". Badges are ready-made strings from the server because the card never receives `facts` (SPEC rule 11).
7. (stretch) "Make an offer" button beside Add to cart in apps/storefront/sections/product.liquid that opens the chat with the input focused; fix the Trail Runner 2 description, which shows internal merchandising copy.
8. (stretch) Accessibility: the panel has aria-labelledby but no role; the countdown rewrites every second inside an aria-live region with no label; card footer and struck price sit at 4.55:1; reduced-motion must cover new animation.

## Rules that bind you (from AGENTS.md)
- Invariant 1: every dollar figure a shopper sees originates in packages/engine. Never compute or invent a price in the theme JS or in server reply text; reuse figures already on the card. Invariant 3: shopper surfaces get the public card only. Invariant 5: every LLM call keeps its timeout and code fallback.
- Code work goes through mattpocock-skills:tdd (the task's "Done when" line is the first failing test). UI work goes through the `impeccable` skill, judged against SPEC §12; read its reference/craft-floor.md before editing theme CSS. Suggested sub-commands: delight + animate (task 4), onboard (5), clarify (6), audit (8), polish last; polish picks up the saved critique automatically.
- Where things deploy: apps/storefront -> `shopify theme push` (human login); apps/server, packages/*, apps/web -> push to main (Railway); the Backboard assistant and its documents are set up by hand in the Backboard dashboard and are never deployed from the repo. If the theme needs a new card field, ship the server first.
- A task is done when its check passes, tests and typecheck are green, its box is ticked in docs/PLAN.md in the same commit, and mattpocock-skills:code-review has run. The plan's tasks are NOT in docs/PLAN.md yet; AGENTS.md asks for a mattpocock-skills:grilling pass before a plan change lands there. Ask Bryan whether to do that or keep working from docs/negotiation-ux-plan.md.
- Ownership per docs/PLAN.md: apps/storefront is Ritvik's, apps/server is Ricardo's, packages/engine is Bryan's. Pull before you start and expect teammates to be editing the same files.
- The working tree may hold a teammate's UNCOMMITTED edits to README.md, docs/ARCHITECTURE.md, docs/PLAN.md and docs/SPEC.md (notes that the Backboard agent is not deployed from the repo). Do not stage, revert or overwrite them; stage your own files by name.
- Commit to main only when Bryan asks; ask before pushing, because a push redeploys the live server hours before the demo. End commit messages with: Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>

## How to see your work in a browser
- Use scripts/chat-walkthrough/ (read its README.md). It starts this repo's server on :3217 with an in-memory owner policy and drives a six-turn negotiation on the live product page with the LOCAL theme chat swapped in, writing screenshots and a log per turn. Turn 5 is "what is the best you can do?".
- Why the in-memory policy: the shared Supabase owner policy is currently PAUSED, so any server using it answers every message with "The owner's paused deals — list price stands." Do not unpause it.
- A different checkout's server may be listening on :3000; leave it alone.
- NEVER click the "Deal" button in a browser test: it mints a real Shopify discount and checkout.
- Verify in bounded passes: build, one batched look at desktop 1440x900 and phone 390x844 together, fix everything in one batch, at most one confirming look.

## Known leftovers you may hit
- A lowball reply mints a new offer at the same round, so two collapsed rows can both read "Round 2 · $151". Existing behaviour; decide with Bryan before changing round accounting.
- A restated card keeps its previous line inside the card.
- Button strings "Deal needs API" and "Minting..." can surface to shoppers.
- The live store's console logs a 404 on load (not investigated).
- docs/SPEC.md §4.1 still says an older card "greys out as superseded"; the theme now collapses it to a row. Update that wording in the same commit as your next SPEC change, once the teammate's uncommitted SPEC edits have landed.

Start by: git pull, read the files listed at the top, run `pnpm test` and `pnpm typecheck` to confirm a green baseline, run mattpocock-skills:code-review on 093c92d, then confirm the look with Bryan and begin task 4.
```
