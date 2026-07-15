"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ScorecardRule = {
  name: string;
  type?: string | null;
  positive_patterns?: string[];
  negative_patterns?: string[];
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
type JobResult = {
  result_id: string;
  file_name: string;
  label?: string;
  transcript_text: string;
  analysis: { client?: string; source?: string; scorecard_name?: string; rows?: AnalysisRow[]; notes?: string };
  qa_overrides?: EditorRow[];
  metrics?: { qa_score: number; passed_count: number; total_count: number; outcome: string; final_grade: string };
  llm_error_report?: string;
  duration_seconds?: number;
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
const SCORECARD_STORAGE = "compassai.scorecards";
const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const DEFAULT_QA_MODEL = "gpt-4o-mini";
const TRANSCRIPTION_MODEL_STORAGE = "compassai.transcriptionModel";
const QA_MODEL_STORAGE = "compassai.qaModel";
const TRANSCRIPTION_MODELS = ["gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"];
const QA_MODELS = ["gpt-4o-mini", "gpt-4.1-mini"];
const APP_VERSION = "0.3.0";
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

function cleanApiKey(value = "") {
  const compact = value.replace(/\s+/g, "").trim();
  if (/^sk-proj(?!-)/.test(compact)) return compact.replace(/^sk-proj/, "sk-proj-");
  return compact;
}

function redactSensitive(value: unknown) {
  return String(value ?? "").replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-...redacted...");
}

function normalizePhone(value = "") {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function formatPhone(value = "") {
  const phone = normalizePhone(value);
  return phone.length === 10 ? `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` : value;
}

function extractAgentName(transcript = "") {
  const patterns = [
    /\bthis is\s+([A-Z][a-z]{1,24})\b/,
    /\bmy name is\s+([A-Z][a-z]{1,24})\b/,
    /\b([A-Z][a-z]{1,24})\s+speaking\b/,
    /\b([A-Z][a-z]{1,24})\s+here\s+from\b/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(transcript);
    if (match?.[1]) return match[1];
  }
  return "";
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
  return {
    agent: extractAgentName(result.transcript_text),
    customer: lead?.customer || "",
    phone: lead?.phone || "",
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

function patternsToText(entry?: ScorecardEntry) {
  return (entry?.bundle?.client_patterns ?? [])
    .map((group) => `${group.name}: ${(group.patterns ?? []).join(", ")}`)
    .join("\n");
}

function rulesToText(rules: ScorecardRule[] = []) {
  return rules
    .map((rule) => {
      const positives = (rule.positive_patterns ?? []).join(", ");
      const negatives = (rule.negative_patterns ?? []).join(", ");
      return `${rule.name} | ${positives} | ${negatives}`;
    })
    .join("\n");
}

function parsePatternText(value: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, rawPatterns = ""] = line.split(/:(.*)/s);
      return {
        name: (name || "Client").trim(),
        patterns: rawPatterns.split(/[,;]+/).map((pattern) => pattern.trim()).filter(Boolean),
      };
    })
    .filter((group) => group.name && group.patterns.length);
}

function parseRuleText(value: string, fallbackType: string) {
  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name = "", positives = "", negatives = ""] = line.split("|").map((part) => part.trim());
      return {
        name: name || "New qualifier",
        type: fallbackType,
        positive_patterns: positives.split(/[,;]+/).map((pattern) => pattern.trim()).filter(Boolean),
        negative_patterns: negatives.split(/[,;]+/).map((pattern) => pattern.trim()).filter(Boolean),
      };
    });
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
            "You are a QA auditor. Return compact JSON only: {rows:[{check,status,result,evidence_time,category}],notes}. status must be Pass, Fail, Needs review, or Not applicable. Do not include full transcripts.",
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
  return JSON.parse(payload.choices?.[0]?.message?.content ?? "{}") as { rows?: AnalysisRow[]; notes?: string };
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

