import { describe, expect, it } from "vitest";
import { manaImageUrl, recoverManaImage } from "./mana-images.js";

describe("bundled mana images", () => {
  it("resolves every supported asset without a public directory", () => {
    const ids = ["W", "U", "B", "R", "G", "C", "S", "T", "X",
      ...Array.from({ length: 21 }, (_, i) => String(i)),
      "WU", "UB", "BR", "RG", "GW", "WB", "UR", "BG", "RW", "GU",
      "WP", "UP", "BP", "RP", "GP", "2W", "2U", "2B", "2R", "2G",
      "CW", "CU", "CB", "CR", "CG"];
    for (const id of ids) expect(manaImageUrl(id), id).toBeTruthy();
    expect(manaImageUrl("../missing")).toBeUndefined();
  });

  it("replaces only an opted-in mana image with literal fallback text", () => {
    const classes = new Set(["pip", "mana-asset"]);
    const parent = {
      classList: { contains: (c: string) => classes.has(c), remove: (c: string) => classes.delete(c) },
      textContent: "", ariaLabel: "W/U"
    };
    recoverManaImage({ dataset: { manaSymbol: "W/U" }, parentElement: parent } as unknown as HTMLImageElement);
    expect(parent.textContent).toBe("W/U");
    expect(parent.ariaLabel).toBe("W/U");
    expect(classes.has("mana-asset")).toBe(false);
    expect(classes.has("pip")).toBe(true);
  });

  it("does not mutate card images or use their names for recovery", () => {
    const card = { dataset: { cardName: "Forest" }, src: "printing-id.jpg", hidden: false };
    recoverManaImage(card as unknown as HTMLImageElement);
    expect(card).toEqual({ dataset: { cardName: "Forest" }, src: "printing-id.jpg", hidden: false });
  });
});
