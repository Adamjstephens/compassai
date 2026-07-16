import assert from "node:assert/strict";
import test from "node:test";
import { isPhoneConfirmationCriterion, pairModelRows, phoneConfirmationExcerpt, resolveQaStatus, sanitizeScorecardLibrary, transcriptEvidenceExcerpt, validTimestampForDuration } from "../lib/qa-safety.ts";

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
  assert.deepEqual(bundle?.client_rule_sets?.client.rules?.map((rule) => rule.name), ["Appointment time", "Appointment Length", "Phone Number Confirmed"]);
  assert.equal(bundle?.client_rule_sets?.client.rules?.[0]?.fail_description, "outside approved hours");
  assert.deepEqual(bundle?.client_rule_sets?.client.rules?.[0]?.negative_patterns, ["outside approved hours"]);
  assert.deepEqual(bundle?.critical_checks, ["Appointment time", "Appointment Length"]);
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

test("model rows are never paired by position when criterion names are unrelated", () => {
  const creditScore = { criterion: "Credit score", status: "Pass", result: "Customer said their score is 720." };
  const paired = pairModelRows([creditScore], ["Phone Number Confirmed"]);
  assert.equal(paired[0], undefined);
});

test("phone confirmation requires phone-specific evidence", () => {
  assert.equal(isPhoneConfirmationCriterion("Confirmed Phone"), true);
  assert.deepEqual(phoneConfirmationExcerpt("Agent: Your credit score is 720. Customer: Correct."), { evidence: "", confirmed: false });
  assert.deepEqual(phoneConfirmationExcerpt("Agent: Do you have a phone number? Customer: Yes."), { evidence: "", confirmed: false });
  const confirmed = phoneConfirmationExcerpt("Agent: Is 610 304 2170 still the best phone number? Customer: Yes, correct.");
  assert.equal(confirmed.confirmed, true);
  assert.match(confirmed.evidence, /phone number.*yes.*correct/i);
  assert.equal(phoneConfirmationExcerpt("Customer: You can reach me at (610) 304-2170.").confirmed, true);
});

test("every scorecard receives appointment length and phone confirmation rules", () => {
  const library = sanitizeScorecardLibrary({ scorecards: [
    { bundle: { universal_rules: [], client_rule_sets: { pella: { rules: [{ name: "Phone Confirmed", positive_patterns: ["email", "credit score"] }] } }, critical_checks: [] } },
    { bundle: { universal_rules: [], client_rule_sets: {}, critical_checks: [] } },
  ] });
  for (const scorecard of library.scorecards ?? []) {
    const bundle = scorecard.bundle ?? {};
    const rules = [...(bundle.universal_rules ?? []), ...Object.values(bundle.client_rule_sets ?? {}).flatMap((set) => set.rules ?? [])];
    assert.equal(rules.some((rule) => rule.name === "Appointment Length"), true);
    const phone = rules.find((rule) => isPhoneConfirmationCriterion(rule.name));
    assert.ok(phone);
    assert.equal(phone.positive_patterns?.some((pattern) => /email|credit score/i.test(pattern)), false);
    assert.equal((bundle.critical_checks ?? []).includes("Appointment Length"), true);
  }
});

test("Pella project size passes any window or door count of three or greater", () => {
  const library = sanitizeScorecardLibrary({ scorecards: [{ name: "Pella", bundle: {
    universal_rules: [],
    client_rule_sets: { pella: { rules: [{ name: "Project Size", positive_patterns: ["3 windows"], pass_description: "" }] } },
    critical_checks: ["Project Size"],
  } }] });
  const projectSize = library.scorecards?.[0]?.bundle?.client_rule_sets?.pella.rules?.find((rule) => rule.name === "Project Size");
  assert.match(projectSize?.pass_description ?? "", /ANY NUMBER OF WINDOWS OR DOORS THAT IS 3 OR GREATER IS A PASS/);
  const patterns = (projectSize?.positive_patterns ?? []).map((pattern) => new RegExp(pattern, "i"));
  assert.equal(patterns.some((pattern) => pattern.test("The customer needs 3 doors")), true);
  assert.equal(patterns.some((pattern) => pattern.test("They want 27 windows")), true);
  assert.equal(patterns.some((pattern) => pattern.test("We need seven doors")), true);
  assert.equal(patterns.some((pattern) => pattern.test("They need 2 windows")), false);
});
