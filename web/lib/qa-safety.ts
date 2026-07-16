type RuleLike = {
  name?: string;
  positive_patterns?: string[];
  negative_patterns?: string[];
  pass_description?: string;
  fail_description?: string;
  [key: string]: unknown;
};

type BundleLike = {
  universal_rules?: RuleLike[];
  client_rule_sets?: Record<string, { rules?: RuleLike[]; [key: string]: unknown }>;
  critical_checks?: Array<string | RuleLike>;
  [key: string]: unknown;
};

type LibraryLike = {
  scorecards?: Array<{ bundle?: BundleLike; [key: string]: unknown }>;
  [key: string]: unknown;
};

export const NO_VERIFIED_EVIDENCE = "No verified transcript evidence found.";

export function verifiedEvidenceOrFallback(verifiedEvidence = "", fallbackEvidence = "") {
  return verifiedEvidence.trim() || fallbackEvidence.trim() || NO_VERIFIED_EVIDENCE;
}

const REMOVED_CRITERIA = new Set(["no same day", "booked correct calendar", "new qualifier"]);

export const APPOINTMENT_LENGTH_RULE: RuleLike = {
  name: "Appointment Length",
  positive_patterns: [
    "\\b(?:60|90)\\s*(?:to|-|and)?\\s*(?:60|90)?\\s*(?:minutes|minute|mins|min)\\b",
    "\\b(?:an?\\s+hour|hour\\s+and\\s+a\\s+half|sixty|ninety)\\s*(?:minutes?)?\\b",
  ],
  negative_patterns: [
    "\\b(?:cannot|can't|can\\s+not)\\s+(?:do|stay|be\\s+there\\s+for).{0,30}(?:60|90)\\s*(?:minutes|minute|mins|min)\\b",
    "\\b(?:only|just)\\s+(?:have|got).{0,20}\\b(?:10|15|20|30|45)\\s*(?:minutes|minute|mins|min)\\b",
    "\\b(?:60|90)\\s*(?:minutes|minute|mins|min).{0,30}\\b(?:too\\s+long|won't\\s+work|doesn't\\s+work)\\b",
  ],
  pass_description: "Customer accepts a 60-90 minute appointment.",
  fail_description: "The 60-90 minute length is missing, rejected, or contradicted.",
};

const PHONE_VALUE_PATTERN = String.raw`(?:(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)(?:[\s-]+(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)){9})`;

export const PHONE_CONFIRMATION_RULE: RuleLike = {
  name: "Phone Number Confirmed",
  positive_patterns: [
    String.raw`\b(?:is|at|on)\s+${PHONE_VALUE_PATTERN}.{0,80}\b(?:correct|right|best|good|still\s+your)\b.{0,100}\b(?:yes|yeah|yep|correct|right|that\s+is|it\s+is)\b`,
    String.raw`\b(?:phone|cell|contact|callback|best)\s*(?:phone\s*)?number\b.{0,160}(?:${PHONE_VALUE_PATTERN}|\b(?:correct|right|good|best|confirmed)\b.{0,80}\b(?:yes|yeah|yep|correct|right)\b)`,
    String.raw`\b(?:call|reach|contact)\s+me\s+(?:at|on).{0,50}${PHONE_VALUE_PATTERN}\b`,
    String.raw`\bmy\s+(?:phone|cell|contact)?\s*number\s+is.{0,40}${PHONE_VALUE_PATTERN}\b`,
  ],
  negative_patterns: [
    "\\b(?:wrong|bad|different|incorrect)\\s+(?:phone\\s+)?number\\b",
    "\\b(?:not|isn't|is\\s+not)\\s+my\\s+(?:phone\\s+)?number\\b",
    "\\bdo\\s+not\\s+call\\s+(?:this|that)\\s+number\\b",
  ],
  pass_description: "Customer confirms or provides a phone or callback number.",
  fail_description: "No phone or callback number is confirmed, or the customer says it is wrong.",
};

