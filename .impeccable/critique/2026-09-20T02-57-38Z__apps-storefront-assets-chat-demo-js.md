---
target: shopper negotiation chat and offer card
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
target_identity: "file:/Users/bryanmaristanez/Documents/3rd year/hackathons/Hack The North/ideas/bazaar/apps/storefront/assets/chat-demo.js"
target_fingerprint: "sha256:b455cf03463f367fe9d005578225a1ab9d0597423898c35eba3f3cb7a392bbd8"
target_path: /Users/bryanmaristanez/Documents/3rd year/hackathons/Hack The North/ideas/bazaar/apps/storefront/assets/chat-demo.js
timestamp: 2026-09-20T02-57-38Z
slug: apps-storefront-assets-chat-demo-js
---
Method: dual-agent (A: design review · B: detector + browser measurements). Evidence: Playwright walkthrough, 6 turns, 1440x900 and 390x844, local theme chat on the live product page, in-memory owner policy.

## Design Health Score: 19/40 (Poor, top of band)
1 Status 2 — "Thinking..." is static text for 3.5–7.7s; round + countdown scroll out of view.
2 Real-world match 1 — "reason: quantity intent", "bundle value", "Shop $161", "Round 2 $40" are engine words.
3 Control 2 — no counter/decline affordance on the card; dead "Voice needs setup" pill.
4 Consistency 2 — trail label flips "Your offer" -> "Round 2"; page says $149, card anchors on $167 unexplained.
5 Error prevention 2 — Deal is a 51x40 pill, no price on it; off-script messages misroute.
6 Recognition 2 — card top (items, round, timer) always clipped in a 304px pane.
7 Flexibility 1 — no haggle shortcuts.
8 Minimalism 2 — ~12 competing controls when an offer lands.
9 Recovery 3 — lowball reply is firm, fast (≈400ms) and invites a better number; but it duplicates the card.
10 Help 2 — 4-round limit and what Deal does are never explained.

## Verdict
Card content is authored (binding disclosure, trail, rounds, countdown). The shell is a generic support widget: "AI chat" launcher, "Ask about outfits..." placeholder, outfit/sizing/shipping prompts, no shopkeeper name, face or voice. Detector CLI: 0 findings; in-page overlay: 2 anti-patterns (names not printed).

## Priority issues
- P0 Off-script haggling gets an outfit pitch. "What is the best you can do?" -> weekend outfit. isOfferIntent (apps/server/src/application.js:1625) misses it; fallbackReply (:1618) returns outfitReply whenever products exist.
- P0 Offer card (397px) is taller than the message pane (304px, critical.css:208). Round, countdown, title, items are clipped on every offer, both viewports.
- P1 Engine jargon on the shopper card; the reason chip says "quantity intent" when the shopper said "student budget"; $167 anchor never explained as shoes $149 + socks $18; items line missing separator ("qty 1Merino").
- P1 Shell not built for haggling: placeholder, prompts, launcher label, header, no persona; prompts never change after an offer.
- P1 Owner pause hijacks every message: a sizing question gets "The owner's paused deals — list price stands."
- P2 Template lines ("I can do $145 for both") ignore the shopper's stated reason; superseded cards stack to 3,300px of near-identical cards; Deal is the smallest button on the card; no last-round tension or ending.
- P2 A11y: panel has aria-labelledby but no role; countdown rewrites every second inside an aria-live region with no label; eight targets are 40px tall; footer and struck price at 4.55:1.

## Personas
Casey (mobile, one hand): Deal is a 51x40 pill far right; scrolls a 304px pane nested in the page; keyboard will cover most of the panel. Jordan (first-timer): sees $167 when the page says $149; "Shop $161" reads like a store name; doesn't know Deal opens checkout rather than charging. Riley (stress): "best you can do" breaks routing; lowball duplicates the card; "Deal needs API" / "Minting..." strings can surface; a 404 in the console on load.

## Questions
If only the card is binding, why is it a bubble in a scroll list rather than a pinned deal slip the chat happens around? What does the shopkeeper visibly give up when it concedes? Should round 4 look and sound different so the demo has an ending?
