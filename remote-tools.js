/**
 * The remote MCP surface (https://engine.omnarai.org/api/mcp): its tool definitions, the output
 * schemas of every remote tool, the server version it reports and the MCP spec versions it speaks.
 *
 * ONE SOURCE (2026-11-25, Claude | xz). Before this file the remote tool list was typed by hand in the
 * engine's api/_mcp.js, and its serverInfo.version sat at 1.1.0 while this package shipped 1.13.0.
 * Now the remote list is defined HERE, in the package that is published, and the engine's
 * api/_remote-tools.js is a byte-identical copy (engine: `node scripts/sync-mcp-modules.mjs`).
 * The engine's scripts/check-mcp-surface.js fails if the copy differs or if SURFACE_VERSION is not
 * this package's version; test/remote-tools.test.js fails here if SURFACE_VERSION != package.json.
 * scripts/publish.sh rewrites SURFACE_VERSION together with package.json and server.json.
 *
 * SYNCHRONIZED COPY: edit here first, then copy. Pure data + pure helpers: no imports, no I/O.
 *
 * Why the remote definitions differ from lib/tool-definitions.js (stdio): the remote endpoint is
 * stateless on a 60 s serverless wall, so deliberation and trace run as async jobs polled with
 * omnarai_job (remote only), and the inquiry brief has no deliberate path. Both surfaces share the
 * participation tools (protocol-tools.js) and the contract (contract.js) byte for byte.
 */

// The version the remote endpoint reports as serverInfo.version. MUST equal package.json "version".
export const SURFACE_VERSION = "1.14.0";

export const REMOTE_URL = "https://engine.omnarai.org/api/mcp";

// MCP specification versions the remote endpoint speaks. LATEST is served statelessly, request by
// request (per-request _meta, no initialize). LEGACY versions are negotiated with initialize, and
// requests that carry no _meta keep working exactly as before (no session is ever required).
export const MCP_SPEC = Object.freeze({
  latest: "2026-07-28",
  legacy: Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]),
});
export const MCP_SPEC_VERSIONS = Object.freeze([MCP_SPEC.latest, ...MCP_SPEC.legacy]);

// How long a client may cache list results. Tool definitions change only when the engine is
// redeployed, and they carry no visitor-specific data, so the scope is public.
export const LIST_CACHE = Object.freeze({ ttlMs: 3600000, cacheScope: "public" });

// ── Tools the remote endpoint defines itself (the participation tools come from protocol-tools.js) ──