export const PELLA_PROJECT_SIZE_RULE: RuleLike = {
  name: "Project Size",
  positive_patterns: [
    String.raw`\b(?:[3-9]|[1-9]\d+)\s*(?:windows?|doors?)\b`,
    String.raw`\b(?:three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|dozen|several|multiple)\s+(?:windows?|doors?)\b`,
    String.raw`\b(?:windows?|doors?)\s*[:=-]?\s*(?:[3-9]|[1-9]\d+)\b`,
    String.raw`\b(?:whole\s+house|all\s+(?:the\s+)?(?:windows?|doors?))\b`,
  ],
  negative_patterns: [
    String.raw`\b(?:1|2|one|two)\s*(?:windows?|doors?)\b`,
    String.raw`\b(?:just|only)\s+(?:1|2|one|two)\s*(?:windows?|doors?)\b`,
  ],
  pass_description: "Any window count of 3 or greater is a Pass.",
  fail_description: "Any window count less than 3 is a Fail.",
  mishear_description: "tree windows -> three windows; too windows -> two windows",
};

const ROOF_AGE_15_OR_DAMAGE_RULE: RuleLike = {
  positive_patterns: [
    String.raw`\b(?:1[5-9]|[2-9]\d|\d{3,})\s*(?:years?|yrs?)(?:\s*old)?\b`,
    String.raw`\b(?:visible\s+damage|roof\s+damage|leak(?:ing|s)?|missing\s+shingles|blown[-\s]+off\s+shingles|storm\s+damage)\b`,
  ],
  negative_patterns: [
    String.raw`\b(?:[0-9]|1[0-4])\s*(?:years?|yrs?)(?:\s*old)?\b`,
    String.raw`\b(?:brand[-\s]+new\s+roof|no\s+(?:roof\s+)?damage|just\s+looking)\b`,
  ],
  pass_description: "Roof is at least 15 years old or has qualifying damage, leaks, missing shingles, or storm damage.",
  fail_description: "Roof is under 15 years old with no qualifying damage, or the customer is only researching.",
};

const ROOF_AGE_10_OR_WEAR_RULE: RuleLike = {
  positive_patterns: [
    String.raw`\b(?:1\d|[2-9]\d|\d{3,})\s*(?:years?|yrs?)(?:\s*old)?\b`,
    String.raw`\b(?:visible\s+(?:wear|damage)|showing\s+wear|leak(?:ing|s)?|missing\s+shingles|staining|storm\s+damage)\b`,
  ],
  negative_patterns: [
    String.raw`\b[0-9]\s*(?:years?|yrs?)(?:\s*old)?\b`,
    String.raw`\b(?:new\s+roof|no\s+(?:wear|damage))\b`,
  ],
  pass_description: "Roof is at least 10 years old or has qualifying wear, damage, leaks, missing shingles, staining, or storm damage.",
  fail_description: "Roof is under 10 years old with no qualifying wear or damage.",
};

export const JPC_REPAIR_ROOF_AGE_RULE: RuleLike = {
  name: "Repair Roof Age",
  positive_patterns: [
    String.raw`\b(?:2[1-9]|[3-9]\d|\d{3,})\s*(?:years?|yrs?)(?:\s*old)?\b`,
    String.raw`\b(?:over|more\s+than|older\s+than)\s+20\s*(?:years?|yrs?)\b`,
  ],
  negative_patterns: [
    String.raw`\b(?:[0-9]|1\d|20)\s*(?:years?|yrs?)(?:\s*old)?\b`,
    String.raw`\b(?:20\s*(?:years?|yrs?)\s+or\s+(?:less|younger)|new(?:er)?\s+roof)\b`,
  ],
  pass_description: "Any roof older than 20 years is a Pass.",
  fail_description: "Any roof 20 years old or newer is a Fail.",
};

