"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Download,
  ExternalLink,
  FileAudio,
  FileOutput,
  Gauge,
  Library,
  Menu,
  Moon,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  TriangleAlert,
  Trash2,
  ArrowRightLeft,
  Upload,
  Users,
  X,
} from "lucide-react";

type AppView = "jobs" | "review" | "scorecards" | "mirrorcxt" | "settings";

type ScorecardRule = {
  name: string;
  type?: string | null;
  positive_patterns?: string[];
  negative_patterns?: string[];
  pass_description?: string;
  fail_description?: string;
  mishear_description?: string;
};
type RubricRow = {
  id: string;
  client_name: string;
  client_aliases: string;
  qualifier_name: string;
  what_counts_as_pass: string;
  what_counts_as_fail: string;
  critical: boolean;
  common_mishears: string;
};
type ScorecardEntry = {
  id: string;
  name: string;
  summary?: string;
  bundle?: {
    name?: string;
    client_patterns?: { name: string; patterns: string[] }[];
    universal_rules?: ScorecardRule[];
    client_rule_sets?: Record<string, { clients?: string[]; rules?: ScorecardRule[] }>;
    critical_checks?: ScorecardRule[];
  };
};
type ScorecardLibrary = { active_scorecard_id?: string; scorecards: ScorecardEntry[]; required_clients_available?: boolean };
type MirrorLead = { id: string; clover_url: string; label: string; disposition?: string; customer?: string; phone?: string };
type EditorRow = {
  Category: string;
  Qualifier: string;
  "System status": string;
  "Final status": string;
  Time: string;
  Evidence: string;
  "Reviewer note": string;
};
type AnalysisRow = {
  category: string;
  check: string;
  status: string;
  passed: boolean;
  result: string;
  evidence_time: string;
};
type TransferAnalysis = {
  occurred: boolean;
  status: string;
  time: string;
  snippet: string;
  notes: string;
};
type JobResult = {
  result_id: string;
  file_name: string;
  file_size_bytes?: number;
  label?: string;
  transcript_text: string;
  analysis: {
    client?: string;
    source?: string;
    scorecard_name?: string;
    rows?: AnalysisRow[];
    notes?: string;
    agent_name?: string;
    customer_name?: string;
    customer_phone?: string;
    transfer?: TransferAnalysis;
  };
  qa_overrides?: EditorRow[];
  metrics?: { qa_score: number; passed_count: number; total_count: number; outcome: string; final_grade: string };
  llm_error_report?: string;
  duration_seconds?: number;
  grading_seconds?: number;
};
type Job = {
  job_id: string;
  status: "queued" | "running" | "complete" | "failed";
  message: string;
  progress: number;
  percent: number;
  eta_seconds?: number;
  elapsed_seconds?: number;
  source_files?: string[];
  results: JobResult[];
  error_report?: string;
};

const OPENAI_KEY_STORAGE = "compassai.openaiApiKey";
const JOB_STORAGE = "compassai.vercelOnly.jobs";
const HOURS_SAVED_STORAGE = "compassai.hoursSaved";
const SCORECARD_STORAGE = "compassai.scorecards";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_QA_MODEL = "gpt-4o-mini";
const TRANSCRIPTION_MODEL_STORAGE = "compassai.transcriptionModel";
const QA_MODEL_STORAGE = "compassai.qaModel";
const THEME_STORAGE = "compassai.theme";
const TRANSCRIPTION_MODELS = ["gpt-4o-mini-transcribe", "gpt-4o-transcribe"];
const QA_MODELS = ["gpt-4o-mini", "gpt-5-mini", "gpt-5", "o3"];
const APP_VERSION = "0.5.4";
const REQUIRED_SCORECARDS = new Set(["Feldco", "Bachmans", "KQR", "Pella", "RbA/QWD"]);
const VERCEL_RELAY_CHUNK_BYTES = 3_300_000;
const MAX_BROWSER_AUDIO_BYTES = 90 * 1024 * 1024;

