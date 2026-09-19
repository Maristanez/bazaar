/** Catalog inputs. All money values are cents; one item per cart unit. */
export type Item = {
  variantId: string;
  productId: string;
  title: string;
  size?: string;
  productType: string;
  list: number;
  cost: number | null;
  stockedAt: string | null;
  inStock: boolean;
  isAddOn: boolean;
};