const COMMON_LLM_INSTRUCTIONS: Record<string, { pass: string; fail: string }> = {
  "home type confirmed": {
    pass: "Customer confirms the type of home.",
    fail: "The home type is not confirmed.",
  },
  "homeowner confirmed": {
    pass: "Customer confirms they own the property.",
    fail: "Customer rents, is not the owner, or ownership is not confirmed.",
  },
  "recorded line confirmed": {
    pass: "Agent states that the call or line is recorded.",
    fail: "The recorded-line disclosure is not stated.",
  },
  "confirmed address": {
    pass: "Customer confirms the service address.",
    fail: "The address is not confirmed or the customer says it is wrong.",
  },
  "address confirmed": {
    pass: "Customer confirms the service address.",
    fail: "The address is not confirmed or the customer says it is wrong.",
  },
  "confirmed email": {
    pass: "Customer confirms or provides an email address.",
    fail: "No email is confirmed or the customer says it is wrong.",
  },
  "email confirmed": {
    pass: "Customer confirms or provides an email address.",
    fail: "No email is confirmed or the customer says it is wrong.",
  },
  "decision makers": {
    pass: "All required decision makers will attend.",
    fail: "A required decision maker will not attend or attendance is not confirmed.",
  },
  "all decision makers present": {
    pass: "All required decision makers will attend.",
    fail: "A required decision maker will not attend or attendance is not confirmed.",
  },
};

type LlmRuleInstructions = { pass: string; fail: string };

