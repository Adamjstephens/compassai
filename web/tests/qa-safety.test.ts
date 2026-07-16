import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compactLlmRubric, isPhoneConfirmationCriterion, JPC_REPAIR_ROOF_AGE_RULE, NO_VERIFIED_EVIDENCE, pairModelRows, phoneConfirmationExcerpt, resolveModelQaStatus, resolveQaStatus, sanitizeScorecardLibrary, transcriptEvidenceExcerpt, validTimestampForDuration, verifiedEvidenceOrFallback } from "../lib/qa-safety.ts";

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

test("an unverified model paraphrase is never displayed as evidence", () => {
  const transcript = "Customer: It is a ranch home.";
  const paraphrase = "Customer confirms that it is a single-family.";
  const verified = transcriptEvidenceExcerpt(transcript, paraphrase);
  assert.equal(verified, "");
  assert.equal(verifiedEvidenceOrFallback(verified), NO_VERIFIED_EVIDENCE);
  assert.equal(verifiedEvidenceOrFallback("", "Customer: It is a ranch home."), "Customer: It is a ranch home.");
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

test("rule match is authoritative when model status contradicts its evidence", () => {
  assert.equal(resolveModelQaStatus("pass", "Needs review", false, true, "Needs review"), "Pass");
  assert.equal(resolveModelQaStatus("fail", "Pass", true, true, "Pass"), "Fail");
  assert.equal(resolveModelQaStatus("none", "Pass", false, true, "Pass"), "Needs review");
  assert.equal(resolveModelQaStatus("pass", "Pass", true, false), "Needs review");
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

test("Pella project size uses concise LLM instructions while retaining fallback patterns", () => {
  const library = sanitizeScorecardLibrary({ scorecards: [{ name: "Pella", bundle: {
    universal_rules: [],
    client_rule_sets: { pella: { rules: [{ name: "Project Size", positive_patterns: ["3 windows"], pass_description: "", fail_description: "" }] } },
    critical_checks: ["Project Size"],
  } }] });
  const projectSize = library.scorecards?.[0]?.bundle?.client_rule_sets?.pella.rules?.find((rule) => rule.name === "Project Size");
  assert.equal(projectSize?.pass_description, "Any window count of 3 or greater is a Pass.");
  assert.equal(projectSize?.fail_description, "Any window count less than 3 is a Fail.");
  const patterns = (projectSize?.positive_patterns ?? []).map((pattern) => new RegExp(pattern, "i"));
  assert.equal(patterns.some((pattern) => pattern.test("The customer needs 3 doors")), true);
  assert.equal(patterns.some((pattern) => pattern.test("They want 27 windows")), true);
  assert.equal(patterns.some((pattern) => pattern.test("We need seven doors")), true);
  assert.equal(patterns.some((pattern) => pattern.test("They need 2 windows")), false);
});

test("JPC repair roof age uses a strict over-20 rule instead of examples", () => {
  const library = sanitizeScorecardLibrary({ scorecards: [{ name: "JPC", bundle: {
    universal_rules: [],
    client_rule_sets: { jpc: { rules: [{
      name: "Repair Roof Age",
      pass_description: "roof is 10 years old; roof is about 20 years old",
      fail_description: "five years old",
      positive_patterns: [] as string[],
      negative_patterns: [] as string[],
    }] } },
    critical_checks: ["Repair Roof Age"],
  } }] });
  const rule = library.scorecards?.[0]?.bundle?.client_rule_sets?.jpc.rules?.find((candidate) => candidate.name === "Repair Roof Age");
  assert.equal(rule?.pass_description, "Any roof older than 20 years is a Pass.");
  assert.equal(rule?.fail_description, "Any roof 20 years old or newer is a Fail.");
  const positive = (rule?.positive_patterns ?? []).map((pattern) => new RegExp(pattern, "i"));
  const negative = (rule?.negative_patterns ?? []).map((pattern) => new RegExp(pattern, "i"));
  assert.equal(positive.some((pattern) => pattern.test("The roof is 21 years old")), true);
  assert.equal(positive.some((pattern) => pattern.test("The roof is 47 years old")), true);
  assert.equal(positive.some((pattern) => pattern.test("The roof is 20 years old")), false);
  assert.equal(negative.some((pattern) => pattern.test("The roof is 20 years old")), true);
  assert.equal(negative.some((pattern) => pattern.test("The roof is 8 years old")), true);
  assert.equal(JPC_REPAIR_ROOF_AGE_RULE.pass_description, rule?.pass_description);
});

test("all bundled roof-age descriptions are rules rather than example lists", () => {
  const library = sanitizeScorecardLibrary(JSON.parse(readFileSync(new URL("../../shared/qa_scorecards.json", import.meta.url), "utf8")));
  const ageRules = library.scorecards?.flatMap((scorecard: any) => {
    const bundle = scorecard.bundle ?? {};
    return [...(bundle.universal_rules ?? []), ...Object.values(bundle.client_rule_sets ?? {}).flatMap((set: any) => set.rules ?? [])]
      .filter((rule) => /roof age/i.test(rule.name || ""))
      .map((rule) => ({ scorecard: String(scorecard.name), rule }));
  }) ?? [];
  assert.ok(ageRules.length >= 5);
  for (const { scorecard, rule } of ageRules) {
    assert.doesNotMatch(rule.pass_description ?? "", /;/, `${scorecard} still has pass examples`);
    assert.doesNotMatch(rule.fail_description ?? "", /;/, `${scorecard} still has fail examples`);
    assert.match(rule.pass_description ?? "", /years|damage|wear/i, `${scorecard} needs an explicit rule`);
  }
});

test("every bundled client scorecard uses semantic LLM rules instead of phrase lists", () => {
  const source = JSON.parse(readFileSync(new URL("../../shared/qa_scorecards.json", import.meta.url), "utf8"));
  const library = sanitizeScorecardLibrary(source);
  const representativeRules: Record<string, [string, RegExp, RegExp]> = {
    "RbA/QWD": ["Government Grant Disclosure", /does not participate.*all costs.*acknowledges/i, /disclosure.*acknowledgment.*missing|acknowledgment.*missing/i],
    Pella: ["Credit Score", /650 or higher/i, /below 650/i],
    KQR: ["Approved Roofing Type", /asphalt.*not a flat or commercial roof/i, /flat or commercial roof/i],
    Forte: ["Approved Service", /residential flat-roof replacement/i, /commercial flat roof/i],
    JPC: ["Repair Roof Age", /older than 20/i, /20 years old or newer/i],
    Bachmans: ["Approved Roofing Type", /asphalt shingles, EPDM, or modified bitumen/i, /metal, slate, or tile only/i],
    HRS: ["Storm Claim Adjuster", /already inspected or reviewed/i, /has not inspected/i],
    Feldco: ["Window Count", /explicitly confirms.*no minimum/i, /not confirmed/i],
  };

  for (const scorecard of library.scorecards ?? []) {
    const expected = representativeRules[String(scorecard.name)];
    if (!expected) continue;
    const [criterion, passRule, failRule] = expected;
    const bundle = scorecard.bundle ?? {};
    const rules = [
      ...(bundle.universal_rules ?? []),
      ...Object.values(bundle.client_rule_sets ?? {}).flatMap((set: any) => set.rules ?? []),
    ];
    const rule = rules.find((candidate) => candidate.name === criterion);
    assert.ok(rule, `${scorecard.name} is missing ${criterion}`);
    assert.match(rule.pass_description ?? "", passRule, `${scorecard.name}: ${criterion} needs a semantic pass rule`);
    assert.match(rule.fail_description ?? "", failRule, `${scorecard.name}: ${criterion} needs a semantic fail rule`);
  }
  assert.equal(Object.keys(representativeRules).length, 8);
});

test("bundled LLM instructions do not contain semicolon-delimited phrase banks", () => {
  const source = JSON.parse(readFileSync(new URL("../../shared/qa_scorecards.json", import.meta.url), "utf8"));
  const library = sanitizeScorecardLibrary(source);
  for (const scorecard of library.scorecards ?? []) {
    const bundle = scorecard.bundle ?? {};
    const rules = [
      ...(bundle.universal_rules ?? []),
      ...Object.values(bundle.client_rule_sets ?? {}).flatMap((set: any) => set.rules ?? []),
    ];
    for (const rule of rules) {
      assert.doesNotMatch(
        `${rule.pass_description ?? ""}\n${rule.fail_description ?? ""}`,
        /;/,
        `${scorecard.name}: ${rule.name} still exposes a phrase bank to the LLM`,
      );
    }
  }
});

test("cloud rubric is concise, semantic, and excludes scanner patterns", () => {
  const rubric = compactLlmRubric("Pella", "Pella Windows & Doors", [
    { name: "Recorded line confirmed", type: "Critical", positive_patterns: ["a very large regex"], negative_patterns: ["another regex"] },
    { name: "Project Size", type: "Critical", pass_description: "Any window count of 3 or greater is a Pass.", fail_description: "Any window count less than 3 is a Fail.", positive_patterns: ["\\b[3-9] windows\\b"] },
  ]);
  assert.deepEqual(rubric.criteria, [
    { name: "Recorded line confirmed", critical: true, pass: "Agent states that the call or line is recorded.", fail: "The recorded-line disclosure is not stated." },
    { name: "Project Size", critical: true, pass: "Any window count of 3 or greater is a Pass.", fail: "Any window count less than 3 is a Fail." },
  ]);
  const serialized = JSON.stringify(rubric);
  assert.doesNotMatch(serialized, /positive_patterns|negative_patterns|regex/);
});

test("every bundled LLM criterion has concise pass and fail instructions", () => {
  const library = JSON.parse(readFileSync(new URL("../../shared/qa_scorecards.json", import.meta.url), "utf8"));
  for (const scorecard of library.scorecards) {
    const bundle = scorecard.bundle ?? {};
    const rules = [
      ...(bundle.universal_rules ?? []),
      ...Object.values(bundle.client_rule_sets ?? {}).flatMap((set: any) => set.rules ?? []),
    ].filter((rule: any) => rule.name !== "Client identified");
    for (const rule of rules) {
      assert.ok(rule.pass_description?.trim(), `${scorecard.name}: ${rule.name} needs a pass instruction`);
      assert.ok(rule.fail_description?.trim(), `${scorecard.name}: ${rule.name} needs a fail instruction`);
    }
  }
});

test("the same evidence-status reconciliation applies to every bundled client", () => {
  const library = JSON.parse(readFileSync(new URL("../../shared/qa_scorecards.json", import.meta.url), "utf8"));
  for (const scorecard of library.scorecards) {
    assert.equal(
      resolveModelQaStatus("pass", "Needs review", false, true, "Needs review"),
      "Pass",
      `${scorecard.name} did not use central reconciliation`,
    );
  }
});
