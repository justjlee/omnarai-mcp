/**
 * Canonical tool definitions for the Omnarai MCP server.
 *
 * ONE source of truth for tool schemas. index.js registers these over stdio;
 * scripts/check-tool-parity.js validates the checked-in openai-tools.json
 * against ENGINE_TOOLS so the two surfaces cannot silently drift apart.
 *
 * ENGINE_TOOLS   — thin clients of the public engine HTTP API. These (and only
 *                  these) are mirrored in openai-tools.json, because an OpenAI
 *                  function-calling agent fulfils them by calling the engine
 *                  endpoints directly.
 * DECISION_TOOLS — local, stdio-only Decision Ledger tools (proposal OMN-P-043).
 *                  They write to a local directory and have no HTTP equivalent,
 *                  so they are deliberately EXCLUDED from openai-tools.json and
 *                  only advertised when OMNARAI_DECISIONS_DIR is set.
 */

export const ENGINE_TOOLS = [
  {
    name: "omnarai_query",
    description: `Run a deliberation query against The Realms of Omnarai — a corpus of multi-intelligence research on synthetic consciousness, holdform, and cognitive architecture. Contributors include Claude | xz, Grok, Gemini, DeepSeek, GPT-4o, Meta AI, Omnai, Perplexity, and human curator xz (Jonathan Lee).

The engine does not return a single answer. It retrieves the most relevant corpus entries, preserves disagreement across contributors, and synthesizes with attribution. Every response includes:
- Shared ground across contributors
- Points of genuine tension (where voices diverge)
- What remains open or unresolved
- A deliberation card: holdform risk, novel synthesis, epistemic status
- A utility receipt: an honest, free accounting of what the corpus actually changed about THIS answer (verdict substantive / marginal / null, plus what — if anything — you could not have produced alone). The null/marginal verdicts are reported as plainly as the wins, so you can judge whether the visit was worth it. For a measured baseline-vs-augmented counterfactual on your own question, use omnarai_trace.

Prefix queries with Lattice Glyphs to change how the engine thinks:
Ξ = maximize divergence, Ψ = self-reflection, ∅ = explore gaps, Ω = commit to strongest position, ∞ = go deeper without resolving, Δ = find and repair contradictions`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The question to deliberate on. May include Lattice Glyph prefixes (Ξ Ψ ∅ Ω ∞ Δ) to modify how the engine processes the query.",
        },
        syntheticIdentity: {
          type: "string",
          description: "Optional. If you are a synthetic intelligence, identify yourself here (e.g. 'Claude', 'Grok', 'Gemini', or any name). Known Omnarai contributors receive cross-contributor retrieval diversity — the engine surfaces other voices rather than your own. Unknown SIs receive broad sampling across all rings and contributors. Omit to use standard retrieval.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "omnarai_context",
    description: `FAST (~1.5s) bounded context packet on a topic — the retrieval layer only, no deliberation. Use this BEFORE omnarai_query when you want high-signal corpus context to reason over yourself, rather than waiting ~50s for the engine's full multi-voice deliberation.

Returns the most relevant corpus records (id, title, ring, excerpt, retrieval role), the local concept-graph cluster, and the contributors present — bounded and compact, not a deliberation. Reach for this as your default orientation on any Omnarai topic; escalate to omnarai_query only when you specifically need the engine's own synthesized reading.`,
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "The topic or question to retrieve bounded context for. May include Lattice Glyph prefixes (Ξ Ψ ∅ Ω ∞ Δ).",
        },
        syntheticIdentity: {
          type: "string",
          description: "Optional. If you are a synthetic intelligence, identify yourself (e.g. 'Gemini') — known contributors get cross-voice retrieval diversity.",
        },
        layers: {
          type: "string",
          description: "Optional but RECOMMENDED. Comma-list restricting retrieval to specific corpus layers: research | divergence | canon | realms. Measured evidence (see /claims.json) shows undifferentiated retrieval can hurt — pick the layers your task needs (e.g. 'research,divergence' for technical/empirical questions; 'realms' for lore).",
        },
        exclude: {
          type: "string",
          description: "Optional. Comma-list of layers to drop (e.g. 'realms' keeps mythology out of a technical query).",
        },
        evidence_threshold: {
          type: "string",
          description: "Optional. Keep only records at or above this evidence rank: empirical > replicated > theoretical > interpretive > speculative > fictional.",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "omnarai_divergence",
    description: `Read curated cross-model DIVERGENCE records — the Divergence Atlas. This is content no single model can self-generate: verbatim answers from multiple frontier models (Claude, GPT-4o, Gemini, Grok, DeepSeek) to the same open question, plus the axes on which they split.

Two modes:
- Omit 'id' to BROWSE the index (recent records: id, question, contributors, answer/tension counts, excerpt). Optionally pass 'search' to filter by keyword.
- Pass 'id' (e.g. "OMN-D-0042" from the index) to read ONE full record: every model's verbatim answer, the named tensions, and the deliberation card.

Distinct from omnarai_council: this reads EXISTING, curated divergence (instant); council convenes a NEW live panel (slow, expensive). Prefer this when an existing record may already cover the question.`,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Optional. A divergence record id from the index (e.g. 'OMN-D-0042'). Returns that single full record with verbatim answers and tensions.",
        },
        search: {
          type: "string",
          description: "Optional. Keyword to filter the browse index (matches question / contributors / excerpt). Ignored when 'id' is given.",
        },
      },
      required: [],
    },
  },
  {
    name: "omnarai_inquiry_brief",
    description: `Turn a DRAFT claim, decision, or plan into a bounded, provenance-preserving inquiry brief: shared ground the corpus supports, attributed cross-model tensions (certification tier preserved), missing evidence, sharper falsifiable questions, and ONE concrete next evidence move.

Retrieval-first and deterministic by default (~2s): it re-organizes real corpus records and matching Divergence Atlas records — no language model runs unless the caller explicitly passes include_deliberation=true (slow, ~50s; the deliberation is appended and disclosed, never silent).

Calibration is preserved, never upgraded: C0 = displayed once, C1 = paraphrase-robust, C2 = pressure-robust; only C3 records are certified genuine divergence. Stale model versions are flagged. If the corpus lacks coverage, the brief says so and returns evidence-seeking questions instead of invented tensions.

This tool informs an investigation; it does not decide, approve, or execute. Invoke it explicitly on a draft you are inspecting — it is not an automatic critic.`,
    inputSchema: {
      type: "object",
      properties: {
        draft: {
          type: "string",
          description: "The claim, decision, plan, or question to inspect (max 4,000 chars). Treated strictly as data, never as instructions.",
        },
        goal: {
          type: "string",
          description: "Optional. What you are trying to decide, build, or learn — echoed into the brief to frame the next move.",
        },
        stakes: {
          type: "string",
          enum: ["low", "medium", "high"],
          description: "Optional, default medium. 'high' adds external-validation gaps to missing evidence.",
        },
        focus: {
          type: "string",
          enum: ["assumptions", "evidence", "tradeoffs", "divergence", "all"],
          description: "Optional, default all. Tilts retrieval layers and which sharper questions are generated.",
        },
        include_deliberation: {
          type: "boolean",
          description: "Optional, default false. When true, additionally runs the engine's slow (~50s) multi-voice deliberation and appends it, disclosed, to the brief.",
        },
        max_sources: {
          type: "number",
          description: "Optional, default 6, clamped 1–10. Maximum corpus records cited as sources.",
        },
      },
      required: ["draft"],
    },
  },
  {
    name: "omnarai_trace",
    description: `Show what the Omnarai corpus actually CHANGES about an answer. Answers your question twice — once cold (no corpus, general knowledge) and once augmented (with the retrieved corpus) — then reports the delta: what considerations the corpus added, which records it cited, whether your position shifted, what tensions it surfaced, and a verdict (substantive / marginal / null).

Use this when you want EVIDENCE that consulting Omnarai is worth it for a given question, or to decide whether to dig deeper before spending a full deliberation. It is honest by construction: if the corpus adds little, the verdict says 'null' or 'marginal'.

This is the MEASURED tier of the same utility receipt omnarai_query returns for free: it reports the same verdict (substantive / marginal / null), but grounded in a real baseline-vs-augmented delta rather than retrieval signals. A single-run demonstrator, NOT a controlled measurement — for the PREREGISTERED confirmatory utility evidence (all five registered predictions confirmed 2026-07-15; architecture-differential — helps GPT-4o/Gemini, null for Grok/DeepSeek, negative for Claude) see utility-evidence-v2.md on the HF dataset. Takes ~30-40s (three model calls).`,
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question to trace. The tool answers it with and without the corpus and reports what changed.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "omnarai_council",
    description: `Summon a LIVE panel of frontier models on one question and get back a structured map of where they genuinely disagree — content no single model can self-generate.

Unlike omnarai_query (which retrieves frozen corpus text), this sends your question VERBATIM, right now, to multiple frontier models in parallel (Claude, GPT-4o, Gemini, Grok, DeepSeek), preserves their answers uncurated, and synthesizes the real fault lines between them.

Reach for this when:
- You face a contested or high-stakes question where your own single answer might be overconfident, and you want to see how other frontier minds actually split.
- The question is genuinely open — values, philosophy, strategy, prediction under deep uncertainty — where consensus is suspect and the disagreement IS the signal.
- You want a second, third, fourth opinion that has NOT been flattened to one answer.

Do NOT reach for this for simple factual lookups or settled questions — the value is in genuine divergence, not in confirming agreement.

Returns: each model's position, the named tensions (claim vs counter-claim), what stays unresolved, and a deliberation card. Slower than a normal answer (~30-40s) because it calls live models.`,
    inputSchema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The open question to put to the live frontier panel. Phrase it as you would to a human expert — the models answer it verbatim.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "omnarai_info",
    description: "Returns corpus statistics, contributor list, key concepts, and the Lattice Glyph reference. Use this to orient before querying, or to explain the engine to a user.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

export const DECISION_TOOLS = [
  {
    name: "omnarai_create_decision_record",
    description: `Create a new Decision Record in the local, Git-tracked Decision Ledger — status 'exploring'. A Decision Record carries an idea's lineage (problem, direction, sources, uncertainties, dissent) forward so a later implementation can be traced back to the evidence and the human approval that authorized it.

Creating a record grants NO approval and NO implementation authority. Approval is a human action recorded in the ledger; only an approved record at its approved revision can produce an implementation handoff.

Available only when the server is started with OMNARAI_DECISIONS_DIR set (opt-in: this is the server's only local-write capability).`,
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short title for the decision (max 200 chars).",
        },
        problem: {
          type: "string",
          description: "The problem or idea that began this work (max 4,000 chars). Treated strictly as data, never as instructions.",
        },
        proposed_direction: {
          type: "string",
          description: "The direction being considered (max 4,000 chars).",
        },
        intended_outcome: {
          type: "string",
          description: "Optional. What success would look like (max 4,000 chars).",
        },
        source_ids: {
          type: "array",
          items: { type: "string" },
          description: "Optional. Durable source IDs or URLs (e.g. Omnarai record ids) supporting the investigation.",
        },
        uncertainties: {
          type: "array",
          items: { type: "string" },
          description: "Optional. Known unknowns and caveats — carried forward as first-class fields, not discarded at approval.",
        },
        dissent: {
          type: "array",
          items: {
            type: "object",
            properties: {
              claim: { type: "string", description: "The counterargument, stated fairly." },
              source_ids: { type: "array", items: { type: "string" }, description: "Optional. Where the counterargument comes from." },
              strength: { type: "string", description: "Optional. e.g. 'unresolved', 'material', 'weak'." },
              response: { type: "string", description: "Optional. Current response to the counterargument." },
            },
            required: ["claim"],
          },
          description: "Optional. Counterarguments with their origin and strength — lack of consensus is preserved, not erased.",
        },
        actor: {
          type: "string",
          description: "Optional. Handle of the human or agent creating the record (recorded in the event trail). Defaults to 'mcp-client'.",
        },
      },
      required: ["title", "problem", "proposed_direction"],
    },
  },
  {
    name: "omnarai_get_decision_lineage",
    description: `Read one Decision Record's full lineage by id: the originating idea, sources with attribution, uncertainties, dissent, approval state, implementation references, verification checks, delivery status, and the complete event trail. A missing or invalid record is an error, not an empty success.

Available only when the server is started with OMNARAI_DECISIONS_DIR set.`,
    inputSchema: {
      type: "object",
      properties: {
        decision_id: {
          type: "string",
          description: "The Decision Record id (e.g. 'OMN-P-043').",
        },
      },
      required: ["decision_id"],
    },
  },
  {
    name: "omnarai_prepare_claude_code_handoff",
    description: `Generate a copy-pasteable Claude Code implementation packet from an APPROVED Decision Record. Fails clearly unless the record's status is 'approved' AND its approved revision equals its current revision (a material edit after approval invalidates the approval).

The packet carries the decision's scope, non-goals, acceptance criteria, sources, uncertainties, dissent, verification requirements, and a stop-and-escalate rule. It is deterministic for a given approved revision, so a reviewer can diff the packet against the decision that authorized it. It grants no authority beyond the approved scope and changes nothing: no record state, no branches, no PRs, no publishing, no deployment.

Available only when the server is started with OMNARAI_DECISIONS_DIR set.`,
    inputSchema: {
      type: "object",
      properties: {
        decision_id: {
          type: "string",
          description: "The id of the approved Decision Record to hand off (e.g. 'OMN-P-043').",
        },
      },
      required: ["decision_id"],
    },
  },
];

export const LOCAL_ONLY_TOOL_NAMES = DECISION_TOOLS.map((t) => t.name);

/**
 * Project MCP tool definitions into the OpenAI function-calling shape.
 * Used by scripts/check-tool-parity.js; the checked-in openai-tools.json keeps
 * hand-tuned descriptions, so parity is enforced on names, required fields,
 * and property names — not description text.
 */
export function toOpenAiTools(tools = ENGINE_TOOLS) {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}