function makeReport(results: JobResult[], mirrorLeads: MirrorLead[]) {
  const generated = new Date().toLocaleString();
  const rows = results
    .map((result) => {
      const m = result.metrics;
      const meta = callMeta(result, mirrorLeads);
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
        <td>${escapeHtml(fmtSeconds(result.duration_seconds))}</td>
      </tr>`;
    })
    .join("");
  const transcriptSections = results
    .map(
      (result, index) => {
        const meta = callMeta(result, mirrorLeads);
        return `<section class="call"><h2>${escapeHtml(titleFor(result, mirrorLeads))}</h2>
        <div class="call-meta">
          <span>Agent: <strong>${escapeHtml(meta.agent || "Not detected")}</strong></span>
          <span>Customer: <strong>${escapeHtml(meta.customer || "Not matched")}</strong></span>
          <span>Phone: <strong>${escapeHtml(meta.phone ? formatPhone(meta.phone) : "Not matched")}</strong></span>
          ${meta.clover ? `<span>Clover: <a href="${escapeHtml(meta.clover)}">Open matched lead</a></span>` : ""}
        </div>
        ${freeAlerts(result.transcript_text)
        .map((alert) => `<div class="free-alert">${escapeHtml(alert)}</div>`)
        .join("")}<div class="search-row"><input class="search" data-target="t${index}" placeholder="Search this transcript"><button type="button" data-prev="t${index}">Previous</button><button type="button" data-next="t${index}">Next</button><span data-count="t${index}">0 matches</span></div><pre class="transcript" id="t${index}">${escapeHtml(result.transcript_text)}</pre></section>`;
      },
    )
    .join("");
  const evidence = results
    .flatMap((result) => (result.qa_overrides ?? []).map((row) => ({ result, row })))
    .map(({ result, row }) => `<tr><td class="long">${escapeHtml(result.file_name)}</td><td>${escapeHtml(row.Qualifier)}</td><td>${escapeHtml(row["Final status"])}</td><td>${escapeHtml(row.Time || "No timestamp")}</td><td class="long">${escapeHtml(row.Evidence)}</td><td class="long">${escapeHtml(row["Reviewer note"])}</td></tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CompassAi Report</title><style>
	body{font-family:Inter,Arial,sans-serif;margin:0;color:#17202a;background:#f4f7fb;line-height:1.45}.page{padding:28px}.hero{background:#0b1118;color:#e6edf5;padding:24px 28px;border-radius:14px;margin-bottom:18px}.hero h1{margin:0 0 6px;font-size:28px}.hero p{margin:0;color:#a8b3c2}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:18px}.card{background:#fff;border:1px solid #d8dee6;border-radius:10px;padding:14px}.card span{color:#687789;display:block;font-size:12px;font-weight:800;text-transform:uppercase}.card strong{display:block;font-size:22px;margin-top:4px}h2{margin:24px 0 10px}.table-wrap{overflow-x:auto;max-width:100%;border:1px solid #d8dee6;border-radius:10px;background:#fff}table{border-collapse:collapse;min-width:1500px;width:max-content;table-layout:auto}th,td{border-bottom:1px solid #d8dee6;padding:10px;text-align:left;vertical-align:top;white-space:nowrap;word-break:normal;overflow-wrap:normal}th{background:#f8fafc;font-size:12px;text-transform:uppercase;color:#475569}.long{white-space:normal;min-width:260px;max-width:560px;overflow-wrap:break-word}.call{background:#fff;border:1px solid #d8dee6;border-radius:12px;padding:16px;margin:16px 0}.call h2{margin-top:0}.call-meta{display:flex;flex-wrap:wrap;gap:10px 16px;color:#475569;margin-bottom:10px}.transcript{white-space:pre-wrap;background:#05080d;color:#e5e7eb;border:1px solid #111827;border-radius:8px;padding:14px;overflow:auto;max-height:700px;overflow-wrap:break-word;word-break:normal}.free-alert{border:2px solid #dc2626;background:#fee2e2;color:#991b1b;border-radius:8px;padding:10px;font-weight:900;margin:10px 0}.search-row{display:grid;grid-template-columns:minmax(220px,380px) auto auto auto;gap:8px;align-items:center;margin:10px 0}.search-row input,.search-row button{border:1px solid #d8dee6;border-radius:7px;padding:8px 10px}a{color:#0f766e;font-weight:800}mark{background:#fde68a;color:#111827;border-radius:3px;padding:0 2px}mark.active{background:#fb923c}@media print{body{background:#fff}.page{padding:12px}.hero,.card,.call{break-inside:avoid}.table-wrap{overflow:visible}table{font-size:10px;min-width:1100px}.search-row{display:none}.transcript{max-height:none;background:#fff;color:#17202a;border-color:#d8dee6}}</style></head><body><div class="page">
	<div class="hero"><h1>CompassAi Batch Report</h1><p>Generated ${escapeHtml(generated)}. Polished web report with MirrorCXT matches, QA evidence, timestamps, and searchable transcripts.</p></div>
	<div class="summary"><div class="card"><span>Calls</span><strong>${results.length}</strong></div><div class="card"><span>Total call time</span><strong>${escapeHtml(fmtSeconds(results.reduce((sum, result) => sum + (result.duration_seconds ?? 0), 0)))}</strong></div><div class="card"><span>MirrorCXT leads loaded</span><strong>${mirrorLeads.length}</strong></div><div class="card"><span>Average QA score</span><strong>${results.length ? Math.round(results.reduce((sum, result) => sum + (result.metrics?.qa_score ?? 0), 0) / results.length) : 0}%</strong></div></div>
	<h2>Review Queue</h2><div class="table-wrap"><table><thead><tr><th>File</th><th>Client</th><th>Scorecard</th><th>Agent</th><th>Customer</th><th>Phone</th><th>Clover</th><th>QA Score</th><th>Outcome</th><th>Call Time</th></tr></thead><tbody>${rows}</tbody></table></div>
	<h2>QA Evidence</h2><div class="table-wrap"><table><thead><tr><th>File</th><th>Qualifier</th><th>Status</th><th>Time</th><th>Evidence</th><th>Reviewer Note</th></tr></thead><tbody>${evidence}</tbody></table></div>
	<h2>MirrorCXT Links</h2><div class="table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th>Disposition</th><th>Clover</th><th>Raw label</th></tr></thead><tbody>${mirrorLeads.map((lead) => `<tr><td>${escapeHtml(lead.customer || "")}</td><td>${escapeHtml(lead.phone ? formatPhone(lead.phone) : "")}</td><td>${escapeHtml(lead.disposition || "")}</td><td>${lead.clover_url ? `<a href="${escapeHtml(lead.clover_url)}">Open Clover</a>` : ""}</td><td class="long">${escapeHtml(lead.label)}</td></tr>`).join("")}</tbody></table></div>
	${transcriptSections}</div><script>(function(){function esc(s){return s.replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}var state={};document.querySelectorAll('.transcript').forEach(function(t){state[t.id]={raw:t.textContent||'',active:0,matches:[]}});function paint(id,q){var t=document.getElementById(id);var s=state[id];if(!t||!s)return;var count=document.querySelector('[data-count="'+id+'"]');if(!q){s.matches=[];t.textContent=s.raw;if(count)count.textContent='0 matches';return}var rx=new RegExp(q.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g,'\\\\$&'),'gi');var i=0;s.matches=[];t.innerHTML=esc(s.raw).replace(rx,function(m){var cls=i===s.active?' active':'';s.matches.push(i);i++;return '<mark class="'+cls.trim()+'">'+esc(m)+'</mark>'});if(count)count.textContent=s.matches.length?((s.active+1)+'/'+s.matches.length+' matches'):'0 matches';}document.querySelectorAll('.search').forEach(function(input){input.addEventListener('input',function(){var id=input.dataset.target;state[id].active=0;paint(id,input.value)})});document.querySelectorAll('[data-prev],[data-next]').forEach(function(btn){btn.addEventListener('click',function(){var id=btn.getAttribute('data-prev')||btn.getAttribute('data-next');var input=document.querySelector('[data-target="'+id+'"]');var s=state[id];if(!input||!s||!s.matches.length)return;s.active=(s.active+(btn.hasAttribute('data-prev')?-1:1)+s.matches.length)%s.matches.length;paint(id,input.value)})})})();</script></body></html>`;
}

export function CompassAiShell({ userEmail }: { userEmail: string }) {
  const [view, setView] = useState<"jobs" | "review" | "scorecards" | "mirrorcxt" | "settings">("jobs");
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
  const [scorecardAliases, setScorecardAliases] = useState("");
  const [universalRules, setUniversalRules] = useState("");
  const [criticalRules, setCriticalRules] = useState("");
  const [transcriptionModel, setTranscriptionModel] = useState(DEFAULT_TRANSCRIPTION_MODEL);
  const [qaModel, setQaModel] = useState(DEFAULT_QA_MODEL);
  const [editingScorecardId, setEditingScorecardId] = useState("");

  const results = useMemo(() => jobs.flatMap((job) => job.results.map((result) => ({ job, result }))), [jobs]);
  const selected = results.find((item) => item.result.result_id === selectedResultId) ?? results[0];

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
    setTranscriptionModel(window.localStorage.getItem(TRANSCRIPTION_MODEL_STORAGE) || DEFAULT_TRANSCRIPTION_MODEL);
    setQaModel(window.localStorage.getItem(QA_MODEL_STORAGE) || DEFAULT_QA_MODEL);
    setStatus(key ? "OpenAI key saved in this browser" : "Paste your OpenAI API key in Settings");
    setCloudStatus(key ? "Saved key; run connection test" : "No OpenAI key saved");
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
    setScorecardAliases(patternsToText(selected));
    setUniversalRules(rulesToText(selected?.bundle?.universal_rules));
    setCriticalRules(rulesToText(selected?.bundle?.critical_checks));
    setScorecardEditor(JSON.stringify(selected?.bundle ?? {}, null, 2));
  }, [scorecards?.active_scorecard_id]);

  async function upload() {
    if (!files?.length || !scorecards) return;
    if (!cleanApiKey(openaiApiKey)) {
      setView("settings");
      setError("Paste and save your OpenAI API key before processing calls.");
      return;
    }
    setBusy(true);
    setError("");
    const job: Job = {
      job_id: uuid(),
      status: "running",
      message: "Starting Vercel-side OpenAI processing...",
      progress: 0.02,
      percent: 2,
      source_files: Array.from(files).map((file) => file.name),
      results: [],
    };
    let nextJobs = [job, ...jobs];
    persistJobs(nextJobs);
    const started = Date.now();
    try {
      for (const [index, file] of Array.from(files).entries()) {
        const update = (patch: Partial<Job>) => {
          nextJobs = nextJobs.map((candidate) =>
            candidate.job_id === job.job_id
              ? { ...candidate, ...patch, elapsed_seconds: Math.round((Date.now() - started) / 1000) }
              : candidate,
          );
          persistJobs(nextJobs);
        };
        update({ message: `Transcribing ${file.name}...`, progress: index / files.length + 0.05, percent: Math.round((index / files.length) * 100) });
        const transcriptPayload = await transcribeDirect(file, cleanApiKey(openaiApiKey), transcriptionModel);
        const ruleAnalysis = makeRuleAnalysis(transcriptPayload.transcript, scorecards, transcriptPayload.duration);
        let rows = ruleAnalysis.rows;
        let source = transcriptPayload.chunked
          ? `OpenAI transcription via Vercel relay (${transcriptPayload.chunk_count} audio parts) + browser rule scanner`
          : "OpenAI transcription via Vercel relay + browser rule scanner";
        if (transcriptPayload.model_fallback) source += ` | ${transcriptPayload.model_fallback}`;
        let report = "";
        try {
          update({ message: `Running cloud QA for ${file.name}...`, progress: (index + 0.65) / files.length, percent: Math.round(((index + 0.65) / files.length) * 100) });
          const qa = await qaDirect(transcriptPayload.transcript, ruleAnalysis.entry, cleanApiKey(openaiApiKey), qaModel);
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
          transcript_text: transcriptPayload.transcript,
          duration_seconds: transcriptPayload.duration,
          analysis: {
            client: ruleAnalysis.client,
            scorecard_name: ruleAnalysis.entry.name,
            source,
            rows,
          },
          qa_overrides: editorRows(rows),
          metrics: metrics(rows),
          llm_error_report: report,
        };
        nextJobs = nextJobs.map((candidate) =>
          candidate.job_id === job.job_id ? { ...candidate, results: [...candidate.results, result] } : candidate,
        );
        persistJobs(nextJobs);
      }
      nextJobs = nextJobs.map((candidate) =>
        candidate.job_id === job.job_id
          ? { ...candidate, status: "complete", message: `Completed ${files.length} file(s).`, progress: 1, percent: 100, eta_seconds: 0 }
          : candidate,
      );
      persistJobs(nextJobs);
      setStatus(`Completed ${files.length} file(s).`);
    } catch (caught) {
      const report = makeErrorReport("Vercel transcription relay workflow", caught, { files: Array.from(files).map((file) => file.name).join(", ") });
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
    setEditingScorecardId(entry.id);
    setScorecardName(entry.name);
    setScorecardAliases(patternsToText(entry));
    setUniversalRules(rulesToText(entry.bundle?.universal_rules));
    setCriticalRules(rulesToText(entry.bundle?.critical_checks));
    setScorecardEditor(JSON.stringify(entry.bundle, null, 2));
  }

  function saveScorecardEdit(mode: "update" | "add") {
    if (!scorecards) return;
    try {
      const original = JSON.parse(scorecardEditor || "{}");
      const bundle = {
        ...original,
        name: scorecardName.trim() || original.name || "Unnamed scorecard",
        client_patterns: parsePatternText(scorecardAliases),
        universal_rules: parseRuleText(universalRules, "Universal"),
        critical_checks: parseRuleText(criticalRules, "Critical"),
      };
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
    } catch (caught) {
      setError(`Could not save scorecard JSON: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
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
    window.localStorage.setItem(TRANSCRIPTION_MODEL_STORAGE, transcriptionModel);
    window.localStorage.setItem(QA_MODEL_STORAGE, qaModel);
    setStatus(`Model settings saved: ${transcriptionModel} transcription, ${qaModel} QA.`);
  }

  async function testOpenAiConnection() {
    const key = cleanApiKey(openaiApiKey);
    if (!key) {
      setCloudStatus("No OpenAI key saved");
      setView("settings");
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
  }

  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <img src="/logo512.png" alt="" />
          <div>
            <h1>CompassAi</h1>
            <span className="version-label">Version {APP_VERSION}</span>
            <p>{userEmail}</p>
          </div>
        </div>
        <nav>
          {(["jobs", "review", "scorecards", "mirrorcxt", "settings"] as const).map((item) => (
            <button key={item} className={view === item ? "active" : ""} onClick={() => setView(item)}>
              {item === "mirrorcxt" ? "MirrorCXT" : item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
        <section className="side-card">
          <span>Cloud LLM Status</span>
          <strong>{cloudStatus}</strong>
          {cloudCheckedAt && <p>Last checked {cloudCheckedAt}</p>}
          <button onClick={testOpenAiConnection} disabled={busy || !cleanApiKey(openaiApiKey)}>Test connection</button>
        </section>
        <section className="side-card">
          <span>Scorecards</span>
          <strong>{scorecards?.scorecards.length ?? 0} loaded</strong>
          <p>{scorecards?.required_clients_available ? "Feldco, Bachmans, KQR, Pella, and RbA/QWD ready." : "Required client check pending."}</p>
        </section>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <h2>CompassAi Web QA Workspace</h2>
            <p>Audio and QA run through CompassAi's Vercel relay using your OpenAI API key. Keep this tab open while processing.</p>
          </div>
          <button onClick={refresh} disabled={busy}>Refresh</button>
        </header>
        {error && <div className="notice error">{error}</div>}
        {view === "jobs" && (
          <section className="panel">
            <h3>Add recordings</h3>
            <div className="drop">
              <input type="file" multiple accept="audio/*,video/*" onChange={(event) => setFiles(event.target.files)} />
              <button className="primary" disabled={busy || !files?.length || !cleanApiKey(openaiApiKey)} onClick={upload}>
                {busy ? "Processing..." : "Upload and process"}
              </button>
            </div>
            {!cleanApiKey(openaiApiKey) && <p className="hint">Add your OpenAI API key in Settings before uploading recordings.</p>}
            <div className="button-row">
              <button onClick={clearJobs} disabled={busy || !jobs.length}>Clear local jobs</button>
            </div>
            <JobList jobs={jobs} selectedResultId={selectedResultId} select={setSelectedResultId} removeJob={removeJob} mirrorLeads={mirrorLeads} />
          </section>
        )}
        {view === "review" && (
          <ReviewPanel
            item={selected}
            allResults={results}
            selectedResultId={selectedResultId}
            select={setSelectedResultId}
            refresh={refresh}
            persistJobs={persistJobs}
            jobs={jobs}
            setError={setError}
            mirrorLeads={mirrorLeads}
          />
        )}
        {view === "scorecards" && (
          <section className="panel">
            <div className="panel-title">
              <div>
                <h3>Scorecards</h3>
                <p>Edit scorecard names, client aliases, qualifiers, and critical checks. Changes are saved in this browser.</p>
              </div>
              <button onClick={resetBundledScorecards} disabled={busy}>Restore bundled</button>
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
                  Download scorecards JSON
                </a>
              )}
            </div>
            <div className="scorecard-layout">
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
              <div className="scorecard-editor">
                <h4>{editingScorecardId ? "Edit scorecard" : "Add scorecard"}</h4>
                <label>Scorecard name
                  <input value={scorecardName} onChange={(event) => setScorecardName(event.target.value)} placeholder="Feldco" />
                </label>
                <label>Client aliases and detection patterns
                  <textarea className="short-editor" value={scorecardAliases} onChange={(event) => setScorecardAliases(event.target.value)} placeholder="Feldco: feldco, feldco windows" />
                </label>
                <label>Universal qualifiers
                  <textarea className="short-editor" value={universalRules} onChange={(event) => setUniversalRules(event.target.value)} placeholder="Homeowner confirmed | homeowner|decision maker | renter|not homeowner" />
                </label>
                <label>Critical checks
                  <textarea className="short-editor" value={criticalRules} onChange={(event) => setCriticalRules(event.target.value)} placeholder="No unapproved quote | free quote|estimate | price guaranteed" />
                </label>
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
          <section className="panel">
            <h3>MirrorCXT import</h3>
            <p className="hint">
              Upload a MirrorCXT HTML export before or after transcribing. CompassAi matches saved leads to calls by phone/name and then shows the Clover link, customer details, and relevant lead info in review queues and exported reports.
            </p>
            <label>Upload MirrorCXT HTML export
              <input type="file" accept=".html,.htm,.txt,text/html,text/plain" onChange={(event) => importMirrorFile(event.target.files?.[0] ?? null)} />
            </label>
            <p>{mirrorLeads.length} Clover/MirrorCXT lead(s) loaded for reports.</p>
            <div className="mirror-list">
              {mirrorLeads.map((lead) => (
                <article key={lead.id}>
                  <strong>{lead.disposition || "MirrorCXT lead"}</strong>
                  <p>{lead.label}</p>
                  {lead.phone && <small>{lead.phone}</small>}
                  {lead.clover_url && <a href={lead.clover_url} target="_blank" rel="noreferrer">Open Clover</a>}
                </article>
              ))}
            </div>
          </section>
        )}
        {view === "settings" && (
          <section className="panel">
            <h3>Settings</h3>
            <div className="api-key-box">
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
            <div className="api-key-box">
              <label>Transcription model
                <select value={transcriptionModel} onChange={(event) => setTranscriptionModel(event.target.value)}>
                  {TRANSCRIPTION_MODELS.map((model) => <option key={model}>{model}</option>)}
                </select>
              </label>
              <label>QA model
                <select value={qaModel} onChange={(event) => setQaModel(event.target.value)}>
                  {QA_MODELS.map((model) => <option key={model}>{model}</option>)}
                </select>
              </label>
              <div className="button-row">
                <button className="primary" onClick={saveModelSettings}>Save model settings</button>
              </div>
              <p className="hint">If a selected transcription model is unavailable, CompassAi automatically falls back to {DEFAULT_TRANSCRIPTION_MODEL}. Use Test OpenAI connection to confirm the cloud QA model and API key are working.</p>
            </div>
            <div className="settings-grid">
              <div><span>Hosting</span><strong>Web based, CompassAi</strong><p>No downloads, quick, secure, quality.</p></div>
              <div><span>Transcription</span><strong>{transcriptionModel}</strong><p>Recordings are sent through CompassAi's same-origin Vercel relay to avoid browser fetch failures.</p></div>
              <div><span>QA model</span><strong>{qaModel}</strong><p>If cloud QA fails, CompassAi falls back to browser rule scanning and shows a copyable error report.</p></div>
              <div><span>Cloud LLM Status</span><strong>{cloudStatus}</strong><p>{cloudCheckedAt ? `Last checked ${cloudCheckedAt}.` : "Use Test OpenAI connection for live API status."}</p></div>
            </div>
          </section>
        )}
        <section className="panel">
          <div className="panel-title">
            <h3>Final report</h3>
            <button className="primary" disabled={!results.length || busy} onClick={exportReport}>Generate HTML report</button>
          </div>
          {reportHtml && (
            <a
              className="download-link"
              download={`CompassAi_QA_Report_${new Date().toISOString().slice(0, 10)}.html`}
              href={`data:text/html;charset=utf-8,${encodeURIComponent(reportHtml)}`}
            >
              Download styled HTML report
            </a>
          )}
          {reportHtml && <iframe title="CompassAi report preview" srcDoc={reportHtml} />}
        </section>
      </main>
    </div>
  );
}

function JobList({ jobs, selectedResultId, select, removeJob, mirrorLeads }: { jobs: Job[]; selectedResultId: string; select: (id: string) => void; removeJob: (id: string) => void; mirrorLeads: MirrorLead[] }) {
  return (
    <div className="job-list">
      {jobs.map((job) => (
        <article key={job.job_id} className="job-card">
          <div className="job-head">
            <strong>{job.status.toUpperCase()}</strong>
            <button onClick={() => removeJob(job.job_id)}>Remove</button>
          </div>
          <progress value={job.progress} max={1} />
          <p>{job.percent}% complete | elapsed {fmtSeconds(job.elapsed_seconds)} | {job.message}</p>
          {(job.source_files ?? []).map((file) => <small key={file}>{file}</small>)}
          {job.results.map((result) => (
            <button key={result.result_id} className={selectedResultId === result.result_id ? "result active" : "result"} onClick={() => select(result.result_id)}>
              {titleFor(result, mirrorLeads)}
            </button>
          ))}
          {job.error_report && <textarea readOnly value={job.error_report} />}
        </article>
      ))}
    </div>
  );
}

function ReviewPanel({
  item,
  allResults,
  selectedResultId,
  select,
  jobs,
  persistJobs,
  setError,
  mirrorLeads,
}: {
  item?: { job: Job; result: JobResult };
  allResults: { job: Job; result: JobResult }[];
  selectedResultId: string;
  select: (id: string) => void;
  refresh: () => Promise<void>;
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

  useEffect(() => {
    setRows(item?.result.qa_overrides ?? []);
    setFinalGrade(item?.result.metrics?.final_grade ?? "Approved");
    setNote("");
    setSearch("");
    setActive(0);
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  if (!item) return <section className="panel"><h3>QA review</h3><p>No completed calls yet.</p></section>;
  const result = item.result;
  const meta = callMeta(result, mirrorLeads);
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h3>{titleFor(result, mirrorLeads)}</h3>
          <p>{result.analysis.source} | Score {result.metrics?.qa_score ?? 0}% | {result.metrics?.outcome}</p>
          <p className="hint">
            Agent: {meta.agent || "not detected"} | Customer: {meta.customer || "not matched"} | Phone: {meta.phone ? formatPhone(meta.phone) : "not matched"}
            {meta.clover && <> | <a href={meta.clover} target="_blank" rel="noreferrer">Open Clover matched lead</a></>}
          </p>
        </div>
        <button className="primary" onClick={save}>Save QA overrides</button>
      </div>
      {result.llm_error_report && <textarea className="error-report" readOnly value={result.llm_error_report} />}
      <div className="review-call-picker">
        <div>
          <h4>Review queue</h4>
          <p>{allResults.length} completed call(s). Select any call to review or update overrides.</p>
        </div>
        <select value={selectedResultId || result.result_id} onChange={(event) => select(event.target.value)}>
          {allResults.map(({ result }) => (
            <option key={result.result_id} value={result.result_id}>
              {titleFor(result, mirrorLeads)}{callMeta(result, mirrorLeads).clover ? " | Clover matched" : ""}
            </option>
          ))}
        </select>
        <div className="review-call-list">
          {allResults.map(({ result }) => {
            const details = callMeta(result, mirrorLeads);
            return (
              <article key={result.result_id} className={result.result_id === item.result.result_id ? "active" : ""}>
                <button onClick={() => select(result.result_id)}>
                  <strong>{result.file_name}</strong>
                  <span>{result.analysis.client || "Unknown"} | {result.analysis.scorecard_name || "No scorecard"} | {result.metrics?.qa_score ?? 0}%</span>
                  <span>Agent: {details.agent || "not detected"} | Customer: {details.customer || "not matched"} | Phone: {details.phone ? formatPhone(details.phone) : "not matched"}</span>
                </button>
                {details.clover && <a href={details.clover} target="_blank" rel="noreferrer">Open Clover</a>}
              </article>
            );
          })}
        </div>
      </div>
      <div className="review-grid">
        <div className="qa-table-wrap">
          <table>
            <thead><tr><th>Qualifier</th><th>System</th><th>Final</th><th>Time</th><th>Evidence</th><th>Reviewer note</th></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.Qualifier}-${index}`}>
                  <td><strong>{row.Qualifier}</strong><small>{row.Category}</small></td>
                  <td><span className="pill">{row["System status"]}</span></td>
                  <td><select value={row["Final status"]} onChange={(event) => setRows((current) => current.map((r, i) => i === index ? { ...r, "Final status": event.target.value } : r))}>{["Pass", "Fail", "Needs review", "Not applicable"].map((status) => <option key={status}>{status}</option>)}</select></td>
                  <td><input value={row.Time} onChange={(event) => setRows((current) => current.map((r, i) => i === index ? { ...r, Time: event.target.value } : r))} /></td>
                  <td><textarea value={row.Evidence} onChange={(event) => setRows((current) => current.map((r, i) => i === index ? { ...r, Evidence: event.target.value } : r))} /></td>
                  <td><textarea value={row["Reviewer note"]} onChange={(event) => setRows((current) => current.map((r, i) => i === index ? { ...r, "Reviewer note": event.target.value } : r))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="transcript-panel">
          <div className="searchbar">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search transcript" />
            <button disabled={!matches.length} onClick={() => setActive((active + matches.length - 1) % matches.length)}>Previous</button>
            <button disabled={!matches.length} onClick={() => setActive((active + 1) % matches.length)}>Next</button>
            <span>{matches.length ? `${active + 1}/${matches.length}` : "0 matches"}</span>
          </div>
          {freeAlerts(result.transcript_text).map((alert) => <div className="free-alert" key={alert}>{alert}</div>)}
          <pre>{highlight(result.transcript_text, search, active)}</pre>
        </aside>
      </div>
      <div className="review-footer">
        <label>Final grade<select value={finalGrade} onChange={(event) => setFinalGrade(event.target.value)}>{["Approved", "Needs coaching", "Reject / no credit", "Needs second review"].map((grade) => <option key={grade}>{grade}</option>)}</select></label>
        <label>Reviewer note<textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
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
