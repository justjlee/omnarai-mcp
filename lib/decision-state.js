/**
 * Decision lifecycle — legal transitions and guards (proposal OMN-P-043).
 *
 * Pure functions: record in, new record out. Nothing here touches the
 * filesystem; persistence goes through lib/decision-store.js.
 *
 * The key safeguard: approval attaches to a bounded decision at a specific
 * revision, not a mutable blob of text. A material edit after approval bumps
 * the revision and invalidates the approval.
 *
 * Phase 1 exposes NO MCP tool that performs transitions — approval and
 * shipping remain explicit human actions recorded in Git. This module exists
 * so those rules are executable and tested from day one, and so the handoff
 * gate has one authoritative definition of "approved at current revision".
 */

import { validateRecord } from "./decision-schema.js";

export const LEGAL_TRANSITIONS = {
  exploring: ["proposed", "rejected", "superseded"],
  proposed: ["approved", "rejected", "superseded"],
  approved: ["in_progress", "rejected", "superseded"],
  in_progress: ["verified", "rejected", "superseded"],
  verified: ["shipped", "superseded"],
  shipped: [],
  rejected: [],
  superseded: [],
};

function fail(record, nextStatus, reason) {
  throw new Error(`Cannot move ${record.id} from '${record.status}' to '${nextStatus}': ${reason}`);
}

/**
 * Check that a transition is legal and its guards are satisfied.
 * `event` must carry { actor, at } plus transition-specific fields
 * (note, successor_id, commit_or_pr). Throws on any violation.
 */
export function assertTransition(record, nextStatus, event = {}) {
  const allowed = LEGAL_TRANSITIONS[record.status];
  if (!allowed) fail(record, nextStatus, `unknown current status '${record.status}'`);
  if (!allowed.includes(nextStatus)) {
    fail(record, nextStatus, `legal next states are [${allowed.join(", ")}] only`);
  }
  if (!event.actor || typeof event.actor !== "string") {
    fail(record, nextStatus, "an explicit actor is required on every transition");
  }

  const p = record.proposal ?? {};
  switch (nextStatus) {
    case "proposed":
      if (!record.idea?.problem) fail(record, nextStatus, "a problem statement is required");
      if (!p.decision) fail(record, nextStatus, "proposal.decision is required");
      if (!p.scope?.length) fail(record, nextStatus, "proposal.scope must not be empty");
      if (!Array.isArray(p.non_goals)) fail(record, nextStatus, "proposal.non_goals must be present");
      if (!p.acceptance_criteria?.length) fail(record, nextStatus, "acceptance criteria are required");
      if (!p.verification_plan?.length) fail(record, nextStatus, "a verification plan is required");
      break;
    case "approved":
      // The actor here is a human attestation — recorded in Git, not a
      // verified identity. Never describe it as strong authorization.
      if (!event.at) fail(record, nextStatus, "an approval timestamp is required");
      break;
    case "in_progress":
      if (record.approval?.state !== "approved") fail(record, nextStatus, "record is not approved");
      if (record.approval.approved_revision !== record.revision) {
        fail(record, nextStatus, "approval is stale — it covers an earlier revision");
      }
      if (!record.implementation?.work_items?.length && !record.implementation?.repository) {
        fail(record, nextStatus, "at least one work item or a repository reference is required");
      }
      break;
    case "verified": {
      const checks = record.verification?.checks ?? [];
      if (!checks.length) fail(record, nextStatus, "verification requires recorded checks");
      const failed = checks.filter((c) => c.required !== false && c.status === "failed");
      if (failed.length) {
        fail(record, nextStatus, `required check(s) failed: ${failed.map((c) => c.name).join(", ")}`);
      }
      break;
    }
    case "shipped":
      if (!event.at) fail(record, nextStatus, "a shipped timestamp is required");
      if (!event.commit_or_pr) fail(record, nextStatus, "a commit/PR/delivery reference is required");
      break;
    case "rejected":
      if (!event.note) fail(record, nextStatus, "a note explaining the rejection is required");
      break;
    case "superseded":
      if (!event.successor_id) fail(record, nextStatus, "the successor record id is required");
      break;
  }
}

/**
 * Apply a guarded transition, returning a NEW validated record with the
 * status change, any side-fields (approval/delivery), and an appended event.
 */
export function applyTransition(record, nextStatus, event = {}) {
  assertTransition(record, nextStatus, event);
  const at = event.at ?? new Date().toISOString();
  const next = structuredClone(record);

  next.status = nextStatus;
  next.updated_at = at;

  if (nextStatus === "approved") {
    next.approval = {
      state: "approved",
      approved_by: event.actor,
      approved_at: at,
      approved_revision: record.revision,
      note: event.note ?? null,
    };
  }
  if (nextStatus === "shipped") {
    next.delivery = {
      ...next.delivery,
      status: "shipped",
      shipped_by: event.actor,
      shipped_at: at,
      commit_or_pr: event.commit_or_pr,
    };
  }
  if (nextStatus === "superseded") {
    next.superseded_by = event.successor_id;
  }

  next.events.push({
    type: `status:${nextStatus}`,
    at,
    actor: event.actor,
    revision: next.revision,
    ...(event.note ? { note: event.note } : {}),
  });

  return validateRecord(next);
}

/**
 * Record a material edit: bump the revision and — if the record was approved —
 * invalidate the approval and return the record to 'proposed' until a human
 * approves the new revision. Callers apply their field changes first, then
 * pass the edited record here.
 */
export function applyMaterialEdit(record, event = {}) {
  if (!event.actor) throw new Error("A material edit requires an explicit actor.");
  const at = event.at ?? new Date().toISOString();
  const next = structuredClone(record);

  next.revision = record.revision + 1;
  next.updated_at = at;
  next.events.push({
    type: "material_edit",
    at,
    actor: event.actor,
    revision: next.revision,
    ...(event.note ? { note: event.note } : {}),
  });

  if (record.approval?.state === "approved") {
    next.approval = {
      state: "requested",
      approved_by: null,
      approved_at: null,
      approved_revision: null,
      note: `Approval of revision ${record.approval.approved_revision} invalidated by material edit.`,
    };
    if (record.status === "approved") {
      next.status = "proposed";
      next.events.push({
        type: "status:proposed",
        at,
        actor: event.actor,
        revision: next.revision,
        note: "Returned to proposed: material edit invalidated the prior approval.",
      });
    }
  }

  return validateRecord(next);
}

/** True iff a record is approved at its current revision — the handoff gate. */
export function isApprovedAtCurrentRevision(record) {
  return (
    record.status === "approved" &&
    record.approval?.state === "approved" &&
    Number.isInteger(record.approval.approved_revision) &&
    record.approval.approved_revision === record.revision
  );
}
