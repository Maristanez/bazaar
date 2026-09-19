// Compile-time tests — checked by `pnpm typecheck`, never executed.
// B0's "Done when": a ChatEvent cannot hold an Option (SPEC rule 11 / AGENTS invariant 3).
import type { ChatEvent, OfferCard, Option, PublicOption } from "./index";

declare const option: Option;
declare const card: OfferCard;

// @ts-expect-error — an owner-side Option (ownerRank, facts) must not pass as a PublicOption
export const leaked: PublicOption = option;

// @ts-expect-error — and so must not ride to a shopper inside a ChatEvent
export const leakedEvent: ChatEvent = { t: "card", card: { ...card, option } };

// The intended path still compiles: strip to the public fields explicitly.
const { id, kind, items, listTotal, total } = option;
export const ok: ChatEvent = { t: "card", card: { ...card, option: { id, kind, items, listTotal, total } } };
