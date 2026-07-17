import assert from "node:assert/strict";
import test from "node:test";
import {
  finalizeMissedOpportunityAnalysis,
  normalizeAnalysisMode,
  runMissedOpportunityAnalysis,
  type MissedOpportunityModelPayload,
  type OpportunityType,
} from "../lib/missed-opportunities.ts";

const pad = " The customer and agent continued discussing the home improvement request and possible consultation details.";

function rawFinding(type: OpportunityType, trigger: string, response: string, confidence = .91): MissedOpportunityModelPayload {
  return {
    findings: [{
      type,
      title: type.replaceAll("_", " "),
      summary: "The agent accepted the objection without a supported recovery attempt.",
      severity: "high",
      confidence,
      customerTrigger: { text: trigger },
      agentResponse: { text: response },
      expectedAction: "Ask a relevant follow-up question and offer a supported next step.",
      suggestedResponse: "I understand. May I ask what is holding you back?",
      evidence: [
        { speaker: "customer", text: trigger },
        { speaker: "agent", text: response },
      ],
    }],
    disposition: { value: "not_booked", confidence: .9, reason: "No appointment or callback was established." },
  };
}

function handledObjection(category: "not_interested" | "free_program_service_boundary", trigger: string, response: string): MissedOpportunityModelPayload {
  return {
    findings: [],
    handledObjections: [{
      category,
      title: "Objection handled effectively",
      assessment: "The agent acknowledged the concern and gave a relevant, supported response.",
      technique: "Acknowledge and reframe",
      confidence: .92,
      customerTrigger: { text: trigger },
      agentResponse: { text: response },
      evidence: [
        { speaker: "customer", text: trigger },
        { speaker: "agent", text: response },
      ],
    }],
    disposition: { value: "not_booked", confidence: .9, reason: "The objection was handled but no appointment was booked." },
  };
}

async function analyze(transcript: string, payload: MissedOpportunityModelPayload, onEvaluate?: () => void) {
  return runMissedOpportunityAnalysis({
    transcript,
    callId: "call-1",
    selectedModel: "gpt-4o-mini",
    evaluate: async () => {
      onEvaluate?.();
      return payload;
    },
  });
}

test("not interested followed by immediate ending is flagged", async () => {
  const transcript = `Customer: I'm not interested. Agent: Okay, have a good day.${pad}`;
  const result = await analyze(transcript, rawFinding("no_rebuttal_after_objection", "I'm not interested.", "Okay, have a good day."));
  assert.equal(result.summary.total, 1);
});

test("not interested followed by a valid follow-up is not flagged", async () => {
  const trigger = "I'm not interested.";
  const response = "I understand. Was it the timing, the project itself, or something else?";
  const transcript = `Customer: ${trigger} Agent: ${response}${pad}`;
  const result = await analyze(transcript, handledObjection("not_interested", trigger, response));
  assert.equal(result.summary.total, 0);
  assert.equal(result.handledObjections.length, 1);
  assert.equal(result.handledObjections[0]?.technique, "Acknowledge and reframe");
});

test("handled objection evidence must be an exact transcript quote", async () => {
  const transcript = `Customer: I'm not interested. Agent: May I ask if it is the timing?${pad}`;
  const result = await analyze(transcript, handledObjection("not_interested", "I'm not interested.", "The agent asked a thoughtful question."));
  assert.equal(result.handledObjections.length, 0);
});

test("the same objection cannot be both a missed opportunity and handled well", async () => {
  const trigger = "I'm not interested.";
  const response = "Okay, have a good day.";
  const transcript = `Customer: ${trigger} Agent: ${response}${pad}`;
  const raw = rawFinding("no_rebuttal_after_objection", trigger, response);
  raw.handledObjections = handledObjection("not_interested", trigger, response).handledObjections;
  const result = await analyze(transcript, raw);
  assert.equal(result.summary.total, 1);
  assert.equal(result.handledObjections.length, 0);
});

test("spouse objection accepted without redirect is flagged", async () => {
  const transcript = `Customer: I need to talk to my spouse. Agent: Okay, call us back.${pad}`;
  const result = await analyze(transcript, rawFinding("decision_maker_objection_not_explored", "I need to talk to my spouse.", "Okay, call us back."));
  assert.equal(result.findings[0]?.type, "decision_maker_objection_not_explored");
});

test("spouse objection redirected to a joint appointment is not flagged", async () => {
  const transcript = `Customer: I need to talk to my spouse. Agent: Would it help to schedule a time when both of you can be available?${pad}`;
  const result = await analyze(transcript, { findings: [] });
  assert.equal(result.summary.total, 0);
});

test("declined appointment time without an alternative is flagged", async () => {
  const transcript = `Customer: That time doesn't work. Agent: Okay, I understand.${pad}`;
  const result = await analyze(transcript, rawFinding("no_alternate_time_offered", "That time doesn't work.", "Okay, I understand."));
  assert.equal(result.summary.total, 1);
});

test("declined time followed by another option is not flagged", async () => {
  const transcript = `Customer: That time doesn't work. Agent: No problem. Would later that day or tomorrow work better?${pad}`;
  const result = await analyze(transcript, { findings: [] });
  assert.equal(result.summary.total, 0);
});

test("price concern acknowledged and redirected is not flagged", async () => {
  const transcript = `Customer: That sounds too expensive. Agent: I understand. The consultation will give you exact options without an obligation.${pad}`;
  const result = await analyze(transcript, { findings: [] });
  assert.equal(result.summary.total, 0);
});

