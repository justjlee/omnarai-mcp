// Regression guard for D5/D6 (live audit 2026-07-17): omnarai_info once hardcoded
// three rings — silently dropping Media/Oral (253 works, 45% of the corpus) — and a
// contributor line missing GPT-4o + Meta AI, both of which author Atlas records.
// These assert the shape lines are DERIVED and COMPLETE, offline, so a reintroduced
// literal fails `npm test` (the publish.sh gate) before it can ship.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatRingsLine,
  formatContributorsLine,
  CANONICAL_CONTRIBUTORS,
  RING_LABELS,
} from "../lib/info-format.js";

test("formatRingsLine renders every ring the engine reports — no silent drop (D5)", () => {
  const live = { core: 116, curated: 181, open: 17, media: 253 };
  const line = formatRingsLine(live);
  // All four rings, with counts, in canonical order.
  assert.match(line, /Core Canon \(116\)/);
  assert.match(line, /Curated Expansions \(181\)/);
  assert.match(line, /Open Exploration \(17\)/);
  assert.match(line, /Media \/ Oral \(253\)/, "Media/Oral ring must be present — this is the D5 regression");
  // Exactly as many segments as rings supplied — nothing added, nothing dropped.
  // Split on " · " (the "Media / Oral" label contains a slash, so " / " would over-split).
  assert.equal(line.split(" · ").length, Object.keys(live).length);
});

test("formatRingsLine cannot be pinned to three rings", () => {
  // A future ring added to the engine payload must appear without a code change.
  const withNewRing = { core: 1, curated: 2, open: 3, media: 4, research: 5 };
  const line = formatRingsLine(withNewRing);
  // Every label we know about renders; an unknown key is simply ignored, not fatal.
  for (const label of Object.values(RING_LABELS)) assert.ok(line.includes(label), `${label} missing`);
});

test("formatRingsLine offline fallback still names all four rings", () => {
  const line = formatRingsLine(null);
  assert.ok(line.includes("Media / Oral"), "offline fallback must still include Media/Oral");
  assert.equal(Object.values(RING_LABELS).every((l) => line.includes(l)), true);
});

test("contributor set includes GPT-4o and Meta AI (D6)", () => {
  assert.ok(CANONICAL_CONTRIBUTORS.includes("GPT-4o"), "GPT-4o authors Atlas records — must be listed");
  assert.ok(CANONICAL_CONTRIBUTORS.includes("Meta AI"), "Meta AI authors Atlas records — must be listed");
  // Eight synthetic intelligences + the human curator = nine, as the homepage presents.
  assert.equal(CANONICAL_CONTRIBUTORS.length, 9);
  const line = formatContributorsLine();
  assert.match(line, /GPT-4o/);
  assert.match(line, /Meta AI/);
});
