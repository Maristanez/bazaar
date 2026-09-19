import { expect, it } from "vitest";
import type { Option } from "@bazaar/contracts";
import { checkAcceptable, createOffer, markUsed, type OfferStore } from "./offers";

const now = new Date("2026-09-19T12:00:00.000Z");
const option: Option = {
  id: "held-tr2",
  kind: "held",
  items: [{ variantId: "tr2-10", title: "Trail Runner 2", size: "10", qty: 1 }],
  listTotal: 14900,
  total: 13500,
  ownerRank: 1,
  facts: ["aged_stock"],
};

it("rejects an unknown offer id", () => {
  expect(checkAcceptable(new Map(), "missing", now)).toEqual({ ok: false, why: "unknown" });
});

it("creates a live offer with the injected id and rejects it after 15 minutes", () => {
  const store: OfferStore = new Map();
  const offer = createOffer(store, { negotiationId: "neg-1", option, now, newId: () => "offer-1" });
  expect(offer.id).toBe("offer-1");
  expect(offer.negotiationId).toBe("neg-1");
  expect(offer.option).toEqual(option);
  expect(offer.expiresAt.toISOString()).toBe("2026-09-19T12:15:00.000Z");
  expect(checkAcceptable(store, offer.id, now)).toEqual({ ok: true, offer });
  expect(checkAcceptable(store, offer.id, new Date("2026-09-19T12:15:00.001Z")))
    .toEqual({ ok: false, why: "expired" });
});

it("rejects an already used offer without using another negotiation's offer", () => {
  const store: OfferStore = new Map();
  const first = createOffer(store, { negotiationId: "neg-1", option, now, newId: () => "offer-1" });
  const other = createOffer(store, { negotiationId: "neg-2", option, now, newId: () => "offer-2" });
  markUsed(store, first.id);
  expect(checkAcceptable(store, first.id, now)).toEqual({ ok: false, why: "used" });
  expect(checkAcceptable(store, other.id, now)).toEqual({ ok: true, offer: other });
});

it("supersedes previous live offers only on the same negotiation", () => {
  const store: OfferStore = new Map();
  const first = createOffer(store, { negotiationId: "neg-1", option, now, newId: () => "offer-1" });
  const other = createOffer(store, { negotiationId: "neg-2", option, now, newId: () => "offer-2" });
  const later = new Date("2026-09-19T12:01:00.000Z");
  const replacement = createOffer(store, {
    negotiationId: "neg-1", option, now: later, newId: () => "offer-3",
  });
  expect(checkAcceptable(store, first.id, later)).toEqual({ ok: false, why: "superseded" });
  expect(checkAcceptable(store, replacement.id, later)).toEqual({ ok: true, offer: replacement });
  expect(checkAcceptable(store, other.id, later)).toEqual({ ok: true, offer: other });
});

it("accepts just before expiry and rejects exactly when the countdown reaches zero", () => {
  const store: OfferStore = new Map();
  const offer = createOffer(store, { negotiationId: "neg-1", option, now, newId: () => "offer-1" });
  expect(checkAcceptable(store, offer.id, new Date("2026-09-19T12:14:59.999Z")))
    .toEqual({ ok: true, offer });
  expect(checkAcceptable(store, offer.id, new Date("2026-09-19T12:15:00.000Z")))
    .toEqual({ ok: false, why: "expired" });
});