test("ignored price concern is flagged", async () => {
  const transcript = `Customer: That sounds too expensive. Agent: Okay, then we can leave it there.${pad}`;
  const result = await analyze(transcript, rawFinding("price_objection_not_handled", "That sounds too expensive.", "Okay, then we can leave it there."));
  assert.equal(result.findings[0]?.type, "price_objection_not_handled");
});

test("Medicare service-boundary correction is treated as a valid rebuttal", async () => {
  let evaluated = false;
  const transcript = "Customer: Medicare says I can get a really good discount, but I think most of this is bullshit. Agent: Medicare is a government health plan. Any government assistance program would be something you would have to apply for with the Pennsylvania government. What we do is specialize in setting up free quotes for people who need windows. I'm sorry that you ran into that misleading ad. Have a good day.";
  const result = await analyze(
    transcript,
    handledObjection("free_program_service_boundary", "I think most of this is bullshit.", "Medicare is a government health plan."),
    () => { evaluated = true; },
  );
  assert.equal(evaluated, true);
  assert.equal(result.disposition.value, "excluded");
  assert.match(result.disposition.reason, /corrected a misleading third-party program claim/i);
  assert.equal(result.summary.total, 0);
  assert.equal(result.handledObjections.length, 1);
});

test("busy customer with a scheduled callback is excluded without a model call", async () => {
  let evaluated = false;
  const transcript = `Customer: I am busy right now. Agent: I will call you back tomorrow at 2 PM.${pad}`;
  const result = await analyze(transcript, rawFinding("no_callback_attempt", "I am busy right now.", "I will call you back tomorrow at 2 PM."), () => { evaluated = true; });
  assert.equal(evaluated, false);
  assert.equal(result.disposition.value, "callback");
});

test("busy customer without a callback attempt is flagged", async () => {
  const transcript = `Customer: I am busy right now. Agent: Fine, goodbye.${pad}`;
  const result = await analyze(transcript, rawFinding("no_callback_attempt", "I am busy right now.", "Fine, goodbye."));
  assert.equal(result.summary.total, 1);
});

test("an early objection is suppressed when booking succeeds later", async () => {
  let evaluated = false;
  const transcript = `Customer: I'm not interested. Agent: Could another day work? Customer: Yes. Agent: Your consultation is scheduled for Friday at 2 PM.${pad}`;
  const result = await analyze(transcript, { findings: [] }, () => { evaluated = true; });
  assert.equal(evaluated, false);
  assert.equal(result.disposition.value, "booked");
});

test("customer no-contact request is excluded", async () => {
  let evaluated = false;
  const transcript = `Customer: Do not call me again and remove me from your list. Agent: Understood.${pad}`;
  const result = await analyze(transcript, { findings: [] }, () => { evaluated = true; });
  assert.equal(evaluated, false);
  assert.equal(result.disposition.value, "excluded");
});

test("disqualified project is excluded", async () => {
  let evaluated = false;
  const transcript = `Customer: I need this unusual service. Agent: That is not a service we offer, so we cannot schedule it.${pad}`;
  const result = await analyze(transcript, { findings: [] }, () => { evaluated = true; });
  assert.equal(evaluated, false);
  assert.equal(result.disposition.value, "excluded");
});

test("incomplete transcript produces no unsupported finding", async () => {
  let evaluated = false;
  const result = await analyze("Customer: Not interested. Agent:", { findings: [] }, () => { evaluated = true; });
  assert.equal(evaluated, false);
  assert.equal(result.summary.total, 0);
});

test("multiple findings using the same trigger are merged", () => {
  const transcript = `Customer: I'm not interested. Agent: Okay, goodbye.${pad}`;
  const one = rawFinding("no_rebuttal_after_objection", "I'm not interested.", "Okay, goodbye.").findings![0];
  const result = finalizeMissedOpportunityAnalysis({ transcript, callId: "call-1", selectedModel: "gpt-4o-mini", raw: { findings: [one, { ...one, type: "no_follow_up_question" }] } });
  assert.equal(result.summary.total, 1);
});

test("QA mode remains the safe default and existing QA data is untouched", () => {
  const savedQa = { metrics: { qa_score: 92 }, rows: [{ check: "Recorded line", status: "Pass" }] };
  assert.equal(normalizeAnalysisMode(undefined), "qa");
  assert.deepEqual(savedQa, { metrics: { qa_score: 92 }, rows: [{ check: "Recorded line", status: "Pass" }] });
});

test("old saved calls without a mode load as QA", () => {
  assert.equal(normalizeAnalysisMode(null), "qa");
  assert.equal(normalizeAnalysisMode("unknown"), "qa");
});

test("reviewer status and notes survive reanalysis through stable fingerprints", () => {
  const transcript = `Customer: I'm not interested. Agent: Okay, goodbye.${pad}`;
  const raw = rawFinding("no_rebuttal_after_objection", "I'm not interested.", "Okay, goodbye.");
  const first = finalizeMissedOpportunityAnalysis({ transcript, callId: "call-1", selectedModel: "gpt-4o-mini", raw });
  const reviewed = [{ ...first.findings[0], status: "coached" as const, reviewerNotes: "Practiced a discovery question." }];
  const rerun = finalizeMissedOpportunityAnalysis({ transcript, callId: "call-1", selectedModel: "gpt-4o-mini", raw, previous: reviewed });
  assert.equal(rerun.findings[0].status, "coached");
  assert.equal(rerun.findings[0].reviewerNotes, "Practiced a discovery question.");
  assert.equal(rerun.findings[0].id, first.findings[0].id);
});
