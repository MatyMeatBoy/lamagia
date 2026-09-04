/**
 * Public surface of the ProsshTCG rules package.
 *
 * `engine.ts` owns the authoritative game, `projection.ts` owns what a seat is
 * allowed to see, `bot.ts` plays through the same legal-action API a human uses,
 * and `simulator.ts` remains a coarse metadata pressure test for deck plumbing.
 */
export * from "./mana.js";
export * from "./characteristics.js";
export * from "./engine.js";
export * from "./projection.js";
export * from "./undo.js";
export * from "./tested.js";
export * from "./bot.js";
export * from "./simulator.js";
