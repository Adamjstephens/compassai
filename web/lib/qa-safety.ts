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
  pass_description: "PASS only when the agent states that the appointment will take 60-90 minutes and the customer acknowledges or accepts that duration. Not applicable is never allowed for this critical criterion.",
  fail_description: "FAIL when a conflicting duration is given or the customer refuses the required appointment length. If the 60-90 minute duration is missing or ambiguous, mark Needs review rather than Pass.",
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
  pass_description: "PASS only when the transcript explicitly confirms the customer's phone or callback number. Valid evidence includes a phone number stated in response to a phone-number question, the customer affirming that a stated number is correct or best, or the customer providing a number where they can be reached. An address, email address, ZIP code, credit score, appointment time, or unrelated number is never phone-confirmation evidence.",
  fail_description: "FAIL when no phone or callback number is confirmed anywhere in the complete call, or when the customer says the number is wrong, different, or should not be called. Do not use unrelated numeric evidence. Not applicable is not allowed.",
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
  pass_description: "ANY NUMBER OF WINDOWS OR DOORS THAT IS 3 OR GREATER IS A PASS. Count windows and doors together when the customer gives a combined project, so two windows plus one door is three and passes. Accept numeric or spoken counts. Whole-house, all-window, several-window, several-door, or multiple-unit projects also pass.",
  fail_description: "FAIL when the total project is fewer than 3 windows and doors. One or two total units do not pass. If no reliable project count can be established, mark Needs review rather than inventing a count.",
  mishear_description: "tree windows -> three windows; too windows -> two windows",
};

function criterionKey(value = "") {
  return value.toLowerCase().replace(/^critical\s*:\s*/i, "").replace(/[^a-z0-9]+/g, " ").trim();
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
  return cleaned;
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
