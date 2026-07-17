export type LearningWorkflow = "qa" | "missed_opportunity" | "handled_objection";
export type LearningScope = "client" | "universal";

export type LearningCorrection = {
  id: string;
  revision: number;
  workflow: LearningWorkflow;
  scope: LearningScope;
  client: string;
  scorecardId: string;
  scorecardName: string;
  criterion: string;
  originalAnswer: string;
  correctedAnswer: string;
  evidence: string;
  rule: string;
  transcriptFingerprint: string;
  model: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  usageCount: number;
  lastUsedAt?: string;
};

export type LearningStoreState = {
  schemaVersion: 1;
  revision: number;
  corrections: LearningCorrection[];
};

export type LearningMatch = {
  correction: LearningCorrection;
  score: number;
  reason: string;
  conflict: boolean;
};

export type LearningAudit = {
  revision: number;
  consideredIds: string[];
  suppliedIds: string[];
  conflicts: string[];
  matchReasons: Record<string, string>;
};

export type LearningContext = {
  workflow: LearningWorkflow;
  client: string;
  scorecardId: string;
  scorecardName: string;
  criteria: string[];
};

const DB_NAME = "compassai-learning";
const STORE_NAME = "state";
const STATE_KEY = "verified-corrections";
const MAX_MATCHES = 3;
const MAX_CONTEXT_CHARACTERS = 2400;

export function emptyLearningState(): LearningStoreState {
  return { schemaVersion: 1, revision: 0, corrections: [] };
}

export function learningHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function tokens(value: string) {
  return new Set(normalized(value).split(" ").filter((token) => token.length > 2));
}

function similarity(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / new Set([...a, ...b]).size;
}

