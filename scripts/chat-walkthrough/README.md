# Chat walkthrough

Drives a real negotiation in a browser and screenshots every turn, so a change to the shopper chat can be looked at, not just tested. It is a design aid, not part of `pnpm test`.

It loads the live product page and swaps in the **local** theme chat (`layout/theme.liquid` widget markup, `assets/critical.css`, `assets/chat-demo.js`), pointed at a local server on `:3217`. That server uses an **in-memory owner policy**, so the walkthrough never reads or writes the shared Supabase policy (which may be paused).

## Run

```sh
cd scripts/chat-walkthrough
npm init -y && npm i playwright && npx playwright install chromium   # once; both are gitignored
node --experimental-strip-types server.mjs &                         # from this folder; restart after server edits
node negotiate.mjs desktop 1440 900
node negotiate.mjs mobile 390 844 mobile
```

Screenshots and `log.json` (each message, reply time, reply text, card text) land in `shots/<label>/`. Turn 5 is "what is the best you can do?".

## Rules

- **Never click Deal.** It mints a real Shopify discount and checkout.
- Set `WALKTHROUGH_PORT` (for both `server.mjs` and `negotiate.mjs`) when `:3217` is taken, for example by another agent's walkthrough.
- Stop the `:3217` server when finished. A different checkout may be listening on `:3000`; leave it alone.
- Chromium is launched with `LocalNetworkAccessChecks` disabled, because a public page may not otherwise call `localhost`.
- The server's default CORS allow-list already includes the store's origin.
