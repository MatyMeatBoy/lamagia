# Bundled mana symbols

These 55 SVGs are copies of the user-supplied mana artwork previously stored
in the untracked public directory. Its provenance note records MTG Wiki's
mana-symbol category and acquisition at the owner's request on 2026-09-03:
https://mtg.fandom.com/wiki/Category:Mana_symbols

All 55 are referenced by the client's symbol mapping. Checked for SVG/XML
structure and absence of scripts, event handlers, external image references,
foreign objects, and entity declarations. Artwork ownership is unchanged;
this is not a new license grant.

Vite imports these files through mana-images.ts, so fresh clones and builds
need no public assets. Vite supplies base-aware URLs or embeds small files.
The client disables public-directory copying to exclude unrelated local assets.
The Pages workflow copies the resulting dist directory. Failed mana images
become their literal symbol text, preserving the pip's accessible label.
Card images opt in via `data-card-name` and fall back to a readable card name when the remote image fails.

Verification: npm run check --workspace=@prossh/client;
npm run build --workspace=@prossh/client;
npx vitest run apps/client/src/mana-images.test.ts.
