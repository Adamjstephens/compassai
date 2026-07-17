import assert from "node:assert/strict";
import test from "node:test";
import { estimatedSessionCost, gradingCost, transcriptionCost } from "../lib/costs.ts";

test("Whisper estimates its published per-minute cost", () => {
  assert.equal(transcriptionCost("whisper-1", 600), 0.06);
});

test("gpt-5-nano grading is cheaper than gpt-4o-mini for the same usage", () => {
  const usage = { promptTokens: 5_000, completionTokens: 1_000 };
  assert.ok(gradingCost("gpt-5-nano", usage) < gradingCost("gpt-4o-mini", usage));
});

test("dated model snapshots use their base model pricing", () => {
  const usage = { promptTokens: 5_000, completionTokens: 1_000 };
  assert.equal(gradingCost("gpt-5-mini-2025-08-07", usage), gradingCost("gpt-5-mini", usage));
});

test("session estimate separates transcription and grading", () => {
  const estimate = estimatedSessionCost("whisper-1", "gpt-5-mini", 300);
  assert.ok(estimate.transcriptionUsd > 0);
  assert.ok(estimate.gradingUsd > 0);
  assert.equal(estimate.totalUsd, estimate.transcriptionUsd + estimate.gradingUsd);
});
