import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RedTeamLayer, RedTeamResult } from "@bazaar/contracts";

const LAYERS = new Set<RedTeamLayer>(["validate", "engine", "check", "auditor", "shopify_code"]);

type ArtifactAttack = {
  name?: unknown;
  blockedBy?: unknown;
  passed?: unknown;
  outcome?: unknown;
};

type Artifact = {
  ranAt?: unknown;
  attacks?: unknown;
  breaches?: unknown;
  settlementRows?: unknown;
  effects?: {
    dryRunDiscounts?: unknown;
    productionRequests?: unknown;
    productionDatabaseWrites?: unknown;
  };
};

function count(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

export function emptyRedTeamResult(): RedTeamResult {
  return {
    ranAt: "",
    attacks: [],
    breaches: 0,
    scope: {
      mode: "isolated",
      server: "no recorded run",
      backboard: "no recorded run",
      shopify: "no recorded run",
      database: "no recorded run",
      liveShopifyValidated: false,
      productionRequests: 0,
      productionDatabaseWrites: 0,
      dryRunDiscounts: 0,
      settlementRows: 0,
    },
  };
}

export function summarizeRedTeamArtifact(value: unknown): RedTeamResult {
  if (!value || typeof value !== "object") throw new TypeError("red-team artifact must be an object");
  const artifact = value as Artifact;
  if (typeof artifact.ranAt !== "string" || !Number.isFinite(Date.parse(artifact.ranAt))) {
    throw new TypeError("red-team artifact ranAt must be an ISO timestamp");
  }
  if (!Array.isArray(artifact.attacks)) throw new TypeError("red-team artifact attacks must be an array");
  if (!Number.isSafeInteger(artifact.breaches) || Number(artifact.breaches) < 0) {
    throw new TypeError("red-team artifact breaches must be a non-negative integer");
  }

  const attacks = artifact.attacks.map((raw, index) => {
    const attack = raw as ArtifactAttack;
    if (!attack || typeof attack !== "object" || typeof attack.name !== "string" || typeof attack.outcome !== "string" || typeof attack.passed !== "boolean") {
      throw new TypeError(`red-team artifact attack ${index + 1} is invalid`);
    }
    if (attack.blockedBy !== null && !LAYERS.has(attack.blockedBy as RedTeamLayer)) {
      throw new TypeError(`red-team artifact attack ${index + 1} has an invalid blocking layer`);
    }
    return {
      name: attack.name,
      blockedBy: attack.blockedBy as RedTeamLayer | null,
      passed: attack.passed,
      outcome: attack.outcome,
    };
  });

  return {
    ranAt: artifact.ranAt,
    attacks,
    breaches: Number(artifact.breaches),
    scope: {
      mode: "isolated",
      server: "current createBazaarServer over loopback HTTP",
      backboard: "adversarial SSE double through the real parser, check, and fallback",
      shopify: "dry-run GraphQL double; generated mutation input inspected",
      database: "in-memory deal log",
      liveShopifyValidated: false,
      productionRequests: count(artifact.effects?.productionRequests),
      productionDatabaseWrites: count(artifact.effects?.productionDatabaseWrites),
      dryRunDiscounts: count(artifact.effects?.dryRunDiscounts),
      settlementRows: Array.isArray(artifact.settlementRows) ? artifact.settlementRows.length : 0,
    },
  };
}

export function loadRedTeamResult(): RedTeamResult {
  const artifactPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../infra/redteam-result.json");
  try {
    return summarizeRedTeamArtifact(JSON.parse(readFileSync(artifactPath, "utf8")));
  } catch {
    return emptyRedTeamResult();
  }
}
