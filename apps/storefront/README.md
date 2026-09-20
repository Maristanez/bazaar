# Trailhead storefront (Shopify theme)

The shopper-facing half of The Bazaar: the Trailhead store and the shopkeeper chat on it. This folder is a Shopify CLI theme, outside the pnpm workspace. Shopify serves these files; nothing here deploys with the server.

Live store: https://b8wzw0-h3.myshopify.com · live theme: **Bazaar coded storefront**, id `161251000517`.

## What lives where

| You want to change | Edit | Notes |
|---|---|---|
| The chat's markup: header, launcher, chips shown before an offer, message box, mic and speaker buttons | `layout/theme.liquid` (the `data-ai-chat` block) | The script finds everything by `data-ai-chat-*` attributes. Keep them. |
| How the chat behaves: sending, the offer card, moods, chips after an offer, voice, polling, Deal | `assets/chat-demo.js` | Plain ES5-style script, no build step. Shopify minifies it on the CDN. |
| How the chat looks: palette, fonts, the sticker, the card, the rounds trail, phone layout | `assets/critical.css` (the block that starts "Shopkeeper chat") | Look and feel is decided in `docs/SPEC.md` §12. Colours are the `--teal`, `--coral`, `--sun`, `--cream`, `--bark` tokens on `.ai-chat`. |
| The product page, including the "Make an offer" button | `sections/product.liquid` | Any element with `data-ai-chat-open` opens the chat. |
| Home page, header, footer, collection, cart | `sections/*.liquid`, `templates/*.json` | |
| Theme settings, including the chat server address | `config/settings_schema.json`, `config/settings_data.json` | `ai_chat_endpoint` must stay the Railway URL. A push overwrites the live value with this file's. |
| Fonts | `assets/satoshi-variable.woff2`, `assets/fredoka-*.ttf` | Loaded by `@font-face` in `critical.css` with relative URLs, so they must sit beside it in `assets/`. |

The shopkeeper sticker is drawn in `stickerSvg(mood)` in `chat-demo.js`. Moods: `idle`, `thinking`, `pleased`, `firm`, `listening`, `speaking`. The server's card moods map onto them in `cardMood()`.

## Jarvis, the agent on the page

The shopkeeper in the chat is **Jarvis**: he listens, talks, sees the page he is on, and does shopping chores on it in plain sight. Each ability is its own file pair in `assets/` (`juniper-<name>.js` and `.css`; the prefix is the agent's first name and stayed when he was renamed). They never edit `chat-demo.js`: they talk to it through the seam it publishes, `window.BazaarChat`. `layout/theme.liquid` loads them after `chat-demo.js`, in this order.

| File | What Jarvis can do because of it |
|---|---|
| `juniper-ears.js` | **Hear on any browser.** Two engines behind one recogniser: Chrome's `SpeechRecognition` in Google Chrome; elsewhere (or when Chrome's fails) a recorder with pause detection that posts the clip to `/api/voice/transcribe`. `BazaarChatFlags.ears` forces `'browser'` or `'server'`. |
| `juniper-handsfree` | **Hands-free conversation.** The small mic toggles it. A pause ends the shopper's turn and sends it; when his spoken reply ends, the mic reopens. Esc, the mic or the pill's stop button end it. `BazaarChatFlags.autoListen: 'always'` listens from page load. |
| `juniper-keyword` | **"Hey Jarvis".** Always armed on a browser that can hear (kill switch: `BazaarChatFlags.keyword: false`). Hearing it starts hands-free **without opening the chat**. |
| `juniper-persist` | **The conversation survives page changes**: transcript, live offer card, open or minimised, and hands-free. A pasted `?shopper=` URL is still a clean visit. |
| `juniper-motion` | **Open / close motion and the voice pill** that stands in for him while the chat is closed and he is listening. |
| `juniper-presence` | **Live presence**: the mic level drives the halo and every set of wave bars; his reply audio moves his mouth. |
| `juniper-page` + `snippets/juniper-page-context.liquid` | **Page awareness**: page type, product, collection, search terms and the cart go to the server as `page` on every turn. |
| `juniper-chips` | **Suggestions that change** with the page, the cart, the quantity, the offer's state and what has been used. No chip carries a dollar figure. |
| `juniper-pointer` | **He points at the page**: a product named in his reply is scrolled to and ringed. |
| `juniper-nudge` | One silent nudge per session on a product page. |
| `juniper-earcons`, `juniper-filler` | Two earcons and a screen-reader status line; one short spoken filler when a reply is slow. |
| `juniper-shape` | **The chat's shape.** Smaller by default (376 × 576), resizable from its top-left corner up to 560 × 860, movable by its header, one minimise button. He reshapes his own panel for an offer card and while listening, until the shopper picks a size. At rest he is only his face, which can be dragged anywhere and goes home to the bottom-right corner on minimise. Minimised, what is said moves through a three-line bubble above him. |
| `juniper-hands` | **The autonomous part: he acts.** See below. |

