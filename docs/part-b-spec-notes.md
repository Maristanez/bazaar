# Part B implementation decisions

`SPEC.md` remains the authority. These notes record conflicts and the owner's explicit 2026-09-19 clarifications. The owner's chat instructions supersede the two ambiguous §6.2 clauses below.

## B2 / B3

| Requirement | Evidence | Treatment |
|---|---|---|
| Prompt: TR2, round 3, offer $140 produces alternatives | SPEC §6 accepts any offer at or above the ask; round 3 asks $127 | Accept $140. Test the round-3 alternatives trigger with $125. |
| SPEC §6.2: whole-dollar ask reductions never grow | List 201¢, cost 100¢, age 61 days, floor 25% produces asks 300, 300, 300, 200¢; reductions 0, 0, 100¢ | Owner decision: shrinking steps use unrounded cents; published whole-dollar asks must only be non-increasing, with round four equal to the rounded target. Removed premature cent rounding from `ask`; the protected worked example is unchanged. |
| SPEC §6.2: no option below its cart target | SPEC §6 prices TR3 + socks at $181; its urgency is zero, so its cart target is its $187 list total | Owner decision: held/final/else preserve cart target; bundle shoe part preserves main target, and bundle total clears cart cost/floor. A generated case found a bundle below the main target under floor-above-list policy; that unsafe bundle is now dropped. |
| SPEC §6.2: never counter below the offer | SPEC §6 recommends Ridge Lite at $99 for a $120 offer on TR3 | Keep the explicit recommendation formula. Same-product acceptance never reduces an offer; the clause applies to acceptance and the same-product counter; cheaper replacement carts follow their explicitly specified price formula. |
| Arbitrary policies allow floor above list | List $100, cost $90, floor 100%, age 94 days gives asks $100, $123, $136, $146, all below its $180 floor | Drop unsafe options rather than clamping them. No descending discount curve exists on these inputs. Tests still generate them and assert unsafe quotes are dropped; monotonicity applies to actually publishable asks. Unrounded concession-step assertions apply where floor ≤ list. |
| Exact accepted offer versus whole-dollar public amounts | An offer of 17001¢ is not a whole dollar | Apply the standing upward-rounding rule: display/agree 17100¢, never reduce the offer. |
| Zero floor percentage versus strictly above cost | At urgency 1 and floor 0%, the target equals cost | Never emit an option at or below cost; drop it rather than raising its price. |

## Gym and core

- SPEC §9.3 limits a Gym run to one selected main product and its bundles. This takes precedence over the prompt's per-shopper product selection; recommendations are not simulated.
- SPEC §5.1 gives Understand a 2.5-second timeout followed by regex extraction. Choose-and-say has a four-second timeout followed by option A and a template. The prompt's blanket template fallback does not replace the more specific Understand rule.
- `USE-CASES.md` retains older cent-valued display examples and a sentence saying whole-dollar rounding is undecided. SPEC §6 and the protected worked example settle it: shopper amounts round up to whole dollars.

Further implementation-specific decisions and verification evidence are recorded per task in `codex-log.md`.
