/**
 * Claude Code handoff gate tests (proposal OMN-P-043).
 *
 * The core Phase 1 acceptance property: an agent CANNOT obtain an
 * implementation handoff from an unapproved or stale-approved record, and an
 * approved handoff carries uncertainty, dissent, scope, and verification
 * requirements — deterministically.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { newRecord } from "../lib/decision-schema.js";
import { applyTransition } from "../lib/decision-state.js";
import { prepareClaudeCodeHandoff, renderHandoffText, HANDOFF_FORMAT } from "../lib/decision-handoff.js";
import { createDecisionStore } from "../lib/decision-store.js";
import {
  runCreateDecisionRecord,
  runGetDecisionLineage,
  runPrepareClaudeCodeHandoff,
} from "../lib/decision-tools.js";

function approvedRecord() {
  const r = newRecord({
    id: "OMN-P-200",
    title: "Bounded change",
    problem: "A problem worth solving.",
    proposed_direction: "A bounded direction.",
    source_ids: ["OMN-287"],
    uncertainties: ["Approval is attestation, not identity."],
    dissent: [{ claim: "Too much process.", strength: "unresolved", response: "Scope is deliberately small." }],
    actor: "test-suite",
    now: "2026-07-16T00:00:00Z",
  });
  r.investigation.sources = [{ id: "OMN-287", title: "Attributed source", contributors: ["Claude | xz"] }];
  r.proposal = {
    decision: "Implement the bounded change only.",
    scope: ["One module.", "Its tests."],
    non_goals: ["Publishing.", "Deployment."],
    acceptance_criteria: ["Gate holds.", "Tests pass."],
    verification_plan: ["npm test", "node scripts/check-tool-parity.js"],
  };
  const p = applyTransition(r, "proposed", { actor: "test-suite", at: "2026-07-16T01:00:00Z" });
  return applyTransition(p, "approved", { actor: "Jonathan Lee", at: "2026-07-16T02:00:00Z" });
}

test("approval gate: exploring and proposed records cannot produce a handoff", () => {
  const r = newRecord({
    id: "OMN-P-201",
    title: "t",
    problem: "p",
    proposed_direction: "d",
    actor: "test-suite",
  });
  assert.throws(() => prepareClaudeCodeHandoff(r), /only an approved record/);

  r.proposal = {
    decision: "x",
    scope: ["s"],
    non_goals: [],
    acceptance_criteria: ["a"],
    verification_plan: ["v"],
  };
  const proposed = applyTransition(r, "proposed", { actor: "test-suite", at: "2026-07-16T01:00:00Z" });
  assert.throws(() => prepareClaudeCodeHandoff(proposed), /only an approved record/);
});

test("revision gate: a stale approval is rejected with an explanation", () => {
  const a = approvedRecord();
  a.revision = 2; // material change after approval
  assert.throws(() => prepareClaudeCodeHandoff(a), /stale.*revision 1.*revision 2/s);
});

test("approved handoff carries id, scope, non-goals, criteria, uncertainty, dissent, verification", () => {
  const packet = prepareClaudeCodeHandoff(approvedRecord());
  assert.equal(packet.format, HANDOFF_FORMAT);
  assert.equal(packet.decision_id, "OMN-P-200");
  assert.equal(packet.approved_revision, 1);
  assert.equal(packet.approved_by, "Jonathan Lee");
  assert.deepEqual(packet.scope, ["One module.", "Its tests."]);
  assert.deepEqual(packet.non_goals, ["Publishing.", "Deployment."]);
  assert.deepEqual(packet.uncertainty, ["Approval is attestation, not identity."]);
  assert.equal(packet.dissent[0].claim, "Too much process.");
  assert.deepEqual(packet.verification_plan, ["npm test", "node scripts/check-tool-parity.js"]);
  assert.match(packet.execution_rule, /Stop and ask the maintainer/);

  const text = renderHandoffText(packet);
  for (const expected of ["OMN-P-200", "Non-goals", "Uncertainty", "Dissent", "Acceptance criteria", "Verification required", "Execution rule", "data about the decision"]) {
    assert.ok(text.includes(expected), `rendered handoff must include "${expected}"`);
  }
});

test("determinism: the same approved record renders byte-identical packets", () => {
  const a = approvedRecord();
  const one = prepareClaudeCodeHandoff(a);
  const two = prepareClaudeCodeHandoff(structuredClone(a));
  assert.deepEqual(one, two);
  assert.equal(renderHandoffText(one), renderHandoffText(two));
});

test("no side effects: preparing a handoff changes neither record nor ledger", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omnarai-handoff-"));
  const store = createDecisionStore({ rootDir: root });
  const created = await runCreateDecisionRecord(
    { title: "t", problem: "p", proposed_direction: "d", actor: "test-suite" },
    { store }
  );
  const id = created.structured.record.id;

  // Unapproved → the tool fails; the stored record is untouched.
  await assert.rejects(() => runPrepareClaudeCodeHandoff({ decision_id: id }, { store }), /only an approved record/);
  const after = await store.get(id);
  assert.deepEqual(after, created.structured.record);

  // Approve out-of-band (as a human editing the ledger would), then hand off.
  const approved = approvedRecord();
  await store.appendEvent(id, { type: "note", actor: "test-suite" }); // ledger still writable
  await store.save({ ...approved, id, events: after.events });
  const handoff = await runPrepareClaudeCodeHandoff({ decision_id: id }, { store });
  assert.equal(handoff.structured.decision_id, id);
  const final = await store.get(id);
  assert.equal(final.status, "approved"); // handoff did not mutate state
});

test("lineage read: missing record is an error, present record keeps dissent and uncertainty visible", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omnarai-lineage-"));
  const store = createDecisionStore({ rootDir: root });
  await assert.rejects(() => runGetDecisionLineage({ decision_id: "OMN-P-999" }, { store }), /No decision record/);

  const created = await runCreateDecisionRecord(
    {
      title: "Lineage test",
      problem: "p",
      proposed_direction: "d",
      uncertainties: ["An open unknown."],
      dissent: [{ claim: "A counterargument." }],
      actor: "test-suite",
    },
    { store }
  );
  const lineage = await runGetDecisionLineage({ decision_id: created.structured.record.id }, { store });
  assert.ok(lineage.text.includes("An open unknown."));
  assert.ok(lineage.text.includes("A counterargument."));
  assert.ok(lineage.text.includes("not_requested"));
  assert.equal(lineage.structured.id, created.structured.record.id);
});

test("create tool states plainly that no authority is granted", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "omnarai-create-"));
  const store = createDecisionStore({ rootDir: root });
  const created = await runCreateDecisionRecord(
    { title: "t", problem: "p", proposed_direction: "d" },
    { store }
  );
  assert.match(created.text, /NO approval and NO implementation authority/);
  assert.equal(created.structured.record.events[0].actor, "mcp-client");
});