function uuid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fmtSeconds(value = 0) {
  if (!value) return "0s";
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fileSignature(name: string, size: number) {
  return `${name.trim().toLowerCase()}::${size}`;
}

export function splitDuplicateFiles<T extends { name: string; size: number }>(
  selected: T[],
  completed: Array<{ file_name: string; file_size_bytes?: number }>,
) {
  const signatures = new Set(
    completed
      .filter((result) => Number.isFinite(result.file_size_bytes))
      .map((result) => fileSignature(result.file_name, Number(result.file_size_bytes))),
  );
  const unique: T[] = [];
  const duplicates: T[] = [];
  selected.forEach((file) => {
    const signature = fileSignature(file.name, file.size);
    if (signatures.has(signature)) {
      duplicates.push(file);
      return;
    }
    signatures.add(signature);
    unique.push(file);
  });
  return { unique, duplicates };
}

function cleanApiKey(value = "") {
  const compact = value.replace(/\s+/g, "").trim();
  if (/^sk-proj(?!-)/.test(compact)) return compact.replace(/^sk-proj/, "sk-proj-");
  return compact;
}

function redactSensitive(value: unknown) {
  return String(value ?? "").replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-...redacted...");
}

function validTranscriptionModel(value = "") {
  return TRANSCRIPTION_MODELS.includes(value) ? value : DEFAULT_TRANSCRIPTION_MODEL;
}

function validQaModel(value = "") {
  return QA_MODELS.includes(value) ? value : DEFAULT_QA_MODEL;
}

function normalizePhone(value = "") {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function formatPhone(value = "") {
  const phone = normalizePhone(value);
  return phone.length === 10 ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` : value;
}

function titleCaseName(value = "") {
  return value
    .replace(/[^a-zA-Z.' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 3)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function extractAgentName(transcript = "") {
  const patterns = [
    /\b(?:this is|my name is|you['’]?re speaking with)\s+([a-z][a-z.'-]{1,24})\b/i,
    /\b([a-z][a-z.'-]{1,24})\s+(?:here|calling)\s+(?:from|on behalf of)\b/i,
    /\b([a-z][a-z.'-]{1,24})\s+speaking\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(transcript);
    if (match?.[1]) return titleCaseName(match[1]);
  }
  return "";
}

function extractCustomerName(transcript = "", agentName = "") {
  const patterns = [
    /\b(?:hi|hello|hey)\s+([a-z][a-z.'-]{1,24})(?=[,.\s])/i,
    /\bis\s+this\s+([a-z][a-z.'-]{1,24})\b/i,
    /\bam\s+i\s+speaking\s+(?:with|to)\s+([a-z][a-z.'-]{1,24})\b/i,
    /\b(?:thanks|thank you),?\s+([a-z][a-z.'-]{1,24})\b/i,
  ];
  const agent = normalizeKey(agentName);
  for (const pattern of patterns) {
    const match = pattern.exec(transcript);
    const candidate = titleCaseName(match?.[1] || "");
    if (candidate && normalizeKey(candidate) !== agent) return candidate;
  }
  return "";
}

function extractCustomerPhone(transcript = "") {
  return /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.exec(transcript)?.[0] ?? "";
}

function transcriptIdentity(transcript = "") {
  const agent = extractAgentName(transcript);
  return {
    agent_name: agent,
    customer_name: extractCustomerName(transcript, agent),
    customer_phone: extractCustomerPhone(transcript),
  };
}

function resultPhones(result: JobResult) {
  const phones = [...result.transcript_text.matchAll(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g)].map((match) => normalizePhone(match[0]));
  return new Set(phones.filter(Boolean));
}

function matchMirrorLead(result: JobResult, mirrorLeads: MirrorLead[] = []) {
  if (!mirrorLeads.length) return undefined;
  const phones = resultPhones(result);
  const byPhone = mirrorLeads.find((lead) => lead.phone && phones.has(normalizePhone(lead.phone)));
  if (byPhone) return byPhone;
  const transcript = normalizeKey(result.transcript_text);
  return mirrorLeads.find((lead) => {
    const customer = normalizeKey(lead.customer || lead.label);
    return customer.length > 5 && transcript.includes(customer);
  });
}

function callMeta(result: JobResult, mirrorLeads: MirrorLead[] = []) {
  const lead = matchMirrorLead(result, mirrorLeads);
  const transcriptMeta = transcriptIdentity(result.transcript_text);
  return {
    agent: result.analysis?.agent_name || transcriptMeta.agent_name,
    customer: result.analysis?.customer_name || lead?.customer || transcriptMeta.customer_name,
    phone: result.analysis?.customer_phone || lead?.phone || transcriptMeta.customer_phone,
    clover: lead?.clover_url || "",
    disposition: lead?.disposition || "",
    lead,
  };
}

function titleFor(result: JobResult, mirrorLeads: MirrorLead[] = []) {
  const client = result.analysis?.client || "Unknown";
  const scorecard = result.analysis?.scorecard_name || "Not selected";
  const meta = callMeta(result, mirrorLeads);
  const extras = [
    meta.customer ? `Customer: ${meta.customer}` : "",
    meta.phone ? `Phone: ${formatPhone(meta.phone)}` : "",
    meta.agent ? `Agent: ${meta.agent}` : "",
  ].filter(Boolean);
  return `${result.file_name} | Client: ${client} | Scorecard: ${scorecard}${extras.length ? ` | ${extras.join(" | ")}` : ""}`;
}

function freeAlerts(text: string) {
  const alerts = [];
  if (/\bfree\s+windows?\b/i.test(text)) alerts.push("FREE WINDOW CUSTOMER");
  if (/\bfree\s+(roofing|roof)\b/i.test(text)) alerts.push("FREE ROOFING CUSTOMER");
  return alerts;
}

function timestampSeconds(value = "") {
  const parts = value.trim().split(":").map(Number);
  if ((parts.length !== 2 && parts.length !== 3) || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function normalizeTransfer(raw: unknown, transcript: string, duration = 0): TransferAnalysis {
  if (!raw || typeof raw !== "object") {
    return { occurred: false, status: "No transfer detected", time: "", snippet: "", notes: "" };
  }
  const value = raw as Partial<TransferAnalysis>;
  const occurred = value.occurred === true;
  const snippet = String(value.snippet || "").replace(/\s+/g, " ").trim();
  const suppliedTime = String(value.time || "").trim();
  const time = occurred && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(suppliedTime)
    ? suppliedTime
    : occurred && snippet
      ? timeForSnippet(transcript, snippet, duration)
      : "";
  return {
    occurred,
    status: occurred ? `Transfer detected${time ? ` at ${time}` : ""}` : "No transfer detected",
    time,
    snippet,
    notes: String(value.notes || "").replace(/\s+/g, " ").trim(),
  };
}

function isPostTransfer(evidenceTime: string, transfer?: TransferAnalysis) {
  if (!transfer?.occurred) return false;
  const evidence = timestampSeconds(evidenceTime);
  const transferAt = timestampSeconds(transfer.time);
  return evidence !== null && transferAt !== null && evidence > transferAt;
}

function safeRegex(pattern: string) {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

function firstPatternMatch(text: string, patterns: string[] = []) {
  for (const pattern of patterns) {
    const regex = safeRegex(pattern);
    const match = regex?.exec(text);
    if (match?.[0]) return match[0];
  }
  return "";
}

function snippetFor(text: string, match: string) {
  if (!match) return "";
  const index = text.toLowerCase().indexOf(match.toLowerCase());
  if (index < 0) return match;
  return text.slice(Math.max(0, index - 70), Math.min(text.length, index + match.length + 90)).replace(/\s+/g, " ").trim();
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scorecardSummary(entry: ScorecardEntry) {
  const bundle = entry.bundle ?? {};
  const clientSets = Object.keys(bundle.client_rule_sets ?? {}).length;
  const universal = bundle.universal_rules?.length ?? 0;
  const critical = bundle.critical_checks?.length ?? 0;
  const aliases = (bundle.client_patterns ?? []).reduce((sum, group) => sum + (group.patterns?.length ?? 0), 0);
  return entry.summary || `${clientSets} client set(s), ${universal} universal rule(s), ${critical} critical check(s), ${aliases} aliases`;
}

function splitFriendlyList(value = "") {
  return value
    .split(/[;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item && item.toLowerCase() !== "undefined");
}

function phraseToPattern(phrase: string) {
  const trimmed = phrase.trim();
  if (!trimmed) return "";
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return `\\b${escaped}\\b`;
}

function cleanPatternForEditor(pattern = "") {
  return pattern
    .replace(/\\b/g, "")
    .replace(/\\s[+*?]?/g, " ")
    .replace(/\(\?:/g, "")
    .replace(/[()]/g, "")
    .replace(/\\[-]/g, "-")
    .replace(/\\([.?+*|[\]{}])/g, "$1")
    .replace(/\[\^?[^\\]]+\]/g, "")
    .replace(/[|]/g, "; ")
    .replace(/\s+/g, " ")
    .replace(/;+(\s*;)+/g, ";")
    .trim();
}

function patternText(patterns: string[] = []) {
  return patterns
    .map(cleanPatternForEditor)
    .filter(Boolean)
    .join("; ");
}

function rulePassText(rule: ScorecardRule) {
  return rule.pass_description || patternText(rule.positive_patterns);
}

function ruleFailText(rule: ScorecardRule) {
  return rule.fail_description || patternText(rule.negative_patterns);
}

function ruleMishearText(rule: ScorecardRule) {
  return rule.mishear_description || "";
}

function makeRubricRow(clientName: string, aliases: string, rule?: ScorecardRule, critical = false): RubricRow {
  return {
    id: uuid(),
    client_name: clientName,
    client_aliases: aliases,
    qualifier_name: rule?.name?.replace(/^Critical:\s*/i, "") || "",
    what_counts_as_pass: rule ? rulePassText(rule) : "",
    what_counts_as_fail: rule ? ruleFailText(rule) : "",
    critical,
    common_mishears: rule ? ruleMishearText(rule) : "",
  };
}

function rubricRowsFromEntry(entry?: ScorecardEntry) {
  if (!entry?.bundle) return [makeRubricRow("", "", undefined, false)];
  const defaultClient = entry.bundle.client_patterns?.[0]?.name || entry.name || "";
  const defaultAliases = (entry.bundle.client_patterns?.[0]?.patterns ?? []).map(cleanPatternForEditor).filter(Boolean).join("; ");
  const rows: RubricRow[] = [];

  for (const rule of entry.bundle.universal_rules ?? []) {
    if (rule.name === "Client identified") continue;
    rows.push(makeRubricRow(defaultClient, defaultAliases, rule, false));
  }
  for (const set of Object.values(entry.bundle.client_rule_sets ?? {})) {
    const clientName = set.clients?.[0] || defaultClient;
    const aliasGroup = entry.bundle.client_patterns?.find((group) => group.name === clientName);
    const aliases = (aliasGroup?.patterns ?? []).map(cleanPatternForEditor).filter(Boolean).join("; ") || defaultAliases;
    for (const rule of set.rules ?? []) {
      rows.push(makeRubricRow(clientName, aliases, rule, false));
    }
  }
  for (const rule of entry.bundle.critical_checks ?? []) {
    rows.push(makeRubricRow(defaultClient, defaultAliases, rule, true));
  }
  return rows.length ? rows : [makeRubricRow(defaultClient, defaultAliases, undefined, false)];
}

function rowToRule(row: RubricRow, fallbackType: string): ScorecardRule {
  const name = row.qualifier_name.trim() || "New qualifier";
  const passPhrases = splitFriendlyList(row.what_counts_as_pass);
  const failPhrases = splitFriendlyList(row.what_counts_as_fail);
  return {
    name,
    type: fallbackType,
    positive_patterns: passPhrases.map(phraseToPattern).filter(Boolean),
    negative_patterns: failPhrases.map(phraseToPattern).filter(Boolean),
    pass_description: passPhrases.join("; "),
    fail_description: failPhrases.join("; "),
    mishear_description: splitFriendlyList(row.common_mishears).join("; "),
  };
}

function bundleFromRubricRows(original: Record<string, unknown>, name: string, rows: RubricRow[]) {
  const usable = rows.filter((row) => row.client_name.trim() || row.qualifier_name.trim());
  const clientMap = new Map<string, { aliases: Set<string>; rules: ScorecardRule[] }>();
  const universalRules: ScorecardRule[] = [];
  const criticalChecks: ScorecardRule[] = [];

  for (const row of usable) {
    const client = row.client_name.trim() || name || "Default client";
    const aliases = splitFriendlyList(row.client_aliases || client);
    if (!clientMap.has(client)) clientMap.set(client, { aliases: new Set([client]), rules: [] });
    const clientInfo = clientMap.get(client)!;
    aliases.forEach((alias) => clientInfo.aliases.add(alias));
    const rule = rowToRule(row, row.critical ? "Critical" : "Qualifier");
    if (row.critical) {
      criticalChecks.push(rule);
    } else {
      clientInfo.rules.push(rule);
    }
  }

  const client_patterns = [...clientMap.entries()].map(([client, info]) => ({
    name: client,
    patterns: [...info.aliases].map(phraseToPattern).filter(Boolean),
  }));
  const client_rule_sets = Object.fromEntries(
    [...clientMap.entries()].map(([client, info]) => [
      client.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "client",
      { clients: [client], rules: info.rules },
    ]),
  );

  return {
    ...original,
    name,
    client_patterns,
    universal_rules: universalRules,
    client_rule_sets,
    critical_checks: criticalChecks,
  };
}

function normalizeScorecardLibrary(library: ScorecardLibrary): ScorecardLibrary {
  const seen = new Set<string>();
  const scorecards = (library.scorecards ?? [])
    .filter((entry) => entry && entry.bundle)
    .map((entry) => {
      const base = entry.id || entry.name || entry.bundle?.name || "scorecard";
      let id = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || uuid();
      while (seen.has(id)) id = `${id}-${seen.size + 1}`;
      seen.add(id);
      return { ...entry, id, name: entry.name || entry.bundle?.name || "Unnamed scorecard" };
    });
  const active = scorecards.some((entry) => entry.id === library.active_scorecard_id)
    ? library.active_scorecard_id
    : scorecards[0]?.id;
  const names = new Set(scorecards.map((entry) => entry.name));
  return {
    active_scorecard_id: active,
    scorecards,
    required_clients_available: [...REQUIRED_SCORECARDS].every((name) => names.has(name)),
  };
}

function activeScorecard(library: ScorecardLibrary) {
  return library.scorecards.find((entry) => entry.id === library.active_scorecard_id) ?? library.scorecards[0];
}

function timeForSnippet(text: string, snippet: string, duration = 0) {
  if (!duration || !snippet) return "00:00";
  const index = text.toLowerCase().indexOf(snippet.slice(0, 24).toLowerCase());
  const ratio = index >= 0 ? index / Math.max(text.length, 1) : 0;
  const seconds = Math.max(0, Math.round(duration * ratio));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function evidenceFromTranscript(transcript: string, proposed: string, fallback: AnalysisRow | undefined, duration = 0) {
  const clean = proposed.replace(/\s+/g, " ").trim();
  const exact = clean && transcript.toLowerCase().includes(clean.toLowerCase()) ? snippetFor(transcript, clean) : "";
  if (exact) {
    return { result: exact, evidence_time: timeForSnippet(transcript, exact, duration) };
  }
  if (fallback?.result && !/^No clear evidence/i.test(fallback.result)) {
    return { result: fallback.result, evidence_time: fallback.evidence_time };
  }
  const quoted = /["“]([^"”]{8,120})["”]/.exec(proposed)?.[1] ?? "";
  const quoteSnippet = quoted ? snippetFor(transcript, quoted) : "";
  if (quoteSnippet) {
    return { result: quoteSnippet, evidence_time: timeForSnippet(transcript, quoteSnippet, duration) };
  }
  return { result: clean || fallback?.result || "No clear evidence found in transcript.", evidence_time: fallback?.evidence_time || "" };
}

function normalizeQaRows(rows: AnalysisRow[], ruleRows: AnalysisRow[], transcript: string, duration = 0) {
  const fallbackByCheck = new Map(ruleRows.map((row) => [normalizeKey(row.check), row]));
  const normalized = rows.map((row) => {
    const fallback = fallbackByCheck.get(normalizeKey(row.check));
    const evidence = evidenceFromTranscript(transcript, row.result || "", fallback, duration);
    const modelTime = String(row.evidence_time || "");
    return {
      category: row.category || fallback?.category || "Qualifier",
      check: row.check || fallback?.check || "QA check",
      status: row.status || fallback?.status || "Needs review",
      passed: (row.status || fallback?.status) === "Pass",
      result: evidence.result,
      evidence_time: /^\d{1,2}:\d{2}(?::\d{2})?$/.test(modelTime) && modelTime !== "00:00" ? modelTime : evidence.evidence_time,
    };
  });
  return normalized.length ? normalized : ruleRows;
}

function readAscii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) bytes[offset + i] = value.charCodeAt(i);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number) {
  new DataView(bytes.buffer).setUint32(offset, value, true);
}

function makeWaveFile(fmtChunk: Uint8Array, dataChunk: Uint8Array, name: string) {
  const fmtPad = fmtChunk.length % 2;
  const dataPad = dataChunk.length % 2;
  const total = 12 + 8 + fmtChunk.length + fmtPad + 8 + dataChunk.length + dataPad;
  const output = new Uint8Array(total);
  writeAscii(output, 0, "RIFF");
  writeUint32(output, 4, total - 8);
  writeAscii(output, 8, "WAVE");
  writeAscii(output, 12, "fmt ");
  writeUint32(output, 16, fmtChunk.length);
  output.set(fmtChunk, 20);
  const dataHeader = 20 + fmtChunk.length + fmtPad;
  writeAscii(output, dataHeader, "data");
  writeUint32(output, dataHeader + 4, dataChunk.length);
  output.set(dataChunk, dataHeader + 8);
  return new File([output], name, { type: "audio/wav" });
}

async function splitWavForVercelRelay(file: File) {
  if (file.size <= VERCEL_RELAY_CHUNK_BYTES) return { files: [file], duration: 0, chunked: false };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    return { files: [file], duration: 0, chunked: false };
  }

  let offset = 12;
  let fmtChunk: Uint8Array | null = null;
  let dataChunk: Uint8Array | null = null;
  while (offset + 8 <= bytes.length) {
    const id = readAscii(bytes, offset, 4);
    const size = new DataView(bytes.buffer).getUint32(offset + 4, true);
    const start = offset + 8;
    const end = Math.min(start + size, bytes.length);
    if (id === "fmt ") fmtChunk = bytes.slice(start, end);
    if (id === "data") dataChunk = bytes.slice(start, end);
    offset = end + (size % 2);
  }

  if (!fmtChunk || !dataChunk || fmtChunk.length < 16) return { files: [file], duration: 0, chunked: false };
  const fmtView = new DataView(fmtChunk.buffer, fmtChunk.byteOffset, fmtChunk.byteLength);
  const sampleRate = fmtView.getUint32(4, true);
  const blockAlign = Math.max(1, fmtView.getUint16(12, true));
  const maxData = Math.floor(VERCEL_RELAY_CHUNK_BYTES / blockAlign) * blockAlign;
  if (maxData <= 0) return { files: [file], duration: 0, chunked: false };

  const stem = file.name.replace(/\.[^.]+$/, "") || "recording";
  const chunks: File[] = [];
  for (let start = 0; start < dataChunk.length; start += maxData) {
    const chunkData = dataChunk.slice(start, Math.min(start + maxData, dataChunk.length));
    chunks.push(makeWaveFile(fmtChunk, chunkData, `${stem}.part-${String(chunks.length + 1).padStart(2, "0")}.wav`));
  }
  const duration = sampleRate ? dataChunk.length / (sampleRate * blockAlign) : 0;
  return { files: chunks, duration, chunked: chunks.length > 1 };
}

function pickScorecard(transcript: string, library: ScorecardLibrary) {
  let best = activeScorecard(library) ?? library.scorecards[0];
  let client = "Unknown";
  for (const entry of library.scorecards) {
    for (const patternGroup of entry.bundle?.client_patterns ?? []) {
      if ((patternGroup.patterns ?? []).some((pattern) => safeRegex(pattern)?.test(transcript))) {
        return { entry, client: patternGroup.name };
      }
    }
  }
  if (/bachman'?s|bachmans/i.test(transcript)) {
    best = library.scorecards.find((entry) => /bachmans/i.test(entry.name)) ?? best;
    client = "Bachmans Roofing";
  } else if (/feldco/i.test(transcript)) {
    best = library.scorecards.find((entry) => /feldco/i.test(entry.name)) ?? best;
    client = "Feldco";
  } else if (/\bpella\b/i.test(transcript)) {
    best = library.scorecards.find((entry) => /pella/i.test(entry.name)) ?? best;
    client = "Pella Windows & Doors";
  } else if (/\bkqr\b|quality\s+windows/i.test(transcript)) {
    best = library.scorecards.find((entry) => /\bkqr\b/i.test(entry.name)) ?? best;
    client = "KQR";
  } else if (/\bqwd\b|renewal\s+by\s+andersen|renewal\s+by\s+anderson|rba/i.test(transcript)) {
    best = library.scorecards.find((entry) => /rba|qwd/i.test(entry.name)) ?? best;
    client = "QWD";
  }
  return { entry: best, client };
}

function rulesFor(entry: ScorecardEntry, client: string) {
  const universal = entry.bundle?.universal_rules ?? [];
  const critical = (entry.bundle?.critical_checks ?? []).map((rule) => ({ ...rule, name: `Critical: ${rule.name}` }));
  const clientSets = Object.values(entry.bundle?.client_rule_sets ?? {});
  const matchingSet =
    clientSets.find((set) => (set.clients ?? []).some((name) => name.toLowerCase() === client.toLowerCase())) ?? clientSets[0];
  return [...universal, ...(matchingSet?.rules ?? []), ...critical].filter((rule) => rule.name !== "Client identified");
}

function gradeRule(rule: ScorecardRule, transcript: string, duration = 0): AnalysisRow {
  const negative = firstPatternMatch(transcript, rule.negative_patterns);
  const positive = firstPatternMatch(transcript, rule.positive_patterns);
  const status = negative ? "Fail" : positive ? "Pass" : "Needs review";
  const evidence = snippetFor(transcript, negative || positive) || "No clear evidence found in transcript.";
  return {
    category: rule.type || (rule.name.startsWith("Critical:") ? "Critical" : "Qualifier"),
    check: rule.name,
    status,
    passed: status === "Pass",
    result: evidence,
    evidence_time: timeForSnippet(transcript, evidence, duration),
  };
}

function metrics(rows: AnalysisRow[], finalGrade = "Approved") {
  const scored = rows.filter((row) => row.status !== "Not applicable");
  const passed = scored.filter((row) => row.status === "Pass").length;
  const qa_score = scored.length ? Math.round((passed / scored.length) * 100) : 0;
  const criticalMiss = scored.some((row) => row.category === "Critical" && row.status !== "Pass");
  return {
    qa_score,
    passed_count: passed,
    total_count: scored.length,
    outcome: criticalMiss ? "CRITICAL MISS" : qa_score >= 80 ? "PASS" : "NEEDS REVIEW",
    final_grade: finalGrade,
  };
}

function editorRows(rows: AnalysisRow[]): EditorRow[] {
  return rows.map((row) => ({
    Category: row.category,
    Qualifier: row.check,
    "System status": row.status,
    "Final status": row.status,
    Time: row.evidence_time,
    Evidence: row.result,
    "Reviewer note": "",
  }));
}

function applyOverrides(result: JobResult, overrides = result.qa_overrides ?? [], finalGrade = result.metrics?.final_grade ?? "Approved") {
  const rows = overrides.map((row) => ({
    category: row.Category,
    check: row.Qualifier,
    status: row["Final status"],
    passed: row["Final status"] === "Pass",
    result: row.Evidence,
    evidence_time: row.Time,
  }));
  return {
    ...result,
    qa_overrides: overrides,
    analysis: { ...result.analysis, rows },
    metrics: metrics(rows, finalGrade),
  };
}

function makeErrorReport(stage: string, error: unknown, extra: Record<string, unknown> = {}) {
  const lines = [
    "CompassAi Cloud LLM Error Report",
    "",
    `What failed: ${stage}`,
    `Exact error: ${redactSensitive(error instanceof Error ? error.message : String(error))}`,
    `Timestamp: ${new Date().toISOString()}`,
    `Platform: ${navigator.platform}`,
    `Browser: ${navigator.userAgent}`,
    "Hosting: Web based, CompassAi",
  ];
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") lines.push(`${key}: ${redactSensitive(value)}`);
  }
  lines.push("Likely fix: verify the OpenAI API key, billing, model access, and use a smaller or compressed audio file if the Vercel upload relay reports a payload limit.");
  lines.push("Transcript and audio content are intentionally omitted.");
  return lines.join("\n");
}

async function runTranscriptionFiles(file: File, apiKey: string, model: string) {
  if (file.size > MAX_BROWSER_AUDIO_BYTES) {
    throw new Error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. CompassAi's web workflow works best below about ${(MAX_BROWSER_AUDIO_BYTES / 1024 / 1024).toFixed(0)} MB.`);
  }
  const prepared = await splitWavForVercelRelay(file);
  const transcriptParts: string[] = [];
  let duration = prepared.duration;
  for (const [index, uploadFile] of prepared.files.entries()) {
    const form = new FormData();
    form.append("model", model);
    form.append("file", uploadFile);
    form.append("response_format", "json");
    const response = await fetch("/api/openai/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `CompassAi transcription relay HTTP ${response.status} on part ${index + 1}/${prepared.files.length}: ${text.slice(0, 700)}`,
      );
    }
    const payload = JSON.parse(text);
    transcriptParts.push(String(payload.text ?? ""));
    duration += Number(payload.duration ?? 0);
  }
  return {
    transcript: transcriptParts.filter(Boolean).join("\n\n"),
    duration,
    chunk_count: prepared.files.length,
    chunked: prepared.chunked,
    model_used: model,
    model_fallback: undefined as string | undefined,
  };
}

