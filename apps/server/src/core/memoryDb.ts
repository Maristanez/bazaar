import type { OfferStore } from "./offers";
import type { CoreDb, MemoryDbInput, Negotiation } from "./ports";
import type { PriceAudit } from "@bazaar/engine";
import type { Settlement } from "@bazaar/contracts";

class MemoryDb implements CoreDb {
  readonly offers: OfferStore = new Map();
  readonly #negotiations = new Map<string, Negotiation>();
  readonly #audits = new Map<string, PriceAudit>();
  readonly #settlements = new Map<string, Settlement>();
  readonly #queues = new Map<string, Promise<void>>();
  readonly #claims = new Set<string>();

  constructor(private readonly input: MemoryDbInput) {}

  getItems() { return this.input.items; }
  getPolicy() { return this.input.policy; }
  getNegotiation(id: string) { return this.#negotiations.get(id); }
  setNegotiation(negotiation: Negotiation) { this.#negotiations.set(negotiation.negotiationId, negotiation); }
  getAudit(offerId: string) { return this.#audits.get(offerId); }
  setAudit(offerId: string, audit: PriceAudit) { this.#audits.set(offerId, audit); }
  getSettlement(offerId: string) { return this.#settlements.get(offerId); }
  setSettlement(settlement: Settlement) { this.#settlements.set(settlement.offerId, settlement); }
  claimOffer(offerId: string) {
    if (this.#claims.has(offerId)) return false;
    this.#claims.add(offerId);
    return true;
  }
  releaseOffer(offerId: string) { this.#claims.delete(offerId); }

  async withNegotiationLock<T>(negotiationId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(negotiationId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.#queues.set(negotiationId, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.#queues.get(negotiationId) === tail) this.#queues.delete(negotiationId);
    }
  }
}

export function createMemoryDb(input: MemoryDbInput): CoreDb {
  return new MemoryDb(input);
}
