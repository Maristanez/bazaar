import type { Option } from "@bazaar/contracts";

export type CheckInput = { menu: readonly Option[]; pick: { optionId: string; line: string } };
export type CheckResult = { ok: true } | { ok: false; reason: string };

function dollars(text: string): number[] | null {
  const amounts: number[] = [];
  for (const match of text.matchAll(/\$/g)) {
    const tail = text.slice(match.index + 1);
    const number = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/.exec(tail)?.[0];
    if (!number) return null;
    const rest = tail.slice(number.length);
    if (/^[\w$]/.test(rest) || /^[,.][\d,.]/.test(rest) || /^,\d/.test(rest)) return null;
    const [whole, fraction = ""] = number.replaceAll(",", "").split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(cents)) return null;
    amounts.push(cents);
  }
  return amounts;
}

function normalize(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "")
    .replace(/\$[\d,]+(?:\.\d{1,2})?/g, (figure) => `$${Number(figure.slice(1).replaceAll(",", ""))}`);
}

function neutralOffer(line: string, option: Option): boolean {
  if (line === "i can hold this price") return true;
  const price = `$${option.total / 100}`;
  const quantity = option.items.reduce((sum, item) => sum + (item.qty || 1), 0);
  const phrases = [
    `i can do ${price}`, `i can offer ${price}`, `how about ${price}`,
    `i can hold ${price} for 15 minutes`,
    ...option.items.map((item) => `${normalize(item.title)} is ready at ${price}`),
    ...(option.items.length === 2 || quantity === 2 ? [`i can do ${price} for both`, `i can offer ${price} for both`] : []),
    ...(option.kind === "final" ? [`my best is ${price}`, `my best stays ${price}`] : []),
  ];
  return phrases.includes(line);
}

/**
 * Pure, fail-closed wording contract: one neutral offer, then exact fact clauses
 * separated by a dash, semicolon, comma, sentence break or "because".
 * Unknown paraphrases fall back; this deliberately makes no semantic-NLP claim.
 */
export function check({ menu, pick }: CheckInput): CheckResult {
  const option = menu.find((candidate) => candidate.id === pick.optionId);
  if (!option) return { ok: false, reason: "unknown_option" };
  if (/\b(?:cost|floor|margin|profit|markup|wholesale)\b/i.test(pick.line)) return { ok: false, reason: "private_word" };
  const allowed = new Set([option.total, option.listTotal, ...option.facts.flatMap((fact) => dollars(fact) ?? [])]);
  const mentioned = dollars(pick.line);
  if (mentioned === null || mentioned.some((value) => !allowed.has(value))) return { ok: false, reason: "unknown_amount" };
  const [offerLine = "", ...reasons] = normalize(pick.line).split(/\s*[;—–]\s*|,\s+|\.\s+|\s+because\s+/).map(normalize);
  const facts = new Set(option.facts.map(normalize));
  if (!neutralOffer(offerLine, option) || reasons.some((reason) => !facts.has(reason))) return { ok: false, reason: "unsupported_reason" };
  return { ok: true };
}
