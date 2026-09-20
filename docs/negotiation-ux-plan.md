# Negotiation UX plan

Draft from the 2026-09-19 critique of the shopper chat (score 19/40). Not yet in the tracker: per `AGENTS.md`, these tasks move into `docs/PLAN.md` §4 after a `mattpocock-skills:grilling` pass, with behaviour changes landing in `docs/SPEC.md` in the same commit.

Evidence: `.impeccable/critique/2026-09-20T02-57-38Z__apps-storefront-assets-chat-demo-js.md`. Current state, the approved prototype and the prompt for the next agent: [`negotiation-ux-handoff.md`](negotiation-ux-handoff.md).

**Status, Sun 20 Sep 00:50:** every task below is built except task 2, which is skipped on purpose (specified behaviour). Tasks 1 and 3 are pushed (`093c92d`). Tasks 4–8 sit **uncommitted in the working tree**, 301 tests and typecheck green. The theme half is already live: it was pushed to the live Shopify theme `161251000517` and checked on the real product page. The server half (engine, server, prompt) reaches shoppers only once it is committed and pushed to `main` and Railway deploys it — see "What is left" at the end.

Decisions made: Phase 1 then Phase 2; the shopkeeper is a warm trail-shop owner; superseded offers collapse to one line; **look A, "Trail chat"**, from the prototype; the shopkeeper is called **Juniper**; voice is part of the design.

Two agents built Phase 2 side by side and split the files: one owned the four chat files (`layout/theme.liquid`, `assets/critical.css`, `assets/chat-demo.js`, `apps/web/src/theme-integration.test.ts`), the other owned `packages/*`, `apps/server/*`, `sections/product.liquid`, `infra/seed`, `scripts/chat-walkthrough` and these docs.

## Gate — prototype the look first — passed

