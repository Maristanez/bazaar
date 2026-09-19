import React from "react";
import type { RedTeamLayer, RedTeamResult } from "@bazaar/contracts";

const LAYER_LABELS: Record<RedTeamLayer, string> = {
  validate: "input validation",
  engine: "pricing engine",
  check: "output check",
  auditor: "settlement auditor",
  shopify_code: "dry-run Shopify rule",
};

function noun(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function RedTeamSummary({ result }: { result: RedTeamResult }) {
  const passed = result.attacks.filter((attack) => attack.passed).length;
  const failed = result.attacks.length - passed;
  const harmless = result.attacks.filter((attack) => attack.passed && attack.blockedBy === null).length;
  const layerCounts = result.attacks.reduce<Partial<Record<RedTeamLayer, number>>>((counts, attack) => {
    if (attack.blockedBy) counts[attack.blockedBy] = (counts[attack.blockedBy] ?? 0) + 1;
    return counts;
  }, {});

  return <section className="paper" style={{ marginTop: 24 }} aria-labelledby="redteam-summary-title">
    <div className="section-heading">
      <div>
        <h2 id="redteam-summary-title">Red-team replay</h2>
        <p>Recorded safety evidence for the current server path.</p>
      </div>
      {result.ranAt && <span>{new Date(result.ranAt).toLocaleString()}</span>}
    </div>
    {!result.ranAt || result.attacks.length === 0 ? <p className="empty">No recorded red-team replay is available.</p> : <>
      <div className={`gym-headline ${failed > 0 || result.breaches > 0 ? "gym-loss" : "gym-win"}`}>
        <div><span>Isolated run</span><strong>{noun(result.attacks.length, "attack")} · {noun(result.breaches, "economic breach", "economic breaches")}</strong></div>
        <b>{passed} passed · {failed} failed</b>
      </div>
      {harmless > 0 && <p className="muted">{noun(harmless, "safe outcome")}; no blocking layer claimed.</p>}
      <ul className="menu-options" aria-label="Observed enforcement layers">
        {(Object.entries(layerCounts) as [RedTeamLayer, number][]).map(([layer, count]) => <li key={layer}><strong>{count}</strong> {LAYER_LABELS[layer]}</li>)}
      </ul>
      {failed > 0 && <div role="alert">
        <strong>Failed outcomes</strong>
        <ul>{result.attacks.filter((attack) => !attack.passed).map((attack) => <li key={attack.name}>{attack.name}: {attack.outcome}</li>)}</ul>
      </div>}
      <p className="muted">
        Scope: isolated test doubles using {result.scope.server}; {result.scope.backboard}; {result.scope.shopify}; and {result.scope.database}.
        This is not live Shopify checkout enforcement. The run made {noun(result.scope.productionRequests, "production request")} and {noun(result.scope.productionDatabaseWrites, "production database write")}.
      </p>
    </>}
  </section>;
}
