// Vite owns the URLs, including deployment base paths and production hashing.
const images = import.meta.glob<string>("./assets/mana/*.svg", {
  eager: true, query: "?url", import: "default"
});

export function manaImageUrl(asset: string): string | undefined {
  return images[`./assets/mana/${asset}.svg`];
}

/** Only mana images opt in. Never resolve a card printing by its display name. */
export function recoverManaImage(image: HTMLImageElement): void {
  const symbol = image.dataset.manaSymbol;
  const pip = image.parentElement;
  if (!symbol || !pip?.classList.contains("mana-asset")) return;
  pip.classList.remove("mana-asset");
  pip.textContent = symbol;
}