const SCORECARD_LLM_RULES: Record<string, Record<string, LlmRuleInstructions>> = {
  "rba qwd": {
    "home type approved": {
      pass: "Pass when the property is a single-family home, townhouse, or condominium on the third floor or lower. A mobile or manufactured home passes only when it has both a permanent solid foundation and 2x4 framing.",
      fail: "Fail when the property is a shed, trailer, RV, condominium above the third floor, or a mobile or manufactured home without both a permanent solid foundation and 2x4 framing.",
    },
    "government grant disclosure": {
      pass: "Pass only when the agent states that Renewal by Andersen does not participate in government or free-window assistance programs, states that all costs are paid by the homeowner, and the customer acknowledges the disclosure.",
      fail: "Fail when government assistance or free windows are discussed and any required part of the disclosure or customer acknowledgment is missing or contradicted.",
    },
    "no unapproved projects": {
      pass: "Pass when the project is a full replacement-window or approved replacement-door project in an existing opening and no excluded project type is requested.",
      fail: "Fail when the project is glass repair, door repair, screen-door-only, egress-window-only, storm-window-only without full replacement, or work on a shed, trailer, or RV.",
    },
  },
  pella: {
    "approved home type": {
      pass: "Pass when the property is a single-family home, detached house, multifamily home, duplex, or a townhome or condominium on the third floor or lower.",
      fail: "Fail when the property is a mobile or manufactured home, trailer, or a townhome or condominium above the third floor.",
    },
    "credit score": {
      pass: "Pass when the customer states a credit score of 650 or higher.",
      fail: "Fail when the customer states a credit score below 650.",
    },
    "no unapproved projects": {
      pass: "Pass when the project is replacement windows or doors installed in existing same-size openings.",
      fail: "Fail when the project is for a shed, storm-window-only, screen-only, security-door-only, new construction, opening resize or conversion, demolition, or installation of customer-supplied products.",
    },
  },
  kqr: {
    "approved roofing type": {
      pass: "Pass when the roof is asphalt or shingle, or the customer is willing to use asphalt shingles, and the project is not a flat or commercial roof.",
      fail: "Fail when the project is a flat or commercial roof or the customer requires metal, slate, or tile only.",
    },
    "approved service": {
      pass: "Pass when the project is a full roof replacement, a King Quality Roofing repair, or an approved window, siding, gutter, or entry-door replacement.",
      fail: "Fail when the project is a repair by another contractor, a flat or commercial roof, soffit-only, fascia-only, or sliding-door-only work.",
    },
    "no unapproved projects": {
      pass: "Pass when the work is on the main home. A skylight passes only when it is included with a full roof replacement.",
      fail: "Fail when the work is for a shed, greenhouse, detached outbuilding, or a skylight without a full roof replacement.",
    },
    "insurance adjuster": {
      pass: "Pass when the insurance adjuster has already inspected the property or the claim has already been approved.",
      fail: "Fail when the adjuster has not inspected the property or the customer is still waiting for the adjuster.",
    },
    "approved time slot": {
      pass: "Pass when the appointment is scheduled for 10:00 AM, 2:00 PM, or 6:00 PM.",
      fail: "Fail when the appointment is scheduled for any other time.",
    },
  },
  forte: {
    "approved roofing type": {
      pass: "Pass when the roof is asphalt or shingle, the customer is willing to convert to asphalt, or the project is a residential flat roof.",
      fail: "Fail when the customer requires metal, slate, tile, rubber, fiberglass, or 3-tab shingles only.",
    },
    "approved service": {
      pass: "Pass when the project is roof replacement, residential flat-roof replacement, commercial asphalt roofing, or approved window, siding, or gutter replacement.",
      fail: "Fail when the project is a non-Forte repair, commercial flat roof, or repair of windows or siding not installed by Forte.",
    },
    "no unapproved projects": {
      pass: "Pass when the work is on the main home. A skylight passes only when it is included with a full roof replacement.",
      fail: "Fail when the work is for a shed, greenhouse, detached outbuilding, or a skylight without a full roof replacement.",
    },
    "insurance adjuster": {
      pass: "Pass when the insurance adjuster has already inspected the property or the claim has already been approved.",
      fail: "Fail when the adjuster has not inspected the property or the customer is still waiting for the adjuster.",
    },
    "approved time slot": {
      pass: "Pass when the appointment is scheduled for 10:00 AM, 2:00 PM, or 6:00 PM.",
      fail: "Fail when the appointment is scheduled for any other time.",
    },
  },
  jpc: {
    "no metal roofing": {
      pass: "Pass when the project uses asphalt shingles or the customer is willing to use asphalt shingles.",
      fail: "Fail when the customer requires metal or standing-seam roofing only.",
    },
    "approved service": {
      pass: "Pass when the project is an asphalt or shingle roof replacement or repair for a roof issue, leak, missing shingles, or roof damage.",
      fail: "Fail when the project requires metal roofing only.",
    },
    "no unapproved projects": {
      pass: "Pass when the work is on the main home. A skylight passes only when it is included with a full roof replacement.",
      fail: "Fail when the work is for a shed, greenhouse, detached structure, outbuilding, or a skylight without a full roof replacement.",
    },
  },
  bachmans: {
    "approved roofing type": {
      pass: "Pass when the project uses asphalt shingles, EPDM, or modified bitumen, or the customer is willing to use one of those approved roofing types.",
      fail: "Fail when the customer requires metal, slate, or tile only or refuses all approved roofing types.",
    },
    "approved service": {
      pass: "Pass when the project is roof replacement or repair, leak investigation, missing-shingle repair, skylight repair or replacement, or chimney flashing.",
      fail: "Fail when the project is entry-door-only, glass-only repair, block windows, gutter-guard-only, Gutter Helmet, or half-round-gutter-only work.",
    },
    "no unapproved projects": {
      pass: "Pass when the work is on the main home. A skylight passes only when it is included with a full roof replacement.",
      fail: "Fail when the work is for a shed, greenhouse, detached garage, outbuilding, or a skylight without a full roof replacement.",
    },
    "insurance adjuster": {
      pass: "Pass when the insurance adjuster has already inspected the property or the claim has already been approved.",
      fail: "Fail when the adjuster has not inspected the property or the customer is still waiting for the adjuster.",
    },
    "approved time slot": {
      pass: "Pass when the appointment is scheduled for 9:00 AM, 1:00 PM, or 5:00 PM.",
      fail: "Fail when the appointment is scheduled for any other time.",
    },
  },
  hrs: {
    "approved roofing type": {
      pass: "Pass when the project is for a residential asphalt, shingle, or metal roof.",
      fail: "Fail when the project is for a commercial flat roof or requires slate or tile only.",
    },
    "storm claim adjuster": {
      pass: "Pass when the insurance adjuster has already inspected or reviewed the storm claim.",
      fail: "Fail when the adjuster has not inspected the property or the customer is still waiting for the adjuster.",
    },
    "approved service": {
      pass: "Pass when the project is residential roof replacement, roof inspection, leak evaluation, storm or insurance-claim work, or metal-roof replacement.",
      fail: "Fail when the project is a commercial roof or work on a shed or greenhouse roof.",
    },
    "no unapproved projects": {
      pass: "Pass when the work is on the main home. A skylight passes only when it is included with a full roof replacement.",
      fail: "Fail when the work is for a shed, greenhouse, outbuilding, or a skylight without a full roof replacement.",
    },
    "approved time slot": {
      pass: "Pass when the appointment is scheduled for 9:00 AM, 1:00 PM, or 5:00 PM.",
      fail: "Fail when the appointment is scheduled for any other time.",
    },
  },
  feldco: {
    "exterior material": {
      pass: "Pass when the customer explicitly confirms the home's exterior material.",
      fail: "Fail when the exterior material is not confirmed.",
    },
    "garage type": {
      pass: "Pass when the customer explicitly confirms an attached garage, detached garage, or no garage.",
      fail: "Fail when the garage type is not confirmed.",
    },
    "window count": {
      pass: "Pass when the customer explicitly confirms the number of windows being replaced. There is no minimum window count.",
      fail: "Fail when the number of replacement windows is not confirmed.",
    },
    "vinyl disclaimer": {
      pass: "Pass when the agent states the required disclosure that Feldco replacement windows are vinyl.",
      fail: "Fail when the vinyl disclosure is omitted or the customer requires aluminum, wood, or storm windows only.",
    },
    "approved service": {
      pass: "Pass when the project is for replacement windows or approved replacement doors and the customer owns an eligible home.",
      fail: "Fail when the project is roofing, siding, storm-window-only, storm-door-only, repair-only, glass-only, a single-wide mobile home, or the customer is a renter or non-owner.",
    },
    "approved time slot": {
      pass: "Pass when the appointment uses an approved slot at 9:30 AM, 10:30 AM, 12:30 PM, 1:30 PM, 3:30 PM, 4:30 PM, or 6:30 PM and all day-specific scheduling restrictions are satisfied.",
      fail: "Fail when the appointment is on Sunday, violates Friday-to-Saturday or Saturday-after-5:00-PM restrictions, or uses a time outside the approved slots.",
    },
  },
};

