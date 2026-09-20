# Owner Console

Run `pnpm --dir apps/web dev`, then open `/console`. `pnpm --dir apps/web build` produces the static app, which the server serves at `/console`; root `pnpm test` and `pnpm typecheck` include it. `/` is only a notice that Shopify serves the storefront.

## Data adapters

The Console reaches its data through one seam, `src/console/data/port.ts`, with two adapters:

- **HTTP** (`httpPort.ts`) — the production default. Same-origin requests with a fresh `Authorization: Bearer <access_token>`; Vite proxies `/api` to localhost:3000 in dev. The routes are in `docs/SPEC.md` §5.3.
- **Fixture** (`fixturePort.ts`) — the development default, labelled on screen and loaded on demand so it stays out of the production entry chunk. Development opens signed in; Sign out exercises the email/password form (any credentials). Changes are in memory and reset on refresh. Synthetic preview data, never live owner data.

## Configuration

Set these in `apps/web/.env.local` or the web build environment. The root server `.env` stays on the server.

```
VITE_CONSOLE_PORT=http            # or "fixture" for an explicit fixture preview
VITE_SUPABASE_URL=<public project URL>
VITE_SUPABASE_ANON_KEY=<public anon or publishable key>
```

Without the two Supabase values the Console asks the server's `/api/public-config` for them. The browser uses Supabase Auth only for session, sign-in and sign-out; `ConsoleAuth` is separate from `ConsolePort`. Missing or invalid auth configuration fails closed. `VITE_` variables carry public values only (AGENTS.md invariant 6).
