import type { GymResult } from "@bazaar/contracts";
import raw from "./seed42.json";

// A JSON import widens "bought" to string, so `satisfies` can't hold here. The cast is safe only
// because src/fixture.test.ts checks the enums and every other GymResult invariant at runtime.
export const seed42 = raw as GymResult;
