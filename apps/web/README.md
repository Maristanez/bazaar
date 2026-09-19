# Owner Console

Run `pnpm --dir apps/web dev`, then open `/console`. `pnpm --dir apps/web build` produces the static app; root `pnpm test` and `pnpm typecheck` include it. `/` is only a notice that Shopify serves the storefront.

Fixture mode is the default and is labelled on screen. Development opens signed in; Sign out exercises the email/password form (any credentials). Fixture changes are in memory and reset on refresh. This is synthetic preview data, not authenticated live owner data.

## R15 handoff

Set these **in apps/web/.env.local or the web build environment**, never import the root server `.env`:

```
VITE_CONSOLE_PORT=http
VITE_SUPABASE_URL=<public project URL>
VITE_SUPABASE_ANON_KEY=<public anon or publishable key>
```

The browser only uses Supabase Auth for session/sign-in/sign-out. `ConsoleAuth` is separate from `ConsolePort` because the supplied five-method data contract has no login operation. Missing HTTP auth configuration fails closed. No service-role, Shopify, or LLM keys belong in a `VITE_` variable.

All HTTP requests use same-origin paths and a fresh `Authorization: Bearer <access_token>`. Hosting/proxying these paths remains Platform's work; no server routes were added here.

| Request | JSON body | Response |
|---|---|---|
| GET `/api/console/state` | — | contracts `ConsoleState` |
| GET `/api/console/stream` | — | SSE `data: <ConsoleEvent JSON>` followed by blank line |
| POST `/api/policy` | `{ floorPct, askOwner }` | contracts `Policy` |
| POST `/api/pause` | `{ paused }` | contracts `Policy` |
| POST `/api/approvals/:id` | `{ decision: "approve" \| "decline" }` | contracts `Approval` |

The adapter maps port `approved`/`declined` to wire `approve`/`decline`. Money remains cents. SSE tolerates heartbeat comments and partial UTF-8 chunks, reads optional `id` / `retry`, sends `Last-Event-ID`, reacquires the token on reconnect, validates event payloads, and aborts on unmount/sign-out. An optional second `subscribe` callback reports `connected | reconnecting | unauthorized`; the original one-argument call remains valid. The Console reloads state after reconnect and shows connection/auth failures. R15 should retain event IDs for replay and return 401/403 without valid owner authorization.

S5's acceptance here is fixture emission → matching newest-first row within 100 ms under the test clock, with all four red blocked layers, PAUSE/Resume and empty/full/paused states. The original live shopper → feed <1s gate returns when R15/B14 are available. The Gym remains an empty 480px region for B12.

## Policy and approvals

The floor slider and ask-me switch are a local preview until Adopt succeeds. Adopt calls `setPolicy` once and updates the saved baseline; a failed request retains the draft. PAUSE saves independently. Reconnect snapshots preserve unsaved drafts and policy writes completed while a reload was in flight.

The default interactive fixture rebases historical pending approvals to a fresh 45-second deadline and suppresses the recorded automatic resolution. Approve, Decline or the deadline now resolves the card; local decisions cannot be overwritten by later replay. Tests can explicitly supply the full recorded stream to exercise its original lifecycle. These changes affect only in-memory fixtures; server approval ownership and persistence remain B8/S7 work.

S6's fixture-era acceptance verifies that previewing changes nothing in port state and Adopt calls `setPolicy` exactly once with the chosen values. The original next-shopper-turn acceptance returns with R15. Tests also cover approval buttons/timeouts and state races during reconnect. The HTTP adapter is typed and tested with stubbed responses; it has not been exercised against live owner routes.
