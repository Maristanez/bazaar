// The deal engine (SPEC §6). Pure: time, seed and data arrive as arguments — no I/O, no clock, no randomness.
// Explicit .ts extensions: the server runs this source directly under Node's strip-types runtime.
export const PACKAGE = "@bazaar/engine";
export type { Item } from "./types.ts";
export { formatMoney, toShopper } from "./money.ts";
export { floorOf, isAddOn } from "./floor.ts";
export { isLowball } from "./lowball.ts";
export { LAST_ROUND_WORDS, analyzeBuyerReason, applyNegotiationContext, auditOffer, leadWithStatedReason, ownerApprovalTotal, priceOffer, reasonReply, suggestedOpeningOffer } from "./negotiate.ts";
export type { BuyerReason, NegotiationAudit, NegotiationItem, NegotiationMirror, NegotiationOffer, NegotiationOptions } from "./negotiate.ts";
export { buildNegotiationMenu, rankNegotiationMenu } from "./negotiation-menu.ts";
export type { NegotiationMenuCandidate, NegotiationMenuInput, NegotiationMenuResult, RequestedNegotiationItem } from "./negotiation-menu.ts";
export { DEFAULT_SETTINGS, SETTING_RANGES, resolveSettings } from "./settings.ts";
export type { ResolvedSettings } from "./settings.ts";
