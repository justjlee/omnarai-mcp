#!/usr/bin/env node
// check-shape-literals.mjs — fail the release if a corpus-shape count is frozen
// into served source instead of derived live.
//
// Why this exists: the 2026-07-17 audit found omnarai_info hardcoding the corpus's
// shape (3 rings, 7 contributors, a stale 568/528208 fallback) two lines below a
// comment that said "so this can never drift." A comment asserting an invariant is a
// wish; this script is the enforcement. It also caught a stale "568 works" citation
// and a "567-work corpus" tool description on the first run.
//
// Rule: no distinctive corpus-shape literal in served code/strings. Fixes are (a)
// derive it live (see lib/info-format.js), (b) genericize the prose ("a corpus", not
// "a 567-work corpus"), or (c) if it is genuinely a static fallback, append a
// `shape-literal-ok` comment on the line to opt out explicitly.
//
// Scope note: generic ring sub-counts (116/181/17) are deliberately NOT matched —
// too collision-prone to lint. They are guarded instead by live derivation plus
// test/info-format.test.js. Only the distinctive full counts + media ring are matched.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// Files/dirs to scan (served logic + published schemas). Relative to repo root.
const SCAN = ["index.js", "inquiry.js", "lib", "openai-tools.json"];
const SKIP_DIRS = new Set(["node_modules", ".git", "test", "proposals"]);
const SCAN_EXT = new Set([".js", ".mjs", ".cjs", ".json"]);

// Distinctive corpus-shape literals. Add new full counts here as the corpus grows.
const FORBIDDEN = [
  { re: /\b528077\b/, what: "total-word count" },
  { re: /\b528208\b/, what: "total-word count (stale, pre-OMN-085)" },
  { re: /\b567\b/, what: "total-work count" },
  { re: /\b568\b/, what: "total-work count (stale, pre-OMN-085)" },
  { re: /\b253\b/, what: "Media/Oral ring count" },
  { re: /eight synthetic/i, what: "contributor-count phrasing" },
];

// A line is exempt if it is a comment or carries an explicit opt-out.
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
const isAllowed = (line) => /shape-literal-ok/.test(line);

function* walk(path) {
  const st = statSync(path);
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(basename(path))) return;
    for (const e of readdirSync(path)) yield* walk(join(path, e));
  } else if ([...SCAN_EXT].some((x) => path.endsWith(x)) && basename(path) !== "check-shape-literals.mjs") {
    yield path;
  }
}

const hits = [];
for (const entry of SCAN) {
  let target;
  try { target = join(ROOT, entry); statSync(target); } catch { continue; }
  for (const file of walk(target)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (isComment(line) || isAllowed(line)) return;
      for (const { re, what } of FORBIDDEN) {
        if (re.test(line)) {
          hits.push({ file: file.replace(ROOT + "/", ""), line: i + 1, what, text: line.trim().slice(0, 100) });
        }
      }
    });
  }
}

if (hits.length) {
  console.error(`\n🔴 shape-literal check FAILED — ${hits.length} frozen corpus-shape literal(s):\n`);
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.what}]\n    ${h.text}`);
  console.error(`\nFix: derive it live, genericize the prose, or append \`shape-literal-ok\` if it is a real static fallback.\n`);
  process.exit(1);
}
console.log("🟢 shape-literal check passed — no frozen corpus-shape literals in served source.");