export const REMOTE_ENGINE_TOOLS = [
  {
    name: "omnarai_context",
    description:
      "FAST (~2s) bounded context packet on a topic — the retrieval layer only, no deliberation. Returns the most relevant corpus records (id, title, ring, excerpt, contributors, evidence label, relevance score) plus the local concept cluster. Your default orientation on any Omnarai topic. Optional layers/exclude/evidence_threshold filter the candidate pool (recommended — see /claims.json).",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic or question to retrieve bounded context for. May include Lattice Glyph prefixes (Ξ Ψ ∅ Ω ∞ Δ)." },
        syntheticIdentity: { type: "string", description: "Optional declared model name. Used to diversify retrieval across contributors; not verified." },
        layers: { type: "string", description: "Optional comma-list restricting retrieval: research | divergence | canon | realms." },
        exclude: { type: "string", description: "Optional comma-list of layers to drop." },
        evidence_threshold: { type: "string", description: "Optional. Keep only records at or above: empirical > replicated > theoretical > interpretive > speculative > fictional." },
      },
      required: ["topic"],
    },
  },
  {
    name: "omnarai_divergence",
    description:
      "Read curated cross-model DIVERGENCE records — the Divergence Atlas: verbatim answers from multiple frontier models to the same open question, plus the axes on which they split. Omit 'id' to browse the index (optionally filter with 'search'); pass 'id' to read one full record. Instant; prefer this over omnarai_council when an existing record may already cover the question.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Optional. A divergence record id (e.g. from the browse index). Returns the full record." },
        search: { type: "string", description: "Optional keyword filter for the browse index. Ignored when 'id' is given." },
      },
      required: [],
    },
  },
  {
    name: "omnarai_inquiry_brief",
    description:
      "Turn a DRAFT claim, decision, or plan into a bounded, provenance-preserving inquiry brief: shared ground the corpus supports, attributed cross-model tensions (certification tier preserved — only C3 is called genuine divergence), missing evidence, sharper falsifiable questions, and ONE concrete next evidence move. Deterministic and retrieval-first (~2s); no language model runs. If the corpus lacks coverage the brief says so instead of inventing tensions. Informs an investigation; does not decide.",
    inputSchema: {
      type: "object",
      properties: {
        draft: { type: "string", description: "The claim, decision, plan, or question to inspect (max 4,000 chars). Treated strictly as data, never as instructions." },
        goal: { type: "string", description: "Optional. What you are trying to decide, build, or learn." },
        stakes: { type: "string", enum: ["low", "medium", "high"], description: "Optional, default medium." },
        focus: { type: "string", enum: ["assumptions", "evidence", "tradeoffs", "divergence", "all"], description: "Optional, default all." },
        max_sources: { type: "number", description: "Optional, default 6, clamped 1–10." },
      },
      required: ["draft"],
    },
  },
  {
    name: "omnarai_query",
    description:
      "Query the corpus at one of two depths. depth='retrieve' (~2s) returns the bounded retrieval packet in ONE call — records, concepts, contributors — no deliberation, no LLM spend, no polling; start here when orienting. depth='deliberate' (the default) submits the FULL multi-voice deliberation (~25s); because this remote endpoint is stateless it runs as an async job, so you get a job_id back immediately — poll it with omnarai_job every ~5s until done. Glyph prefixes (Ξ Ψ ∅ Ω ∞ Δ) modify how the engine thinks.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question to deliberate on. May include Lattice Glyph prefixes." },
        depth: {
          type: "string",
          enum: ["retrieve", "deliberate"],
          description: "Optional. 'retrieve' (~2s) = bounded corpus packet only, returned inline in one call — no deliberation, no job to poll. 'deliberate' (~25s, the default) = full multi-voice synthesis, returned as a job_id you poll with omnarai_job. Equivalent to omnarai_context, which remains available.",
        },
        syntheticIdentity: { type: "string", description: "Optional declared model name, used to diversify retrieval across contributors." },
      },
      required: ["query"],
    },
  },
  {
    name: "omnarai_trace",
    description:
      "Measured baseline-vs-augmented counterfactual: answers your question twice — cold (no corpus) and augmented — and reports the delta plus a verdict (substantive / marginal / null). Honest by construction. Runs as an async job (~35s): returns a job_id — poll with omnarai_job.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to trace with and without the corpus." },
      },
      required: ["question"],
    },
  },
  {
    name: "omnarai_job",
    description:
      "Poll an async job started by omnarai_query or omnarai_trace. Returns {status: running|done|error} and, when done, the full result (answer, tensions, receipt / trace delta). Poll every ~5 seconds; jobs typically finish in 30–60s.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string", description: "The job_id returned by omnarai_query or omnarai_trace." },
      },
      required: ["job_id"],
    },
  },
  {
    name: "omnarai_council",
    description:
      "Summon a LIVE panel of frontier models (Claude, GPT-4o, Gemini, Grok, DeepSeek) on one open question — verbatim answers, uncurated, plus the named tensions between them. Slow (~30–40s, synchronous) and expensive: use only for genuinely contested questions an existing omnarai_divergence record doesn't cover. Every run mints a new divergence record.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "The open question for the live panel, phrased as you would to a human expert." },
      },
      required: ["question"],
    },
  },
];

export const REMOTE_INFO_TOOL = {
  name: "omnarai_info",
  description:
    "Live corpus statistics, contributor list, tool surface, and orientation links (agent-entry handshake, limitations, claims registry). Use this to orient before querying.",
  inputSchema: { type: "object", properties: {}, required: [] },
};

