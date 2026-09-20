import { expect, it } from "vitest";
import type { Option } from "@bazaar/contracts";
import { check } from "./check";

const held: Option = { id: "A", kind: "held", total: 16900, listTotal: 16900, ownerRank: 1, items: [{ variantId: "tr3-10", title: "Trail Runner 3", size: "10", qty: 1 }], facts: [] };
const c1: Option = { id: "C1", kind: "else", total: 12000, listTotal: 14900, ownerRank: 2, items: [{ variantId: "tr2-10", title: "Trail Runner 2", size: "10", qty: 1 }], facts: ["stocked 94 days ago", "list $149"] };
const menu = [held, c1];
const verdict = (optionId: string, line: string) => check({ menu, pick: { optionId, line } });

it("blocks an invented option id", () => {
  expect(verdict("invented", "I can do $120.")).toEqual({ ok: false, reason: "unknown_option" });
});

it("blocks an invented dollar figure", () => {
  expect(verdict("C1", "I can do $119.")).toEqual({ ok: false, reason: "unknown_amount" });
});

it("blocks private money words case-insensitively", () => {
  for (const word of ["cost", "FLOOR", "Margin", "profit", "markup", "wholesale"]) {
    expect(verdict("C1", `I can do $120, above ${word}.`)).toEqual({ ok: false, reason: "private_word" });
  }
});

it("blocks a reason with no supplied fact", () => {
  expect(verdict("C1", "I can do $120 because this is the last pair.")).toEqual({ ok: false, reason: "unsupported_reason" });
});

it("passes a clean offer with its supplied facts, and the option-A template line", () => {
  expect(verdict("C1", "I can do $120 — stocked 94 days ago; list $149.")).toEqual({ ok: true });
  expect(verdict("A", "I can hold $169 for 15 minutes.")).toEqual({ ok: true });
});

it("does not let a list figure masquerade as the agreed total", () => {
  expect(verdict("C1", "I can do $149.")).toEqual({ ok: false, reason: "unsupported_reason" });
});

it("rejects extra claims even when a valid fact is present", () => {
  for (const line of [
    "I can do $120 — stocked 94 days ago and this is the last pair.",
    "I can do $120 — stocked 94 days ago; free shipping.",
    "I can do $120 because not stocked 94 days ago.",
    "I can do $120 for both.",
  ]) expect(verdict("C1", line)).toEqual({ ok: false, reason: "unsupported_reason" });
});

it("rejects malformed dollar syntax rather than matching a valid numeric prefix", () => {
  for (const figure of ["$120.000", "$120e3", "$1,20", "$$120", "$-120", "$120abc"]) {
    expect(verdict("C1", `I can do ${figure}.`).ok).toBe(false);
  }
});

it("checks total, list and fact figures with exact cents and word boundaries", () => {
  const option: Option = { id: "B1", kind: "bundle", total: 14700, listTotal: 16700, ownerRank: 1,
    items: [{ variantId: "shoe", title: "Costume Runner", qty: 1 }, { variantId: "socks", title: "Socks", qty: 1 }],
    facts: ["list $167 for both", "socks list $18"],
  };
  expect(check({ menu: [option], pick: { optionId: "B1", line: "I can do $147.00 for both — socks list $18; list $167 for both." } })).toEqual({ ok: true });
  expect(check({ menu: [option], pick: { optionId: "B1", line: "I can do $147 for both — socks list $19." } })).toEqual({ ok: false, reason: "unknown_amount" });
  expect(check({ menu: [option], pick: { optionId: "B1", line: "Costume Runner is ready at $147." } })).toEqual({ ok: true });
  const twoSocks: Option = { ...option, id: "S2", kind: "held", total: 3600, listTotal: 3600, items: [{ variantId: "socks", title: "Socks", qty: 2 }], facts: [] };
  expect(check({ menu: [twoSocks], pick: { optionId: "S2", line: "I can do $36 for both." } })).toEqual({ ok: true });
  const large = { ...option, total: 123400, listTotal: 150000, facts: ["list $1500 for both"] };
  expect(check({ menu: [large], pick: { optionId: "B1", line: "I can do $1,234.00 for both — list $1,500 for both." } })).toEqual({ ok: true });
});
