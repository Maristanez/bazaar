# Negotiation UX plan (draft)

Draft from the 2026-09-19 critique of the shopper chat (score 19/40). Not yet in the tracker: per `AGENTS.md`, these tasks move into `docs/PLAN.md` §4 after a `mattpocock-skills:grilling` pass, with behaviour changes landing in `docs/SPEC.md` in the same commit.

Evidence: `.impeccable/critique/2026-09-20T02-57-38Z__apps-storefront-assets-chat-demo-js.md`.

Decisions already made: Phase 1 then Phase 2; the shopkeeper is a warm trail-shop owner; superseded offers collapse to one line.

## Gate — prototype the look first

Before any theme work in tasks 3, 4, 5 or 6, the look is shown as a throwaway `mattpocock-skills:prototype`: the launcher, the open chat, a live offer card, collapsed old offers, the thinking state and the final round, at desktop and phone widths, against `docs/SPEC.md` §12. Bryan approves the look; only then does it get built into `apps/storefront`. The server fix in task 1 does not wait on this.

## Phase 1 — make the haggle unbreakable

### 1. Off-script messages stay in the negotiation — server, `tdd`
- Today "what's the best you can do?" during a live offer returns a weekend-outfit pitch.
- Cause, in `apps/server/src/application.js`: `isOfferIntent` (`:1625`) misses the phrase; `fallbackReply` (`:1618`) returns the outfit line whenever the catalogue is loaded.
- Done when: a shopper with a live offer sends that phrase and gets the current card back with a line saying what would move the price, and no round is spent.

### 2. A paused store still answers questions — server, `tdd`
- Today every message, including a sizing question, gets "The owner's paused deals — list price stands."
- **This is specified behaviour, not a bug:** `docs/SPEC.md` §3 rule 8 says "PAUSE wins instantly. Next message on any surface" gets that line. Changing it is a spec change, so it needs the team's agreement first. Default: leave it.
- Done when (only if the team agrees): with deals paused, a sizing question gets a normal answer and only an offer gets the pause line; SPEC §3 rule 8 is reworded in the same commit.

### 3. The offer card fits the chat window — theme, `impeccable layout`
- Today the card is 397px tall and the message pane is 304px (`apps/storefront/assets/critical.css:208`), so round, countdown, title and items are clipped on every offer at both viewports.
- Changes: message pane about 60svh; panel full height on phones; quick prompts hidden once an offer exists; items on one line; the new card's top scrolled into view; Deal becomes a full-width "Deal at $145" button and View item becomes a link.
- Done when: at 1440×900 and 390×844 the whole live card, from round label to Deal button, is visible without scrolling the pane.

## Phase 2 — give the shopkeeper a character

### 4. Shopkeeper identity — theme, `impeccable delight` + `animate`
- A name and a drawn mark replace the generic speech-bubble icon: in the launcher, the header, and beside each reply.
- The mark changes with the `mood` field the card already carries.
- An animated thinking state replaces the static "Thinking..." text (replies take 3.5–7.7s).
- Header and launcher copy stop saying "AI chat" / "LIVE AI + OFFERS"; the dead "Voice needs setup" pill is hidden when voice is unavailable.
- Voice: warm trail-shop owner — plain-spoken, a little wry, talks about runs and gear. The Backboard prompt already says "warm, quick, and a little cheeky, like a market trader rather than a call centre" (`packages/llm/src/backboard.ts:7`); the gap is the code fallback lines in `packages/engine/src/negotiate.ts` (`reasonPrefix` `:269`, counter line `:131`), which is where "That gives me something to work with (quantity intent)" comes from.
- Look: `docs/SPEC.md` §12 already decides it — "the shopkeeper is a die-cut sticker", "the haggle is a trail", palette teal `#004c4c` · coral `#f3675a` · sun `#f6d809` · cream `#fdf3e3`, type Satoshi/Fredoka. The theme today uses spruce and orange instead. All design work is judged against §12.
- Done when: a first-time shopper can tell from the closed launcher that this is a shopkeeper who takes offers.

### 5. Suggestions built for haggling — engine + server (`tdd`), theme (`impeccable onboard`)
- Partly done by Ritvik in `1559e36`: placeholder is now "Make an offer...", and the static chips are "Make it $5 less", "Student discount", "Gift me socks".
- Still open: the chips never change once an offer lands, and "$5" is hardcoded in the theme.
- The public card has no field for suggestions today (`packages/contracts/src/index.ts:14-20`). Cheapest route: post-offer chips with no dollar figures, which needs no contract or engine change.
- Before an offer: chips like "I'm buying two", "Student budget".
- After an offer: "Meet in the middle?", "Is that your best?", "Add socks?".
- Every dollar figure on a chip comes from `packages/engine` (invariant 1) and travels inside the public card only (invariant 3).
- Done when: the chips change after the first offer, and a property test shows every chip amount is an engine figure above cost.

### 6. Card copy and conversation shape — theme + server, `impeccable clarify`
- Shopper language replaces "reason: quantity intent", "bundle value", "Shop $161", "Round 2 $40".
- The reason shown matches what the shopper actually said, or is dropped.
- The $167 anchor is explained as shoes $149 + socks $18.
- The "qty 1Merino Socks" separator bug is fixed.
- Superseded cards collapse to a one-line row ("Round 1 · $161").
- Replies reference the shopper's stated reason instead of "I can do $145 for both".
- The final round looks and sounds different, so the demo has an ending.
- Done when: no engine vocabulary appears on any shopper surface across the six-turn walkthrough.

## Stretch — only if time allows

### 7. The product page invites the haggle
- A "Make an offer" button beside Add to cart opens the chat with the input focused.
- The Trail Runner 2 description stops showing internal merchandising copy ("A strong recommendation when a shopper...").

### 8. Accessibility — `impeccable audit`
- Panel gets a role to go with its label.
- The countdown gets a label and stops being re-announced every second inside the live region.
- Eight controls go from 40px to 44px tall.
- Card footer and struck price move off the 4.55:1 contrast edge.
- Reduced-motion covers the new animations.

## Who owns what (`docs/PLAN.md` ownership table)

- `apps/storefront` — Ritvik (tasks 3, 4, 6 theme side, 7, 8).
- `apps/server` — Ricardo (tasks 1, 2).
- `packages/engine` — Bryan (fallback lines in task 4 and 6, any chip amounts in task 5).
- Neither the theme nor the Railway server is published yet (`docs/DEMO.md:7`); none of this reaches the demo until both are.

## Open questions

1. Chip amounts: a new field on the public card? Does it stay inside `PublicOption`?
2. An unrecognised message during a live offer: restate the card, and never spend a round?
3. The persona's voice: server template lines, the Backboard prompt, or both?

## Every task

`mattpocock-skills:code-review` on the diff, box ticked in `docs/PLAN.md` in the same commit, then re-verify in the real store with `run` + `claude-in-chrome`. `impeccable polish` is the last pass.
