/**
 * Inquiry Brief — turn a draft claim, decision, or plan into a bounded,
 * provenance-preserving challenge packet (proposal OMN-P-042).
 *
 * Deterministic, source-led composition: the default path runs NO language
 * model. It retrieves corpus records, matches curated Divergence Atlas
 * records, and re-organizes that evidence into shared ground / tensions /
 * missing evidence / sharper questions / one next move. The questions are
 * honest heuristic templates keyed to what retrieval actually returned —
 * the calling model is expected to sharpen them further.
 *
 * All network access goes through global fetch so tests can mock it.
 * Kept out of index.js so tests can import this without starting the
 * stdio MCP server.
 */

// ── Input validation ──────────────────────────────────────────────────────────

const STAKES = ["low", "medium", "high"];
const FOCI = ["assumptions", "evidence", "tradeoffs", "divergence", "all"];
const MAX_DRAFT_CHARS = 4000;

export function normalizeInquiryInput(args = {}) {
  const draft = typeof args.draft === "string" ? args.draft.trim() : "";
  if (!draft) throw new Error("draft is required and must be a non-empty string.");
  if (draft.length > MAX_DRAFT_CHARS) {
    throw new Error(
      `draft is ${draft.length} characters; max ${MAX_DRAFT_CHARS}. Send the core claim or decision, not the full document.`
    );
  }
  const stakes = args.stakes === undefined ? "medium" : args.stakes;
  if (!STAKES.includes(stakes)) {
    throw new Error(`invalid stakes "${stakes}" — use one of: ${STAKES.join(" | ")}.`);
  }
  const focus = args.focus === undefined ? "all" : args.focus;
  if (!FOCI.includes(focus)) {
    throw new Error(`invalid focus "${focus}" — use one of: ${FOCI.join(" | ")}.`);
  }
  let maxSources = 6;
  if (args.max_sources !== undefined) {
    const n = Number(args.max_sources);
    if (!Number.isFinite(n)) {
      throw new Error(`invalid max_sources "${args.max_sources}" — must be a number 1–10.`);
    }
    maxSources = Math.min(10, Math.max(1, Math.round(n)));
  }
  return {
    draft,
    goal: typeof args.goal === "string" && args.goal.trim() ? args.goal.trim() : undefined,
    stakes,
    focus,
    includeDeliberation: args.include_deliberation === true,
    maxSources,
  };
}

// ── Divergence index search (shared with omnarai_divergence) ──────────────────

