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
  return {
    ...rule,
    positive_patterns: (rule.positive_patterns ?? []).filter((pattern) => !isSameDayInstruction(pattern)),
    negative_patterns: (rule.negative_patterns ?? []).filter((pattern) => !isSameDayInstruction(pattern)),
    pass_description: cleanDescription(rule.pass_description) as string | undefined,
    fail_description: cleanDescription(rule.fail_description) as string | undefined,
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
    const universalRules = cleanRules(bundle.universal_rules);
    const universalNames = new Set(universalRules.map((rule) => criterionKey(rule.name)));
    const clientRuleSets = Object.fromEntries(Object.entries(bundle.client_rule_sets ?? {}).map(([key, set]) => [
      key,
      { ...set, rules: cleanRules(set.rules, universalNames) },
    ]));
    const criticalSeen = new Set<string>();
    const criticalChecks = (bundle.critical_checks ?? []).flatMap((check) => {
      const name = typeof check === "string" ? check : check.name;
      const key = criterionKey(name);
      if (!key || REMOVED_CRITERIA.has(key) || criticalSeen.has(key)) return [];
      criticalSeen.add(key);
      return [typeof check === "string" ? check : cleanRule(check)];
    });
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

export function resolveQaStatus(requestedStatus: string, critical: boolean, evidenceVerified: boolean) {
  const normalized = requestedStatus.trim().toLowerCase();
  const status = normalized === "pass" ? "Pass"
    : normalized === "fail" ? "Fail"
      : normalized === "not applicable" || normalized === "n/a" || normalized === "na" ? "Not applicable"
        : "Needs review";
  if (critical && status === "Not applicable") return "Needs review";
  if (status === "Pass" && !evidenceVerified) return "Needs review";
  return status;
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