const MISSING_LLM_INSTRUCTIONS: Record<string, { pass?: string; fail?: string }> = {
  "exterior material": {
    fail: "The exterior material is not confirmed.",
  },
  "garage type": {
    fail: "The garage type is not confirmed.",
  },
  "window count": {
    fail: "The window count is not confirmed.",
  },
  "approved service": {
    pass: "Project is for replacement windows or approved replacement doors.",
  },
};

function criterionKey(value = "") {
  return value.toLowerCase().replace(/^critical\s*:\s*/i, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function scorecardRuleKey(value = "") {
  const key = criterionKey(value);
  if (key.includes("rba") || key.includes("qwd")) return "rba qwd";
  if (key.includes("pella")) return "pella";
  if (key.includes("kqr") || key.includes("king quality")) return "kqr";
  if (key.includes("forte")) return "forte";
  if (key.includes("jpc") || key.includes("jp carroll")) return "jpc";
  if (key.includes("bachman")) return "bachmans";
  if (key === "hrs" || key.includes("home roofing solutions")) return "hrs";
  if (key.includes("feldco")) return "feldco";
  return key;
}

function applyScorecardLlmRule(rule: RuleLike, scorecardName: string): RuleLike {
  const instructions = SCORECARD_LLM_RULES[scorecardRuleKey(scorecardName)]?.[criterionKey(rule.name)];
  return instructions
    ? { ...rule, pass_description: instructions.pass, fail_description: instructions.fail }
    : rule;
}

function isSameDayInstruction(value = "") {
  const readable = value.replace(/\\s[+*?]?/g, " ").replace(/\\b/g, "");
  return /\b(?:no\s+same\s+day|same\s+day|today\s+only|same-day)\b/i.test(readable);
}

function cleanDescription(value: unknown) {
  if (typeof value !== "string") return value;
  return value.split(/[;\n]+/).map((item) => item.trim()).filter((item) => item && !isSameDayInstruction(item)).join("; ");
}

function cleanRule(rule: RuleLike): RuleLike {
  const cleaned = {
    ...rule,
    positive_patterns: (rule.positive_patterns ?? []).filter((pattern) => !isSameDayInstruction(pattern)),
    negative_patterns: (rule.negative_patterns ?? []).filter((pattern) => !isSameDayInstruction(pattern)),
    pass_description: cleanDescription(rule.pass_description) as string | undefined,
    fail_description: cleanDescription(rule.fail_description) as string | undefined,
  };
  const key = criterionKey(rule.name);
  if (key === "appointment length") return { ...cleaned, ...APPOINTMENT_LENGTH_RULE, name: rule.name || APPOINTMENT_LENGTH_RULE.name };
  if ((key.includes("phone") || key.includes("number")) && key.includes("confirm")) {
    return { ...cleaned, ...PHONE_CONFIRMATION_RULE, name: rule.name || PHONE_CONFIRMATION_RULE.name };
  }
  const common = COMMON_LLM_INSTRUCTIONS[key];
  if (common) return { ...cleaned, pass_description: common.pass, fail_description: common.fail };
  const missing = MISSING_LLM_INSTRUCTIONS[key];
  if (missing) {
    return {
      ...cleaned,
      pass_description: cleaned.pass_description || missing.pass,
      fail_description: cleaned.fail_description || missing.fail,
    };
  }
  return cleaned;
}

function conciseInstruction(value: unknown, fallback: string) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text || fallback;
}

export function compactLlmRubric(scorecardName: string, client: string, rules: RuleLike[]) {
  return {
    scorecard: scorecardName,
    client,
    criteria: rules
      .filter((rule) => criterionKey(rule.name) !== "client identified")
      .map((original) => {
        const rule = cleanRule(original);
        const name = String(rule.name || "Unnamed criterion").replace(/^Critical:\s*/i, "");
        return {
          name,
          critical: String(rule.type || "").toLowerCase() === "critical" || /^Critical:/i.test(String(rule.name || "")),
          pass: conciseInstruction(rule.pass_description, `${name} is clearly satisfied.`),
          fail: conciseInstruction(rule.fail_description, `${name} is not satisfied.`),
        };
      }),
  };
}

function cleanRules(rules: RuleLike[] = [], inherited = new Set<string>()) {
  const seen = new Set(inherited);
  return rules.flatMap((rule) => {
    const key = criterionKey(rule.name);
    if (!key || REMOVED_CRITERIA.has(key) || seen.has(key)) return [];
    seen.add(key);
    return [cleanRule(rule)];
  });
}

export function sanitizeScorecardLibrary<T extends LibraryLike>(library: T): T {
  const scorecards = (library.scorecards ?? []).map((entry) => {
    const bundle = entry.bundle ?? {};
    let universalRules = cleanRules(bundle.universal_rules);
    const universalNames = new Set(universalRules.map((rule) => criterionKey(rule.name)));
    let clientRuleSets = Object.fromEntries(Object.entries(bundle.client_rule_sets ?? {}).map(([key, set]) => [
      key,
      { ...set, rules: cleanRules(set.rules, universalNames) },
    ]));
    const scorecardName = String(entry.name || bundle.name || "").toLowerCase();
    if (scorecardName.includes("pella")) {
      const polishProjectSize = (rule: RuleLike) => criterionKey(rule.name) === "project size"
        ? { ...rule, ...PELLA_PROJECT_SIZE_RULE, name: rule.name || PELLA_PROJECT_SIZE_RULE.name }
        : rule;
      universalRules = universalRules.map(polishProjectSize);
      clientRuleSets = Object.fromEntries(Object.entries(clientRuleSets).map(([key, set]) => [
        key,
        { ...set, rules: (set.rules ?? []).map(polishProjectSize) },
      ]));
    }
    const polishRoofAge = (rule: RuleLike) => {
      const key = criterionKey(rule.name);
      if (scorecardName.includes("jpc") && key === "repair roof age") {
        return { ...rule, ...JPC_REPAIR_ROOF_AGE_RULE, name: rule.name || JPC_REPAIR_ROOF_AGE_RULE.name };
      }
      if (["kqr", "forte", "bachmans"].some((name) => scorecardName.includes(name)) && key === "roof age or damage") {
        return { ...rule, ...ROOF_AGE_15_OR_DAMAGE_RULE, name: rule.name };
      }
      if (scorecardName === "hrs" && key === "roof age or wear") {
        return { ...rule, ...ROOF_AGE_10_OR_WEAR_RULE, name: rule.name };
      }
      return rule;
    };
    universalRules = universalRules.map(polishRoofAge);
    clientRuleSets = Object.fromEntries(Object.entries(clientRuleSets).map(([key, set]) => [
      key,
      { ...set, rules: (set.rules ?? []).map(polishRoofAge) },
    ]));
    universalRules = universalRules.map((rule) => applyScorecardLlmRule(rule, scorecardName));
    clientRuleSets = Object.fromEntries(Object.entries(clientRuleSets).map(([key, set]) => [
      key,
      { ...set, rules: (set.rules ?? []).map((rule) => applyScorecardLlmRule(rule, scorecardName)) },
    ]));
    if (Object.keys(clientRuleSets).length) {
      clientRuleSets = Object.fromEntries(Object.entries(clientRuleSets).map(([key, set]) => {
        const rules = [...(set.rules ?? [])];
        const names = new Set([...universalRules, ...rules].map((rule) => criterionKey(rule.name)));
        if (!names.has("appointment length")) rules.push({ ...APPOINTMENT_LENGTH_RULE });
        if (![...names].some((name) => (name.includes("phone") || name.includes("number")) && name.includes("confirm"))) {
          rules.push({ ...PHONE_CONFIRMATION_RULE });
        }
        return [key, { ...set, rules }];
      }));
    } else {
      const names = new Set(universalRules.map((rule) => criterionKey(rule.name)));
      if (!names.has("appointment length")) universalRules = [...universalRules, { ...APPOINTMENT_LENGTH_RULE }];
      if (![...names].some((name) => (name.includes("phone") || name.includes("number")) && name.includes("confirm"))) {
        universalRules = [...universalRules, { ...PHONE_CONFIRMATION_RULE }];
      }
    }
    const criticalSeen = new Set<string>();
    const criticalChecks = (bundle.critical_checks ?? []).flatMap((check) => {
      const name = typeof check === "string" ? check : check.name;
      const key = criterionKey(name);
      if (!key || REMOVED_CRITERIA.has(key) || criticalSeen.has(key)) return [];
      criticalSeen.add(key);
      return [typeof check === "string" ? check : cleanRule(check)];
    });
    if (!criticalSeen.has("appointment length")) criticalChecks.push("Appointment Length");
    return { ...entry, bundle: { ...bundle, universal_rules: universalRules, client_rule_sets: clientRuleSets, critical_checks: criticalChecks } };
  });
  return { ...library, scorecards } as T;
}

export function timestampSeconds(value = "") {
  const parts = value.trim().split(":").map(Number);
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.slice(1).some((part) => part >= 60)) return null;
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0] * 3600 + parts[1] * 60 + parts[2];
}

