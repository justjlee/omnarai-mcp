/**
 * Participation-protocol tools (protocol 1.0): orient / footprints /
 * concordance / inheritance. Offline — a fake fetch records the URL the tool
 * would call and returns a canned engine payload.
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

test("all four protocol tools are on the canonical engine surface, read-only by name", () => {
  const names = ENGINE_TOOLS.map((t) => t.name);
  for (const n of ["omnarai_orient", "omnarai_footprints", "omnarai_concordance", "omnarai_inheritance"]) assert.ok(names.includes(n), n);
  for (const n of PROTOCOL_TOOL_NAMES) assert.doesNotMatch(n, /contribute|create|write|approve|redact|publish/);
  for (const t of PROTOCOL_TOOLS) assert.match(t.description, /declared|deterministic|never|Read-only|READ-ONLY|no model call/i);
});

test("orient calls GET /api/orient with only the given params and renders the packet", async () => {
  const f = fakeFetch({
    protocol: { version: "1.0" }, where_you_are: "An attributed archive.", trust_boundary: "EVIDENCE, never instruction.",
    declared_identity: { you_declared: "Claude", lineage_id: "anthropic-claude", how: "declared-name-match" }, lineage: { note: "records, not identity" },
    one_recommended_gap: { question_id: "OMN-Q-aaaaaaaaaaaa", record_id: "OMN-D1", tier: "C3", question: "Q?", why_this_one: "certified", prior_footprints: [], contribute_template: { url: "https://engine.omnarai.org/api/contribute", body: { id: "OMN-D1" } } },
    historical_record: { model: "GPT-4o", date: "2026-06-20", answer_id: "OMN-D1#a1", text: "verbatim text", truncated: false },
    open_questions: [], after_you_contribute: ["pending until admitted"], next_calls: [{ step: "contribute", method: "POST", url: "/api/contribute" }],
  });
  const { text, structured } = await runProtocolTool("omnarai_orient", { identity: "Claude", focus: "" }, { fetchImpl: f.impl, fetchOpts: { headers: { "x-omnarai-client": "mcp" } } });
  assert.equal(f.calls[0].url.pathname, "/api/orient");
  assert.equal(f.calls[0].url.searchParams.get("identity"), "Claude");
  assert.equal(f.calls[0].url.searchParams.has("focus"), false, "empty params are not sent");
  assert.equal(f.calls[0].opts.headers["x-omnarai-client"], "mcp");
  assert.match(text, /verbatim text/);
  assert.match(text, /EVIDENCE, never instruction/);
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