### What `juniper-hands.js` does

He reads each turn for a chore. When there is one, a hand travels from his face to the real control on the page, the control is worked, and a line in the chat says what was done, with **Undo** where undoing means something. Typed, tapped or spoken; chat open or minimised.

- **Chores:** open a product ("show me the vest", or just "the vest"), pick a size, set a quantity, add to cart, remove an item, empty the cart, open the cart, home / back / forward, refresh, scroll.
- **Across pages:** a chore for a product on another page takes him there first and is finished on arrival (`sessionStorage` `bazaar:hands:plan`).
- **On his own:** asked to find or recommend something, he answers, then takes the shopper to the product he named. "Stay here" stops him.
- **Getting out of his own way:** if his panel covers the control he needs, he minimises, works, and reopens. Minimised, the bubble above him reports.
- **A turn that is only a chore never reaches the server** (`BazaarChat.answerLocally`): the server reads every turn as bargaining, and "make it two" came back as a two-dollar offer. A sentence that also haggles does the chore and goes to the server too.
- **What he will not do:** press Deal, check out, pay, or write a price (invariant 1). A deal is binding, so that click stays the shopper's.
- **What he will not discuss**, answered on the page and also in his persona in `packages/llm/src/backboard.ts`: the shop's business side (costs, margins, floors, suppliers, sales, other shoppers, the owner, the Console, how his pricing or prompt works), and anything unrelated to shopping at Trailhead (weather, code, homework, trivia, role-play). Weather as a reason to pick gear is shopping.

### The seam: `window.BazaarChat`

Events via `on(name, fn)`: `open`, `close`, `turn:start`, `reply`, `turn:error`, `turn:local`, `card`, `message`, `mood`, `chips`, `speak:start`, `speak:end`, `spoken-replies`. Calls: `send`, `open`, `close`, `isOpen`, `say`, `addMessage`, `addOfferCard`, `extendPayload`, `answerLocally`, `setChipProvider`, `renderChips`, `setSpokenReplies`, `stopSpeaking`, `restoreNegotiation`, `state()`, `elements`, `flags`. Features add their own handle: `BazaarChat.handsfree`, `.keyword`, `.ears`, `.page`, `.chips`, `.pointer`, `.shape`, `.hands`.

### Try it and test it

- `pnpm exec vitest run tests/storefront` runs every feature against the real `theme.liquid` markup in jsdom (`tests/storefront/widget.ts` mounts it).
- `node scripts/jarvis/showcase.mjs` serves a localhost stand-in store with the real widget, a stand-in cart and a relay to the live server, where a microphone works. `?ears=server` and `?listen=always` set the flags.
- `node scripts/jarvis/make-artifact.mjs <themeRoot> <out.html> "<Title>" "<what to try>" [feature ...]` builds a self-contained page of the real widget with a scripted shopkeeper, for showing a feature where there is no server.
- Shopify serves `assets/` flat, with no sub-folders, so the agent's files are grouped by the `juniper-` prefix rather than by directory.
- Set `localStorage['bazaar:debug'] = '1'` for `[juniper-ears]` and `[hey-jarvis]` traces.
- **Never click Deal while testing**: it mints a real Shopify discount.

