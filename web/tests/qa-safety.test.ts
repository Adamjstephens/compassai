import assert from "node:assert/strict";
import test from "node:test";
import { pairModelRows, resolveQaStatus, sanitizeScorecardLibrary, transcriptEvidenceExcerpt, validTimestampForDuration } from "../lib/qa-safety.ts";

test("scorecard cleanup removes prohibited, duplicate, and same-day instructions", () => {
  const library = sanitizeScorecardLibrary({ scorecards: [{ bundle: {
    universal_rules: [{ name: "Recorded line" }, { name: "Recorded Line" }, { name: "New qualifier" }],
    client_rule_sets: { client: { rules: [
      { name: "No Same Day", fail_description: "today only" },
      { name: "Booked Correct Calendar" },
      { name: "Appointment time", fail_description: "same day; outside approved hours", negative_patterns: ["same\\s+day", "outside approved hours"] },
    ] } },
    critical_checks: ["No Same Day", "Appointment time", "Appointment time"],
  } }] });
  const bundle = library.scorecards?.[0]?.bundle;
  assert.deepEqual(bundle?.universal_rules?.map((rule) => rule.name), ["Recorded line"]);
  assert.deepEqual(bundle?.client_rule_sets?.client.rules?.map((rule) => rule.name), ["Appointment time"]);
  assert.equal(bundle?.client_rule_sets?.client.rules?.[0]?.fail_description, "outside approved hours");
  assert.deepEqual(bundle?.client_rule_sets?.client.rules?.[0]?.negative_patterns, ["outside approved hours"]);
  assert.deepEqual(bundle?.critical_checks, ["Appointment time"]);
});

test("clear transcript evidence is recovered from an explanatory model response", () => {
  const transcript = "Agent: This call is being recorded for quality assurance. Customer: Okay.";
  const proposed = "Pass. Clear evidence: This call is being recorded for quality assurance.";
  assert.equal(transcriptEvidenceExcerpt(transcript, proposed), "This call is being recorded for quality assurance.");
  assert.equal(transcriptEvidenceExcerpt(transcript, "The agent disclosed a monitored line."), "");
});

test("timestamps outside the call duration are rejected", () => {
  assert.equal(validTimestampForDuration("09:58", 600), true);
  assert.equal(validTimestampForDuration("30:00", 600), false);
  assert.equal(validTimestampForDuration("12:75", 900), false);
});

test("an evidence-backed critical Pass is guaranteed to remain Pass", () => {
  assert.equal(resolveQaStatus("Pass", true, true), "Pass");
  assert.equal(resolveQaStatus("Pass", true, false), "Needs review");
  assert.equal(resolveQaStatus("Not applicable", true, true), "Needs review");
  assert.equal(resolveQaStatus("Needs review", true, true, "Pass"), "Pass");
  assert.equal(resolveQaStatus("Needs review", true, true, "Fail"), "Fail");
});

test("model rows are paired despite harmless criterion naming changes", () => {
  const rows = [
    { qualifier: "Recorded-line confirmed", status: "Pass" },
    { criterion: "Customer address confirmed", status: "Pass" },
  ];
  const paired = pairModelRows(rows, ["Recorded line confirmed", "Address confirmed"]);
  assert.equal(paired[0], rows[0]);
  assert.equal(paired[1], rows[1]);
});
