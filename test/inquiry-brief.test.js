/**
 * Acceptance tests for omnarai_inquiry_brief (proposal OMN-P-042).
 * Runs with the built-in test runner: `npm test` (node --test).
 * All upstream responses are mocked via global.fetch — no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  runInquiryBrief,
  normalizeInquiryInput,
  searchDivergenceIndex,
} from "../inquiry.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DRAFT = "Build a memory system that automatically carries decisions between AI sessions.";

const RETRIEVAL = {
  cleanQuery: DRAFT,
  records: [
    {
      id: "OMN-001",
      title: "Memory across sessions",
      ring: "Core Canon",
      layer: "research",
      role: "relevance",
      contributors: ["Claude | xz"],
      evidence: "empirical",
      relevanceScore: 0.82,
      excerpt: "Decisions carried across sessions require durable, attributed storage.",
    },
    {
      id: "OMN-002",
      title: "Holdform and continuity",
      ring: "Curated Expansions",
      layer: "research",
      role: "diversity",
      contributors: ["Grok"],
      evidence: "interpretive",
      relevanceScore: 0.61,
      excerpt: "Continuity without consent risks freezing an identity mid-motion.",
    },
  ],
  contributors: ["Claude | xz", "Grok"],
};

function divIndex(records) {
  return { count: records.length, records };
}

function divFull({ id = "OMN-D-0001", tier = "C0", stale = false } = {}) {
  return {
    id,
    question: "Should memory persist across sessions automatically?",
    date: "2026-06-01",
    certification: { tier },
    ...(stale
      ? { freshness: { stale: true, stale_models: [{ model: "gpt-4o-2024", superseded_by: "gpt-5" }] } }
      : {}),
    answers: [
      { model: "Claude", answer: "Persistence should be opt-in." },
      { model: "GPT-4o", answer: "Persistence should be the default." },
    ],
    tensions: [
      {
        voice_a: "Claude",
        voice_b: "GPT-4o",
        topic: "autonomy of memory",
        status: "open",
        claim_a: "Persistent memory should be opt-in",
        claim_b: "Persistence should be the default",
      },
    ],
  };
}

const INDEX_ENTRY = {
  id: "OMN-D-0001",
  question: "Should memory persist across sessions automatically?",
  contributors: ["Claude", "GPT-4o"],
  excerpt: "memory sessions decisions persistence",
  answerCount: 2,
  tensionCount: 1,
};

const DEPS = {
  engineUrl: "https://engine.test/api/query",
  divergencesUrl: "https://engine.test/api/divergences",
  fetchOpts: {},
};

function jsonRes(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

// routes: { retrieve, index, full: {id: record}, retrieveStatus, indexStatus }
function installFetch(t, routes, calls = []) {
  const orig = global.fetch;
  global.fetch = async (url) => {
    calls.push(String(url));
    const u = new URL(url);
    if (u.pathname.endsWith("/api/query")) {
      return jsonRes(routes.retrieve ?? RETRIEVAL, routes.retrieveStatus ?? 200);
    }
    if (u.pathname.endsWith("/api/divergences")) {
      if (routes.indexStatus && routes.indexStatus !== 200) return jsonRes({}, routes.indexStatus);
      const id = u.searchParams.get("id");
      if (id) {
        return routes.full?.[id] ? jsonRes(routes.full[id]) : jsonRes({ error: "not found" }, 404);
      }
      return jsonRes(routes.index ?? divIndex([]));
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  t.after(() => {
    global.fetch = orig;
  });
  return calls;
}

function parseBrief(text) {
  const m = text.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(m, "output must contain a fenced JSON payload");
  return JSON.parse(m[1]);
}

// ── 1. Valid retrieval-first request ─────────────────────────────────────────

test("retrieval-first: uses mode=retrieve, never the deliberation path, sources carry ids + contributors", async (t) => {
  const calls = installFetch(t, {
    index: divIndex([INDEX_ENTRY]),
    full: { "OMN-D-0001": divFull() },
  });
  let deliberated = false;
  const out = await runInquiryBrief(
    { draft: DRAFT },
    { ...DEPS, deliberate: async () => { deliberated = true; return "x"; } }
  );

  assert.ok(calls.some((c) => c.includes("mode=retrieve")), "calls the retrieval path");
  assert.ok(!calls.some((c) => c.includes("async=1") || c.includes("sync=1")), "never touches deliberation endpoints");
  assert.equal(deliberated, false, "deliberate() not invoked without opt-in");

  const brief = parseBrief(out);
  assert.equal(brief.trace.mode, "retrieve");
  assert.ok(brief.sources.length > 0);
  for (const s of brief.sources) {
    assert.ok(s.id, "source has an id");
    assert.ok(Array.isArray(s.contributors), "source has contributors");
  }
});

test("max_sources bounds the corpus records cited", async (t) => {
  installFetch(t, { index: divIndex([]) });
  const brief = parseBrief(await runInquiryBrief({ draft: DRAFT, max_sources: 1 }, DEPS));
  assert.equal(brief.sources.filter((s) => s.role !== "divergence-atlas").length, 1);
});

// ── 2. Certification language ─────────────────────────────────────────────────

test("C0 record is never called a genuine divergence", async (t) => {
  installFetch(t, {
    index: divIndex([INDEX_ENTRY]),
    full: { "OMN-D-0001": divFull({ tier: "C0" }) },
  });
  const out = await runInquiryBrief({ draft: DRAFT }, DEPS);
  const brief = parseBrief(out);
  assert.equal(brief.tensions[0].certification.tier, "C0");
  assert.ok(!out.includes("genuine divergence"), "the phrase is reserved for C3");
});

test("C3 record may carry the phrase and exposes its source id", async (t) => {
  installFetch(t, {
    index: divIndex([INDEX_ENTRY]),
    full: { "OMN-D-0001": divFull({ tier: "C3" }) },
  });
  const out = await runInquiryBrief({ draft: DRAFT }, DEPS);
  const brief = parseBrief(out);
  assert.equal(brief.tensions[0].certification.tier, "C3");
  assert.ok(brief.tensions[0].certification.label.includes("genuine divergence"));
  assert.deepEqual(brief.tensions[0].position_a.source_ids, ["OMN-D-0001"]);
});

// ── 3. Freshness preservation ─────────────────────────────────────────────────

test("stale model versions produce a freshness note", async (t) => {
  installFetch(t, {
    index: divIndex([INDEX_ENTRY]),
    full: { "OMN-D-0001": divFull({ stale: true }) },
  });
  const out = await runInquiryBrief({ draft: DRAFT }, DEPS);
  const brief = parseBrief(out);
  assert.equal(brief.tensions[0].freshness.stale, true);
  assert.ok(brief.tensions[0].freshness.note.includes("gpt-4o-2024"));
  assert.ok(out.includes("Stale model version"), "note surfaces in the rendered brief");
});

// ── 4. No invented evidence ───────────────────────────────────────────────────

test("empty retrieval yields an honest brief: no shared ground, no tensions, explicit limits, evidence-seeking questions", async (t) => {
  installFetch(t, { retrieve: { records: [] }, index: divIndex([]) });
  const brief = parseBrief(await runInquiryBrief({ draft: DRAFT }, DEPS));
  assert.deepEqual(brief.shared_ground, []);
  assert.deepEqual(brief.tensions, []);
  assert.ok(brief.limits.length > 0);
  assert.ok(brief.sharper_questions.length > 0);
  assert.ok(brief.missing_evidence.length > 0);
  assert.equal(brief.trace.corpus_response_used, false);
  assert.ok(brief.recommended_next_move.action.length > 0, "still proposes an evidence-acquisition move");
});

// ── 5. Input validation ───────────────────────────────────────────────────────

test("input validation: required draft, enums, size cap, max_sources clamping", () => {
  assert.throws(() => normalizeInquiryInput({}), /draft is required/);
  assert.throws(() => normalizeInquiryInput({ draft: "   " }), /draft is required/);
  assert.throws(() => normalizeInquiryInput({ draft: "x".repeat(4001) }), /max 4000/);
  assert.throws(() => normalizeInquiryInput({ draft: "x", focus: "speed" }), /invalid focus/);
  assert.throws(() => normalizeInquiryInput({ draft: "x", stakes: "extreme" }), /invalid stakes/);
  assert.throws(() => normalizeInquiryInput({ draft: "x", max_sources: "lots" }), /invalid max_sources/);
  assert.equal(normalizeInquiryInput({ draft: "x" }).maxSources, 6);
  assert.equal(normalizeInquiryInput({ draft: "x", max_sources: 99 }).maxSources, 10);
  assert.equal(normalizeInquiryInput({ draft: "x", max_sources: 0 }).maxSources, 1);
  assert.equal(normalizeInquiryInput({ draft: "x" }).stakes, "medium");
  assert.equal(normalizeInquiryInput({ draft: "x" }).focus, "all");
});

// ── 6. Optional deliberation ──────────────────────────────────────────────────

test("include_deliberation=true uses the deliberation path and discloses it in trace.mode", async (t) => {
  installFetch(t, { index: divIndex([]) });
  let askedWith = "";
  const out = await runInquiryBrief(
    { draft: DRAFT, include_deliberation: true },
    { ...DEPS, deliberate: async (q) => { askedWith = q; return "DELIBERATION-TEXT"; } }
  );
  assert.ok(askedWith.includes(DRAFT), "deliberation receives the draft");
  assert.ok(out.includes("DELIBERATION-TEXT"), "deliberation output is appended, disclosed");
  assert.equal(parseBrief(out).trace.mode, "retrieve_plus_deliberation");
});

test("deliberation failure is reported cleanly; brief remains retrieval-only", async (t) => {
  installFetch(t, { index: divIndex([]) });
  const out = await runInquiryBrief(
    { draft: DRAFT, include_deliberation: true },
    { ...DEPS, deliberate: async () => { throw new Error("boom"); } }
  );
  const brief = parseBrief(out);
  assert.equal(brief.trace.mode, "retrieve");
  assert.ok(brief.limits.some((l) => l.includes("Deliberation was requested but failed")));
});

// ── 7. Attribution integrity ──────────────────────────────────────────────────

test("every source-backed item references at least one returned source id", async (t) => {
  installFetch(t, {
    index: divIndex([INDEX_ENTRY]),
    full: { "OMN-D-0001": divFull() },
  });
  const brief = parseBrief(await runInquiryBrief({ draft: DRAFT }, DEPS));
  const sourceIds = new Set(brief.sources.map((s) => s.id));
  for (const g of brief.shared_ground) {
    assert.ok(g.source_ids.length > 0);
    for (const id of g.source_ids) assert.ok(sourceIds.has(id), `shared ground id ${id} traces to sources`);
  }
  for (const t2 of brief.tensions) {
    for (const pos of [t2.position_a, t2.position_b]) {
      assert.ok(pos.source_ids.length > 0);
      for (const id of pos.source_ids) assert.ok(sourceIds.has(id), `tension id ${id} traces to sources`);
    }
  }
});

// ── Error behavior (spec §Error behavior) ─────────────────────────────────────

test("retrieval outage fails loud and names the layer", async (t) => {
  installFetch(t, { retrieveStatus: 503 });
  await assert.rejects(() => runInquiryBrief({ draft: DRAFT }, DEPS), /retrieval layer unavailable/);
});

test("divergence outage degrades with a stated limit, not invented tensions", async (t) => {
  installFetch(t, { indexStatus: 500 });
  const brief = parseBrief(await runInquiryBrief({ draft: DRAFT }, DEPS));
  assert.deepEqual(brief.tensions, []);
  assert.equal(brief.trace.divergence_response_used, false);
  assert.ok(brief.limits.some((l) => l.includes("Divergence layer unavailable")));
});

// ── Shared search helper (used by omnarai_divergence too) ─────────────────────

test("searchDivergenceIndex matches on ANY token and ranks by overlap", () => {
  const records = [
    { id: "A", question: "consciousness and experience in models" },
    { id: "B", question: "unrelated topic" },
    { id: "C", question: "consciousness only" },
  ];
  const hits = searchDivergenceIndex(records, "consciousness experience");
  assert.deepEqual(hits.map((r) => r.id), ["A", "C"]);
});
