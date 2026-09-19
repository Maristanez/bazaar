import type { ConsoleEvent } from "@bazaar/contracts";
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const optional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value);
const string = (value: unknown) => typeof value === "string";
function items(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => record(item) && string(item.variantId) && string(item.title) && number(item.qty) && optional(item.size, string));
}
// Validate the boundary before any network-controlled nested value reaches React.
export function isConsoleEvent(value: unknown): value is ConsoleEvent {
  if (!record(value)) return false;
  if (!["at", "negotiationId", "shopperId", "reasoning"].every(key => string(value[key]))) return false;
  if (!["storefront", "chatgpt"].includes(String(value.surface))) return false;
  if (!["decision", "blocked", "approval_requested", "approval_resolved", "settled", "recalled"].includes(String(value.kind))) return false;
  if (value.kind === "blocked" && !["validate", "engine", "check", "auditor"].includes(String(value.blockedBy))) return false;
  if (!["offer", "floor", "cost", "target", "ask", "profit", "round"].every(key => optional(value[key], number))) return false;
  if (!["picked", "memory", "threadId"].every(key => optional(value[key], string))) return false;
  if (!optional(value.menu, menu => Array.isArray(menu) && menu.every(option => record(option) && string(option.id) && string(option.kind) && items(option.items) && number(option.total) && number(option.listTotal) && number(option.ownerRank) && Array.isArray(option.facts) && option.facts.every(string)))) return false;
  if (!optional(value.llm, llm => record(llm) && string(llm.provider) && string(llm.model) && number(llm.ms) && (llm.costUsd === null || number(llm.costUsd)))) return false;
  return optional(value.approval, approval => record(approval) && string(approval.id) && string(approval.negotiationId) && items(approval.items) && ["offer", "cost", "profit", "pctOverCost"].every(key => number(approval[key])) && string(approval.deadline) && Number.isFinite(Date.parse(approval.deadline as string)) && ["requested", "approved", "declined", "timed_out"].includes(String(approval.status)));
}
