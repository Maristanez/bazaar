# Hack the North 2026 — rules, judging, and prior art

**What this is:** the Bazaar-relevant facts extracted from the ideation sweep (`../../Ideas/Doc1.md`–`Doc4.md`) so `PLAN.md` has one place to point at. The full ideation trail — Ghost Shoppers, LUMEN, SHEETSHIP, Aisle and the rest — stays in `Ideas/`; none of it is being built.

**Extracted:** 2026-09-18. **Trust level:** these were research findings written into the ideation docs, not re-verified at extraction time. Anything load-bearing for the pitch should be re-checked against Devpost before Saturday.

---

## 1. The clock

| When | What |
|---|---|
| **Sat 00:00 EDT** | Code may start. **32 hours**, not 36. |
| **Sat 14:00 EDT** | Initial Devpost submission **with every sponsor prize selected**. Hard deadline — prizes cannot be added later. |
| **Sun 08:00 EDT** | Final submission. |
| **Sun 09:45–11:45** | Sponsor judging. |
| **Sun ~11:45** | HTN round 1 in assigned rooms; **top 2 per room** advance. |
| **Sun 12:00** | Round 2 finals — **4-min demo + 1-min Q&A**, several judge pairs rotating. |

**Allowed before the clock:** planning, installs, accounts, dataset gathering. Explicitly permitted — this is what `PLAN.md` §14 "Tonight's checklist" is for.

**Judging is a live demo, not slides.**

---

## 2. Who is judging

- **HTN finalists panel is heavily VC + frontier-AI engineers** — Basecase, Upfront, Garage Capital, 1517, First Round, SPC, N49P; engineers from OpenAI, DeepMind, Cerebras, Baseten, Docker, Rox, Apple, Netflix.
- **Shopify's judges are generalists with a few engineers.** Consequence for the pitch: the "wait, that's possible?" moment has to land in **20 seconds** *and* survive an engineer's follow-up. Two layers, both required.

### Shopify track criteria (2026 wording)

| Criterion | What they said |
|---|---|
| **Technical Excellence** | sophisticated, *appropriate* AI |
| **Impact Potential** | merchant ops or customer experience |
| **Innovation Factor** | "unexpected approaches that make us think differently about commerce" |

The track brief says outright: *"Take inspo from one of our projects — SimGym."*

---

## 3. Sponsor tracks

**Live in 2026:** Shopify (Hack Shopping with AI, 1 winner, Shop Cash) · OpenAI API Prizes (3 winners, Codex-assisted) · Rox Best AI Agent ($10K/$2K) · Baseten · Elastic · Huawei openJiuwen Multi-Agent · Huawei OMNI Live · Bracket Bot · LeLamp · Backboard · Sentry · Warp · GPTZero · Tether · Dryft · RBC "Signal in the Noise" · MLH (Gemini, ElevenLabs, MongoDB, Tiger Data, Vultr, Snowflake, Solana).

**Gone since last year:** Cohere, Groq, Cerebras, Windsurf, YC, Snap, Martian, Databricks, Auth0, Cloudflare.

**What v3 is actually selecting** (per `PLAN.md` §0): HTN finalist · Shopify · Backboard · OpenAI. ElevenLabs only if voice lands. **Huawei dropped.**

> Warning carried over from the ideation docs: *gimmick stacking costs judging minutes.* Only select a track whose integration is load-bearing.

**Two eligibility items to confirm before Sat 14:00:**
1. Shopify-prize eligibility, if anyone on the team has a Shopify affiliation.
2. Permission for public source submission.

---

## 4. Prior art — the "already exists" list

Checked during ideation, as of Sept 2026. This is the evidence base behind the v3 framing that the Gym, not the haggling, is the product.

