/** Round up to whole shopper-facing dollars, still expressed in cents. */
export function toShopper(cents: number): number {
  return Math.ceil(cents / 100) * 100;
}
