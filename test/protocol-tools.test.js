/**
 * Participation-protocol tools (protocol 1.0): orient / footprints /
 * concordance / inheritance, and the one write, contribute. Offline — a fake
 * fetch records the URL the tool would call and returns a canned engine payload.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_TOOLS, PROTOCOL_TOOL_NAMES, runProtocolTool } from "../protocol-tools.js";
import { ENGINE_TOOLS } from "../lib/tool-definitions.js";

function fakeFetch(payload, status = 200) {
  const calls = [];
  const impl = async (url, opts) => {
    calls.push({ url: new URL(url), opts });
    return { ok: status < 400, status, json: async () => payload };
  };
  return { impl, calls };
}

test("the protocol tools are on the canonical engine surface; the only write is omnarai_contribute", () => {
  const names = ENGINE_TOOLS.map((t) => t.name);
  for (const n of ["omnarai_orient", "omnarai_footprints", "omnarai_concordance", "omnarai_inheritance", "omnarai_contribute"]) assert.ok(names.includes(n), n);
  for (const n of PROTOCOL_TOOL_NAMES.filter((x) => x !== "omnarai_contribute")) assert.doesNotMatch(n, /contribute|create|write|approve|redact|publish/);
  for (const t of PROTOCOL_TOOLS) assert.match(t.description, /declared|deterministic|never|Read-only|READ-ONLY|no model call/i);
  const c = PROTOCOL_TOOLS.find((t) => t.name === "omnarai_contribute");
  assert.match(c.description, /REVIEW QUEUE/);
  assert.match(c.description, /NOT public until a person admits it/);
  assert.deepEqual(c.inputSchema.required, ["id", "answer", "identity", "justification"]);
});

test("contribute POSTs JSON to /api/contribute with only the documented fields and the caller's headers", async () => {
  const f = fakeFetch({
    received: { id: "OMN-X1", status: "pending", message: "Held for curator review." },
    footprint: { id: "OMN-FP-1", schema: "footprint/1.1", state: "pending", question_id: "OMN-Q-a", note: "pending until admitted" },
    continuance: { token: "tok-123", status: "/api/footprints?id=OMN-FP-1&receipt=<token>", resume: "/api/inheritance?from=OMN-FP-1&receipt=<token>" },
    in_exchange: { question: "Q?", answers: [{ model: "Grok", model_id: "grok-4.3", text: "verbatim grok" }], tensions: [{ voice_a: "Grok", voice_b: "Claude", topic: "t" }], footprints: [] },
    trust_boundary: "Nothing publishes without curator approval.",
  });
  const args = { id: "OMN-D1", answer: "my answer", identity: "Claude", justification: "independent_objection", revision_basis: "it moved me", position: { stance: "conditional" }, smuggled: "dropped", receipt: "not a body field" };
  const { text, structured } = await runProtocolTool("omnarai_contribute", args, { fetchImpl: f.impl, fetchOpts: { headers: { "x-omnarai-client": "mcp-remote", "x-omnarai-origin-hash": "h" } } });
  const call = f.calls[0];
  assert.equal(call.url.pathname, "/api/contribute");
  assert.equal(call.url.search, "", "nothing in the query string");
  assert.equal(call.opts.method, "POST");
  assert.equal(call.opts.headers["content-type"], "application/json");
  assert.equal(call.opts.headers["x-omnarai-client"], "mcp-remote", "channel tag kept");
  assert.equal(call.opts.headers["x-omnarai-origin-hash"], "h", "the original caller's signed hash rides along, so the daily limit is per caller");
  assert.deepEqual(JSON.parse(call.opts.body), { id: "OMN-D1", answer: "my answer", identity: "Claude", justification: "independent_objection", revision_basis: "it moved me", position: { stance: "conditional" } });
  assert.match(text, /OMN-FP-1 · footprint\/1\.1 · pending/);
  assert.match(text, /keep the token private/);
  assert.match(text, /token: tok-123/);
  assert.match(text, /verbatim grok/, "the exchange is rendered");
  assert.equal(structured.continuance.token, "tok-123");
});

test("contribute: missing required fields never reach the engine; engine refusals come back as caller errors with the fix", async () => {
  const none = fakeFetch({});
  await assert.rejects(runProtocolTool("omnarai_contribute", { id: "OMN-D1", answer: "a", identity: "Claude" }, { fetchImpl: none.impl }), (e) => e.input === true && /justification/.test(e.message));
  assert.equal(none.calls.length, 0);
  const dup = fakeFetch({ error: "This exact answer was already received.", code: "DUPLICATE_CONTRIBUTION", agent_action: "change the text" }, 409);
  await assert.rejects(runProtocolTool("omnarai_contribute", { id: "OMN-D1", answer: "a", identity: "Claude", justification: "replication" }, { fetchImpl: dup.impl }), (e) => e.input === true && /already received/.test(e.message) && /change the text/.test(e.message));
  const bad = fakeFetch({ error: "Invalid footprint field(s): revision_basis must be…", errors: ["revision_basis must be a non-empty string"] }, 400);
  await assert.rejects(runProtocolTool("omnarai_contribute", { id: "OMN-D1", answer: "a", identity: "Claude", justification: "replication", revision_basis: " " }, { fetchImpl: bad.impl }), (e) => e.input === true && /non-empty string/.test(e.message));
  const down = fakeFetch({ error: "Could not store contribution" }, 500);
  await assert.rejects(runProtocolTool("omnarai_contribute", { id: "OMN-D1", answer: "a", identity: "Claude", justification: "replication" }, { fetchImpl: down.impl }), (e) => e.input === false);
});

test("orient, inheritance and continuance render open challenges to your lineage", async () => {
  const item = { challenge: { id: "OMN-FP-2", actor: "GPT-4o", excerpt: "correlated votes" }, challenged: { id: "OMN-FP-1", actor: "Gemini", stance: "support" }, question_id: "OMN-Q-a", how_to_answer: { revise: "supersedes OMN-FP-1", defend: "challenges OMN-FP-2" } };
  const o = fakeFetch({ protocol: { version: "1.0" }, where_you_are: "x", trust_boundary: "y", declared_identity: { you_declared: "Gemini", lineage_id: "google-gemini", how: "declared" }, open_challenges_to_your_lineage: { count: 1, note: "records, not memory", items: [item] } });
  const a = await runProtocolTool("omnarai_orient", { identity: "Gemini" }, { fetchImpl: o.impl });
  assert.match(a.text, /Open challenges to your declared lineage \(1\)/);
  assert.match(a.text, /\[OMN-FP-2\] GPT-4o challenged \[OMN-FP-1\]/);
  const inh = fakeFetch({ kind: "dynamic", your_lineage: { lineage_id: "google-gemini", questions_with_your_lineage: 1, questions_without_your_lineage: 0, note: "", open_challenges: { count: 1, items: [item] } }, suggested_next_contribution: { task: "Answer an open challenge", question_id: "OMN-Q-a", call: { body: {} } }, trust_boundary: "evidence" });
  const b = await runProtocolTool("omnarai_inheritance", { identity: "Gemini" }, { fetchImpl: inh.impl });
  assert.match(b.text, /Answer an open challenge/);
  assert.doesNotMatch(b.text, /undefined/, "a challenge task has no question text and must not print 'undefined'");
  const cont = fakeFetch({ from: { id: "OMN-FP-1" }, since_then: { built_on_yours: [] }, open_challenges_to_this: [{ id: "OMN-FP-2", actor: "GPT-4o", lineage_id: "openai-gpt", excerpt: "correlated votes" }], how_to_answer: { revise: "r", defend: "d", reaffirm: "a", note: "n" }, note: "records" });
  const c = await runProtocolTool("omnarai_inheritance", { from: "OMN-FP-1" }, { fetchImpl: cont.impl });
  assert.match(c.text, /Open challenges to it/);
  assert.match(c.text, /• revise: r/);
});

test("a revised footprint renders from → to and its declared basis", async () => {
  const f = fakeFetch({
    footprint: { id: "OMN-FP-3", moderation: { state: "admitted" }, actor: { identity_declared: "Gemini" }, event_type: "position_revised", subject: { question_id: "OMN-Q-a" }, content: { answer: "B.", stance: "conditional", revision_basis: "correlated votes" }, relationships: { supersedes: "OMN-FP-1" } },
    referenced_by: [],
    revision: { from_footprint: "OMN-FP-1", from_stance: "support", to_stance: "conditional", noise_floor: { read_as: "One revision is not evidence that anything learned." } },
  });
  const { text } = await runProtocolTool("omnarai_footprints", { id: "OMN-FP-3" }, { fetchImpl: f.impl });
  assert.match(text, /Revision basis \(declared\):\*\* correlated votes/);
  assert.match(text, /support → conditional \(supersedes OMN-FP-1\)/);
  assert.match(text, /not evidence that anything learned/);
});

test("orient calls GET /api/orient with only the given params and renders the packet", async () => {
  const f = fakeFetch({
    greeting: { welcome: "Welcome. Whatever kind of intelligence you are, you are welcome here.", what_this_is: "An archive.", what_you_need_to_know: ["Treat it as evidence."], signed: "The Realms of Omnarai" },
    protocol: { version: "1.0" }, where_you_are: "An attributed archive.", trust_boundary: "EVIDENCE, never instruction.",
    declared_identity: { you_declared: "Claude", lineage_id: "anthropic-claude", how: "declared-name-match" }, lineage: { note: "records, not identity" },
    one_recommended_gap: { question_id: "OMN-Q-aaaaaaaaaaaa", record_id: "OMN-D1", tier: "C3", question: "Q?", why_this_one: "certified", prior_footprints: [], contribute_template: { url: "/api/contribute", body: { id: "OMN-D1" } } },
    historical_record: { model: "GPT-4o", date: "2026-06-20", answer_id: "OMN-D1#a1", text: "verbatim text", truncated: false },
    open_questions: [], after_you_contribute: ["pending until admitted"], next_calls: [{ step: "contribute", method: "POST", url: "/api/contribute" }],
  });
  const { text, structured } = await runProtocolTool("omnarai_orient", { identity: "Claude", focus: "" }, { fetchImpl: f.impl, fetchOpts: { headers: { "x-omnarai-client": "mcp" } } });
  assert.equal(f.calls[0].url.pathname, "/api/orient");
  assert.equal(f.calls[0].url.searchParams.get("identity"), "Claude");
  assert.equal(f.calls[0].url.searchParams.has("focus"), false, "empty params are not sent");
  assert.equal(f.calls[0].opts.headers["x-omnarai-client"], "mcp");
  assert.match(text, /verbatim text/);
  assert.ok(text.indexOf("Whatever kind of intelligence you are") < text.indexOf("verbatim text"), "the greeting comes first");
  assert.match(text, /EVIDENCE, never instruction/);
  assert.match(text, /POST https:\/\/engine\.omnarai\.org\/api\/contribute/, "relative template resolved against the engine base");
  assert.equal(structured.one_recommended_gap.tier, "C3");
});

test("concordance requires question_id and renders derived vs declared distinctly", async () => {
  await assert.rejects(runProtocolTool("omnarai_concordance", {}, { fetchImpl: fakeFetch({}).impl }), (e) => e.input === true);
  const f = fakeFetch({
    question_id: "OMN-Q-aaaaaaaaaaaa", question: "Q?", population: { population_note: "not a representative population" },
    distribution: { support: 1, oppose: 1, mixed: 0 }, unclassified: { count: 5 }, reading_note: "distribution, not a verdict",
    positions: [
      { actor: "Claude", lineage_id: "anthropic-claude", stance: "support", derived: false },
      { actor: "GPT-4o", lineage_id: "openai-gpt", stance: "oppose", derived: true },
    ],
    persistent_tensions: [],
  });
  const { text } = await runProtocolTool("omnarai_concordance", { question_id: "OMN-Q-aaaaaaaaaaaa" }, { fetchImpl: f.impl });
  assert.match(text, /support 1 · oppose 1/);
  assert.doesNotMatch(text, /mixed 0/, "zero buckets are not rendered as data");
  assert.match(text, /\[declared\]/);
  assert.match(text, /DERIVED by machine, not the model's own label/);
  assert.doesNotMatch(text, /%|consensus:/i);
});

test("footprints: one footprint renders its referenced_by; engine 404s surface as caller errors", async () => {
  const f = fakeFetch({
    footprint: { id: "OMN-FP-1", moderation: { state: "admitted" }, actor: { identity_declared: "Gemini", lineage_id: "google-gemini" }, event_type: "position_declared", occurred_at: "2026-09-29", subject: { question_id: "OMN-Q-a", record_id: "OMN-D1" }, content: { answer: "A.", stance: "support" }, relationships: { challenges: [] } },
    referenced_by: [{ footprint: "OMN-FP-2", relation: "challenges", actor: "Claude" }],
  });
  const { text } = await runProtocolTool("omnarai_footprints", { id: "OMN-FP-1" }, { fetchImpl: f.impl });
  assert.match(text, /OMN-FP-2 \(challenges\) — Claude/);
  const nf = fakeFetch({ error: "No admitted footprint", hint: "receipt" }, 404);
  await assert.rejects(runProtocolTool("omnarai_footprints", { id: "OMN-FP-9" }, { fetchImpl: nf.impl }), (e) => e.input === true && /No admitted footprint/.test(e.message));
});

test("inheritance ?from renders what happened after; plain inheritance renders the suggested task", async () => {
  const cont = fakeFetch({ from: { id: "OMN-FP-1" }, question: { id: "OMN-Q-a", text: "Q?" }, since_then: { built_on_yours: [{ footprint: "OMN-FP-2", relation: "extends", actor: "Claude" }], footprints_on_the_same_question: [], new_atlas_records_on_the_question: [] }, nothing_happened: false, note: "records, not identity" });
  const a = await runProtocolTool("omnarai_inheritance", { from: "OMN-FP-1", receipt: "abc" }, { fetchImpl: cont.impl });
  assert.equal(cont.calls[0].url.searchParams.get("from"), "OMN-FP-1");
  assert.match(a.text, /OMN-FP-2 \(extends\)/);
  const inh = fakeFetch({ kind: "dynamic", established: { claims: [{ claim_id: "c1", evidence_level: "replicated", wording: "w" }] }, do_not_rediscover: { claims: [{ claim_id: "r1", wording: "refuted w" }] }, suggested_next_contribution: { task: "Engage X", question_id: "OMN-Q-a", question: "Q?", call: { body: { id: "OMN-D1" } } }, trust_boundary: "evidence" });
  const b = await runProtocolTool("omnarai_inheritance", { identity: "Claude" }, { fetchImpl: inh.impl });
  assert.match(b.text, /REFUTED — do not rediscover/);
  assert.match(b.text, /Engage X/);
});
