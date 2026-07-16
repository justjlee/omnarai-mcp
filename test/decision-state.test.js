/**
 * Decision lifecycle tests (proposal OMN-P-043): legal transitions, guards,
 * revision policy, approval invalidation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { newRecord } from "../lib/decision-schema.js";
import {
  LEGAL_TRANSITIONS,
  applyMaterialEdit,
  applyTransition,
  assertTransition,
  isApprovedAtCurrentRevision,
} from "../lib/decision-state.js";

const HUMAN = { actor: "Jonathan Lee", at: "2026-07-16T12:00:00Z" };

function exploring() {
  return newRecord({
    id: "OMN-P-100",
    title: "Test decision",
    problem: "A problem.",
    proposed_direction: "A direction.",
    actor: "test-suite",
    now: "2026-07-16T00:00:00Z",
  });
}

function proposed() {
  const r = exploring();
  r.proposal = {
    decision: "Do the bounded thing.",
    scope: ["One bounded change."],
    non_goals: ["Everything else."],
    acceptance_criteria: ["It works."],
    verification_plan: ["npm test"],
  };
  return applyTransition(r, "proposed", { actor: "test-suite", at: "2026-07-16T01:00:00Z" });
}

function approved() {
  return applyTransition(proposed(), "approved", HUMAN);
}

test("every status only reaches its legal next states", () => {
  const record = exploring();
  for (const [from, allowed] of Object.entries(LEGAL_TRANSITIONS)) {
    for (const to of Object.keys(LEGAL_TRANSITIONS)) {
      if (from === to || allowed.includes(to)) continue;
      assert.throws(
        () => assertTransition({ ...record, status: from }, to, { actor: "x", at: "2026-07-16T00:00:00Z", note: "n", successor_id: "OMN-P-101", commit_or_pr: "abc" }),
        /legal next states|unknown current status/,
        `${from} -> ${to} should be illegal`
      );
    }
  }
});

test("proposed requires decision, scope, acceptance criteria, and verification plan", () => {
  const r = exploring();
  assert.throws(() => applyTransition(r, "proposed", HUMAN), /proposal\.decision/);
  r.proposal.decision = "Do it.";
  assert.throws(() => applyTransition(r, "proposed", HUMAN), /scope/);
  r.proposal.scope = ["One thing."];
  assert.throws(() => applyTransition(r, "proposed", HUMAN), /acceptance criteria/);
  r.proposal.acceptance_criteria = ["Works."];
  assert.throws(() => applyTransition(r, "proposed", HUMAN), /verification plan/);
  r.proposal.verification_plan = ["npm test"];
  const p = applyTransition(r, "proposed", HUMAN);
  assert.equal(p.status, "proposed");
});

test("approval records actor, timestamp, and the approved revision", () => {
  const a = approved();
  assert.equal(a.status, "approved");
  assert.deepEqual(a.approval, {
    state: "approved",
    approved_by: "Jonathan Lee",
    approved_at: "2026-07-16T12:00:00Z",
    approved_revision: 1,
    note: null,
  });
  assert.equal(isApprovedAtCurrentRevision(a), true);
  // The event trail preserves who/when/why.
  const last = a.events.at(-1);
  assert.equal(last.type, "status:approved");
  assert.equal(last.actor, "Jonathan Lee");
});

test("every transition requires an explicit actor", () => {
  assert.throws(() => applyTransition(proposed(), "approved", { at: "2026-07-16T12:00:00Z" }), /actor/);
});

test("a material edit after approval bumps revision, invalidates approval, returns to proposed", () => {
  const a = approved();
  const edited = applyMaterialEdit(a, { actor: "test-suite", at: "2026-07-16T13:00:00Z", note: "scope changed" });
  assert.equal(edited.revision, 2);
  assert.equal(edited.status, "proposed");
  assert.equal(edited.approval.state, "requested");
  assert.equal(edited.approval.approved_revision, null);
  assert.equal(isApprovedAtCurrentRevision(edited), false);
  // ...and the original record object is untouched (pure function).
  assert.equal(a.revision, 1);
  assert.equal(a.status, "approved");
});

test("in_progress requires current approval plus a work item or repository", () => {
  const a = approved();
  assert.throws(() => applyTransition(a, "in_progress", HUMAN), /work item|repository/);
  a.implementation.work_items = ["Implement the bounded change."];
  const ip = applyTransition(a, "in_progress", { actor: "implementation-agent", at: "2026-07-16T14:00:00Z" });
  assert.equal(ip.status, "in_progress");

  // Stale approval (revision mismatch) blocks implementation.
  const stale = approved();
  stale.revision = 2;
  stale.implementation.work_items = ["x"];
  assert.throws(() => applyTransition(stale, "in_progress", HUMAN), /stale/);
});

test("verified requires recorded checks with no failed required check", () => {
  const a = approved();
  a.implementation.work_items = ["x"];
  const ip = applyTransition(a, "in_progress", HUMAN);
  assert.throws(() => applyTransition(ip, "verified", HUMAN), /recorded checks/);

  ip.verification.checks = [{ name: "npm test", status: "failed" }];
  assert.throws(() => applyTransition(ip, "verified", HUMAN), /failed/);

  ip.verification.checks = [{ name: "npm test", status: "passed" }];
  assert.equal(applyTransition(ip, "verified", HUMAN).status, "verified");
});

test("shipped requires verified status, an actor, and a delivery reference", () => {
  const a = approved();
  a.implementation.work_items = ["x"];
  const ip = applyTransition(a, "in_progress", HUMAN);
  ip.verification.checks = [{ name: "npm test", status: "passed" }];
  const v = applyTransition(ip, "verified", HUMAN);

  assert.throws(() => applyTransition(v, "shipped", HUMAN), /commit\/PR|delivery reference/);
  const s = applyTransition(v, "shipped", { ...HUMAN, commit_or_pr: "abc1234" });
  assert.equal(s.status, "shipped");
  assert.equal(s.delivery.status, "shipped");
  assert.equal(s.delivery.commit_or_pr, "abc1234");
  // Terminal: nothing leaves shipped.
  assert.deepEqual(LEGAL_TRANSITIONS.shipped, []);
});

test("rejected requires a note; superseded requires a successor id", () => {
  assert.throws(() => applyTransition(proposed(), "rejected", HUMAN), /note/);
  const rej = applyTransition(proposed(), "rejected", { ...HUMAN, note: "Not worth the process." });
  assert.equal(rej.status, "rejected");

  assert.throws(() => applyTransition(proposed(), "superseded", HUMAN), /successor/);
  const sup = applyTransition(proposed(), "superseded", { ...HUMAN, successor_id: "OMN-P-101" });
  assert.equal(sup.superseded_by, "OMN-P-101");
});
