export type AnalysisMode = "qa" | "missed_opportunities";

export type OpportunityType =
  | "no_rebuttal_after_objection"
  | "no_follow_up_question"
  | "no_redirect_to_booking"
  | "no_alternate_time_offered"
  | "no_callback_attempt"
  | "decision_maker_objection_not_explored"
  | "price_objection_not_handled"
  | "free_program_objection_not_handled"
  | "timing_objection_not_explored"
  | "buying_signal_not_converted"
  | "question_answered_without_close"
  | "no_next_step_established"
  | "agent_ended_while_customer_engaged";

export type OpportunityEvidence = {
  speaker: "agent" | "customer" | "unknown";
  text: string;
  startTime?: number;
  endTime?: number;
  turnId?: string;
};

export type MissedOpportunity = {
  id: string;
  callId: string;
  type: OpportunityType;
  title: string;
  summary: string;
  severity: "low" | "medium" | "high";
  confidence: number;
  customerTrigger: Omit<OpportunityEvidence, "speaker">;
  agentResponse: Omit<OpportunityEvidence, "speaker">;
  expectedAction: string;
  suggestedResponse?: string;
  evidence: OpportunityEvidence[];
  status: "open" | "reviewed" | "dismissed" | "coached";
  reviewerNotes?: string;
  analysisVersion: string;
  createdAt: string;
  fingerprint: string;
};

export type MissedOpportunitySummary = {
  total: number;
  highSeverityCount: number;
  countsByType: Record<string, number>;
  strongestOpportunity?: MissedOpportunity;
};

export type CallDisposition = {
  value: "booked" | "transferred" | "callback" | "not_booked" | "excluded" | "uncertain";
  confidence: number;
  reason: string;
};

export type CandidateWindow = {
  id: string;
  category: string;
  text: string;
  startOffset: number;
  endOffset: number;
};

export type MissedOpportunityAnalysis = {
  findings: MissedOpportunity[];
  summary: MissedOpportunitySummary;
  disposition: CallDisposition;
  analysisVersion: string;
  promptVersion: string;
  selectedModel: string;
  cacheKey: string;
  analyzedAt: string;
  candidateCount: number;
  identity?: { agentName?: string; customerName?: string; customerPhone?: string };
};

type RawFinding = Partial<Omit<MissedOpportunity, "id" | "callId" | "analysisVersion" | "createdAt" | "fingerprint">> & {
  type?: string;
};

export type MissedOpportunityModelPayload = {
  findings?: RawFinding[];
  disposition?: Partial<CallDisposition>;
  identity?: { agentName?: string; customerName?: string; customerPhone?: string };
  notes?: string;
};

export const MISSED_OPPORTUNITY_ANALYSIS_VERSION = "1.0.1";
export const MISSED_OPPORTUNITY_PROMPT_VERSION = "missed-opportunities-v2";
export const DEFAULT_OPPORTUNITY_CONFIDENCE = 0.78;

export function normalizeAnalysisMode(value: unknown): AnalysisMode {
  return value === "missed_opportunities" ? "missed_opportunities" : "qa";
}

const OPPORTUNITY_TYPES = new Set<OpportunityType>([
  "no_rebuttal_after_objection",
  "no_follow_up_question",
  "no_redirect_to_booking",
  "no_alternate_time_offered",
  "no_callback_attempt",
  "decision_maker_objection_not_explored",
  "price_objection_not_handled",
  "free_program_objection_not_handled",
  "timing_objection_not_explored",
  "buying_signal_not_converted",
  "question_answered_without_close",
  "no_next_step_established",
  "agent_ended_while_customer_engaged",
]);

