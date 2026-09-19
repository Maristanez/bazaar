import type { ChatEvent, ConsoleEvent, Option, Policy, ProductCard, Settlement } from "@bazaar/contracts";
import type { Item, PriceAudit } from "@bazaar/engine";
import type { Offer, OfferStore } from "./offers";

export type Surface = "storefront" | "chatgpt";
export type Route = { negotiationId: string; shopperId: string; surface: Surface };
export type MirroredItem = Item & { image: string };
export type Negotiation = Route & { productId: string; size?: string; round: number };
export type Understood = {
  kind: "offer" | "budget" | "question";
  amount?: number;
  budget?: number;
  size?: string;
  wants?: string;
  currency?: string;
  quantity?: number;
};
export type Blocked = { blocked: "validate" | "engine" | "offer_ids" | "auditor" | "mint" };
export type Timed<T> = { timedOut: true } | { timedOut: false; value: T };
export type LlmTrace = { provider: string; model: string; ms: number; costUsd: number | null; threadId: string; memory?: string };
export type ShopkeeperChoice = { optionId: string; line: string; trace?: LlmTrace };

export interface CoreDb {
  getItems(): readonly MirroredItem[];
  getPolicy(): Policy;
  getNegotiation(id: string): Negotiation | undefined;
  setNegotiation(negotiation: Negotiation): void;
  offers: OfferStore;
  getAudit(offerId: string): PriceAudit | undefined;
  setAudit(offerId: string, audit: PriceAudit): void;
  getSettlement(offerId: string): Settlement | undefined;
  setSettlement(settlement: Settlement): void;
  withNegotiationLock<T>(negotiationId: string, work: () => Promise<T>): Promise<T>;
  claimOffer(offerId: string): boolean;
  releaseOffer(offerId: string): void;
}

export type CoreHooks = {
  pause: () => Promise<boolean>;
  approval: (offer: Offer, audit: PriceAudit) => Promise<boolean>;
  auditor: (offer: Offer, audit: PriceAudit) => Promise<PriceAudit | null>;
};

export type CorePorts = {
  db: CoreDb;
  understand: (input: { text: string; product: Pick<MirroredItem, "productId" | "title" | "size"> }) => Promise<Understood>;
  chooseAndSay: (options: readonly Option[], context: {
    shopperId: string;
    negotiationId: string;
    shopperMessage: string;
    productId: string;
    title: string;
    size?: string;
    round: number;
    budget?: number;
    wants?: string;
  }) => Promise<ShopkeeperChoice>;
  mint: (offer: Offer, audit: PriceAudit) => Promise<{ code: string; checkoutUrl: string }>;
  clock: { now(): Date; within<T>(work: () => Promise<T>, milliseconds: number): Promise<Timed<T>> };
  events: { chat(route: Route, event: ChatEvent): void; console(route: Route, event: ConsoleEvent): void };
  newId(): string;
  hooks?: CoreHooks;
};

export type MakeOfferInput = {
  negotiationId?: string;
  shopperId: string;
  surface: Surface;
  productId: string;
  size?: string;
  text?: string;
  understood?: Understood;
};

export type MemoryDbInput = { items: readonly MirroredItem[]; policy: Policy };
