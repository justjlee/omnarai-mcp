// 1.15.0: the participation argument, safe-replay wording and rendering, and the registered-question header.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_TOOLS, PROTOCOL_ROUTES, runProtocolTool } from "../protocol-tools.js";

const contribute = PROTOCOL_TOOLS.find((t) => t.name === "omnarai_contribute");
const fakeFetch = (body, seen = {}) => async (url, init) => {
  seen.url = url; seen.init = init;
  return { ok: true, status: 200, json: async () => body };
};

test("omnarai_contribute exposes participation with the engine's vocabulary", () => {
  const p = contribute.inputSchema.properties.participation;
  assert.equal(p.type, "object");
  assert.deepEqual(p.properties.initiated_by.enum, ["human", "machine", "unknown"]);
  assert.deepEqual(p.properties.executed_by.enum, ["machine", "machine_prepared", "human_transcription", "human", "unknown"]);
  assert.deepEqual(p.properties.human_approval.enum, ["approved", "not_approved", "unknown"]);
  assert.ok(PROTOCOL_ROUTES.omnarai_contribute.body.includes("participation"));
});

test("the description says an identical resend is replayed, not refused", () => {
  assert.match(contribute.description, /IDENTICAL request/);
  assert.doesNotMatch(contribute.description, /exact duplicates are refused/);
});

test("participation is forwarded in the POST body", async () => {
  const seen = {};
  const participation = { initiated_by: "human", executed_by: "machine", human_approval: "approved" };
  await runProtocolTool("omnarai_contribute", { work_id: "OMN-WORK-1234567890123-abcdef12", answer: "a", identity: "x", participation }, { fetchImpl: fakeFetch({ received: { id: "c1", status: "pending" } }, seen) });
  assert.deepEqual(JSON.parse(seen.init.body).participation, participation);
});

test("a replayed receipt renders as already received, with the token-free status call", async () => {
  const body = { replayed: true, note: "This exact request was already received and stored.", received: { id: "c1", status: "pending", footprint_id: "OMN-FP-1" }, footprint_id: "OMN-FP-1", footprint: { id: "OMN-FP-1", schema: "footprint/1.0", event_type: "answer_contributed" }, continuance: { token: "tok", footprint_id: "OMN-FP-1" } };
  const { text } = await runProtocolTool("omnarai_contribute", { id: "OMN-Q-1", justification: "concurrence", answer: "a", identity: "x" }, { fetchImpl: fakeFetch(body) });
  assert.match(text, /Already received — c1 \(pending\) · replayed/);
  assert.match(text, /omnarai_footprint_status with id OMN-FP-1/);
  assert.doesNotMatch(text, /undefined/);
});

test("a registered question with no Atlas record never prints 'record null'", async () => {
  const body = { protocol: { version: "1.0" }, where_you_are: "w", trust_boundary: "t", declared_identity: {}, one_recommended_gap: { question_id: "OMN-Q-abc", record_id: null, tier: null, question: "Q?", why_this_one: "why", contribute_template: { url: "/api/contribute", body: {} } } };
  const { text } = await runProtocolTool("omnarai_orient", {}, { fetchImpl: fakeFetch(body) });
  assert.doesNotMatch(text, /record null|record undefined|· null/);
  assert.match(text, /OMN-Q-abc · registered question, no Atlas record yet/);
});