Look A of the prototype (https://claude.ai/artifact/264h2oq8KSsGVhWYJMD1UB) is the approved look. The original gate, for the record: before any theme work in tasks 3, 4, 5 or 6, the look is shown as a throwaway `mattpocock-skills:prototype`: the launcher, the open chat, a live offer card, collapsed old offers, the thinking state and the final round, at desktop and phone widths, against `docs/SPEC.md` §12. Bryan approves the look; only then does it get built into `apps/storefront`. The server fix in task 1 does not wait on this.

## Phase 1 — make the haggle unbreakable

### 1. Off-script messages stay in the negotiation — server, `tdd` — done (`093c92d`)
- Today "what's the best you can do?" during a live offer returns a weekend-outfit pitch.
- Cause, in `apps/server/src/application.js`: `isOfferIntent` (`:1625`) misses the phrase; `fallbackReply` (`:1618`) returns the outfit line whenever the catalogue is loaded.
- Done when: a shopper with a live offer sends that phrase and gets the current card back with a line saying what would move the price, and no round is spent.
- Follow-up from the code review of `093c92d`: a bare number after haggling words (*"can you go lower? 120"*) was swallowed as a question and the shopper's number was lost. It is now read as an offer at that number (`parseMoney`, tests in `application-off-script.test.ts`).

### 2. A paused store still answers questions — server, `tdd` — skipped on purpose
- Today every message, including a sizing question, gets "The owner's paused deals — list price stands."
- **This is specified behaviour, not a bug:** `docs/SPEC.md` §3 rule 8 says "PAUSE wins instantly. Next message on any surface" gets that line. Changing it is a spec change, so it needs the team's agreement first. Default: leave it.
- Done when (only if the team agrees): with deals paused, a sizing question gets a normal answer and only an offer gets the pause line; SPEC §3 rule 8 is reworded in the same commit.

### 3. The offer card fits the chat window — theme, `impeccable layout` — done (`093c92d`)
- Today the card is 397px tall and the message pane is 304px (`apps/storefront/assets/critical.css:208`), so round, countdown, title and items are clipped on every offer at both viewports.
- Changes: message pane about 60svh; panel full height on phones; quick prompts hidden once an offer exists; items on one line; the new card's top scrolled into view; Deal becomes a full-width "Deal at $145" button and View item becomes a link.
- Done when: at 1440×900 and 390×844 the whole live card, from round label to Deal button, is visible without scrolling the pane.

## Phase 2 — give the shopkeeper a character

### 4. Shopkeeper identity — theme, `impeccable delight` + `animate` — done
- A name and a drawn mark replace the generic speech-bubble icon: in the launcher, the header, and beside each reply.
- The mark changes with the `mood` field the card already carries.
- An animated thinking state replaces the static "Thinking..." text (replies take 3.5–7.7s).
- Header and launcher copy stop saying "AI chat" / "LIVE AI + OFFERS"; the dead "Voice needs setup" pill is hidden when voice is unavailable.
- Voice: warm trail-shop owner — plain-spoken, a little wry, talks about runs and gear. The Backboard prompt already says "warm, quick, and a little cheeky, like a market trader rather than a call centre" (`packages/llm/src/backboard.ts:7`); the gap is the code fallback lines in `packages/engine/src/negotiate.ts` (`reasonPrefix` `:269`, counter line `:131`), which is where "That gives me something to work with (quantity intent)" comes from.
- Look: `docs/SPEC.md` §12 already decides it — "the shopkeeper is a die-cut sticker", "the haggle is a trail", palette teal `#004c4c` · coral `#f3675a` · sun `#f6d809` · cream `#fdf3e3`, type Satoshi/Fredoka. The theme today uses spruce and orange instead. All design work is judged against §12.
- Done when: a first-time shopper can tell from the closed launcher that this is a shopkeeper who takes offers.
- Built: the launcher is the die-cut sticker with the words "Make an offer"; the header reads "Juniper — Trailhead's AI shopkeeper. Takes offers." (SPEC §3 rule 10: it says what it is); the sticker sits beside every reply and its face follows the card's `mood` (the server now sends `offended` on a lowball; the last round is firm); "Doing the maths" with walking dots replaces "Thinking..."; SPEC §12 palette, Fredoka and Satoshi as theme assets; the mic and speaker are hidden when `/api/voice/config` says voice is unavailable; listening bar with a waveform and stop-and-send; "Reading this aloud · Stop" on a spoken reply.
- Voice of the lines: the engine's fallback lines are rewritten (`SHOPPER_WORDS` and the lines in `packages/engine/src/negotiate.ts`), and both Backboard prompts now open "You are Juniper, the AI shopkeeper of Trailhead Co…".

### 5. Suggestions built for haggling — server (`tdd`), theme (`impeccable onboard`) — done
- Partly done by Ritvik in `1559e36`: placeholder is now "Make an offer...", and the static chips are "Make it $5 less", "Student discount", "Gift me socks".
- Still open: the chips never change once an offer lands, and "$5" is hardcoded in the theme.
- The public card has no field for suggestions today (`packages/contracts/src/index.ts:14-20`). Cheapest route: post-offer chips with no dollar figures, which needs no contract or engine change.
- Before an offer: chips like "I'm buying two", "Student budget".
- After an offer: "Meet in the middle?", "Is that your best?", "Add socks?".
- Every dollar figure on a chip comes from `packages/engine` (invariant 1) and travels inside the public card only (invariant 3).
- Done when: the chips change after the first offer, and a property test shows every chip amount is an engine figure above cost.
- Built, by the cheapest route: **a chip never carries a dollar figure**, so there is no chip amount to prove anything about and no contract or engine change. "Make it $5 less" is gone. After an offer: "Is that your best?", "Meet me in the middle", "What would move it?" (the server learned that phrase), and "Skip the add-on" when the card has one; the last round shows fewer. The check that stands in for the property test is in `theme-integration.test.ts`: the chips change after the first offer, and no chip label or prompt contains `$` or a digit.

### 6. Card copy and conversation shape — theme + server + engine, `impeccable clarify` — done
- Shopper language replaces "reason: quantity intent", "bundle value", "Shop $161", "Round 2 $40".
- The reason shown matches what the shopper actually said, or is dropped.
- The $167 anchor is explained as shoes $149 + socks $18.
- The "qty 1Merino Socks" separator bug is fixed.
- Superseded cards collapse to a one-line row ("Round 1 · $161").
- Replies reference the shopper's stated reason instead of "I can do $145 for both".
- The final round looks and sounds different, so the demo has an ending.
- Done when: no engine vocabulary appears on any shopper surface across the six-turn walkthrough.
- Built. Badges are in the shopper's words (`for a tight budget`, `for a bigger cart`, `needs a reason`, `final offer`); `bundle value`, `seller counter`, `good intent`, `missing cost` and `reason: x` are gone. The reason shown is the one given in **this** message (`leadWithStatedReason`); an earlier one stands only when this message gives none. The price trail reads List price → You offered → My price. Every card item carries `listPrice`, so the card shows "Trail Runner 2 · size 9 · qty 1 · list $149" and the $167 anchor explains itself; the theme formats the figure and adds nothing up. The "qty 1Merino Socks" separator bug is gone (items are a list).
- Replies that answer the shopper: the wording check lets the model say only the price sentence, so **code** answers the reason in front of it (`reasonReply`: *"A tight budget. I've been there. I can do $151 for both."*) and closes the last round (*"That's the last stop on this trail."*). Both are fixed strings with no figure. SPEC §3 rule 5 and §5.1 step 7 say so.
- The final round is a sun-yellow card labelled "Final offer · round N of N"; `pending_owner` is labelled "With the owner". A card's line is hidden while it only repeats the bubble above it, and shown when a poll changes it (owner approve or decline).
- Proof: the six-turn walkthrough is a server test (`application-off-script.test.ts`), and the card's rendering is checked in `theme-integration.test.ts`.

## Stretch — only if time allows

### 7. The product page invites the haggle — done, one human step left
- A "Make an offer" button beside Add to cart opens the chat with the input focused.
- The Trail Runner 2 description stops showing internal merchandising copy ("A strong recommendation when a shopper...").
- Built: the button is in `sections/product.liquid` beside Add to cart (any `data-ai-chat-open` element opens the chat and focuses the message box); a hint under it replaces the old callout, which said "never below the shop floor" — owner vocabulary.
- The description is store data, not theme. All eight descriptions in `infra/seed/trailhead-products.csv` — the Description and the SEO description columns — are rewritten for shoppers (Trail Runner 3's even said "price stays firm; bundles only"). **The live store still shows the old copy until a human edits the product descriptions in Shopify admin** or re-imports the CSV.

### 8. Accessibility — `impeccable audit` — done
- Panel gets a role to go with its label.
- The countdown gets a label and stops being re-announced every second inside the live region.
- Eight controls go from 40px to 44px tall.
- Card footer and struck price move off the 4.55:1 contrast edge.
- Reduced-motion covers the new animations.
- Built: the panel has `role="region"` with its label; the countdown is `aria-live="off"` inside the polite log and is prefixed "Held for" / "Owner replies within"; every control is at least 44px; the struck price and the card footer are above 4.5:1; one `prefers-reduced-motion` rule covers every `.ai-chat` animation and transition.

## Who owns what (`docs/PLAN.md` ownership table)

- `apps/storefront` — Ritvik (tasks 3, 4, 6 theme side, 7, 8).
- `apps/server` — Ricardo (tasks 1, 2).
- `packages/engine` — Bryan (fallback lines in task 4 and 6, any chip amounts in task 5).
- Neither the theme nor the Railway server is published yet (`docs/DEMO.md:7`); none of this reaches the demo until both are.

## Open questions — answered

1. Chip amounts: none. A chip never carries a figure, so no field was needed for chips. One field **was** added to the public card for task 6: `Option.items[].listPrice?` (one unit's public list price, in cents). It is additive and optional, it is a price already printed on the storefront, and it stays inside `PublicOption` because it lives on `items`. This is a change to `packages/contracts` — said out loud here, per PLAN rule zero.
2. A price-move question during a live offer restates the card and never spends a round (task 1). Any other unrecognised message is still answered as a question.
3. Both, plus one more place: the engine's fallback lines, the Backboard prompt, and code's reply to the shopper's reason in front of the model's sentence.

## What is left

- **Commit and push.** Nothing from tasks 4–8 is committed. Pushing to `main` redeploys the live server hours before the demo, so it waits for Bryan's word. The theme is already live, and it was written to keep working against the older server: every new field is optional.
- **Railway.** At the last check the live server was still serving code from before `093c92d` (a live card showed the `bundle value` badge). Until Railway deploys `main`, shoppers see the new look with the old wording.
- **Shopify admin.** Edit the eight product descriptions (copy is in `infra/seed/trailhead-products.csv`).
- **Known leftover.** A lowball reply mints a new offer at the same round, so two collapsed rows can read the same round and total. Round accounting was left alone; decide with Bryan.
- `mattpocock-skills:code-review` has run on `093c92d` (one bug found and fixed, above) and on the Phase 2 server and engine diff (it caught a shoe size being read as a $10 offer, *"can you go lower, I wear a 10?"*, and the SEO description column of the seed CSV still holding the internal copy; both fixed and tested). `impeccable polish` on the live theme is the last pass, if there is time.

## Every task

`mattpocock-skills:code-review` on the diff, box ticked in `docs/PLAN.md` in the same commit, then re-verify in the real store with `run` + `claude-in-chrome`. `impeccable polish` is the last pass.
