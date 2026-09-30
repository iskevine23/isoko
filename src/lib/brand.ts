/** Visible product name. Internal modules and the e-Soko source catalog keep their own names. */
export const PRODUCT_NAME = "e-biciro";

export const PRODUCT_TAGLINE = "From raw data to trusted agricultural insights.";

export function pageTitle(page: string) {
  return `${page} — ${PRODUCT_NAME}`;
}