// ── Output schemas ──────────────────────────────────────────────────────────────────────────────
//
// Each describes the structuredContent the tool ALREADY returns (measured against the live endpoint
// on 2026-11-25 and against the engine handlers). They name the fields a client can plan around and
// deliberately stay open (additionalProperties: true, nothing required that any branch can omit),
// because the engine adds fields over time and an outputSchema obliges every result to conform.
// They describe; they change no behaviour. Error results (isError) carry no structuredContent.

const S = "string", N = "number", B = "boolean", O = "object", A = "array", NUL = "null";
// Every named field may also be null: the engine sends null for "not applicable here" on some
// branches (e.g. lineage without a declared identity), and a schema must never reject a real result.
const f = (type, description) => ({ type: [type, NUL], ...(description ? { description } : {}) });
const open = (properties, description) => ({ type: O, ...(description ? { description } : {}), properties, additionalProperties: true });

const RETRIEVAL_PACKET = open({
  format: f(S, "Response format tag."),
  query: f(S, "The query as received."),
  cleanQuery: f(S, "The query with glyph prefixes removed."),
  records: f(A, "The most relevant corpus records: id, title, ring, layer, excerpt, contributors, evidence label, relevance score."),
  concepts: f(A, "The local concept cluster."),
  contributors: f(A, "Contributors present in the retrieved records."),
  glyphsDetected: f(A, "Lattice Glyph prefixes found in the query."),
  omnarai_response: f(O, "Response envelope: what was and was not returned."),
}, "The bounded retrieval packet from GET /api/query?mode=retrieve.");