async function transcribeDirect(file: File, apiKey: string, requestedModel: string) {
  try {
    return await runTranscriptionFiles(file, apiKey, requestedModel || DEFAULT_TRANSCRIPTION_MODEL);
  } catch (caught) {
    if ((requestedModel || DEFAULT_TRANSCRIPTION_MODEL) === DEFAULT_TRANSCRIPTION_MODEL) throw caught;
    const fallback = await runTranscriptionFiles(file, apiKey, DEFAULT_TRANSCRIPTION_MODEL);
    return {
      ...fallback,
      model_fallback: `Requested transcription model '${requestedModel}' was not available, so CompassAi used '${DEFAULT_TRANSCRIPTION_MODEL}'.`,
    };
  }
}

async function qaDirect(transcript: string, scorecard: ScorecardEntry, apiKey: string, model: string) {
  const response = await fetch("/api/openai/chat", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a QA auditor. Return compact JSON only: {agent_name,customer_name,customer_phone,transfer:{occurred,time,snippet,notes},rows:[{check,status,result,evidence_time,category}],notes}. Identify agent/customer from transcript context when clear, such as greetings and introductions. Detect warm or cold transfers, handoffs, 'let me get you over to' language, hold-then-transfer moments, or a clear change in agent/customer roles. transfer.occurred must be true only when the transcript supports a transfer; include the best MM:SS timestamp, exact short evidence snippet, and a concise explanation. status must be Pass, Fail, Needs review, or Not applicable. Do not include full transcripts.",
        },
        {
          role: "user",
          content: JSON.stringify({
            scorecard_name: scorecard.name,
            scorecard_bundle: scorecard.bundle,
            transcript: transcript.slice(0, 45000),
          }),
        },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`CompassAi QA relay HTTP ${response.status}: ${text.slice(0, 700)}`);
  const payload = JSON.parse(text);
  return JSON.parse(payload.choices?.[0]?.message?.content ?? "{}") as {
    rows?: AnalysisRow[];
    notes?: string;
    agent_name?: string;
    customer_name?: string;
    customer_phone?: string;
    transfer?: Partial<TransferAnalysis>;
  };
}

function makeRuleAnalysis(transcript: string, library: ScorecardLibrary, duration = 0) {
  const { entry, client } = pickScorecard(transcript, library);
  const rows = rulesFor(entry, client).map((rule) => gradeRule(rule, transcript, duration));
  return { entry, client, rows };
}

