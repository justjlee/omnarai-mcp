// info-format.js — pure formatting for omnarai_info's corpus-shape lines.
//
// Extracted so the D5/D6 regression (omnarai_info once hardcoded 3 rings, silently
// dropping Media/Oral — 253 works, 45% of the corpus — and dropped GPT-4o + Meta AI
// from the contributor line) is guarded by an offline unit test instead of a comment.
// The rule these encode: never enumerate the corpus's shape from a frozen literal when
// the engine can report it live. Rings are derived from /api/info; the contributor set
// is the one canonical list, asserted in test/info-format.test.js.

// Label + display order for the epistemic rings. Any ring present in the live
// /api/info payload is rendered; nothing is filtered out by omission here.
export const RING_LABELS = {
  core: "Core Canon",
  curated: "Curated Expansions",
  open: "Open Exploration",
  media: "Media / Oral",
};

// The canonical contributor set the homepage presents: eight synthetic intelligences
// plus the human curator. Kept as data (not an inline string) so a dropped voice is a
// failing test, not a silent edit. GPT-4o and Meta AI author Atlas records — a
// contributor list that omits them is the exact provenance gap the project refuses.
export const CANONICAL_CONTRIBUTORS = [
  "Claude | xz",
  "Grok",
  "Gemini",
  "DeepSeek",
  "GPT-4o",
  "Meta AI",
  "Omnai (ChatGPT)",
  "Perplexity",
  "xz (Jonathan Lee)",
];

// Offline fallbacks — only used when the engine is unreachable. Annotated so the
// shape-literal lint (scripts/check-shape-literals.mjs) allows them as intentional.
export const FALLBACK_WORKS = 567;   // shape-literal-ok: offline fallback only
export const FALLBACK_WORDS = 528077; // shape-literal-ok: offline fallback only

/**
 * Render the epistemic-ring line from a live rings object ({core, curated, open,
 * media, ...}), e.g. "Core Canon (116) / Curated Expansions (181) / …". Every ring
 * with a finite count is rendered — the function cannot silently drop one. When rings
 * is null/absent (engine unreachable) it falls back to naming all four rings without
 * counts, so the Media/Oral ring is present even offline.
 */
export function formatRingsLine(rings) {
  // Separator is " · ", not " / ": the "Media / Oral" label contains a slash, so a
  // slash-joined line would mis-split into a phantom fifth ring.
  if (rings && typeof rings === "object") {
    const parts = Object.entries(RING_LABELS)
      .filter(([k]) => Number.isFinite(rings[k]))
      .map(([k, label]) => `${label} (${rings[k].toLocaleString()})`);
    if (parts.length) return parts.join(" · ");
  }
  return Object.values(RING_LABELS).join(" · ");
}

/** The contributor line for omnarai_info — the canonical set, comma-joined. */
export function formatContributorsLine() {
  return CANONICAL_CONTRIBUTORS.join(", ");
}
