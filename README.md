# The Bazaar

**Hack the North 2026 · team of 3 · coding window Sat 00:00 → Sun 08:00 EDT (32 h)**

> A shopkeeper AI you can prove is safe before it meets a customer. A character on the storefront helps a human shopper find what they want, then closes the sale inside the owner's rules — because the floor is code, not a prompt. Before the owner switches it on, 300 synthetic shoppers and a red-team attack her rules in the Gym. Then a judge takes the keyboard and tries to be breach number one.

---

## Start here

**[`PLAN.md`](PLAN.md) is the source of truth.** Plan v3, human-to-agent. Where anything in this folder disagrees with it, PLAN.md wins.

If you have five minutes: PLAN.md §0 (TL;DR), §2 (the product), §15 (demo script).
If you're about to build: §11 (repo & contracts), §12 (three lanes), §13 (schedule).
If it's still Friday night: **§14 (tonight's checklist)**.

---

## What's in here

| Path | What it is | Status |
|---|---|---|
| [`PLAN.md`](PLAN.md) | Plan v3 — product, architecture, engine, guardrails, Gym, schedule, demo script, judge Q&A | **Live — source of truth** |
| [`mockups/index.html`](mockups/index.html) | Storefront + pet + Merchant Console visual mockups (open in a browser) | **Live** |
| [`research/frontend-tech.md`](research/frontend-tech.md) | Front-end library choices with primary sources — character animation, chat UI, charts, voice, realtime, hosting | **Live** — cited by PLAN §10.3 |
| [`reference/hackathon-rules.md`](reference/hackathon-rules.md) | Clock, deadlines, judging format, sponsor tracks, prior art, winner patterns | **Live** — cited by PLAN Appendix C |
| [`archive/v2-spec.md`](archive/v2-spec.md) | v2 spec — agent-to-agent negotiation over UCP | **Superseded** |
| [`archive/v2-team-plan.md`](archive/v2-team-plan.md) | v2 component map & 3-person split | **Superseded** |

The wider ideation trail (Ghost Shoppers, LUMEN, SHEETSHIP, Aisle…) lives in `../Ideas/` and is **not** being built.

---

## The v2 → v3 pivot, in one table

| v2 (archived) | v3 (`PLAN.md`) |
|---|---|
| Buyer AI agent haggles with merchant agents | **A human talks to the shop's agent directly** |
| 3 stores, 3 Deal Agent servers, a directory | **1 store** (Trailhead Co.), 1 backend process |
| UCP extension + MCP server | Dropped from the build; a "what's next" slide |
| Arena: three robots bidding aloud | **Storefront + the pet.** One conversation, one character |
| Gym = pricing-policy preview | Gym = pricing preview **+ adversarial red-team**, and it's the headline |
| Memory may shift price ±5% | **Memory never touches price** |

**Why:** Anthropic's Project Deal (Apr 2026) already demonstrated buyer/seller agents haggling, so v2 read as "Project Deal on Shopify" to an AI judge. See `reference/hackathon-rules.md` §4–5.

The archived v2 docs are kept for the parts that carried over unchanged in spirit — policy engine, Strategist-as-phraser, Auditor, discount-code settlement, Console, Gym tier 1 — and for the deeper UCP/protocol detail if a judge asks "what's next".

---

## Known plan-breaker

Shopify dev stores are always password-protected, which blocks `/api/ucp/mcp` and cart permalinks. PLAN.md §8.1 carries **Path A** (trial store, password off — unverified) and **Path B** (Storefront GraphQL + pre-authenticated browser). **Decide which by midnight Friday.**