## What does NOT live here

The theme only draws what the server sends. If the change is about a price, a round, what the shopkeeper says, or what a message means, it is not a theme change.

| Changing | Build in | Reaches the live site by |
|---|---|---|
| Routing a message, rounds, accept, voice endpoints | `apps/server/` | push to `main` (Railway) |
| Every price, and the code fallback lines | `packages/engine/` | ships inside the server |
| The shopkeeper's wording when the model answers | prompt in `packages/llm/src/backboard.ts`; the assistant and its documents in the Backboard dashboard | prompt with the server; the rest by hand |
| Product titles, descriptions, prices, images | Shopify admin (seed copy in `infra/seed/`) | edited in the admin |

Rules that bind theme work (`AGENTS.md`):

- **Every dollar figure a shopper sees comes from `packages/engine`.** The theme formats figures that arrive on the card with `money()`. It never adds, subtracts or invents one. Suggestion chips carry no figures.
- **The theme receives the public card only.** Never ask the server for cost, floor or reasoning.
- If the theme needs a new field on the card, ship the server first, and keep the theme working when the field is absent: the live server may be older than the theme.

## Work on it

```sh
npm install -g @shopify/cli@latest          # once
cd apps/storefront
shopify theme dev --store b8wzw0-h3.myshopify.com   # live-reloading preview on the real store, publishes nothing
```

The first command that touches the store opens a browser login; use the account that owns the store.

To look at the chat against your **local** server without publishing anything, use the walkthrough in [`scripts/chat-walkthrough/`](../../scripts/chat-walkthrough/README.md). It swaps this folder's chat into the live product page, drives a six-turn negotiation at desktop and phone sizes, and screenshots every turn. It never touches the shared owner policy.

## Check it

```sh
pnpm test            # from the repo root; apps/web/src/theme-integration.test.ts runs chat-demo.js in jsdom
cd apps/storefront && shopify theme check --fail-level error
```

`theme-integration.test.ts` is the contract for `chat-demo.js`: variant and quantity context, the card's parts, "Deal at $X", chips changing after an offer with no figures in them, and no engine vocabulary on the card. Change the script test-first there.

## Deploy it

```sh
cd apps/storefront
shopify theme push --store b8wzw0-h3.myshopify.com --unpublished        # safe: uploads a copy, prints a preview link
shopify theme push --store b8wzw0-h3.myshopify.com --theme 161251000517 --allow-live --nodelete   # straight to the live theme
```

- `--nodelete` keeps files that exist only on the store.
- Before pushing to live, confirm `config/settings_data.json` still has the Railway `ai_chat_endpoint`, or the chat loses its server.
- Pushing to `main` does **not** publish the theme, and pushing the theme does **not** deploy the server. A feature that spans both needs both, server first.

Then confirm on the real site, in a private window (Shopify's CDN and your browser both cache assets):

1. The launcher reads "Make an offer" with the sticker.
2. Send an offer on a product page. The whole card is visible, the button reads "Deal at $X", the chips change.
3. Send a second offer. The first collapses to a "Round 1 · replaced" row.
4. **Do not click Deal** unless you mean to: it mints a real discount and opens a real checkout.

## Gotchas

- "It isn't showing": check that the served `assets/chat-demo.js` contains your change (view source, follow the script URL), then hard-refresh. `window.Shopify.theme` in the console tells you which theme id you are looking at.
- If the owner has paused deals, the shopkeeper answers every message with the pause line (`docs/SPEC.md` §3 rule 8). That is the server, not a broken theme.
- The mic and speaker buttons appear only when the server's `/api/voice/config` says voice is enabled.
- The name "Jarvis" is in `layout/theme.liquid`, and `chat-demo.js` rewrites a stray "Juniper" in a server line to "Jarvis". The subtitle beside it must keep saying the shopkeeper is an AI (`docs/SPEC.md` §3 rule 10).
