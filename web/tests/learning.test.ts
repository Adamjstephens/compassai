import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLearningContext,
  emptyLearningState,
  learningConflicts,
  learningSignature,
  sanitizeLearningText,
  upsertLearningCorrection,
} from "../lib/learning.ts";

function correction(overrides: Record<string, unknown> = {}) {
  return {
    id: String(overrides.id ?? "c1"),
    workflow: "qa" as const,
    scope: "client" as const,
    client: "Pella",
    scorecardId: "pella",
    scorecardName: "Pella",
    criterion: "Project size",
    originalAnswer: "Needs review",
    correctedAnswer: "Pass",
    evidence: "We have six windows.",
    rule: "Any window count of three or greater passes.",
    transcriptFingerprint: "abc",
    model: "gpt-4o-mini",
    enabled: true,
    ...overrides,
  };
}

test("verified learning prioritizes an exact client, scorecard, and criterion correction", () => {
    const state = upsertLearningCorrection(emptyLearningState(), correction());
    const result = buildLearningContext(state, {
      workflow: "qa",
      client: "Pella",
      scorecardId: "pella",
      scorecardName: "Pella",
      criteria: ["Project size"],
    });
    assert.deepEqual(result.audit.suppliedIds, ["c1"]);
    assert.match(result.audit.matchReasons.c1, /exact criterion/);
  });

test("verified learning does not leak a client correction to another client", () => {
    const state = upsertLearningCorrection(emptyLearningState(), correction());
    const result = buildLearningContext(state, {
      workflow: "qa",
      client: "Feldco",
      scorecardId: "feldco",
      scorecardName: "Feldco",
      criteria: ["Project size"],
    });
    assert.deepEqual(result.audit.suppliedIds, []);
  });

test("verified learning allows explicitly universal corrections across clients", () => {
    const state = upsertLearningCorrection(emptyLearningState(), correction({ scope: "universal" }));
    const result = buildLearningContext(state, {
      workflow: "qa",
      client: "Feldco",
      scorecardId: "feldco",
      scorecardName: "Feldco",
      criteria: ["Project size"],
    });
    assert.deepEqual(result.audit.suppliedIds, ["c1"]);
  });

test("verified learning withholds contradictory enabled corrections", () => {
    let state = upsertLearningCorrection(emptyLearningState(), correction());
    state = upsertLearningCorrection(state, correction({ id: "c2", correctedAnswer: "Fail" }));
    assert.deepEqual(learningConflicts(state.corrections), new Set(["c1", "c2"]));
    const result = buildLearningContext(state, {
      workflow: "qa",
      client: "Pella",
      scorecardId: "pella",
      scorecardName: "Pella",
      criteria: ["Project size"],
    });
    assert.deepEqual(result.audit.suppliedIds, []);
    assert.equal(result.audit.conflicts.length, 2);
  });

test("verified learning limits prompt injection to three compact examples", () => {
    let state = emptyLearningState();
    for (let index = 0; index < 5; index += 1) {
      state = upsertLearningCorrection(state, correction({ id: `c${index}`, criterion: `Criterion ${index}`, correctedAnswer: "Pass" }));
    }
    const result = buildLearningContext(state, {
      workflow: "qa",
      client: "Pella",
      scorecardId: "pella",
      scorecardName: "Pella",
      criteria: ["Criterion 0", "Criterion 1", "Criterion 2", "Criterion 3", "Criterion 4"],
    });
    assert.equal(result.prompt.length, 3);
    assert.ok(result.prompt.join("").length <= 2400);
  });

test("verified learning changes the signature when the correction revision changes", () => {
    const first = upsertLearningCorrection(emptyLearningState(), correction());
    const context = { workflow: "qa" as const, client: "Pella", scorecardId: "pella", scorecardName: "Pella", criteria: ["Project size"] };
    const firstSignature = learningSignature(buildLearningContext(first, context).audit);
    const second = upsertLearningCorrection(first, correction({ rule: "Three or more windows passes." }));
    assert.notEqual(learningSignature(buildLearningContext(second, context).audit), firstSignature);
  });

test("verified learning masks phone numbers and email addresses", () => {
    assert.equal(sanitizeLearningText("Call 312-555-0100 or adam@example.com"), "Call [phone removed] or [email removed]");
  });