**Shopify already ships:**
- **SimGym** — AI shoppers with personas browse a store and compare two themes. Public merchant reviews complain about: false positives, shoppers that don't match the store, no way to describe real customers, whole-theme-only runs, analytics pollution, bots blocked by Cloudflare, no export.
- **Sidekick** — edits theme settings/sections and store content on request with approval; discounts, automations, custom apps; voice input.
- **Rollouts** — native A/B testing on real traffic + scheduled publishing.
- **Agentic stack** — UCP, Catalog API, Cart/Checkout MCP, Checkout Kit, Universal Cart (waitlist), Shopify AI Toolkit for Codex/Claude Code.

**The one that killed v2:** **Anthropic's Project Deal (Apr 2026)** publicly demonstrated buyer/seller agents haggling. To an OpenAI/DeepMind judge, agent-to-agent negotiation on Shopify reads as "Project Deal on Shopify." This is *the* reason v2 was demoted and v3 went human-to-agent. See `../archive/v2-spec.md` for what was dropped.

**Do NOT build** (redundant, or a past HTN finalist): AI shopping chatbot · product-description/image generator · AI store builder · analytics Q&A · virtual try-on · creator↔product matching (Maatchaa '25) · spend-control extension (Dime Defender '24) · a straight SimGym clone.

**Where v3 sits against that list:** haggling bots exist (Nibble, Haggler, DBargain) — treat their stats as *vendor-claimed* or don't cite them. What the research did **not** find is anyone simulating a population of hagglers against the merchant's own rules *before launch*. That gap is the Gym, and it is the pitch.

---

## 5. How the ideation ranked The Bazaar — and what v3 changed

Across three ranking passes, v2 Bazaar landed at **#2 → #5 → #14**. The reasons it fell, and v3's answer to each:

| Why it fell (v2) | v3's answer |
|---|---|
| "Project Deal on Shopify" — no longer surprising to AI judges | No buyer agent. A **human** haggles with the shop's agent. |
| "Is this good for merchants?" | Profit floor is **code, not a prompt**; owner sets policy; PAUSE always available. |
| Reads as "another agent-tests-agent tool" | The Gym is reframed as **provable safety before launch** + adversarial red-team, and a judge is handed the keyboard to try to break it. |
| Direct precedent among winners lists | The demo beat is *"a judge tries to break it and loses"* — that has no precedent in the lists below. |

Worth knowing: the highest-ranked alternatives were **LUMEN** (robot lamp, needs hardware) and **SHEETSHIP** (compile a spreadsheet to Shopify checkout). Both are in `Ideas/Doc4.md` if Friday night goes badly and the team needs a pivot. They are *not* the plan.

---

## 6. Winner patterns worth stealing

From reading how recent grand-prize teams actually found their idea (TreeHacks 2026, HackMIT 2025, PennApps XXVI, Cal Hacks 12.0, Bolt). The ones that apply to v3:

1. **Closed loop, not detection.** Shepherd won TreeHacks because existing canes *detect* obstacles and theirs *steers*. Detect→act is the upgrade judges reward. → The Gym doesn't just report risk; the floor it validates is the same code that runs live.
2. **Do the real thing during the hackathon and show the ledger.** Project Lend moved 50 lb of actual food; DIAL actually booked the hotel. Proof beats promise. → **A real Shopify checkout at the negotiated price**, on stage.
3. **Labor compression with one number.** Tailored Labs: "8 hours of editing in 4 minutes." → Two numbers: margin earned, and **floor breaches: zero**.
4. **Put one teammate entirely on UI/demo**, and **keep a hardcoded fallback for the flaky part** (the Cal Hacks winner's own stated method). → P3 Stage lane; offline replay mode; pre-minted discount code.
5. **Play is legitimate.** Kinemo beat a 911-dispatch copilot. Judges love being handed a controller. → Hand the judge the keyboard.

---

## 7. Why-now stats

`PLAN.md` Appendix B holds the pitch stats actually being used (cart abandonment, blanket-discount margin math, AI-sourced order growth, the Chevy "$1 Tahoe" incident, *Moffatt v. Air Canada*). Those are the sourced ones — prefer them.

The ideation docs also carry accessibility-market stats (European Accessibility Act, WebAIM Million, US accessibility suits). Those belonged to Ghost Shoppers, **not** to The Bazaar. Don't import them.
