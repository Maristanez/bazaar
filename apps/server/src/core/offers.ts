import type { Option } from "@bazaar/contracts";

export type Offer = {
  id: string;
  negotiationId: string;
  option: Option;
  expiresAt: Date;
  used: boolean;
  superseded: boolean;
};

export type OfferStore = Map<string, Offer>;

export type Acceptability =
  | { ok: true; offer: Offer }
  | { ok: false; why: "unknown" | "expired" | "used" | "superseded" };

export function createOffer(
  store: OfferStore,
  input: { negotiationId: string; option: Option; now: Date; newId: () => string },
): Offer {
  const offer: Offer = {
    id: input.newId(),
    negotiationId: input.negotiationId,
    option: input.option,
    expiresAt: new Date(input.now.getTime() + 15 * 60 * 1000),
    used: false,
    superseded: false,
  };
  for (const previous of store.values()) {
    if (previous.negotiationId === input.negotiationId && checkAcceptable(store, previous.id, input.now).ok) {
      previous.superseded = true;
    }
  }
  store.set(offer.id, offer);
  return offer;
}

export function checkAcceptable(store: OfferStore, offerId: string, now: Date): Acceptability {
  const offer = store.get(offerId);
  if (!offer) return { ok: false, why: "unknown" };
  if (now.getTime() >= offer.expiresAt.getTime()) return { ok: false, why: "expired" };
  if (offer.used) return { ok: false, why: "used" };
  if (offer.superseded) return { ok: false, why: "superseded" };
  return { ok: true, offer };
}

export function markUsed(store: OfferStore, offerId: string): void {
  const offer = store.get(offerId);
  if (offer) offer.used = true;
}