const CANDIDATE_GROUPS: Array<{ category: string; pattern: RegExp }> = [
  { category: "interest", pattern: /\b(not interested|just looking|research(?:ing)? first|need to think|not ready|project (?:is )?for later)\b/gi },
  { category: "decision_maker", pattern: /\b(spouse|husband|wife|partner|decision maker|approval from|talk (?:to|with) (?:him|her|them|my))\b/gi },
  { category: "callback", pattern: /\b(call (?:me|you|us) back|can(?:not|'t) talk|busy right now|bad time)\b/gi },
  { category: "price", pattern: /\b(can(?:not|'t) afford|do not have the money|don't have the money|too expensive|only wanted (?:a )?price|pricing|already (?:have|received|got) a quote)\b/gi },
  { category: "free_program", pattern: /\b(thought (?:it|this) was free|free windows?|free roof(?:ing)?|government (?:grant|program|assistance))\b/gi },
  { category: "appointment_time", pattern: /\b(that time (?:does not|doesn't|won't) work|cannot make (?:that|it)|can't make (?:that|it)|another time|future date)\b/gi },
  { category: "appointment_resistance", pattern: /\b(do not want an appointment|don't want an appointment|no appointment|not scheduling|not book(?:ing)?)\b/gi },
  { category: "buying_signal", pattern: /\b(how much|what does it cost|when can|how soon|available|estimate|consultation|quote)\b/gi },
];

const BOOKED_PATTERNS = [
  /\b(?:appointment|consultation|estimate) (?:is|has been|was) (?:booked|scheduled|set|confirmed)\b/i,
  /\byou(?:'re| are) (?:all )?set for\b/i,
  /\bwe(?:'ll| will) see you (?:on|at)\b/i,
  /\bbooked (?:you|it|that) for\b/i,
];
const CALLBACK_PATTERNS = [
  /\b(?:i|we)(?:'ll| will| can) call (?:you|them) back (?:at|on|tomorrow|later)\b/i,
  /\bcallback (?:is|was|for) (?:set|scheduled|booked)\b/i,
  /\bcall you back at \d/i,
];
const NO_CONTACT_PATTERNS = [
  /\bdo not call (?:me|us) again\b/i,
  /\bdon't call (?:me|us) again\b/i,
  /\bremove (?:me|us) from (?:your|the) (?:list|system)\b/i,
  /\bstop calling\b/i,
];
const DISQUALIFIED_PATTERNS = [
  /\bwe do not (?:offer|service|handle|work on) (?:that|those|this)\b/i,
  /\boutside (?:our|the) service area\b/i,
  /\bnot a service we (?:offer|provide)\b/i,
  /\bcommercial (?:property|project).{0,60}\bresidential only\b/i,
];
const HOSTILE_PATTERNS = [
  /\b(?:threaten|threatening|harass|harassment)\b/i,
  /\b(?:fuck|fucking) (?:off|you)\b/i,
];

function normalized(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function includesEvidence(transcript: string, quote: string) {
  const needle = normalized(quote);
  if (needle.length < 3) return false;
  return normalized(transcript).includes(needle);
}

function timestamp(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function cleanEvidence(value: unknown, defaultSpeaker: OpportunityEvidence["speaker"]): OpportunityEvidence {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const speaker = input.speaker === "agent" || input.speaker === "customer" ? input.speaker : defaultSpeaker;
  return {
    speaker,
    text: String(input.text ?? "").trim().slice(0, 700),
    startTime: timestamp(input.startTime),
    endTime: timestamp(input.endTime),
    turnId: input.turnId ? String(input.turnId).slice(0, 100) : undefined,
  };
}

function severityRank(value: MissedOpportunity["severity"]) {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

export function isServiceBoundaryCorrection(transcript: string) {
  const mentionsExternalProgram = /\b(medicare|medicaid|government (?:assistance|grant|benefit|health|funding) (?:plan|program)?|free (?:window|roof(?:ing)?|product) program)\b/i.test(transcript);
  const explainsExternalOwnership = /\b(?:medicare|medicaid) is (?:a )?government (?:health )?(?:plan|program)\b/i.test(transcript)
    || /\b(?:you|they|the customer|someone) (?:would|would have|'d|must|has to|have to) (?:apply|contact).{0,120}\b(?:government|medicare|medicaid|agency)\b/is.test(transcript)
    || /\b(?:government|medicare|medicaid).{0,100}\bnot (?:our|a service we|something we)\b/is.test(transcript);
  const statesActualOffer = /\b(?:what we do|we (?:do|actually|only)|we specialize|our service).{0,180}\b(?:free )?(?:quotes?|estimates?|consultations?|appointments?)\b/is.test(transcript);
  const correctsMisleadingClaim = /\b(?:misleading|incorrect|inaccurate|false) (?:ad|advertisement|claim|information)\b/i.test(transcript);
  return mentionsExternalProgram && explainsExternalOwnership && (statesActualOffer || correctsMisleadingClaim);
}

export function createOpportunityCacheKey(transcript: string, model: string) {
  return [
    "missed_opportunities",
    MISSED_OPPORTUNITY_ANALYSIS_VERSION,
    MISSED_OPPORTUNITY_PROMPT_VERSION,
    model,
    hashString(normalized(transcript)),
  ].join(":");
}

export function detectCandidateWindows(transcript: string, radius = 850): CandidateWindow[] {
  const candidates: CandidateWindow[] = [];
  for (const group of CANDIDATE_GROUPS) {
    group.pattern.lastIndex = 0;
    for (const match of transcript.matchAll(group.pattern)) {
      const offset = match.index ?? 0;
      const startOffset = Math.max(0, offset - radius);
      const endOffset = Math.min(transcript.length, offset + match[0].length + radius);
      if (candidates.some((item) => item.category === group.category && Math.abs(item.startOffset - startOffset) < 240)) continue;
      candidates.push({
        id: `window-${hashString(`${group.category}:${offset}:${match[0]}`)}`,
        category: group.category,
        text: transcript.slice(startOffset, endOffset),
        startOffset,
        endOffset,
      });
    }
  }
  return candidates
    .sort((left, right) => left.startOffset - right.startOffset)
    .slice(0, 12);
}

export function inferCallDisposition(transcript: string, transferOccurred = false): CallDisposition {
  const clean = transcript.trim();
  if (transferOccurred) return { value: "transferred", confidence: 1, reason: "A successful transfer is already recorded for the call." };
  if (clean.length < 80) return { value: "excluded", confidence: 1, reason: "Transcript is too short for supported opportunity analysis." };
  if (NO_CONTACT_PATTERNS.some((pattern) => pattern.test(clean))) return { value: "excluded", confidence: .99, reason: "The customer requested no further contact." };
  if (isServiceBoundaryCorrection(clean)) return { value: "excluded", confidence: .98, reason: "The agent corrected a misleading third-party program claim and explained the service the company actually offers." };
  if (DISQUALIFIED_PATTERNS.some((pattern) => pattern.test(clean))) return { value: "excluded", confidence: .95, reason: "The transcript indicates the lead or requested service was disqualified." };
  if (HOSTILE_PATTERNS.some((pattern) => pattern.test(clean))) return { value: "excluded", confidence: .9, reason: "The transcript indicates a hostile or safety-sensitive ending." };
  if (BOOKED_PATTERNS.some((pattern) => pattern.test(clean))) return { value: "booked", confidence: .94, reason: "The transcript contains a supported appointment confirmation." };
  if (CALLBACK_PATTERNS.some((pattern) => pattern.test(clean))) return { value: "callback", confidence: .9, reason: "A specific callback or next step appears to have been established." };
  if (detectCandidateWindows(clean).length) return { value: "not_booked", confidence: .72, reason: "The transcript contains objection or buying-signal moments without a confirmed appointment." };
  return { value: "uncertain", confidence: .45, reason: "No reliable booked outcome or missed-opportunity candidate was found." };
}

export function summarizeMissedOpportunities(findings: MissedOpportunity[]): MissedOpportunitySummary {
  const visible = findings.filter((finding) => finding.status !== "dismissed");
  const countsByType: Record<string, number> = {};
  for (const finding of visible) countsByType[finding.type] = (countsByType[finding.type] ?? 0) + 1;
  const strongestOpportunity = [...visible].sort((left, right) =>
    severityRank(right.severity) - severityRank(left.severity) || right.confidence - left.confidence,
  )[0];
  return {
    total: visible.length,
    highSeverityCount: visible.filter((finding) => finding.severity === "high").length,
    countsByType,
    strongestOpportunity,
  };
}

export function filterMissedOpportunities(
  findings: MissedOpportunity[],
  filters: { type?: string; severity?: string; minimumConfidence?: number; status?: string },
) {
  return findings.filter((finding) =>
    (!filters.type || finding.type === filters.type)
    && (!filters.severity || finding.severity === filters.severity)
    && (!filters.status || finding.status === filters.status)
    && finding.confidence >= (filters.minimumConfidence ?? 0),
  );
}

export function aggregateMissedOpportunities(calls: Array<{ agent?: string; analysis?: MissedOpportunityAnalysis }>) {
  const byAgent: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const coachingPatterns: Record<string, number> = {};
  let analyzedCalls = 0;
  let highSeverity = 0;
  let total = 0;
  for (const call of calls) {
    if (!call.analysis) continue;
    analyzedCalls += 1;
    const agent = call.agent?.trim() || "Unknown agent";
    const findings = call.analysis.findings.filter((finding) => finding.status !== "dismissed");
    byAgent[agent] = (byAgent[agent] ?? 0) + findings.length;
    for (const finding of findings) {
      total += 1;
      if (finding.severity === "high") highSeverity += 1;
      byType[finding.type] = (byType[finding.type] ?? 0) + 1;
      if (finding.status === "coached") coachingPatterns[finding.type] = (coachingPatterns[finding.type] ?? 0) + 1;
    }
  }
  return {
    opportunitiesPerAgent: byAgent,
    countsByType: byType,
    highSeverityOpportunityRate: total ? highSeverity / total : 0,
    opportunitiesPerNonBookedCall: analyzedCalls ? total / analyzedCalls : 0,
    repeatCoachingPatterns: coachingPatterns,
    appointmentLossOpportunities: Object.entries(byType)
      .filter(([type]) => /booking|alternate_time|callback|next_step|buying_signal|close/.test(type))
      .reduce((sum, [, count]) => sum + count, 0),
  };
}

export function buildMissedOpportunityPrompt(transcript: string, windows: CandidateWindow[]) {
  const system = `You are a conservative sales-call QA auditor evaluating missed opportunities on a non-booked call.
Return JSON only with this shape: {"identity":{"agentName":"","customerName":"","customerPhone":""},"findings":[{"type":"...","title":"...","summary":"...","severity":"low|medium|high","confidence":0.0,"customerTrigger":{"text":"exact quote","startTime":null,"endTime":null,"turnId":null},"agentResponse":{"text":"exact quote","startTime":null,"endTime":null,"turnId":null},"expectedAction":"...","suggestedResponse":"...","evidence":[{"speaker":"agent|customer|unknown","text":"exact quote","startTime":null,"endTime":null,"turnId":null}]}],"disposition":{"value":"booked|transferred|callback|not_booked|excluded|uncertain","confidence":0.0,"reason":"..."}}.
Use only exact evidence present in the supplied transcript windows. Infer speaker roles only when context is reliable. Evaluate the next several turns after each objection, then check the call ending for later recovery, booking, transfer, callback, or another next step. Return no finding when uncertain, evidence is insufficient, the transcript is incomplete, speaker roles are unreliable, the customer requests no contact, the lead is disqualified, the service is unavailable, the customer is hostile, or the agent reasonably attempted recovery. A factual correction is a valid rebuttal when the customer asks about Medicare, Medicaid, government grants, free products, or another third-party benefit the company does not administer and the agent explains both that boundary and the actual offer, such as a free quote, estimate, or consultation. Do not instruct the agent to claim that a government or medical program provides company benefits. Distinguish a free quote or consultation from a free product or government-funded service. Do not flag a weak response unless momentum was genuinely abandoned. Do not duplicate or stack findings on the same evidence. Confidence must be at least ${DEFAULT_OPPORTUNITY_CONFIDENCE} for every returned finding. Never invent quotes, timestamps, policy, or outcomes.`;
  const user = JSON.stringify({
    analysisVersion: MISSED_OPPORTUNITY_ANALYSIS_VERSION,
    promptVersion: MISSED_OPPORTUNITY_PROMPT_VERSION,
    allowedTypes: Array.from(OPPORTUNITY_TYPES),
    candidateWindows: windows,
    callEnding: transcript.slice(-2200),
  });
  return { system, user };
}

export function missedOpportunityResponseFormat() {
  const nullableNumber = { anyOf: [{ type: "number" }, { type: "null" }] };
  const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };
  const quote = {
    type: "object",
    additionalProperties: false,
    required: ["text", "startTime", "endTime", "turnId"],
    properties: { text: { type: "string" }, startTime: nullableNumber, endTime: nullableNumber, turnId: nullableString },
  };
  const evidence = {
    type: "object",
    additionalProperties: false,
    required: ["speaker", "text", "startTime", "endTime", "turnId"],
    properties: {
      speaker: { type: "string", enum: ["agent", "customer", "unknown"] },
      text: { type: "string" },
      startTime: nullableNumber,
      endTime: nullableNumber,
      turnId: nullableString,
    },
  };
  return {
    type: "json_schema",
    json_schema: {
      name: "compassai_missed_opportunities",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["identity", "findings", "disposition"],
        properties: {
          identity: {
            type: "object",
            additionalProperties: false,
            required: ["agentName", "customerName", "customerPhone"],
            properties: { agentName: { type: "string" }, customerName: { type: "string" }, customerPhone: { type: "string" } },
          },
          findings: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "title", "summary", "severity", "confidence", "customerTrigger", "agentResponse", "expectedAction", "suggestedResponse", "evidence"],
              properties: {
                type: { type: "string", enum: Array.from(OPPORTUNITY_TYPES) },
                title: { type: "string" },
                summary: { type: "string" },
                severity: { type: "string", enum: ["low", "medium", "high"] },
                confidence: { type: "number", minimum: 0, maximum: 1 },
                customerTrigger: quote,
                agentResponse: quote,
                expectedAction: { type: "string" },
                suggestedResponse: { type: "string" },
                evidence: { type: "array", minItems: 2, items: evidence },
              },
            },
          },
          disposition: {
            type: "object",
            additionalProperties: false,
            required: ["value", "confidence", "reason"],
            properties: {
              value: { type: "string", enum: ["booked", "transferred", "callback", "not_booked", "excluded", "uncertain"] },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reason: { type: "string" },
            },
          },
        },
      },
    },
  };
}

export function finalizeMissedOpportunityAnalysis(options: {
  transcript: string;
  callId: string;
  selectedModel: string;
  raw: MissedOpportunityModelPayload;
  previous?: MissedOpportunity[];
  transferOccurred?: boolean;
  minimumConfidence?: number;
  candidateCount?: number;
}): MissedOpportunityAnalysis {
  const analyzedAt = new Date().toISOString();
  const localDisposition = inferCallDisposition(options.transcript, options.transferOccurred);
  const allowedDispositions = new Set<CallDisposition["value"]>(["booked", "transferred", "callback", "not_booked", "excluded", "uncertain"]);
  const rawDisposition = options.raw.disposition;
  const rawDispositionConfidence = Math.max(0, Math.min(1, Number(rawDisposition?.confidence) || 0));
  const preserveLocalDisposition = localDisposition.value === "booked" || localDisposition.value === "transferred" || localDisposition.value === "callback" || localDisposition.value === "excluded";
  const disposition = !preserveLocalDisposition && rawDisposition?.value && allowedDispositions.has(rawDisposition.value) && rawDispositionConfidence >= .75
    ? { value: rawDisposition.value, confidence: rawDispositionConfidence, reason: String(rawDisposition.reason || "Cloud analysis disposition.").slice(0, 500) }
    : localDisposition;
  const cacheKey = createOpportunityCacheKey(options.transcript, options.selectedModel);
  const excluded = disposition.value === "booked" || disposition.value === "transferred" || disposition.value === "callback" || disposition.value === "excluded" || disposition.value === "uncertain";
  const minimumConfidence = options.minimumConfidence ?? DEFAULT_OPPORTUNITY_CONFIDENCE;
  const previousByFingerprint = new Map((options.previous ?? []).map((finding) => [finding.fingerprint, finding]));
  const findings: MissedOpportunity[] = [];

  if (!excluded) {
    for (const raw of options.raw.findings ?? []) {
      if (!raw.type || !OPPORTUNITY_TYPES.has(raw.type as OpportunityType)) continue;
      if (raw.type === "free_program_objection_not_handled" && isServiceBoundaryCorrection(options.transcript)) continue;
      const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));
      if (confidence < minimumConfidence) continue;
      const trigger = cleanEvidence(raw.customerTrigger, "customer");
      const response = cleanEvidence(raw.agentResponse, "agent");
      if (!includesEvidence(options.transcript, trigger.text) || !includesEvidence(options.transcript, response.text)) continue;
      const evidence = (Array.isArray(raw.evidence) ? raw.evidence : [])
        .map((item) => cleanEvidence(item, "unknown"))
        .filter((item) => includesEvidence(options.transcript, item.text));
      if (evidence.length < 2) continue;
      const fingerprint = `${raw.type}:${hashString(normalized(trigger.text).slice(0, 180))}`;
      const prior = previousByFingerprint.get(fingerprint);
      const severity = raw.severity === "high" || raw.severity === "medium" ? raw.severity : "low";
      const finding: MissedOpportunity = {
        id: prior?.id || `opp-${hashString(`${options.callId}:${fingerprint}`)}`,
        callId: options.callId,
        type: raw.type as OpportunityType,
        title: String(raw.title || raw.type.replaceAll("_", " ")).trim().slice(0, 160),
        summary: String(raw.summary || "The agent did not establish a supported next step.").trim().slice(0, 700),
        severity,
        confidence,
        customerTrigger: { text: trigger.text, startTime: trigger.startTime, endTime: trigger.endTime, turnId: trigger.turnId },
        agentResponse: { text: response.text, startTime: response.startTime, endTime: response.endTime, turnId: response.turnId },
        expectedAction: String(raw.expectedAction || "Make a reasonable recovery attempt and move the call toward a supported next step.").trim().slice(0, 500),
        suggestedResponse: raw.suggestedResponse ? String(raw.suggestedResponse).trim().slice(0, 700) : undefined,
        evidence,
        status: prior?.status || "open",
        reviewerNotes: prior?.reviewerNotes || "",
        analysisVersion: MISSED_OPPORTUNITY_ANALYSIS_VERSION,
        createdAt: prior?.createdAt || analyzedAt,
        fingerprint,
      };
      const duplicateIndex = findings.findIndex((candidate) =>
        candidate.fingerprint === fingerprint
        || normalized(candidate.customerTrigger.text) === normalized(finding.customerTrigger.text),
      );
      if (duplicateIndex === -1) findings.push(finding);
      else if (severityRank(finding.severity) > severityRank(findings[duplicateIndex].severity) || finding.confidence > findings[duplicateIndex].confidence) findings[duplicateIndex] = finding;
    }
  }

  return {
    findings,
    summary: summarizeMissedOpportunities(findings),
    disposition,
    analysisVersion: MISSED_OPPORTUNITY_ANALYSIS_VERSION,
    promptVersion: MISSED_OPPORTUNITY_PROMPT_VERSION,
    selectedModel: options.selectedModel,
    cacheKey,
    analyzedAt,
    candidateCount: options.candidateCount ?? detectCandidateWindows(options.transcript).length,
    identity: options.raw.identity ? {
      agentName: String(options.raw.identity.agentName || "").trim().slice(0, 120),
      customerName: String(options.raw.identity.customerName || "").trim().slice(0, 120),
      customerPhone: String(options.raw.identity.customerPhone || "").trim().slice(0, 60),
    } : undefined,
  };
}

export async function runMissedOpportunityAnalysis(options: {
  transcript: string;
  callId: string;
  selectedModel: string;
  previous?: MissedOpportunity[];
  transferOccurred?: boolean;
  evaluate: (prompt: { system: string; user: string }, windows: CandidateWindow[]) => Promise<MissedOpportunityModelPayload>;
}) {
  const windows = detectCandidateWindows(options.transcript);
  const disposition = inferCallDisposition(options.transcript, options.transferOccurred);
  const shouldEvaluate = disposition.value === "not_booked" && windows.length > 0;
  const raw = shouldEvaluate
    ? await options.evaluate(buildMissedOpportunityPrompt(options.transcript, windows), windows)
    : { findings: [], disposition };
  return finalizeMissedOpportunityAnalysis({ ...options, raw, candidateCount: windows.length });
}
