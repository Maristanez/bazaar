import type { CoreHooks } from "./ports";

/** B7 Auditor, B8 approvals, and B9 PAUSE plug in here. B5 deliberately permits all three. */
export const noOpHooks: CoreHooks = {
  pause: async () => true,
  approval: async () => true,
  auditor: async (_offer, audit) => audit,
};
