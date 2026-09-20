/**
 * The owner's lowball rule (SPEC §4.4.1): an offer under cutoffPct of list is a lowball.
 * A cutoff of 0 turns the rule off. The server and the Gym both call this, so the Forecast matches the floor.
 */
export function isLowball(offered: number, list: number, cutoffPct: number): boolean {
  return cutoffPct > 0 && offered * 100 < list * cutoffPct;
}