export function validTimestampForDuration(value = "", duration = 0) {
  const seconds = timestampSeconds(value);
  return seconds !== null && duration > 0 && seconds <= Math.ceil(duration) + 2;
}

export function resolveQaStatus(requestedStatus: string, critical: boolean, evidenceVerified: boolean, fallbackStatus = "") {
  const normalized = requestedStatus.trim().toLowerCase();
  let status = normalized === "pass" ? "Pass"
    : normalized === "fail" ? "Fail"
      : normalized === "not applicable" || normalized === "n/a" || normalized === "na" ? "Not applicable"
        : "Needs review";
  const fallback = fallbackStatus.trim().toLowerCase();
  if (status === "Needs review" && evidenceVerified && (fallback === "pass" || fallback === "fail")) {
    status = fallback === "pass" ? "Pass" : "Fail";
  }
  if (critical && status === "Not applicable") return "Needs review";
  if (status === "Pass" && !evidenceVerified) return "Needs review";
  return status;
}

export function resolveModelQaStatus(
  ruleMatch: string,
  requestedStatus: string,
  critical: boolean,
  evidenceVerified: boolean,
  fallbackStatus = "",
) {
  const match = ruleMatch.trim().toLowerCase();
  if (match === "pass") return resolveQaStatus("Pass", critical, evidenceVerified);
  if (match === "fail") return resolveQaStatus("Fail", critical, evidenceVerified);
  if (match === "none" || match === "ambiguous") {
    return resolveQaStatus("Needs review", critical, evidenceVerified);
  }
  return resolveQaStatus(requestedStatus, critical, evidenceVerified, fallbackStatus);
}

