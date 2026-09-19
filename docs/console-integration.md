# Console → Backboard → Shopify verification

Last pre-merge deployment check (2026-09-19): the local server/widget path was exercised against the real Shopify catalog, Backboard assistant, and Supabase merchant. The live storefront is https://b8wzw0-h3.myshopify.com/; Railway was serving the older server, and its `/console` returned 404. The GitHub main merge can trigger a new Railway deployment; verify its result separately. The updated Shopify theme also requires separate publication. Shopify, Railway, and Supabase dashboard logins are still pending. Local widget → real-service evidence is not proof of the published storefront.

## Connected path

The owner signs in through Supabase Auth. Every owner route verifies that the bearer token belongs to the configured merchant. Adopt appends a policy row before updating the server's active policy. Each shopper turn uses that policy to generate a safe price in `packages/engine`; Backboard receives the private code-priced candidate menu and returns a selected option and checked wording. Shoppers receive only the selected public card. The owner feed receives the private decision over authenticated SSE. Shopify checkout acceptance refreshes costs and inventory and checks current policy again. Successful settlements are recorded in Supabase.

PAUSE invalidates existing offers and cancels pending approvals. Resume permits new offers without reviving cancelled cards. Owner decisions update the same shopper card through status polling. Approval is once per negotiation, above cost, and expires after 45 seconds; decline/timeout restores the final safe offer. Repeated acceptance returns the same settlement and cannot mint twice.

## Local verification evidence

- Signed into the existing owner account with a one-time session; password and ownership were unchanged.
- Console loaded all nine real Shopify products and saved policy. No owner cost fields appeared in public product/card payloads.
- After the final server restart, changing the selector from size 10 to size 11 and saying "same shoes" produced a size 11 card and a fresh negotiation.
- Selected Trail Runner 2 size 10. Successive browser offers remained on that product and reached $133 at the original cost +25% policy.
- Moving the slider to 60% without Adopt left the live floor at $97.50. After Adopt, the next request in the same Backboard thread used floor $124.80 and returned $142. The console displayed the matching option and real `gpt-4.1-mini` trace. Observed offer runs were about 0.9–2.3 seconds; unsupported extra wording was stripped by the existing checker.
- Enabling owner review and offering $90 produced an owner decision showing size 10, quantity 1, $78 cost and $12 profit. Approve updated the shopper card without another message.
- Deal opened real Shopify Checkout: Trail Runner 2, size 10, quantity 1, $149 list, $59 discount, $90 CAD subtotal. The Supabase deal row matched those values and had `owner_approved = true`. No order was placed. Shipping/address-dependent totals were not tested.
- Decline was also verified with the latest widget: the pending $90 card changed to the $133 final offer, showed "My best stays $133", enabled Deal, and reset the countdown to 15 minutes.
- PAUSE disabled the existing Deal button and made the next message return the paused line. The console showed a blocked event. Resume left the old card unavailable.
- A prior local verification restored policy to floor 25%, ask owner true, paused false. Current live policy should be read from the owner dashboard after access is restored; do not treat 25% as current.
- The live homepage currently shows eight products while the collection page shows all nine; Trail Runner 3 is omitted from the live homepage. The local theme fix removes that limit, but it has not been published.
- Live storefront bugs reproduced during verification: socks size L/XL with quantity 2 settled using S/M, and a later generic Trail Runner 2 request for $120 returned a Race Vest quantity 2. These remain deployment/runtime follow-up items.
- The local Gym now renders 300 SVG shoppers using the live `priceOffer` engine and deterministic rule-based behavior; it does not call Backboard. A current Trail Runner 2 seed-42 run uses list 14,900, cost 7,800, stocked 2026-06-17, and its tested floor sweep remains negative versus the 20% banner. Do not promise a red-to-teal flip.

## Reproduce locally

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Keep server credentials in the ignored root `.env`: Shopify credentials, Backboard API key/assistant ID, Supabase URL and secret/service-role key.
3. Keep only public browser configuration in `apps/web/.env.local`: `VITE_CONSOLE_PORT=http`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (publishable key is also accepted by the SDK).
4. Start `pnpm --dir apps/server start`, `pnpm --dir apps/web dev`, and `node scripts/storefront-preview.mjs`. The preview binds only to loopback and uses the actual theme widget and real public Shopify variant IDs.
5. Open `/console` on Vite's printed port and `http://127.0.0.1:9293/?product=trail-runner-2&shopper=your-test-session`. Use distinct shopper IDs for independent tests.
6. Run `pnpm test`, `pnpm typecheck`, and `pnpm --dir apps/web build`.

The local production build is served by the server at `/console`; the Railway deployment remains pending and currently returns 404 for that route. Production defaults to HTTP mode and fails visibly when public auth configuration is absent. Fixture mode requires an explicit setting outside development.

## Automated coverage

Merge-time validation is recorded in `codex-log.md`: workspace tests and type checks, production web build, diff checks, integration/security/runtime/Backboard/widget coverage, and a secret scan of committed files and browser assets. These checks do not establish hosted deployment success.

HTTP integration tests exercise Adopt, PAUSE, fresh costs, quantity inventory, live Backboard-menu projection using an external API double, authenticated SSE, approval, duplicate acceptance and public/private payload boundaries. Separate security tests cover every owner route, invalid mutations, policy restart recovery and SSE cursors across server restarts. Runtime tests cover 45-second timeout, decline, pause cancellation and races. Backboard tests cover per-session thread reuse, concurrent calls, memory settings, parsing and failure fallback. Real widget DOM tests cover selected variants, negotiation IDs, pending decisions, price/countdown changes and settlement handoff. Engine tests include generated price/cost/floor invariants.

## Remaining deployment and product work

- Apply `infra/migrations/20260919_allow_null_deal_code.sql` before relying on list-price settlement logging in the existing database. Full-price checkouts have no discount code; this additive relaxation was prepared but not applied remotely.
- Deploy server/web changes with the server secrets and public web build variables. Publish the updated `shopify-theme/assets/chat-demo.js` to the intended theme. Local testing does not update the live Railway app or Shopify theme.
- The Gym is local, deterministic, rule-based and uses the live `priceOffer` engine; it is not a Backboard simulation, and the current seed-42 floor sweep remains negative versus the banner. Do not promise a threshold flip or change the population to make one appear.
- Backboard still uses one configured assistant. Persistent shared memory is disabled, including for a client-supplied `demo` ID; thread context continues within a negotiation. Per-shopper assistants and isolated persistent recall remain R10 work.
- The local JavaScript pricing path has been extracted into a pure engine module and the full private code-priced menu now supports requested bundles and cheaper alternatives through Backboard. The local theme also removes the technical memory claim from the chat footer. These changes are not published to the live theme.
- In-memory offers/approvals/feed and settlement retry queues are lost on process restart by design. Deal writes retry after transient failures without issuing a second code. Durable reconciliation is needed before multi-instance production use. Post-mint policy changes trigger revocation; a Shopify revocation failure can leave an orphan code and is logged.
- Tax/shipping, discount-removal/stacking behavior, draft-order fallback and a completed paid order were not verified in this session.