function parseMirrorText(value: string): MirrorLead[] {
  const links = [...value.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((match) => match[0]);
  const clover = links.filter((link) => /clover|lead|customer|contact/i.test(link));
  const parser = typeof DOMParser !== "undefined" ? new DOMParser() : null;
  const rows: MirrorLead[] = [];
  if (parser && /<[^>]+>/.test(value)) {
    const doc = parser.parseFromString(value, "text/html");
    doc.querySelectorAll("tr, .lead, .appointment, .customer, article, section").forEach((node, index) => {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      const cells = Array.from(node.querySelectorAll("td, th, .name, .customer-name, .lead-name"))
        .map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const href = Array.from(node.querySelectorAll("a"))
        .map((link) => link.getAttribute("href") || "")
        .find((url) => /clover|lead|customer|contact/i.test(url));
      if (!href && text.length < 20) return;
      const phone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.exec(text)?.[0] ?? "";
      const disposition = /(booked|appointment|rejected|not interested|no answer|cancelled|rescheduled)/i.exec(text)?.[0] ?? "";
      const named = /(customer|name|homeowner)\s*:?\s*([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/i.exec(text)?.[2] ?? "";
      const customer = named || cells.find((cell) =>
        /^[A-Za-z][A-Za-z.'-]+(?:\s+[A-Za-z][A-Za-z.'-]+){1,3}$/.test(cell) && !/booked|appointment|phone|email|address|clover/i.test(cell),
      ) || "";
      if (href || phone || disposition) {
        rows.push({
          id: `${index}-${href || phone || text.slice(0, 20)}`,
          clover_url: href || "",
          label: text.slice(0, 120) || `MirrorCXT lead ${index + 1}`,
          disposition,
          customer,
          phone,
        });
      }
    });
  }
  if (rows.length) return rows;
  return clover.map((url, index) => ({ id: `${index}-${url}`, clover_url: url, label: `MirrorCXT lead ${index + 1}` }));
}

export function makeReport(results: JobResult[], mirrorLeads: MirrorLead[]) {
  const generated = new Date().toLocaleString();
  const reviewRows = results
    .map((result) => {
      const m = result.metrics;
      const meta = callMeta(result, mirrorLeads);
      const transfer = result.analysis.transfer;
      return `<tr>
        <td class="long">${escapeHtml(result.file_name)}</td>
        <td>${escapeHtml(result.analysis.client)}</td>
        <td>${escapeHtml(result.analysis.scorecard_name)}</td>
        <td>${escapeHtml(meta.agent || "Not detected")}</td>
        <td>${escapeHtml(meta.customer || "Not matched")}</td>
        <td>${escapeHtml(meta.phone ? formatPhone(meta.phone) : "Not matched")}</td>
        <td>${meta.clover ? `<a href="${escapeHtml(meta.clover)}">Open Clover</a>` : "Not matched"}</td>
        <td>${m?.qa_score ?? 0}%</td>
        <td>${escapeHtml(m?.outcome)}</td>
        <td>${escapeHtml(transfer?.status || "No transfer detected")}</td>
        <td>${escapeHtml(fmtSeconds(result.duration_seconds))}</td>
        <td>${escapeHtml(fmtSeconds(result.grading_seconds))}</td>
      </tr>`;
    })
    .join("");
  const grouped = new Map<string, JobResult[]>();
  results.forEach((result) => {
    const agent = callMeta(result, mirrorLeads).agent || "Unassigned agent";
    grouped.set(agent, [...(grouped.get(agent) ?? []), result]);
  });
  let transcriptIndex = 0;
  const agentSections = Array.from(grouped.entries()).map(([agent, calls]) => {
    const average = calls.length
      ? Math.round(calls.reduce((sum, call) => sum + (call.metrics?.qa_score ?? 0), 0) / calls.length)
      : 0;
    const transferCount = calls.filter((call) => call.analysis.transfer?.occurred).length;
    const callSections = calls.map((result) => {
      const index = transcriptIndex++;
      const meta = callMeta(result, mirrorLeads);
      const transfer = result.analysis.transfer;
      const evidenceRows = (result.qa_overrides ?? editorRows(result.analysis.rows ?? [])).map((row) => {
        const postTransfer = isPostTransfer(row.Time, transfer);
        return `<tr>
          <td class="qualifier-cell"><strong>${escapeHtml(row.Qualifier)}</strong><small>${escapeHtml(row.Category)}</small></td>
          <td>${escapeHtml(row["System status"])}</td>
          <td>${escapeHtml(row["Final status"])}</td>
          <td class="time-cell">${escapeHtml(row.Time || "No timestamp")}${postTransfer ? '<span class="post-transfer">&#9888; Post-Transfer</span>' : ""}</td>
          <td class="long">${escapeHtml(row.Evidence)}</td>
          <td class="long">${escapeHtml(row["Reviewer note"])}</td>
        </tr>`;
      }).join("");
      const transferAlert = transfer?.occurred
        ? `<div class="transfer-alert"><strong>Transfer detected${transfer.time ? ` at ${escapeHtml(transfer.time)}` : ""}</strong><span>${escapeHtml(transfer.snippet || transfer.notes || "The AI identified a call handoff.")}</span></div>`
        : "";
      return `<article class="call-report">
        <header class="call-header"><span>Individual call report</span><h3>${escapeHtml(titleFor(result, mirrorLeads))}</h3></header>
        <div class="call-meta">
          <span>Agent: <strong>${escapeHtml(meta.agent || "Not detected")}</strong></span>
          <span>Customer: <strong>${escapeHtml(meta.customer || "Not matched")}</strong></span>
          <span>Phone: <strong>${escapeHtml(meta.phone ? formatPhone(meta.phone) : "Not matched")}</strong></span>
          <span>QA score: <strong>${result.metrics?.qa_score ?? 0}%</strong></span>
          <span>Outcome: <strong>${escapeHtml(result.metrics?.outcome || "Needs review")}</strong></span>
          <span>Call time: <strong>${escapeHtml(fmtSeconds(result.duration_seconds))}</strong></span>
          <span>Grading time: <strong>${escapeHtml(fmtSeconds(result.grading_seconds))}</strong></span>
          ${meta.clover ? `<span>Clover: <a href="${escapeHtml(meta.clover)}">Open matched lead</a></span>` : ""}
        </div>
        ${transferAlert}
        ${freeAlerts(result.transcript_text).map((alert) => `<div class="free-alert">${escapeHtml(alert)}</div>`).join("")}
        <h4>QA assessment and evidence</h4>
        <div class="table-wrap"><table class="qa-table"><thead><tr><th>Qualifier</th><th>System</th><th>Final</th><th>Evidence time</th><th>Evidence</th><th>Reviewer note</th></tr></thead><tbody>${evidenceRows || '<tr><td colspan="6">No QA evidence recorded for this call.</td></tr>'}</tbody></table></div>
        <h4>Transcript</h4>
        <div class="search-row"><input class="search" data-target="t${index}" placeholder="Search this transcript"><button type="button" data-prev="t${index}">Previous</button><button type="button" data-next="t${index}">Next</button><span data-count="t${index}">0 matches</span></div>
        <pre class="transcript" id="t${index}">${escapeHtml(result.transcript_text)}</pre>
      </article>`;
    }).join("");
    return `<details class="agent-section" open><summary><span>Agent</span><strong>${escapeHtml(agent)}</strong><em>${calls.length} call${calls.length === 1 ? "" : "s"} · ${average}% average QA · ${transferCount} transfer${transferCount === 1 ? "" : "s"}</em></summary>${callSections}</details>`;
  }).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CompassAi Report</title><style>
	body{font-family:Inter,Arial,sans-serif;margin:0;color:#17202a;background:#f4f7fb;line-height:1.45}.page{padding:28px;max-width:1800px;margin:auto}.hero{background:#0b1118;color:#e6edf5;padding:24px 28px;border-radius:10px;margin-bottom:18px}.hero h1{margin:0 0 6px;font-size:28px}.hero p{margin:0;color:#a8b3c2}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:18px}.card{background:#fff;border:1px solid #d8dee6;border-radius:8px;padding:14px}.card span,.call-header span{color:#687789;display:block;font-size:12px;font-weight:800;text-transform:uppercase}.card strong{display:block;font-size:22px;margin-top:4px}h2{margin:24px 0 10px}h4{margin:20px 0 8px}.table-wrap{overflow-x:auto;max-width:100%;border:1px solid #d8dee6;border-radius:8px;background:#fff}table{border-collapse:collapse;min-width:1500px;width:max-content;table-layout:auto}th,td{border-bottom:1px solid #d8dee6;padding:10px;text-align:left;vertical-align:top;white-space:nowrap;word-break:normal;overflow-wrap:normal}th{background:#f8fafc;font-size:12px;text-transform:uppercase;color:#475569}.long{white-space:normal;min-width:260px;max-width:560px;overflow-wrap:break-word}.qualifier-cell{white-space:normal;min-width:220px;max-width:320px}.qualifier-cell small{display:block;color:#64748b}.time-cell{min-width:145px}.post-transfer{display:block;width:max-content;margin-top:5px;border:1px solid #dc2626;background:#fee2e2;color:#991b1b;border-radius:4px;padding:3px 6px;font-size:11px;font-weight:900}.agent-section{background:#fff;border:1px solid #b9c5d3;border-radius:8px;margin:20px 0;padding:0 16px 16px}.agent-section>summary{cursor:pointer;padding:16px 0;display:flex;align-items:center;gap:12px}.agent-section>summary span{font-size:12px;color:#64748b;text-transform:uppercase;font-weight:800}.agent-section>summary strong{font-size:20px}.agent-section>summary em{margin-left:auto;color:#64748b;font-style:normal}.call-report{border-top:3px solid #0f766e;padding:18px 0 6px;margin:10px 0 22px}.call-header h3{margin:4px 0 12px;font-size:18px;overflow-wrap:break-word;word-break:normal}.call-meta{display:flex;flex-wrap:wrap;gap:10px 16px;color:#475569;margin-bottom:12px}.transfer-alert{border:2px solid #2563eb;background:#dbeafe;color:#1e3a8a;border-radius:8px;padding:11px 13px;font-weight:700;margin:10px 0}.transfer-alert strong,.transfer-alert span{display:block}.transfer-alert span{font-weight:500;margin-top:3px}.transcript{white-space:pre-wrap;background:#05080d;color:#e5e7eb;border:1px solid #111827;border-radius:8px;padding:14px;overflow:auto;max-height:700px;overflow-wrap:break-word;word-break:normal}.free-alert{border:2px solid #dc2626;background:#fee2e2;color:#991b1b;border-radius:8px;padding:10px;font-weight:900;margin:10px 0}.search-row{display:grid;grid-template-columns:minmax(220px,380px) auto auto auto;gap:8px;align-items:center;margin:10px 0}.search-row input,.search-row button{border:1px solid #d8dee6;border-radius:7px;padding:8px 10px}a{color:#0f766e;font-weight:800}mark{background:#fde68a;color:#111827;border-radius:3px;padding:0 2px}mark.active{background:#fb923c}@media(max-width:720px){.page{padding:12px}.agent-section>summary{align-items:flex-start;flex-wrap:wrap}.agent-section>summary em{width:100%;margin-left:0}.search-row{grid-template-columns:1fr 1fr}.search-row input,.search-row span{grid-column:1/-1}}@media print{body{background:#fff}.page{padding:12px}.hero,.card,.call-report{break-inside:avoid}.agent-section{border:0;padding:0}.table-wrap{overflow:visible}table{font-size:10px;min-width:1100px}.search-row{display:none}.transcript{max-height:none;background:#fff;color:#17202a;border-color:#d8dee6}}</style></head><body><div class="page">
	<div class="hero"><h1>CompassAi Batch Report</h1><p>Generated ${escapeHtml(generated)}. Polished web report with MirrorCXT matches, QA evidence, timestamps, and searchable transcripts.</p></div>
	<div class="summary"><div class="card"><span>Calls</span><strong>${results.length}</strong></div><div class="card"><span>Total call time</span><strong>${escapeHtml(fmtSeconds(results.reduce((sum, result) => sum + (result.duration_seconds ?? 0), 0)))}</strong></div><div class="card"><span>MirrorCXT leads loaded</span><strong>${mirrorLeads.length}</strong></div><div class="card"><span>Average QA score</span><strong>${results.length ? Math.round(results.reduce((sum, result) => sum + (result.metrics?.qa_score ?? 0), 0) / results.length) : 0}%</strong></div></div>
	<h2>Review Queue</h2><div class="table-wrap"><table><thead><tr><th>File</th><th>Client</th><th>Scorecard</th><th>Agent</th><th>Customer</th><th>Phone</th><th>Clover</th><th>QA Score</th><th>Outcome</th><th>Transfer</th><th>Call Time</th><th>Grading Time</th></tr></thead><tbody>${reviewRows}</tbody></table></div>
	<h2>QA Reviews by Agent</h2>${agentSections || "<p>No completed calls were selected for this report.</p>"}
	<h2>MirrorCXT Links</h2><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th>Disposition</th><th>Clover</th><th>Raw label</th></tr></thead><tbody>${mirrorLeads.map((lead) => `<tr><td>${escapeHtml(lead.customer || "")}</td><td>${escapeHtml(lead.phone ? formatPhone(lead.phone) : "")}</td><td>${escapeHtml(lead.disposition || "")}</td><td>${lead.clover_url ? `<a href="${escapeHtml(lead.clover_url)}">Open Clover</a>` : ""}</td><td class="long">${escapeHtml(lead.label)}</td></tr>`).join("")}</tbody></table></div>
	</div><script>(function(){function esc(s){return s.replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}var state={};document.querySelectorAll('.transcript').forEach(function(t){state[t.id]={raw:t.textContent||'',active:0,matches:[]}});function paint(id,q){var t=document.getElementById(id);var s=state[id];if(!t||!s)return;var count=document.querySelector('[data-count="'+id+'"]');if(!q){s.matches=[];t.textContent=s.raw;if(count)count.textContent='0 matches';return}var rx=new RegExp(q.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g,'\\\\$&'),'gi');var i=0;s.matches=[];t.innerHTML=esc(s.raw).replace(rx,function(m){var cls=i===s.active?' active':'';s.matches.push(i);i++;return '<mark class="'+cls.trim()+'">'+esc(m)+'</mark>'});if(count)count.textContent=s.matches.length?((s.active+1)+'/'+s.matches.length+' matches'):'0 matches';}document.querySelectorAll('.search').forEach(function(input){input.addEventListener('input',function(){var id=input.dataset.target;state[id].active=0;paint(id,input.value)})});document.querySelectorAll('[data-prev],[data-next]').forEach(function(btn){btn.addEventListener('click',function(){var id=btn.getAttribute('data-prev')||btn.getAttribute('data-next');var input=document.querySelector('[data-target="'+id+'"]');var s=state[id];if(!input||!s||!s.matches.length)return;s.active=(s.active+(btn.hasAttribute('data-prev')?-1:1)+s.matches.length)%s.matches.length;paint(id,input.value)})})})();</script></body></html>`;
}

export function CompassAiShell({ userEmail }: { userEmail: string }) {
  const [view, setView] = useState<AppView>("jobs");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scorecards, setScorecards] = useState<ScorecardLibrary | null>(null);
  const [selectedResultId, setSelectedResultId] = useState("");
  const [status, setStatus] = useState("Loading CompassAi...");
  const [cloudStatus, setCloudStatus] = useState("Not checked yet");
  const [cloudCheckedAt, setCloudCheckedAt] = useState("");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [mirrorText, setMirrorText] = useState("");
  const [mirrorLeads, setMirrorLeads] = useState<MirrorLead[]>([]);
  const [reportHtml, setReportHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [scorecardEditor, setScorecardEditor] = useState("");
  const [scorecardName, setScorecardName] = useState("");
  const [rubricRows, setRubricRows] = useState<RubricRow[]>([]);
  const [transcriptionModel, setTranscriptionModel] = useState(DEFAULT_TRANSCRIPTION_MODEL);
  const [qaModel, setQaModel] = useState(DEFAULT_QA_MODEL);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [editingScorecardId, setEditingScorecardId] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hoursSavedSeconds, setHoursSavedSeconds] = useState(0);
  const scorecardEditorRef = useRef<HTMLDivElement | null>(null);
  const scorecardNameInputRef = useRef<HTMLInputElement | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement | null>(null);

  const results = useMemo(() => jobs.flatMap((job) => job.results.map((result) => ({ job, result }))), [jobs]);
  const selected = results.find((item) => item.result.result_id === selectedResultId) ?? results[0];

  const updateLocation = useCallback((nextView: AppView, resultId = "", mode: "push" | "replace" = "push") => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextView);
    if (nextView === "review" && resultId) url.searchParams.set("result", resultId);
    else url.searchParams.delete("result");
    window.history[mode === "push" ? "pushState" : "replaceState"]({}, "", url);
  }, []);

  const focusReview = useCallback(() => {
    window.setTimeout(() => {
      reviewHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      reviewHeadingRef.current?.focus({ preventScroll: true });
    }, 60);
  }, []);

  const openReview = useCallback((resultId: string, mode: "push" | "replace" = "push") => {
    if (!results.some(({ result }) => result.result_id === resultId)) return;
    setSelectedResultId(resultId);
    setView("review");
    setSidebarOpen(false);
    updateLocation("review", resultId, mode);
    focusReview();
  }, [focusReview, results, updateLocation]);

  const navigateToView = useCallback((nextView: AppView, mode: "push" | "replace" = "push") => {
    if (nextView === "review" && results.length) {
      openReview(selectedResultId && results.some(({ result }) => result.result_id === selectedResultId) ? selectedResultId : results[0].result.result_id, mode);
      return;
    }
    setView(nextView);
    setSidebarOpen(false);
    updateLocation(nextView, "", mode);
  }, [openReview, results, selectedResultId, updateLocation]);

  function focusScorecardEditor() {
    window.setTimeout(() => {
      scorecardEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      scorecardNameInputRef.current?.focus({ preventScroll: true });
      scorecardNameInputRef.current?.select();
    }, 80);
  }

  const persistJobs = useCallback((next: Job[]) => {
    setJobs(next);
    window.localStorage.setItem(JOB_STORAGE, JSON.stringify(next));
  }, []);

  const persistScorecards = useCallback((next: ScorecardLibrary) => {
    const normalized = normalizeScorecardLibrary(next);
    setScorecards(normalized);
    window.localStorage.setItem(SCORECARD_STORAGE, JSON.stringify(normalized));
    setStatus(`Scorecard library saved: ${normalized.scorecards.length} scorecard(s).`);
  }, []);

  const refresh = useCallback(async () => {
    const stored = window.localStorage.getItem(JOB_STORAGE);
    if (stored) setJobs(JSON.parse(stored));
    const key = cleanApiKey(window.localStorage.getItem(OPENAI_KEY_STORAGE) ?? "");
    if (key) window.localStorage.setItem(OPENAI_KEY_STORAGE, key);
    setOpenaiApiKey(key);
    setApiKeyDraft(key);
    setTranscriptionModel(validTranscriptionModel(window.localStorage.getItem(TRANSCRIPTION_MODEL_STORAGE) || DEFAULT_TRANSCRIPTION_MODEL));
    setQaModel(validQaModel(window.localStorage.getItem(QA_MODEL_STORAGE) || DEFAULT_QA_MODEL));
    setTheme(window.localStorage.getItem(THEME_STORAGE) === "dark" ? "dark" : "light");
    setStatus(key ? "OpenAI key saved in this browser" : "Paste your OpenAI API key in Settings");
    setCloudStatus(key ? "Saved key; run connection test" : "No OpenAI key saved");
    setHydrated(true);
  }, []);

  useEffect(() => {
    refresh();
    fetch("/qa_scorecards.json")
      .then((response) => response.json())
      .then((library: ScorecardLibrary) => {
        const stored = window.localStorage.getItem(SCORECARD_STORAGE);
        setScorecards(normalizeScorecardLibrary(stored ? JSON.parse(stored) : library));
      })
      .catch((caught) => setError(`Scorecards failed to load: ${caught instanceof Error ? caught.message : String(caught)}`));
  }, [refresh]);

  useEffect(() => {
    if (!scorecards?.scorecards.length) return;
    const selected = scorecards.scorecards.find((entry) => entry.id === editingScorecardId) ?? activeScorecard(scorecards);
    setEditingScorecardId(selected?.id ?? "");
    setScorecardName(selected?.name ?? "");
    setRubricRows(rubricRowsFromEntry(selected));
    setScorecardEditor(JSON.stringify(selected?.bundle ?? {}, null, 2));
  }, [scorecards?.active_scorecard_id]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE, theme);
  }, [theme]);

  useEffect(() => {
    if (!hydrated) return;
    let stored: { seconds: number; resultIds: string[] } = { seconds: 0, resultIds: [] };
    try {
      const raw = window.localStorage.getItem(HOURS_SAVED_STORAGE);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<typeof stored> | null;
        if (parsed && typeof parsed === "object") {
          stored = {
            seconds: Number(parsed.seconds) || 0,
            resultIds: Array.isArray(parsed.resultIds) ? parsed.resultIds : [],
          };
        }
      }
    } catch {
      // Rebuild a damaged local counter from the completed results still in this browser.
    }
    const resultIds = new Set(Array.isArray(stored.resultIds) ? stored.resultIds : []);
    let seconds = Number.isFinite(stored.seconds) ? Math.max(0, stored.seconds) : 0;
    jobs.flatMap((job) => job.results).forEach((result) => {
      if (resultIds.has(result.result_id)) return;
      resultIds.add(result.result_id);
      seconds += Math.max(0, Number(result.duration_seconds) || 0);
    });
    const next = { seconds, resultIds: Array.from(resultIds) };
    window.localStorage.setItem(HOURS_SAVED_STORAGE, JSON.stringify(next));
    setHoursSavedSeconds(seconds);
  }, [hydrated, jobs]);

  useEffect(() => {
    if (!hydrated) return;
    const applyUrl = (replaceStale = false) => {
      const params = new URLSearchParams(window.location.search);
      const requestedView = params.get("view") as AppView | null;
      const validViews: AppView[] = ["jobs", "review", "scorecards", "mirrorcxt", "settings"];
      const nextView = requestedView && validViews.includes(requestedView) ? requestedView : "jobs";
      if (nextView === "review") {
        const requestedResult = params.get("result") || "";
        const match = results.find(({ result }) => result.result_id === requestedResult);
        const fallback = match ?? results[0];
        if (fallback) {
          setSelectedResultId(fallback.result.result_id);
          setView("review");
          if (!match && replaceStale) updateLocation("review", fallback.result.result_id, "replace");
          return;
        }
        setView("jobs");
        if (replaceStale) updateLocation("jobs", "", "replace");
        return;
      }
      setView(nextView);
    };
    applyUrl(true);
    const onPopState = () => applyUrl(true);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [hydrated, results, updateLocation]);

  async function upload() {
    if (!files?.length || !scorecards) return;
    if (!cleanApiKey(openaiApiKey)) {
      navigateToView("settings");
      setError("Paste and save your OpenAI API key before processing calls.");
      return;
    }
    const { unique: selectedFiles, duplicates: duplicateFiles } = splitDuplicateFiles(
      Array.from(files),
      jobs.flatMap((job) => job.results),
    );
    if (!selectedFiles.length) {
      setStatus(`Skipped ${duplicateFiles.length} duplicate file${duplicateFiles.length === 1 ? "" : "s"}. Nothing new was sent to OpenAI.`);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    const job: Job = {
      job_id: uuid(),
      status: "running",
      message: "Preparing recordings for cloud transcription...",
      progress: 0.02,
      percent: 2,
      elapsed_seconds: 0,
      eta_seconds: undefined,
      source_files: selectedFiles.map((file) => file.name),
      results: [],
    };
    let nextJobs = [job, ...jobs];
    persistJobs(nextJobs);
    const started = Date.now();
    try {
      for (const [index, file] of selectedFiles.entries()) {
        const update = (patch: Partial<Job>) => {
          const elapsed = Math.round((Date.now() - started) / 1000);
          const nextProgress = Math.max(0.01, Math.min(1, patch.progress ?? nextJobs.find((candidate) => candidate.job_id === job.job_id)?.progress ?? 0.01));
          const eta = nextProgress > 0.03 && nextProgress < 0.99 ? Math.max(1, Math.round((elapsed / nextProgress) - elapsed)) : patch.eta_seconds;
          nextJobs = nextJobs.map((candidate) =>
            candidate.job_id === job.job_id
              ? { ...candidate, ...patch, elapsed_seconds: elapsed, eta_seconds: eta }
              : candidate,
          );
          persistJobs(nextJobs);
        };
        update({
          message: `Transcribing ${file.name} (${index + 1} of ${selectedFiles.length})...`,
          progress: index / selectedFiles.length + 0.05,
          percent: Math.max(2, Math.round((index / selectedFiles.length) * 100)),
        });
        const transcriptPayload = await transcribeDirect(file, cleanApiKey(openaiApiKey), transcriptionModel);
        const gradingStarted = Date.now();
        const ruleAnalysis = makeRuleAnalysis(transcriptPayload.transcript, scorecards, transcriptPayload.duration);
        const localIdentity = transcriptIdentity(transcriptPayload.transcript);
        let qaIdentity = { ...localIdentity };
        let transfer = normalizeTransfer(undefined, transcriptPayload.transcript, transcriptPayload.duration);
        let rows = ruleAnalysis.rows;
        let source = transcriptPayload.chunked
          ? `OpenAI transcription via Vercel relay (${transcriptPayload.chunk_count} audio parts) + browser rule scanner`
          : "OpenAI transcription via Vercel relay + browser rule scanner";
        if (transcriptPayload.model_fallback) source += ` | ${transcriptPayload.model_fallback}`;
        let report = "";
        try {
          update({
            message: `Running QA review for ${file.name} (${index + 1} of ${selectedFiles.length})...`,
            progress: (index + 0.65) / selectedFiles.length,
            percent: Math.round(((index + 0.65) / selectedFiles.length) * 100),
          });
          const qa = await qaDirect(transcriptPayload.transcript, ruleAnalysis.entry, cleanApiKey(openaiApiKey), qaModel);
          qaIdentity = {
            agent_name: titleCaseName(qa.agent_name || localIdentity.agent_name),
            customer_name: titleCaseName(qa.customer_name || localIdentity.customer_name),
            customer_phone: qa.customer_phone || localIdentity.customer_phone,
          };
          transfer = normalizeTransfer(qa.transfer, transcriptPayload.transcript, transcriptPayload.duration);
          if (Array.isArray(qa.rows) && qa.rows.length) {
            rows = normalizeQaRows(qa.rows, ruleAnalysis.rows, transcriptPayload.transcript, transcriptPayload.duration);
            source = transcriptPayload.chunked
              ? `OpenAI transcription (${transcriptPayload.chunk_count} audio parts) + OpenAI QA via Vercel relay`
              : "OpenAI transcription + OpenAI QA via Vercel relay";
          }
        } catch (caught) {
          report = makeErrorReport("Cloud QA model request; browser rule scanner was used", caught, {
            model: qaModel,
            transcript_characters: transcriptPayload.transcript.length,
            scorecard: ruleAnalysis.entry.name,
          });
        }
        const result: JobResult = {
          result_id: uuid(),
          file_name: file.name,
          file_size_bytes: file.size,
          transcript_text: transcriptPayload.transcript,
          duration_seconds: transcriptPayload.duration,
          grading_seconds: Math.max(1, Math.round((Date.now() - gradingStarted) / 1000)),
          analysis: {
            client: ruleAnalysis.client,
            scorecard_name: ruleAnalysis.entry.name,
            source,
            rows,
            agent_name: qaIdentity.agent_name,
            customer_name: qaIdentity.customer_name,
            customer_phone: qaIdentity.customer_phone,
            transfer,
          },
          qa_overrides: editorRows(rows),
          metrics: metrics(rows),
          llm_error_report: report,
        };
        nextJobs = nextJobs.map((candidate) =>
          candidate.job_id === job.job_id
            ? {
                ...candidate,
                results: [...candidate.results, result],
                message: `Finished ${index + 1} of ${selectedFiles.length} recording(s).`,
                progress: (index + 1) / selectedFiles.length,
                percent: Math.round(((index + 1) / selectedFiles.length) * 100),
              }
            : candidate,
        );
        persistJobs(nextJobs);
      }
      nextJobs = nextJobs.map((candidate) =>
        candidate.job_id === job.job_id
          ? { ...candidate, status: "complete", message: `Completed ${selectedFiles.length} file(s)${duplicateFiles.length ? `; skipped ${duplicateFiles.length} duplicate(s)` : ""}.`, progress: 1, percent: 100, eta_seconds: 0 }
          : candidate,
      );
      persistJobs(nextJobs);
      setStatus(`Completed ${selectedFiles.length} file(s)${duplicateFiles.length ? ` and skipped ${duplicateFiles.length} duplicate(s)` : ""}.`);
    } catch (caught) {
      const report = makeErrorReport("Cloud transcription relay workflow", caught, { files: selectedFiles.map((file) => file.name).join(", ") });
      nextJobs = nextJobs.map((candidate) =>
        candidate.job_id === job.job_id ? { ...candidate, status: "failed", message: "Processing failed.", progress: 1, percent: 100, error_report: report } : candidate,
      );
      persistJobs(nextJobs);
      setError(report);
    } finally {
      setBusy(false);
    }
  }

  function removeJob(jobId: string) {
    persistJobs(jobs.filter((job) => job.job_id !== jobId));
  }

  function removeResult(jobId: string, resultId: string) {
    const next = jobs.flatMap((job) => {
      if (job.job_id !== jobId) return [job];
      const remaining = job.results.filter((result) => result.result_id !== resultId);
      return remaining.length || job.status !== "complete" ? [{ ...job, results: remaining }] : [];
    });
    persistJobs(next);
    if (selectedResultId === resultId) setSelectedResultId(next.flatMap((job) => job.results)[0]?.result_id ?? "");
  }

  function parseMirror(value = mirrorText) {
    const leads = parseMirrorText(value);
    setMirrorLeads(leads);
    setStatus(`Imported ${leads.length} MirrorCXT lead(s).`);
  }

  async function importMirrorFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setMirrorText(text);
    parseMirror(text);
  }

  async function importScorecardFile(file: File | null) {
    if (!file || !scorecards) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming: ScorecardEntry[] = Array.isArray(parsed.scorecards)
        ? parsed.scorecards
        : [{ id: parsed.id || parsed.name || file.name, name: parsed.name || parsed.bundle?.name || file.name, bundle: parsed.bundle ?? parsed }];
      persistScorecards({
        active_scorecard_id: incoming[0]?.id ?? scorecards.active_scorecard_id,
        scorecards: [...scorecards.scorecards, ...incoming],
      });
    } catch (caught) {
      setError(`Could not import scorecard JSON: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  function activateScorecard(scorecardId: string) {
    if (!scorecards) return;
    persistScorecards({ ...scorecards, active_scorecard_id: scorecardId });
  }

  function editScorecard(scorecardId: string) {
    const entry = scorecards?.scorecards.find((item) => item.id === scorecardId);
    if (!entry) return;
    navigateToView("scorecards");
    setEditingScorecardId(entry.id);
    setScorecardName(entry.name);
    setRubricRows(rubricRowsFromEntry(entry));
    setScorecardEditor(JSON.stringify(entry.bundle, null, 2));
    focusScorecardEditor();
  }

  function saveScorecardEdit(mode: "update" | "add") {
    if (!scorecards) return;
    try {
      const original = JSON.parse(scorecardEditor || "{}");
      const bundle = bundleFromRubricRows(original, scorecardName.trim() || original.name || "Unnamed scorecard", rubricRows);
      const entry: ScorecardEntry = {
        id: mode === "update" && editingScorecardId ? editingScorecardId : `${bundle.name || "scorecard"}-${Date.now()}`,
        name: scorecardName.trim() || bundle.name || "Unnamed scorecard",
        bundle,
      };
      const next = mode === "update"
        ? scorecards.scorecards.map((item) => (item.id === editingScorecardId ? entry : item))
        : [...scorecards.scorecards, entry];
      persistScorecards({ active_scorecard_id: entry.id, scorecards: next });
      setEditingScorecardId(entry.id);
      setScorecardEditor(JSON.stringify(bundle, null, 2));
    } catch (caught) {
      setError(`Could not save scorecard: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }

  function updateRubricRow(rowId: string, patch: Partial<RubricRow>) {
    setRubricRows((current) => current.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
  }

  function addRubricRow() {
    const previous = rubricRows.at(-1);
    setRubricRows((current) => [
      ...current,
      makeRubricRow(previous?.client_name || scorecardName || "", previous?.client_aliases || scorecardName || "", undefined, false),
    ]);
  }

  function duplicateRubricRow(row: RubricRow) {
    setRubricRows((current) => [...current, { ...row, id: uuid(), qualifier_name: `${row.qualifier_name} copy` }]);
  }

  function removeRubricRow(rowId: string) {
    setRubricRows((current) => (current.length > 1 ? current.filter((row) => row.id !== rowId) : current));
  }

  function deleteScorecard(scorecardId: string) {
    if (!scorecards || scorecards.scorecards.length <= 1) return;
    const next = scorecards.scorecards.filter((entry) => entry.id !== scorecardId);
    persistScorecards({ active_scorecard_id: next[0]?.id, scorecards: next });
  }

  function resetBundledScorecards() {
    fetch("/qa_scorecards.json")
      .then((response) => response.json())
      .then((library: ScorecardLibrary) => {
        window.localStorage.removeItem(SCORECARD_STORAGE);
        setScorecards(normalizeScorecardLibrary(library));
        setStatus("Restored bundled scorecards.");
      })
      .catch((caught) => setError(`Could not restore bundled scorecards: ${caught instanceof Error ? caught.message : String(caught)}`));
  }

  function exportReport() {
    const html = makeReport(results.map((item) => item.result), mirrorLeads);
    setReportHtml(html);
    setStatus("Report generated in browser.");
  }

  function saveOpenAiKey() {
    const trimmed = cleanApiKey(apiKeyDraft);
    window.localStorage.setItem(OPENAI_KEY_STORAGE, trimmed);
    setOpenaiApiKey(trimmed);
    setApiKeyDraft(trimmed);
    setStatus(trimmed ? "OpenAI key saved in this browser" : "Paste your OpenAI API key in Settings");
    setCloudStatus(trimmed ? "Saved key; run connection test" : "No OpenAI key saved");
    setError("");
  }

  function clearOpenAiKey() {
    window.localStorage.removeItem(OPENAI_KEY_STORAGE);
    setApiKeyDraft("");
    setOpenaiApiKey("");
    setStatus("Paste your OpenAI API key in Settings");
    setCloudStatus("No OpenAI key saved");
  }

  function saveModelSettings() {
    const savedTranscriptionModel = validTranscriptionModel(transcriptionModel);
    const savedQaModel = validQaModel(qaModel);
    window.localStorage.setItem(TRANSCRIPTION_MODEL_STORAGE, savedTranscriptionModel);
    window.localStorage.setItem(QA_MODEL_STORAGE, savedQaModel);
    setTranscriptionModel(savedTranscriptionModel);
    setQaModel(savedQaModel);
    setStatus(`Model settings saved: ${savedTranscriptionModel} transcription, ${savedQaModel} QA.`);
  }

  async function testOpenAiConnection() {
    const key = cleanApiKey(openaiApiKey);
    if (!key) {
      setCloudStatus("No OpenAI key saved");
      navigateToView("settings");
      return;
    }
    setCloudStatus("Checking OpenAI relay...");
    setCloudCheckedAt(new Date().toLocaleTimeString());
    try {
      const response = await fetch("/api/openai/chat", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: qaModel || DEFAULT_QA_MODEL,
          messages: [{ role: "user", content: "Reply with OK only." }],
          max_tokens: 5,
        }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 260)}`);
      setCloudStatus(`Online: ${qaModel || DEFAULT_QA_MODEL} responded through CompassAi relay`);
      setError("");
    } catch (caught) {
      if ((qaModel || DEFAULT_QA_MODEL) !== DEFAULT_QA_MODEL) {
        try {
          const fallback = await fetch("/api/openai/chat", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: DEFAULT_QA_MODEL,
              messages: [{ role: "user", content: "Reply with OK only." }],
              max_tokens: 5,
            }),
          });
          if (fallback.ok) {
            setCloudStatus(`Online with fallback: ${DEFAULT_QA_MODEL}. Selected model failed.`);
            setError(makeErrorReport("Cloud LLM selected-model check", caught, { selected_model: qaModel, fallback_model: DEFAULT_QA_MODEL }));
            return;
          }
        } catch {
          // Preserve the original selected-model error below.
        }
      }
      const report = makeErrorReport("Cloud LLM live connection check", caught, { selected_model: qaModel || DEFAULT_QA_MODEL });
      setCloudStatus("Offline or rejected by OpenAI relay");
      setError(report);
    }
  }

  function clearJobs() {
    persistJobs([]);
    setSelectedResultId("");
    setReportHtml("");
    navigateToView("jobs", "replace");
  }

  const navItems: { id: AppView; label: string; icon: typeof AudioLines }[] = [
    { id: "jobs", label: "Jobs", icon: AudioLines },
    { id: "review", label: "Review", icon: ClipboardCheck },
    { id: "scorecards", label: "Scorecards", icon: Library },
    { id: "mirrorcxt", label: "MirrorCXT", icon: Users },
    { id: "settings", label: "Settings", icon: Settings },
  ];
  const viewMeta: Record<AppView, { title: string; description: string }> = {
    jobs: { title: "Call processing", description: "Upload recordings, monitor live progress, and open completed QA reviews." },
    review: { title: "QA review", description: "Verify evidence, adjust qualifier decisions, and finalize each call." },
    scorecards: { title: "Scorecard library", description: "Manage client detection and build plain-language grading rubrics." },
    mirrorcxt: { title: "MirrorCXT matching", description: "Import saved leads to add customer context and Clover links to matching calls." },
    settings: { title: "Workspace settings", description: "Manage appearance, cloud AI access, models, and browser-stored data." },
  };

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`app-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="brand">
          <img src="/logo512.png" alt="" />
          <div>
            <h1>CompassAi</h1>
            <span className="version-label">Version {APP_VERSION}</span>
            <p>{userEmail}</p>
          </div>
          <button className="icon-button sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        </div>
        <nav className="app-nav" aria-label="Workspace navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} data-testid={`nav-${id}`} className={view === id ? "active" : ""} onClick={() => navigateToView(id)}>
              <Icon size={18} />
              <span>{label}</span>
              {id === "review" && results.length > 0 && <small>{results.length}</small>}
            </button>
          ))}
        </nav>
        <section className="side-card status-card">
          <div className="side-card-title"><Bot size={16} /><span>Cloud LLM</span></div>
          <strong>{cloudStatus}</strong>
          {cloudCheckedAt && <p>Last checked {cloudCheckedAt}</p>}
          <button onClick={testOpenAiConnection} disabled={busy || !cleanApiKey(openaiApiKey)}><RefreshCw size={15} /> Test connection</button>
        </section>
        <section className="side-card status-card">
          <div className="side-card-title"><ShieldCheck size={16} /><span>Scorecards</span></div>
          <strong>{scorecards?.scorecards.length ?? 0} loaded</strong>
          <p>{scorecards?.required_clients_available ? "Required client library ready." : "Required client check pending."}</p>
        </section>
        <section className="side-card hours-saved-card" title="One hour is credited for each hour of completed call audio processed by CompassAi.">
          <div className="side-card-title"><Clock3 size={16} /><span>Time saved</span></div>
          <strong>Hours saved, using CompassAi: {(hoursSavedSeconds / 3600).toFixed(1)}</strong>
          <p>Saved only in this browser.</p>
        </section>
      </aside>
      <main>
        <header className="topbar">
          <button className="icon-button menu-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <div>
            <span className="eyebrow">CompassAi QA workstation</span>
            <h2>{viewMeta[view].title}</h2>
            <p>{viewMeta[view].description}</p>
          </div>
          <button className="topbar-action" onClick={refresh} disabled={busy}><RefreshCw size={16} /> Refresh</button>
        </header>
        {status && <div className="notice status-notice" role="status"><CheckCircle2 size={17} /><span>{status}</span></div>}
        {error && <div className="notice error">{error}</div>}
        {view === "jobs" && (
          <>
            <section className="panel upload-panel">
              <div className="section-heading">
                <div className="section-icon"><Upload size={20} /></div>
                <div><h3>Add recordings</h3><p>Choose one or more audio or video files. Each call is detected and graded independently.</p></div>
              </div>
              <div className="drop">
                <input aria-label="Choose call recordings" type="file" multiple accept="audio/*,video/*" onChange={(event) => setFiles(event.target.files)} />
                <button className="primary" disabled={busy || !files?.length || !cleanApiKey(openaiApiKey)} onClick={upload}>
                  <AudioLines size={17} /> {busy ? "Processing calls..." : "Upload and process"}
                </button>
              </div>
              {!cleanApiKey(openaiApiKey) && <button className="inline-notice" onClick={() => navigateToView("settings")}>Add your OpenAI API key in Settings before uploading recordings.</button>}
            </section>
            <JobList
              jobs={jobs}
              selectedResultId={selectedResultId}
              openReview={openReview}
              removeJob={removeJob}
              removeResult={removeResult}
              mirrorLeads={mirrorLeads}
              clearJobs={clearJobs}
              busy={busy}
            />
            <section className="panel report-workspace">
              <div className="section-heading report-heading">
                <div className="section-icon"><FileOutput size={20} /></div>
                <div><h3>Final report</h3><p>{results.length} completed call(s) available for the styled batch report.</p></div>
                <button className="primary" disabled={!results.length || busy} onClick={exportReport}><FileOutput size={17} /> Generate report</button>
              </div>
              {reportHtml && <div className="report-actions"><a className="download-link" download={`CompassAi_QA_Report_${new Date().toISOString().slice(0, 10)}.html`} href={`data:text/html;charset=utf-8,${encodeURIComponent(reportHtml)}`}><Download size={16} /> Download styled HTML report</a></div>}
              {reportHtml && <iframe title="CompassAi report preview" srcDoc={reportHtml} />}
            </section>
          </>
        )}
        {view === "review" && (
          <ReviewPanel
            item={selected}
            allResults={results}
            select={openReview}
            headingRef={reviewHeadingRef}
            persistJobs={persistJobs}
            jobs={jobs}
            setError={setError}
            mirrorLeads={mirrorLeads}
          />
        )}
        {view === "scorecards" && (
          <section className="panel screen-panel scorecard-screen">
            <div className="panel-title">
              <div>
                <span className="eyebrow">Rubric manager</span>
                <h3>Client scorecards</h3>
                <p>Build and edit scorecards with plain-language qualifier rows. Changes are saved in this browser.</p>
              </div>
              <button onClick={resetBundledScorecards} disabled={busy}><RefreshCw size={16} /> Restore bundled</button>
            </div>
            <div className="scorecard-tools">
              <label>Active scorecard
                <select value={scorecards?.active_scorecard_id ?? ""} onChange={(event) => activateScorecard(event.target.value)}>
                  {scorecards?.scorecards.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </label>
              <label>Import scorecard JSON/library
                <input type="file" accept=".json,application/json" onChange={(event) => importScorecardFile(event.target.files?.[0] ?? null)} />
              </label>
              {scorecards && (
                <a className="download-link" download="compassai_scorecards.json" href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(scorecards, null, 2))}`}>
                  <Download size={16} /> Download library
                </a>
              )}
            </div>
            <div className="scorecard-layout">
              <div className="scorecard-library">
                <div className="subsection-heading"><div><h4>Library</h4><p>{scorecards?.scorecards.length ?? 0} available scorecards</p></div></div>
                <div className="scorecard-list">
                {scorecards?.scorecards.map((entry) => (
                  <article key={entry.id} className={entry.id === editingScorecardId ? "selected" : ""}>
                    <div>
                      <strong>{entry.name}</strong>
                      <p>{scorecardSummary(entry)}</p>
                      {entry.id === scorecards.active_scorecard_id && <span className="pill">Active</span>}
                    </div>
                    <div className="button-row">
                      <button onClick={() => activateScorecard(entry.id)}>Use</button>
                      <button onClick={() => editScorecard(entry.id)}>Edit</button>
                      <button onClick={() => deleteScorecard(entry.id)} disabled={scorecards.scorecards.length <= 1}>Delete</button>
                    </div>
                  </article>
                ))}
                </div>
              </div>
              <div className="scorecard-editor" ref={scorecardEditorRef} tabIndex={-1}>
                <div className="subsection-heading"><div><h4>{editingScorecardId ? "Edit scorecard" : "Add scorecard"}</h4><p>Define client detection and grading expectations.</p></div></div>
                <div className="rubric-header">
                  <label>Scorecard name
                    <input ref={scorecardNameInputRef} value={scorecardName} onChange={(event) => setScorecardName(event.target.value)} placeholder="Feldco" />
                  </label>
                  <button onClick={addRubricRow}>Add qualifier row</button>
                </div>
                <p className="hint">Use semicolons between phrases. Example: <strong>homeowner; I own the home; yes, I own it</strong>. Common mishears can use <strong>wrong phrase -&gt; correct phrase</strong>.</p>
                <div className="rubric-table-wrap">
                  <table className="rubric-table">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th>Aliases</th>
                        <th>Qualifier</th>
                        <th>Counts as pass</th>
                        <th>Counts as fail</th>
                        <th>Critical</th>
                        <th>Common mishears</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rubricRows.map((row) => (
                        <tr key={row.id}>
                          <td><input value={row.client_name} onChange={(event) => updateRubricRow(row.id, { client_name: event.target.value })} placeholder="Feldco" /></td>
                          <td><textarea value={row.client_aliases} onChange={(event) => updateRubricRow(row.id, { client_aliases: event.target.value })} placeholder="Feldco; Feldco Windows" /></td>
                          <td><input value={row.qualifier_name} onChange={(event) => updateRubricRow(row.id, { qualifier_name: event.target.value })} placeholder="Homeowner confirmed" /></td>
                          <td><textarea value={row.what_counts_as_pass} onChange={(event) => updateRubricRow(row.id, { what_counts_as_pass: event.target.value })} placeholder="homeowner; I own the home" /></td>
                          <td><textarea value={row.what_counts_as_fail} onChange={(event) => updateRubricRow(row.id, { what_counts_as_fail: event.target.value })} placeholder="renter; tenant; not the owner" /></td>
                          <td className="critical-cell"><input type="checkbox" checked={row.critical} onChange={(event) => updateRubricRow(row.id, { critical: event.target.checked })} /></td>
                          <td><textarea value={row.common_mishears} onChange={(event) => updateRubricRow(row.id, { common_mishears: event.target.value })} placeholder="corded line -> recorded line" /></td>
                          <td>
                            <div className="mini-actions">
                              <button onClick={() => duplicateRubricRow(row)}>Duplicate</button>
                              <button onClick={() => removeRubricRow(row.id)} disabled={rubricRows.length <= 1}>Remove</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <details>
                  <summary>Advanced JSON</summary>
                  <textarea value={scorecardEditor} onChange={(event) => setScorecardEditor(event.target.value)} spellCheck={false} />
                </details>
                <div className="button-row">
                  <button className="primary" onClick={() => saveScorecardEdit("update")} disabled={!editingScorecardId}>Save selected</button>
                  <button onClick={() => saveScorecardEdit("add")}>Save as new</button>
                </div>
              </div>
            </div>
          </section>
        )}
        {view === "mirrorcxt" && (
          <section className="panel screen-panel mirror-screen">
            <div className="panel-title"><div><span className="eyebrow">Lead context</span><h3>MirrorCXT import</h3><p>Match saved leads to completed calls using customer names and phone numbers.</p></div></div>
            <p className="hint">
              Upload a MirrorCXT HTML export before or after transcribing. CompassAi matches saved leads to calls by phone/name and then shows the Clover link, customer details, and relevant lead info in review queues and exported reports.
            </p>
            <label className="file-drop"><Upload size={22} /><span>Upload MirrorCXT HTML export</span>
              <input type="file" accept=".html,.htm,.txt,text/html,text/plain" onChange={(event) => importMirrorFile(event.target.files?.[0] ?? null)} />
            </label>
            <div className="import-summary"><div><span>Imported leads</span><strong>{mirrorLeads.length}</strong></div><div><span>Clover links</span><strong>{mirrorLeads.filter((lead) => lead.clover_url).length}</strong></div><div><span>Matched calls</span><strong>{results.filter(({ result }) => callMeta(result, mirrorLeads).clover).length}</strong></div></div>
            <div className="mirror-list">
              {mirrorLeads.map((lead) => (
                <article key={lead.id}>
                  <strong>{lead.disposition || "MirrorCXT lead"}</strong>
                  <p>{lead.label}</p>
                  {lead.phone && <small>{lead.phone}</small>}
                  {lead.clover_url && <a href={lead.clover_url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open Clover</a>}
                </article>
              ))}
            </div>
          </section>
        )}
        {view === "settings" && (
          <section className="panel screen-panel settings-screen">
            <div className="panel-title"><div><span className="eyebrow">Preferences</span><h3>Workspace settings</h3><p>Settings and sensitive credentials remain stored in this browser.</p></div></div>
            <div className="settings-sections">
            <div className="api-key-box setting-card">
              <div className="setting-card-title">{theme === "dark" ? <Moon size={19} /> : <Sun size={19} />}<div><h4>Appearance</h4><p>Choose your preferred workspace theme.</p></div></div>
              <label>Color theme
                <select value={theme} onChange={(event) => setTheme(event.target.value === "dark" ? "dark" : "light")}>
                  <option value="light">Light mode</option>
                  <option value="dark">Dark mode</option>
                </select>
              </label>
            </div>
            <div className="api-key-box setting-card">
              <div className="setting-card-title"><ShieldCheck size={19} /><div><h4>OpenAI access</h4><p>Connect transcription and QA through your API key.</p></div></div>
              <label>
                OpenAI API key
                <input type="password" value={apiKeyDraft} onChange={(event) => setApiKeyDraft(event.target.value)} placeholder="sk-..." autoComplete="off" />
              </label>
              <div className="button-row">
                <button className="primary" onClick={saveOpenAiKey}>Save key in this browser</button>
                <button onClick={clearOpenAiKey}>Clear key</button>
                <button onClick={testOpenAiConnection} disabled={!cleanApiKey(openaiApiKey)}>Test OpenAI connection</button>
              </div>
              <p className="hint">Your key stays in this browser's local storage. CompassAi sends it only to its same-origin Vercel relay for OpenAI transcription and QA.</p>
            </div>
            <div className="api-key-box setting-card">
              <div className="setting-card-title"><Bot size={19} /><div><h4>AI models</h4><p>Select preferred cloud models with automatic fallback.</p></div></div>
              <label>Transcription model
                <select value={transcriptionModel} onChange={(event) => setTranscriptionModel(event.target.value)}>
                  {TRANSCRIPTION_MODELS.map((model) => <option key={model}>{model}</option>)}
                </select>
              </label>
              <label>QA model:
                <select value={qaModel} onChange={(event) => setQaModel(event.target.value)}>
                  {QA_MODELS.map((model) => <option key={model}>{model}</option>)}
                </select>
              </label>
              <div className="button-row">
                <button className="primary" onClick={saveModelSettings}>Save model settings</button>
              </div>
              <p className="hint">If a selected transcription model is unavailable, CompassAi automatically falls back to {DEFAULT_TRANSCRIPTION_MODEL}. Use Test OpenAI connection to confirm the cloud QA model and API key are working.</p>
            </div>
            <div className="api-key-box setting-card browser-data-card">
              <div className="setting-card-title"><Trash2 size={19} /><div><h4>Browser data</h4><p>Jobs, scorecard edits, and preferences are stored locally in this browser.</p></div></div>
              <button onClick={clearJobs} disabled={busy || !jobs.length}><Trash2 size={16} /> Clear local jobs and reports</button>
            </div>
            </div>
            <div className="settings-grid">
              <div><strong>Web based, CompassAi</strong><p>No downloads, quick, secure, quality.</p></div>
              <div><strong>{transcriptionModel}</strong><p>Used for audio transcription through CompassAi's same-origin relay.</p></div>
              <div><strong>{qaModel}</strong><p>Used for QA grading, evidence review, and context interpretation.</p></div>
              <div><span>Cloud LLM Status</span><strong>{cloudStatus}</strong><p>{cloudCheckedAt ? `Last checked ${cloudCheckedAt}.` : "Use Test OpenAI connection for live API status."}</p></div>
              <div><span>Appearance</span><strong>{theme === "dark" ? "Dark mode" : "Light mode"}</strong><p>Saved locally for this browser.</p></div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function JobList({
  jobs,
  selectedResultId,
  openReview,
  removeJob,
  removeResult,
  mirrorLeads,
  clearJobs,
  busy,
}: {
  jobs: Job[];
  selectedResultId: string;
  openReview: (id: string) => void;
  removeJob: (id: string) => void;
  removeResult: (jobId: string, resultId: string) => void;
  mirrorLeads: MirrorLead[];
  clearJobs: () => void;
  busy: boolean;
}) {
  const processing = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const failed = jobs.filter((job) => job.status === "failed");
  const completed = jobs.flatMap((job) => job.results.map((result) => ({ job, result })));

  return (
    <div className="job-workspace">
      {processing.length > 0 && (
        <section className="panel queue-section" aria-labelledby="processing-heading">
          <div className="section-heading compact">
            <div className="section-icon live"><Gauge size={19} /></div>
            <div><h3 id="processing-heading">Processing</h3><p>{processing.length} active batch{processing.length === 1 ? "" : "es"}</p></div>
          </div>
          <div className="processing-list">
            {processing.map((job) => (
              <article key={job.job_id} className="job-card processing-card">
                <div className="job-head">
                  <div><span className="status-chip running">{job.status}</span><strong>{job.message}</strong></div>
                  <button className="icon-button danger-button" aria-label="Remove processing job" title="Remove job" onClick={() => removeJob(job.job_id)}><Trash2 size={17} /></button>
                </div>
                <div className="progress-row"><progress value={job.progress} max={1} /><strong>{job.percent}%</strong></div>
                <div className="job-metrics">
                  <span><Clock3 size={15} /> Elapsed <strong>{fmtSeconds(job.elapsed_seconds)}</strong></span>
                  <span><Gauge size={15} /> ETA <strong>{job.eta_seconds ? fmtSeconds(job.eta_seconds) : "Calculating"}</strong></span>
                  <span><FileAudio size={15} /> Files <strong>{job.results.length}/{job.source_files?.length ?? job.results.length}</strong></span>
                </div>
                <div className="source-files">{(job.source_files ?? []).map((file) => <small key={file}>{file}</small>)}</div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="panel queue-section" aria-labelledby="completed-heading">
        <div className="section-heading compact queue-heading">
          <div className="section-icon"><CheckCircle2 size={19} /></div>
          <div><h3 id="completed-heading">Completed calls</h3><p>{completed.length} call{completed.length === 1 ? "" : "s"} ready to review</p></div>
          <button onClick={clearJobs} disabled={busy || !jobs.length}><Trash2 size={16} /> Clear all</button>
        </div>
        {completed.length === 0 ? (
          <div className="empty-state"><FileAudio size={28} /><strong>No completed calls yet</strong><p>Processed calls will appear here as individual QA cards.</p></div>
        ) : (
          <div className="completed-grid">
            {completed.map(({ job, result }) => {
              const meta = callMeta(result, mirrorLeads);
              const score = result.metrics?.qa_score ?? 0;
              const outcome = result.metrics?.outcome || "Needs review";
              return (
                <article key={result.result_id} data-testid={`completed-call-${result.result_id}`} className={`completed-card ${selectedResultId === result.result_id ? "selected" : ""}`}>
                  <button className="completed-card-main" onClick={() => openReview(result.result_id)} aria-label={`Review QA for ${result.file_name}`}>
                    <div className="completed-card-top">
                      <span className={`score-orb ${score >= 80 ? "pass" : score >= 60 ? "review" : "fail"}`}>{score}%</span>
                      <div className="completed-title"><strong>{result.file_name}</strong><span>{result.analysis.client || "Unknown client"} · {result.analysis.scorecard_name || "No scorecard"}</span></div>
                      <ChevronRight size={20} />
                    </div>
                    <div className="card-tags"><span>{outcome}</span>{meta.clover && <span className="matched">Clover matched</span>}</div>
                    <dl className="call-facts">
                      <div><dt>Agent</dt><dd>{meta.agent || "Not detected"}</dd></div>
                      <div><dt>Customer</dt><dd>{meta.customer || "Not matched"}</dd></div>
                      <div><dt>Phone</dt><dd>{meta.phone ? formatPhone(meta.phone) : "Not matched"}</dd></div>
                      <div><dt>Call time</dt><dd>{fmtSeconds(result.duration_seconds)}</dd></div>
                      <div><dt>Grading</dt><dd>{fmtSeconds(result.grading_seconds)}</dd></div>
                    </dl>
                    <span className="review-cta">Review QA <ChevronRight size={16} /></span>
                  </button>
                  <div className="completed-card-actions">
                    {meta.clover && <a href={meta.clover} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open Clover</a>}
                    <button className="text-danger" onClick={() => removeResult(job.job_id, result.result_id)}><Trash2 size={15} /> Remove</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {failed.length > 0 && (
        <section className="panel queue-section" aria-labelledby="failed-heading">
          <div className="section-heading compact"><div className="section-icon failed"><X size={19} /></div><div><h3 id="failed-heading">Failed</h3><p>{failed.length} job{failed.length === 1 ? "" : "s"} need attention</p></div></div>
          <div className="processing-list">{failed.map((job) => <article key={job.job_id} className="job-card failed-card"><div className="job-head"><strong>{job.message}</strong><button onClick={() => removeJob(job.job_id)}><Trash2 size={15} /> Remove</button></div>{job.error_report && <textarea className="error-report" readOnly value={job.error_report} />}</article>)}</div>
        </section>
      )}
    </div>
  );
}

function ReviewPanel({
  item,
  allResults,
  select,
  headingRef,
  jobs,
  persistJobs,
  setError,
  mirrorLeads,
}: {
  item?: { job: Job; result: JobResult };
  allResults: { job: Job; result: JobResult }[];
  select: (id: string) => void;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  jobs: Job[];
  persistJobs: (jobs: Job[]) => void;
  setError: (message: string) => void;
  mirrorLeads: MirrorLead[];
}) {
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [finalGrade, setFinalGrade] = useState("Approved");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const [mobileTab, setMobileTab] = useState<"checks" | "transcript">("checks");
  const [savedAt, setSavedAt] = useState("");

  useEffect(() => {
    setRows(item?.result.qa_overrides ?? []);
    setFinalGrade(item?.result.metrics?.final_grade ?? "Approved");
    setNote(item?.result.analysis?.notes ?? "");
    setSearch("");
    setActive(0);
    setMobileTab("checks");
    setSavedAt("");
  }, [item?.result.result_id]);

  const matches = useMemo(() => {
    if (!item || !search.trim()) return [] as number[];
    const haystack = item.result.transcript_text.toLowerCase();
    const needle = search.toLowerCase();
    const positions = [];
    let index = 0;
    while ((index = haystack.indexOf(needle, index)) >= 0) {
      positions.push(index);
      index += Math.max(needle.length, 1);
    }
    return positions;
  }, [item, search]);

  const dirty = Boolean(item) && (
    JSON.stringify(rows) !== JSON.stringify(item?.result.qa_overrides ?? [])
    || finalGrade !== (item?.result.metrics?.final_grade ?? "Approved")
    || note !== (item?.result.analysis?.notes ?? "")
  );

  function reset() {
    if (!item) return;
    setRows(item.result.qa_overrides ?? []);
    setFinalGrade(item.result.metrics?.final_grade ?? "Approved");
    setNote(item.result.analysis?.notes ?? "");
    setSavedAt("");
  }

  function save() {
    if (!item) return;
    try {
      const updatedJobs = jobs.map((job) => {
        if (job.job_id !== item.job.job_id) return job;
        return {
          ...job,
          results: job.results.map((result) =>
            result.result_id === item.result.result_id ? applyOverrides({ ...result, analysis: { ...result.analysis, notes: note } }, rows, finalGrade) : result,
          ),
        };
      });
      persistJobs(updatedJobs);
      setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  if (!item) return <section className="panel"><h3>QA review</h3><p>No completed calls yet.</p></section>;
  const result = item.result;
  const meta = callMeta(result, mirrorLeads);
  const selectedIndex = Math.max(0, allResults.findIndex(({ result: candidate }) => candidate.result_id === result.result_id));
  const previous = allResults[selectedIndex - 1]?.result;
  const next = allResults[selectedIndex + 1]?.result;
  return (
    <section className="review-workstation">
      <aside className="review-rail" aria-label="Completed calls">
        <div className="review-rail-head">
          <div><strong>Review queue</strong><span>{selectedIndex + 1} of {allResults.length}</span></div>
          <div className="rail-nav"><button className="icon-button" aria-label="Previous call" disabled={!previous} onClick={() => previous && select(previous.result_id)}><ChevronLeft size={17} /></button><button className="icon-button" aria-label="Next call" disabled={!next} onClick={() => next && select(next.result_id)}><ChevronRight size={17} /></button></div>
        </div>
        <div className="review-call-list">
          {allResults.map(({ result: candidate }) => {
            const details = callMeta(candidate, mirrorLeads);
            return (
              <button key={candidate.result_id} data-testid={`review-call-${candidate.result_id}`} className={candidate.result_id === result.result_id ? "active" : ""} onClick={() => select(candidate.result_id)}>
                <div><strong>{candidate.file_name}</strong><span className="rail-score">{candidate.metrics?.qa_score ?? 0}%</span></div>
                <span>{candidate.analysis.client || "Unknown"} · {candidate.analysis.scorecard_name || "No scorecard"}</span>
                <small>{candidate.metrics?.outcome || "Needs review"}{details.clover ? " · Clover matched" : ""}</small>
              </button>
            );
          })}
        </div>
      </aside>

      <div className="review-main">
        <div className="review-toolbar">
          <div className="review-identity">
            <span className="eyebrow">Selected call</span>
            <h3 ref={headingRef} tabIndex={-1} data-testid="review-heading">{result.file_name}</h3>
            <p>{result.analysis.client || "Unknown client"} · {result.analysis.scorecard_name || "No scorecard"} · {result.analysis.source}</p>
          </div>
          <div className="review-toolbar-actions">
            <span className={`save-state ${dirty ? "dirty" : ""}`}>{dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt}` : "All changes saved"}</span>
            <label className="grade-control">Final grade<select value={finalGrade} onChange={(event) => setFinalGrade(event.target.value)}>{["Approved", "Needs coaching", "Reject / no credit", "Needs second review"].map((grade) => <option key={grade}>{grade}</option>)}</select></label>
            <button onClick={reset} disabled={!dirty}>Reset</button>
            <button className="primary" data-testid="save-qa-overrides" onClick={save} disabled={!dirty}>Save overrides</button>
          </div>
        </div>

        <div className="review-summary">
          <div><span>QA score</span><strong>{result.metrics?.qa_score ?? 0}%</strong></div>
          <div><span>Outcome</span><strong>{result.metrics?.outcome || "Needs review"}</strong></div>
          <div><span>Agent</span><strong>{meta.agent || "Not detected"}</strong></div>
          <div><span>Customer</span><strong>{meta.customer || "Not matched"}</strong></div>
          <div><span>Phone</span><strong>{meta.phone ? formatPhone(meta.phone) : "Not matched"}</strong></div>
          {meta.clover && <a href={meta.clover} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open Clover</a>}
        </div>

        {result.llm_error_report && <textarea className="error-report" readOnly value={result.llm_error_report} />}
        <div className="mobile-review-tabs" role="tablist" aria-label="Review content">
          <button role="tab" data-testid="review-tab-checks" aria-selected={mobileTab === "checks"} className={mobileTab === "checks" ? "active" : ""} onClick={() => setMobileTab("checks")}>QA checks</button>
          <button role="tab" data-testid="review-tab-transcript" aria-selected={mobileTab === "transcript"} className={mobileTab === "transcript" ? "active" : ""} onClick={() => setMobileTab("transcript")}>Transcript</button>
        </div>
        <div className="review-grid">
          <div className={`qa-pane ${mobileTab === "checks" ? "mobile-active" : ""}`}>
            <div className="pane-heading"><div><h4>QA checks</h4><p>{rows.length} qualifier{rows.length === 1 ? "" : "s"}</p></div></div>
            <div className="qa-table-wrap">
              <table>
                <thead><tr><th>Qualifier</th><th>System</th><th>Final</th><th>Time</th><th>Evidence</th><th>Reviewer note</th></tr></thead>
                <tbody>{rows.map((row, index) => (
                  <tr key={`${row.Qualifier}-${index}`}>
                    <td><strong>{row.Qualifier}</strong><small>{row.Category}</small></td>
                    <td><span className="pill">{row["System status"]}</span></td>
                    <td><select value={row["Final status"]} onChange={(event) => setRows((current) => current.map((r, i) => i === index ? { ...r, "Final status": event.target.value } : r))}>{["Pass", "Fail", "Needs review", "Not applicable"].map((status) => <option key={status}>{status}</option>)}</select></td>
                    <td><div className="evidence-time"><input value={row.Time} onChange={(event) => setRows((current) => current.map((r, i) => i === index ? { ...r, Time: event.target.value } : r))} />{isPostTransfer(row.Time, result.analysis.transfer) && <span className="post-transfer-badge"><TriangleAlert size={13} /> Post-Transfer</span>}</div></td>
                    <td><textarea value={row.Evidence} onChange={(event) => setRows((current) => current.map((r, i) => i === index ? { ...r, Evidence: event.target.value } : r))} /></td>
                    <td><textarea value={row["Reviewer note"]} onChange={(event) => setRows((current) => current.map((r, i) => i === index ? { ...r, "Reviewer note": event.target.value } : r))} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
          <section className={`transcript-panel ${mobileTab === "transcript" ? "mobile-active" : ""}`}>
            <div className="pane-heading transcript-heading"><div><h4>Transcript</h4><p>{fmtSeconds(result.duration_seconds)} call time</p></div></div>
            <div className="searchbar"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transcript" /><button disabled={!matches.length} onClick={() => setActive((active + matches.length - 1) % matches.length)}>Previous</button><button disabled={!matches.length} onClick={() => setActive((active + 1) % matches.length)}>Next</button><span>{matches.length ? `${active + 1}/${matches.length}` : "0 matches"}</span></div>
            {result.analysis.transfer?.occurred && <div className="transfer-alert"><ArrowRightLeft size={18} /><div><strong>{result.analysis.transfer.status}</strong><span>{result.analysis.transfer.snippet || result.analysis.transfer.notes || "The AI identified a call handoff."}</span></div></div>}
            {freeAlerts(result.transcript_text).map((alert) => <div className="free-alert" key={alert}>{alert}</div>)}
            <pre>{highlight(result.transcript_text, search, active)}</pre>
          </section>
        </div>
        <div className="review-footer"><label>Overall reviewer note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Coaching notes, override reasoning, or follow-up needed..." /></label></div>
      </div>
    </section>
  );
}

function highlight(text: string, needle: string, active: number) {
  if (!needle.trim()) return text;
  const lower = text.toLowerCase();
  const search = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let match = 0;
  let index = lower.indexOf(search);
  while (index >= 0) {
    if (index > cursor) parts.push(text.slice(cursor, index));
    parts.push(<mark className={match === active ? "active" : ""} key={`${index}-${match}`}>{text.slice(index, index + needle.length)}</mark>);
    cursor = index + needle.length;
    match += 1;
    index = lower.indexOf(search, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