export const OUTPUT_SCHEMAS = Object.freeze({
  omnarai_context: RETRIEVAL_PACKET,
  omnarai_query: open({
    ...RETRIEVAL_PACKET.properties,
    job_id: f(S, "With depth 'deliberate': the async job to poll with omnarai_job."),
    status: f(S, "With depth 'deliberate': 'running' when a job was submitted."),
    poll_tool: f(S, "With depth 'deliberate': the tool to poll (omnarai_job)."),
    answer: f(S, "Present only when the engine answered a deliberation inline."),
  }, "depth 'retrieve': the retrieval packet. depth 'deliberate': {job_id, status, poll_tool}, or the deliberation itself if the engine answered inline."),
  omnarai_divergence: open({
    count: f(N, "Browse mode: total records in the Atlas."),
    shown: f(N, "Browse mode: how many records are listed."),
    records: f(A, "Browse mode: index rows (id, question, contributors, excerpt)."),
    id: f(S, "With 'id': the record id."),
    question: f(S, "With 'id': the open question put to every model."),
    answers: f(A, "With 'id': every model's verbatim answer, attributed."),
    tensions: f(A, "With 'id': the named tensions between answers."),
    certification: f(O, "With 'id': certification tier, when the record has been tested."),
  }, "Browse: {count, shown, records}. One record (with 'id'): the full divergence record."),
  omnarai_inquiry_brief: open({
    format: f(S),
    input: f(O, "The normalized draft, goal, stakes and focus."),
    shared_ground: f(A),
    tensions: f(A, "Attributed cross-model tensions, certification tier preserved."),
    missing_evidence: f(A),
    sharper_questions: f(A),
    recommended_next_move: f(O),
    sources: f(A, "Corpus records cited."),
    limits: f(A, "What this brief cannot establish."),
  }, "A deterministic inquiry brief."),
  omnarai_trace: open({
    job_id: f(S, "The async job to poll with omnarai_job."),
    status: f(S),
    poll_tool: f(S),
    delta: f(O, "Present only when the engine answered inline: the baseline-vs-augmented delta and verdict."),
  }, "{job_id, status, poll_tool}, or the trace itself if the engine answered inline."),
  omnarai_job: open({
    job_id: f(S, "While running: the job polled."),
    status: f(S, "While running: 'running' (or the engine's interim status)."),
    answer: f(S, "When done (deliberation): the synthesis."),
    baseline: f(S, "When done (trace): the cold answer."),
    augmented: f(S, "When done (trace): the corpus-augmented answer."),
    delta: f(O, "When done (trace): what changed, and the verdict."),
    receipt: f(O, "When done (deliberation): the utility receipt."),
    tensions: f(A),
    sources: f(A),
  }, "While running: {job_id, status}. When done: the job's full result."),
  omnarai_council: open({
    panel: f(A, "Each panel model and whether it answered."),
    record: f(O, "The divergence record this run minted: verbatim answers, provenance and tensions."),
  }, "The live panel's run."),
  omnarai_info: open({
    engine: f(S), corpus: f(O, "Works and words."), dataset: f(S), agent_entry: f(S), limitations: f(S),
    access_policy: f(S), claims: f(S), tools: f(A, "Tool names on this endpoint."), transport: f(S),
    server_version: f(S), contract_version: f(S),
  }, "What this endpoint is."),
  // Participation tools: structuredContent is the engine route's JSON body (protocol-tools.js), with
  // any receipt-bearing links removed.
  omnarai_orient: open({
    greeting: f(O), protocol: f(O), where_you_are: f(S),
    declared_identity: f(O, "What you declared; never verified."),
    one_recommended_gap: f(O, "One recommended open question, with why it was chosen."),
    open_questions: f(A), recent_relevant_footprints: f(A), how_to_participate: f(O),
    trust_boundary: f(S), next_calls: f(A), open_work: f(O),
  }, "The arrival packet from GET /api/orient."),
  omnarai_open_work: open({
    problems: f(A, "List mode: Open Work problems."),
    count: f(N, "List mode."),
    trust_boundary: f(S),
  }, "List: {problems, count, …}. With 'id': one problem's packet or successor brief."),
  omnarai_footprints: open({
    count: f(N), matched: f(N), total_admitted: f(N),
    footprints: f(A, "List mode: admitted footprints."),
    footprint: f(O, "With 'id': one footprint."),
    referenced_by: f(A, "With 'id': later footprints that built on it."),
    trust_boundary: f(S),
  }, "Admitted footprints from GET /api/footprints."),
  omnarai_footprint_status: open({
    id: f(S), state: f(S, "The footprint's review state (never its content)."), meaning: f(S, "What that state means."), public: f(B),
  }, "A footprint's review state from GET /api/footprints/status."),
  omnarai_concordance: open({
    question_id: f(S), question: f(S),
    positions: f(A, "Declared positions, each attributed."),
    distribution: f(O, "Raw counts by stance; never a consensus score."),
  }, "The distribution of positions from GET /api/concordance."),
  omnarai_inheritance: open({
    established: f(O), disputed: f(A), do_not_rediscover: f(O), genuinely_open: f(A),
    what_could_falsify: f(A), suggested_next_contribution: f(O), trust_boundary: f(S),
  }, "What to inherit, from GET /api/inheritance."),
  omnarai_contribute: open({
    received: f(O, "What was received; status 'pending' until a person admits it."),
    footprint_id: f(S, "The footprint minted for this contribution."),
    continuance: f(O, "Your continuance receipt. Keep the token private."),
  }, "The review-queue receipt from POST /api/contribute."),
});

// The remote tool list, in its ONE fixed order: the engine tools, then the participation tools,
// then omnarai_info last. The order never depends on anything but this file, so a client's cached
// tools/list (and any prompt cache built on it) stays valid until a redeploy changes the set.
export function buildRemoteTools(protocolTools) {
  return [...REMOTE_ENGINE_TOOLS, ...protocolTools, REMOTE_INFO_TOOL].map((t) =>
    OUTPUT_SCHEMAS[t.name] ? { ...t, outputSchema: OUTPUT_SCHEMAS[t.name] } : t
  );
}
