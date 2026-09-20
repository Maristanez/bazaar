/** Round up to whole shopper-facing dollars, still expressed in cents. */
export function toShopper(cents: number): number {
  return Math.ceil(Number(cents || 0) / 100) * 100;
}

/** "$149" for whole dollars, "$149.50" otherwise. The one money formatter every surface uses. */
export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