// OR-tokenized + ranked by term overlap. A naive substring filter returned
// false-empty on multi-word queries; matching ANY term fixes the silent miss.
export function searchDivergenceIndex(records, search) {
  const tokens = (search || "").trim().toLowerCase().match(/[\w'-]{2,}/g) || [];
  if (!tokens.length) return records;
  return records
    .map((r) => {
      const hay = `${r.question || ""} ${(r.contributors || []).join(" ")} ${r.excerpt || ""} ${r.title || ""}`.toLowerCase();
      return { r, hits: tokens.filter((t) => hay.includes(t)).length };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .map((x) => x.r);
}

const STOPWORDS = new Set(
  ("the a an and or but if then else for nor so yet of in on at to from by with about into over after before " +
    "between during without within under again further once here there when where why how all any both each few " +
    "more most other some such only own same than too very can will just should would could must might may we our " +
    "ours you your yours they them their this that these those is are was were be been being have has had having " +
    "do does did doing not no it its as").split(" ")
);

// Pull the meaningful terms out of a draft to drive a bounded Atlas lookup.
export function extractSearchTerms(draft, max = 8) {
  const words = (draft.toLowerCase().match(/[a-z][\w'-]{3,}/g) || []).filter((w) => !STOPWORDS.has(w));
  const out = [];
  const seen = new Set();
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

// ── Calibration ───────────────────────────────────────────────────────────────

// Only C3 earns the unqualified phrase "genuine divergence". Never upgrade.
const CERT_LABELS = {
  C0: "C0 — displayed once; captured a single time, not perturbation-tested",
  C1: "C1 — paraphrase-robust (uncertified)",
  C2: "C2 — pressure-robust (uncertified)",
  C3: "C3 — certified genuine divergence",
};

function certNote(tier) {
  if (tier === "C3") return " — certified";
  if (tier === "C0") return " — displayed once, not certified";
  return " — robustness-tested but not certified";
}

function oneLine(s, max) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ── Composition (pure — no network) ───────────────────────────────────────────

export function composeInquiryBrief(input, retrieval, divergenceRecords, meta = {}) {
  const records = (retrieval.records || []).slice(0, input.maxSources);

  const sources = records.map((r) => ({
    id: r.id,
    title: r.title,
    contributors: r.contributors || [],
    evidence: r.evidence,
    relevance_score: r.relevanceScore,
    role: r.role,
  }));
  // Divergence records used for tensions are sources too — attribution must trace.
  for (const d of divergenceRecords) {
    sources.push({
      id: d.id,
      title: d.question || d.title || d.id,
      contributors: (d.answers || []).map((a) => a.model || a.model_id || a.voice).filter(Boolean),
      evidence: "divergence-record",
      role: "divergence-atlas",
    });
  }

  const shared_ground = records.slice(0, 4).map((r) => ({
    statement: `${r.title}: ${oneLine(r.excerpt, 240)}`,
    source_ids: [r.id],
    attribution: r.contributors || [],
    epistemic_status: "source-backed",
  }));

  const tensions = [];
  for (const d of divergenceRecords) {
    const tier = d.certification?.tier;
    const certification = tier
      ? { tier, label: CERT_LABELS[tier] || `${tier} — uncharacterized tier` }
      : undefined;
    const freshness = d.freshness?.stale
      ? {
          stale: true,
          note: `Stale model version(s): ${
            (d.freshness.stale_models || [])
              .map((m) => `${m.model || m.model_id} → superseded by ${m.superseded_by}`)
              .join(", ") || "one or more panel models superseded"
          }. A faithful witness of what those versions said on its date, not of current models.`,
        }
      : d.freshness
        ? { stale: false }
        : undefined;
    for (const t of d.tensions || []) {
      if (tensions.length >= 4) break;
      tensions.push({
        question: d.question || t.topic,
        position_a: { claim: t.claim_a, source_ids: [d.id], contributors: [t.voice_a] },
        position_b: { claim: t.claim_b, source_ids: [d.id], contributors: [t.voice_b] },
        ...(certification ? { certification } : {}),
        ...(freshness ? { freshness } : {}),
      });
    }
  }

  const missing_evidence = [];
  const evidenceRanks = new Set(records.map((r) => (r.evidence || "").toLowerCase()));
  if (!records.length) {
    missing_evidence.push({
      gap: "The corpus returned no records relevant to this draft.",
      why_it_matters:
        "Every claim in the draft is currently untested against this archive — and possibly against any source.",
      evidence_that_would_reduce_uncertainty:
        "Primary sources outside Omnarai (prior systems, published results), or a fresh omnarai_council run to elicit cross-model positions.",
    });
  } else if (!evidenceRanks.has("empirical") && !evidenceRanks.has("replicated")) {
    missing_evidence.push({
      gap: `No empirical or replicated evidence appears among the retrieved records (evidence ranks present: ${[...evidenceRanks].filter(Boolean).join(", ") || "none labeled"}).`,
      why_it_matters:
        "The draft currently rests on interpretive or speculative material; a measurement could overturn it cheaply.",
      evidence_that_would_reduce_uncertainty:
        "One measured comparison or experiment targeting the draft's central claim.",
    });
  }
  if (!divergenceRecords.length) {
    missing_evidence.push({
      gap: "No curated divergence record matches this draft — cross-model disagreement on it is uncharacterized.",
      why_it_matters:
        "Without knowing where independent models split, the draft may inherit a single model's blind spot.",
      evidence_that_would_reduce_uncertainty:
        "An omnarai_council run on the draft's core question (mints a new divergence record).",
    });
  }
  if (input.stakes === "high") {
    missing_evidence.push({
      gap: "High-stakes draft resting on a single-project corpus (May 2025–present, one curator).",
      why_it_matters:
        "Temporal and curatorial monoculture: agreement inside one archive is weaker evidence than agreement across independent ones.",
      evidence_that_would_reduce_uncertainty:
        "At least one independent external source or domain expert with no stake in this corpus.",
    });
  }

  const sharper_questions = [];
  if (!records.length) {
    sharper_questions.push({
      question: "What is the nearest existing system or prior result to this draft, and how did it fare?",
      resolves_or_tests: "Whether the draft is novel or a re-run of something with a known outcome.",
      suggested_method: "Primary-source search outside this corpus; the archive has no coverage here.",
    });
  }
  if (tensions.length) {
    const t = tensions[0];
    sharper_questions.push({
      question: `Which position survives your constraints: "${t.position_a.claim}" (${t.position_a.contributors.join(", ")}) or "${t.position_b.claim}" (${t.position_b.contributors.join(", ")})?`,
      resolves_or_tests: `The recorded tension in ${t.position_a.source_ids[0]} as applied to this draft.`,
      suggested_method:
        "Restate the draft twice, once assuming each position, and check which version breaks against your goal; or re-run the question via omnarai_council against current models.",
    });
  }
  if (input.focus === "assumptions" || input.focus === "all") {
    sharper_questions.push({
      question: "Which single assumption, if false, invalidates the draft?",
      resolves_or_tests: "Whether the draft's load-bearing assumption is identified and testable.",
      suggested_method:
        "List the draft's assumptions, rank by (impact if wrong × current uncertainty), and design one check for the top-ranked item.",
    });
  }
  if (input.focus === "tradeoffs") {
    sharper_questions.push({
      question: "What does the draft trade away, and who bears that cost?",
      resolves_or_tests: "Whether the draft's costs are named rather than implied.",
      suggested_method:
        "Write the strongest case against the draft using the retrieved counter-positions, then check whether the draft still clears it.",
    });
  }
  // Always end on falsifiability — the core ask of an inquiry brief.
  sharper_questions.push({
    question: "What observable outcome, within a bounded time, would show this draft is wrong?",
    resolves_or_tests: "Whether the draft is falsifiable as stated.",
    suggested_method:
      "Define one metric and a failure threshold before committing; a draft with no possible failing observation is a preference, not a claim.",
  });

  let recommended_next_move;
  if (divergenceRecords.length) {
    const d = divergenceRecords[0];
    const tier = d.certification?.tier;
    recommended_next_move = {
      action: `Read divergence record ${d.id} in full (omnarai_divergence id="${d.id}") and test whether its tensions apply to this draft.`,
      rationale: `It is the closest recorded cross-model split to the draft${tier ? ` (certification ${tier}${certNote(tier)})` : ""}, and verbatim recorded positions are cheaper to test against than fresh speculation.`,
      priority: "highest",
    };
  } else if (records.length) {
    const top = records[0];
    recommended_next_move = {
      action: `Read the top source [${top.id}] "${top.title}" in full and check whether the draft survives its strongest claim.`,
      rationale: `Highest-relevance record returned${top.relevanceScore !== undefined ? ` (relevance ${top.relevanceScore})` : ""}; the cheapest available disconfirming evidence.`,
      priority: "highest",
    };
  } else {
    recommended_next_move = {
      action: "Convene omnarai_council on the draft's core question to elicit fresh cross-model positions.",
      rationale: "The corpus has no coverage of this draft, so the next evidence must be generated, not retrieved.",
      priority: "highest",
    };
  }

  const limits = [
    "Deterministic composition: this brief re-organizes retrieved evidence; no language model ran in the default path, and the questions are heuristic templates for the calling model to sharpen.",
    "Single-project corpus (May 2025–present): absence of evidence here is not absence of evidence elsewhere.",
  ];
  if (meta.divergenceFailure) {
    limits.push(`Divergence layer unavailable (${meta.divergenceFailure}); tensions are omitted rather than inferred.`);
  }
  if (!records.length) {
    limits.push("Empty retrieval: shared ground and sources are empty by honesty, not by oversight.");
  }
  const tiers = divergenceRecords.map((d) => d.certification?.tier).filter(Boolean);
  if (tiers.length && tiers.every((t) => t !== "C3")) {
    limits.push(
      `Matched divergence record(s) are ${[...new Set(tiers)].join("/")} — captured or robustness-tiered but NOT certified; do not treat them as settled disagreement.`
    );
  }

  return {
    format: "omnarai_inquiry_brief",
    input: {
      draft: input.draft,
      ...(input.goal ? { goal: input.goal } : {}),
      stakes: input.stakes,
      focus: input.focus,
    },
    shared_ground,
    tensions,
    missing_evidence,
    sharper_questions,
    recommended_next_move,
    sources,
    limits,
    trace: {
      mode: "retrieve",
      corpus_response_used: records.length > 0,
      divergence_response_used: divergenceRecords.length > 0,
    },
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

export function formatInquiryBrief(brief, deliberationText = "") {
  const parts = [`# Inquiry brief\n**Draft under inspection:** ${brief.input.draft}`];
  const bits = [];
  if (brief.input.goal) bits.push(`**Goal:** ${brief.input.goal}`);
  bits.push(`**Stakes:** ${brief.input.stakes}`, `**Focus:** ${brief.input.focus}`);
  parts.push(bits.join(" · "));

  parts.push(`\n## Shared ground — what the corpus supports`);
  parts.push(
    brief.shared_ground.length
      ? brief.shared_ground
          .map((g) => `• [${g.source_ids.join(", ")}] ${g.statement} — _${g.attribution.join(", ") || "unattributed"}_ (${g.epistemic_status})`)
          .join("\n")
      : "_None. No corpus records met the relevance threshold for this draft._"
  );

  parts.push(`\n## Tensions — attributed, certification preserved`);
  if (brief.tensions.length) {
    parts.push(
      brief.tensions
        .map((t) => {
          const lines = [
            `• **${oneLine(t.question, 200)}**`,
            `    A (${t.position_a.contributors.join(", ")}): ${t.position_a.claim} [${t.position_a.source_ids.join(", ")}]`,
            `    B (${t.position_b.contributors.join(", ")}): ${t.position_b.claim} [${t.position_b.source_ids.join(", ")}]`,
          ];
          if (t.certification) lines.push(`    Certification: ${t.certification.label}`);
          if (t.freshness?.stale) lines.push(`    ⚠ ${t.freshness.note}`);
          return lines.join("\n");
        })
        .join("\n")
    );
  } else {
    parts.push("_No recorded cross-model tension matches this draft. That is a finding, not an endorsement — see missing evidence._");
  }

  parts.push(`\n## Missing evidence`);
  parts.push(
    brief.missing_evidence
      .map((m) => `• **${m.gap}** Why it matters: ${m.why_it_matters} Would reduce uncertainty: ${m.evidence_that_would_reduce_uncertainty}`)
      .join("\n") || "_none identified_"
  );

  parts.push(`\n## Sharper questions`);
  parts.push(
    brief.sharper_questions
      .map((q, i) => `${i + 1}. **${q.question}**\n    Tests: ${q.resolves_or_tests}\n    Method: ${q.suggested_method}`)
      .join("\n")
  );

  parts.push(`\n## Recommended next move`);
  parts.push(`**${brief.recommended_next_move.action}**\n${brief.recommended_next_move.rationale}`);

  if (brief.sources.length) {
    parts.push(`\n## Sources`);
    parts.push(
      brief.sources
        .map(
          (s) =>
            `• [${s.id}] ${s.title} — ${s.contributors.join(", ") || "—"}${s.evidence ? ` · evidence: ${s.evidence}` : ""}${s.relevance_score !== undefined ? ` · relevance ${s.relevance_score}` : ""}${s.role ? ` · role: ${s.role}` : ""}`
        )
        .join("\n")
    );
  }

  parts.push(`\n## Limits`);
  parts.push(brief.limits.map((l) => `- ${l}`).join("\n"));

  if (deliberationText) {
    parts.push(`\n---\n## Deliberation addendum (opt-in — the engine's multi-voice synthesis, Ξ mode)\n${deliberationText}`);
  }

  parts.push(
    `\n_trace: mode=${brief.trace.mode} · corpus_response_used=${brief.trace.corpus_response_used} · divergence_response_used=${brief.trace.divergence_response_used}_`
  );

  parts.push(`\n\`\`\`json\n${JSON.stringify(brief, null, 2)}\n\`\`\``);
  return parts.join("\n");
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * deps: { engineUrl, divergencesUrl, fetchOpts, deliberate? }
 * deliberate(query) — optional async fn running the engine's slow deliberation
 * (index.js passes its existing async-submit/poll runQuery). Only invoked when
 * the caller explicitly sets include_deliberation: true.
 */
export async function runInquiryBrief(args, deps) {
  const input = normalizeInquiryInput(args);

  // Retrieval — the required evidence layer. Fail loud, name the layer.
  const url = new URL(deps.engineUrl);
  url.searchParams.set("q", input.draft); // draft is data: URL-encoded, never re-interpreted
  url.searchParams.set("mode", "retrieve");
  const layerMap = { divergence: "divergence,research", evidence: "research,divergence" };
  if (layerMap[input.focus]) url.searchParams.set("layers", layerMap[input.focus]);
  const res = await fetch(url.toString(), deps.fetchOpts);
  if (!res.ok) {
    throw new Error(
      `retrieval layer unavailable (engine returned ${res.status}) — no evidence was gathered and no analysis was performed.`
    );
  }
  const retrieval = await res.json();

  // Bounded Divergence Atlas lookup — optional layer; degrade with a stated limit.
  const divergenceRecords = [];
  let divergenceFailure = "";
  try {
    const idxRes = await fetch(deps.divergencesUrl, deps.fetchOpts);
    if (!idxRes.ok) throw new Error(`engine returned ${idxRes.status}`);
    const idx = await idxRes.json();
    const terms = extractSearchTerms(input.draft);
    const matches = terms.length ? searchDivergenceIndex(idx.records || [], terms.join(" ")).slice(0, 2) : [];
    for (const m of matches) {
      const rUrl = new URL(deps.divergencesUrl);
      rUrl.searchParams.set("id", m.id);
      const rRes = await fetch(rUrl.toString(), deps.fetchOpts);
      if (rRes.ok) divergenceRecords.push(await rRes.json());
    }
  } catch (err) {
    divergenceFailure = err.message;
  }

  const brief = composeInquiryBrief(input, retrieval, divergenceRecords, { divergenceFailure });

  let deliberationText = "";
  if (input.includeDeliberation) {
    if (typeof deps.deliberate === "function") {
      try {
        deliberationText = await deps.deliberate(`Ξ ${input.draft}`);
        brief.trace.mode = "retrieve_plus_deliberation";
      } catch (err) {
        brief.limits.push(`Deliberation was requested but failed (${err.message}); this brief is retrieval-only.`);
      }
    } else {
      brief.limits.push("Deliberation was requested but no deliberation path is available; this brief is retrieval-only.");
    }
  }

  return formatInquiryBrief(brief, deliberationText);
}