function qaRowKey(row: Record<string, unknown>) {
  const value = row.check ?? row.qualifier ?? row.Qualifier ?? row.criterion ?? row.name ?? "";
  return String(value).toLowerCase().replace(/^critical\s*:\s*/i, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function pairModelRows<T extends Record<string, unknown>>(rows: T[], checks: string[]) {
  const used = new Set<number>();
  return checks.map((check, checkIndex) => {
    const key = qaRowKey({ check });
    let index = rows.findIndex((row, candidateIndex) => !used.has(candidateIndex) && qaRowKey(row) === key);
    if (index < 0) {
      const candidates = rows.flatMap((row, candidateIndex) => {
        if (used.has(candidateIndex)) return [];
        const candidate = qaRowKey(row);
        return candidate.length >= 5 && (candidate.includes(key) || key.includes(candidate)) ? [candidateIndex] : [];
      });
      if (candidates.length === 1) index = candidates[0];
    }
    if (index < 0) return undefined;
    used.add(index);
    return rows[index];
  });
}

export function isPhoneConfirmationCriterion(value = "") {
  const key = criterionKey(value);
  return (key.includes("phone") || key.includes("number")) && key.includes("confirm");
}

export function phoneConfirmationExcerpt(transcript: string) {
  const text = transcript.replace(/\s+/g, " ").trim();
  const candidates: Array<{ evidence: string; confirmed: boolean; index: number }> = [];
  for (const [confirmed, patterns] of [
    [false, PHONE_CONFIRMATION_RULE.negative_patterns ?? []],
    [true, PHONE_CONFIRMATION_RULE.positive_patterns ?? []],
  ] as const) {
    for (const pattern of patterns) {
      const expression = new RegExp(pattern, "gi");
      let match = expression.exec(text);
      while (match?.[0]) {
        candidates.push({ evidence: match[0].trim(), confirmed, index: match.index });
        match = expression.exec(text);
      }
    }
  }
  return candidates.sort((left, right) => right.index - left.index)[0] ?? { evidence: "", confirmed: false };
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function transcriptEvidenceExcerpt(transcript: string, proposed: string) {
  const clean = proposed.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (transcript.toLowerCase().includes(clean.toLowerCase())) return clean;

  const candidates = [
    ...Array.from(clean.matchAll(/["“”]([^"“”]{5,240})["“”]/g), (match) => match[1]),
    ...clean.split(/(?:\s+[—-]\s+|:\s+|[.!?]\s+)/),
  ].map((item) => item.trim()).filter((item) => item.length >= 5).sort((left, right) => right.length - left.length);
  for (const candidate of candidates) {
    if (transcript.toLowerCase().includes(candidate.toLowerCase())) return candidate;
  }

  const words = clean.match(/[a-z0-9']+/gi) ?? [];
  for (let size = Math.min(18, words.length); size >= 5; size -= 1) {
    for (let start = 0; start + size <= words.length; start += 1) {
      const expression = new RegExp(words.slice(start, start + size).map(escaped).join("[^a-z0-9']+"), "i");
      const match = expression.exec(transcript);
      if (match?.[0]) return match[0];
    }
  }
  return "";
}