export function sanitizeLearningText(value: string, limit = 700) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email removed]")
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[phone removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function upsertLearningCorrection(
  state: LearningStoreState,
  correction: Omit<LearningCorrection, "revision" | "createdAt" | "updatedAt" | "usageCount"> & Partial<Pick<LearningCorrection, "revision" | "createdAt" | "usageCount">>,
) {
  const now = new Date().toISOString();
  const existing = state.corrections.find((item) => item.id === correction.id);
  const nextRevision = state.revision + 1;
  const next: LearningCorrection = {
    ...correction,
    evidence: sanitizeLearningText(correction.evidence),
    rule: sanitizeLearningText(correction.rule, 500),
    originalAnswer: sanitizeLearningText(correction.originalAnswer, 500),
    correctedAnswer: sanitizeLearningText(correction.correctedAnswer, 500),
    revision: (existing?.revision ?? correction.revision ?? 0) + 1,
    createdAt: existing?.createdAt ?? correction.createdAt ?? now,
    updatedAt: now,
    usageCount: existing?.usageCount ?? correction.usageCount ?? 0,
  };
  return {
    schemaVersion: 1 as const,
    revision: nextRevision,
    corrections: existing
      ? state.corrections.map((item) => item.id === next.id ? next : item)
      : [next, ...state.corrections],
  };
}

export function removeLearningCorrection(state: LearningStoreState, id: string) {
  return { ...state, revision: state.revision + 1, corrections: state.corrections.filter((item) => item.id !== id) };
}

function conflictKey(item: LearningCorrection) {
  return [item.workflow, item.scope, normalized(item.client), item.scorecardId, normalized(item.criterion)].join(":");
}

export function learningConflicts(corrections: LearningCorrection[]) {
  const groups = new Map<string, LearningCorrection[]>();
  for (const correction of corrections.filter((item) => item.enabled)) {
    const key = conflictKey(correction);
    groups.set(key, [...(groups.get(key) ?? []), correction]);
  }
  const conflicts = new Set<string>();
  for (const items of groups.values()) {
    if (new Set(items.map((item) => normalized(item.correctedAnswer))).size > 1) {
      items.forEach((item) => conflicts.add(item.id));
    }
  }
  return conflicts;
}

export function retrieveLearningMatches(state: LearningStoreState, context: LearningContext) {
  const conflicts = learningConflicts(state.corrections);
  const normalizedClient = normalized(context.client);
  const normalizedCriteria = context.criteria.map(normalized);
  const considered: LearningMatch[] = [];

  for (const correction of state.corrections) {
    if (!correction.enabled || correction.workflow !== context.workflow) continue;
    const sameClient = normalized(correction.client) === normalizedClient;
    if (correction.scope !== "universal" && !sameClient) continue;
    const exactScorecard = correction.scorecardId === context.scorecardId;
    const criterion = normalized(correction.criterion);
    const exactCriterion = normalizedCriteria.includes(criterion);
    const related = Math.max(0, ...context.criteria.map((item) => similarity(item, correction.criterion)));
    if (!exactCriterion && related < .34) continue;
    const score = (exactCriterion ? 100 : Math.round(related * 50))
      + (sameClient ? 30 : 0)
      + (exactScorecard ? 20 : 0)
      + (correction.scope === "universal" ? 2 : 0);
    considered.push({
      correction,
      score,
      conflict: conflicts.has(correction.id),
      reason: exactCriterion
        ? `${sameClient ? "Same client, " : ""}${exactScorecard ? "same scorecard, " : ""}exact criterion`
        : `${sameClient ? "Same client, " : ""}similar criterion (${Math.round(related * 100)}%)`,
    });
  }

  return considered.sort((left, right) => right.score - left.score || right.correction.updatedAt.localeCompare(left.correction.updatedAt));
}

export function buildLearningContext(state: LearningStoreState, context: LearningContext) {
  const considered = retrieveLearningMatches(state, context);
  const selected: LearningMatch[] = [];
  let characters = 0;
  for (const match of considered) {
    if (match.conflict || selected.length >= MAX_MATCHES) continue;
    const compact = compactLearningMatch(match);
    if (characters + compact.length > MAX_CONTEXT_CHARACTERS) continue;
    characters += compact.length;
    selected.push(match);
  }
  const audit: LearningAudit = {
    revision: state.revision,
    consideredIds: considered.map((item) => item.correction.id),
    suppliedIds: selected.map((item) => item.correction.id),
    conflicts: considered.filter((item) => item.conflict).map((item) => item.correction.id),
    matchReasons: Object.fromEntries(considered.map((item) => [item.correction.id, item.reason])),
  };
  return { matches: selected, audit, prompt: selected.map(compactLearningMatch) };
}

function compactLearningMatch(match: LearningMatch) {
  const item = match.correction;
  return JSON.stringify({
    id: item.id,
    criterion: item.criterion,
    corrected_answer: item.correctedAnswer,
    verified_evidence: item.evidence,
    reviewer_rule: item.rule,
    scope: item.scope,
  });
}

export function learningSignature(audit: LearningAudit) {
  return learningHash(JSON.stringify({ revision: audit.revision, supplied: audit.suppliedIds, conflicts: audit.conflicts }));
}

export function markLearningUsed(state: LearningStoreState, ids: string[]) {
  if (!ids.length) return state;
  const used = new Set(ids);
  const now = new Date().toISOString();
  return {
    ...state,
    corrections: state.corrections.map((item) => used.has(item.id)
      ? { ...item, usageCount: item.usageCount + 1, lastUsedAt: now }
      : item),
  };
}

function openLearningDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadLearningState() {
  if (typeof indexedDB === "undefined") return emptyLearningState();
  const db = await openLearningDb();
  return new Promise<LearningStoreState>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => resolve(normalizeLearningImport(request.result));
    request.onerror = () => reject(request.error);
  }).finally(() => db.close());
}

export async function saveLearningState(state: LearningStoreState) {
  const db = await openLearningDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(state, STATE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

export function normalizeLearningImport(value: unknown): LearningStoreState {
  const input = value && typeof value === "object" ? value as Partial<LearningStoreState> : {};
  const corrections = Array.isArray(input.corrections) ? input.corrections.filter((item): item is LearningCorrection => Boolean(item?.id && item?.workflow && item?.criterion)) : [];
  return { schemaVersion: 1, revision: Math.max(0, Number(input.revision) || 0), corrections };
}
