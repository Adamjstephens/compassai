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
const TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const QA_MODEL = "gpt-4o-mini";
const REQUIRED_SCORECARDS = new Set(["Feldco", "Bachmans", "KQR", "Pella", "RbA/QWD"]);

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

function titleFor(result: JobResult) {
  const client = result.analysis?.client || "Unknown";
  const scorecard = result.analysis?.scorecard_name || "Not selected";
  return `${result.file_name} | Client: ${client} | Scorecard: ${scorecard}`;
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

function timeForSnippet(text: string, snippet: string, duration = 0) {
  if (!duration || !snippet) return "00:00";
  const index = text.toLowerCase().indexOf(snippet.slice(0, 24).toLowerCase());
  const ratio = index >= 0 ? index / Math.max(text.length, 1) : 0;
  const seconds = Math.max(0, Math.round(duration * ratio));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function pickScorecard(transcript: string, library: ScorecardLibrary) {
  let best = library.scorecards[0];
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
    "CompassAi Vercel-Only Error Report",
    "",
    `What failed: ${stage}`,
    `Exact error: ${error instanceof Error ? error.message : String(error)}`,
    `Timestamp: ${new Date().toISOString()}`,
    `Platform: ${navigator.platform}`,
    `Browser: ${navigator.userAgent}`,
    "Hosting: Vercel-only browser workflow",
  ];
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined && value !== "") lines.push(`${key}: ${value}`);
  }
  lines.push("Likely fix: verify the OpenAI API key, billing, model access, browser CORS/network policy, and use a smaller or compressed audio file.");
  lines.push("Transcript and audio content are intentionally omitted.");
  return lines.join("\n");
}

async function transcribeDirect(file: File, apiKey: string) {
  if (file.size > 24 * 1024 * 1024) {
    throw new Error(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB. Browser-only OpenAI transcription works best below about 24 MB.`);
  }
  const form = new FormData();
  form.append("model", TRANSCRIPTION_MODEL);
  form.append("file", file);
  form.append("response_format", "json");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`OpenAI transcription HTTP ${response.status}: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text);
  return { transcript: String(payload.text ?? ""), duration: Number(payload.duration ?? 0) };
}

async function qaDirect(transcript: string, scorecard: ScorecardEntry, apiKey: string) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: QA_MODEL,
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
  if (!response.ok) throw new Error(`OpenAI QA HTTP ${response.status}: ${text.slice(0, 500)}`);
  const payload = JSON.parse(text);
  return JSON.parse(payload.choices?.[0]?.message?.content ?? "{}") as { rows?: AnalysisRow[]; notes?: string };
}

function makeRuleAnalysis(transcript: string, library: ScorecardLibrary, duration = 0) {
  const { entry, client } = pickScorecard(transcript, library);
  const rows = rulesFor(entry, client).map((rule) => gradeRule(rule, transcript, duration));
  return { entry, client, rows };
}

function parseMirrorText(value: string) {
  const links = [...value.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map((match) => match[0]);
  const clover = links.filter((link) => /clover|lead|customer|contact/i.test(link));
  return clover.map((url, index) => ({ id: `${index}-${url}`, clover_url: url, label: `MirrorCXT lead ${index + 1}` }));
}

function makeReport(results: JobResult[], mirrorLeads: any[]) {
  const generated = new Date().toLocaleString();
  const rows = results
    .map((result) => {
      const m = result.metrics;
      return `<tr><td>${escapeHtml(titleFor(result))}</td><td>${escapeHtml(result.analysis.client)}</td><td>${escapeHtml(result.analysis.scorecard_name)}</td><td>${m?.qa_score ?? 0}%</td><td>${escapeHtml(m?.outcome)}</td><td>${escapeHtml(fmtSeconds(result.duration_seconds))}</td></tr>`;
    })
    .join("");
  const transcriptSections = results
    .map(
      (result, index) => `<section class="call"><h2>${escapeHtml(titleFor(result))}</h2>${freeAlerts(result.transcript_text)
        .map((alert) => `<div class="free-alert">${escapeHtml(alert)}</div>`)
        .join("")}<input class="search" data-target="t${index}" placeholder="Search transcript"><div class="transcript" id="t${index}">${escapeHtml(result.transcript_text)}</div></section>`,
    )
    .join("");
  const evidence = results
    .flatMap((result) => result.qa_overrides ?? [])
    .map((row) => `<tr><td>${escapeHtml(row.Qualifier)}</td><td>${escapeHtml(row["Final status"])}</td><td>${escapeHtml(row.Time)}</td><td class="long">${escapeHtml(row.Evidence)}</td><td class="long">${escapeHtml(row["Reviewer note"])}</td></tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>CompassAi Report</title><style>
body{font-family:Arial,sans-serif;margin:24px;color:#17202a;line-height:1.45}h1,h2{margin:.4rem 0}.table-wrap{overflow-x:auto;max-width:100%;border:1px solid #d8dee6;border-radius:8px}table{border-collapse:collapse;min-width:1100px;width:max-content;table-layout:auto}th,td{border-bottom:1px solid #d8dee6;padding:9px;text-align:left;vertical-align:top;white-space:nowrap;word-break:normal;overflow-wrap:normal}.long{white-space:normal;min-width:260px;max-width:520px;overflow-wrap:break-word}.transcript{white-space:pre-wrap;background:#f8fafc;border:1px solid #d8dee6;border-radius:8px;padding:14px;overflow-wrap:break-word;word-break:normal}.free-alert{border:2px solid #dc2626;background:#fee2e2;color:#991b1b;border-radius:8px;padding:10px;font-weight:900;margin:10px 0}.search{max-width:360px;margin:10px 0}@media print{body{margin:12px}.table-wrap{overflow:visible}table{font-size:11px}}</style></head><body>
<h1>CompassAi Batch Report</h1><p>Generated ${escapeHtml(generated)}. Total call time: ${escapeHtml(fmtSeconds(results.reduce((sum, result) => sum + (result.duration_seconds ?? 0), 0)))}.</p>
<h2>Review Queue</h2><div class="table-wrap"><table><thead><tr><th>File</th><th>Client</th><th>Scorecard</th><th>QA Score</th><th>Outcome</th><th>Call Time</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>QA Evidence</h2><div class="table-wrap"><table><thead><tr><th>Qualifier</th><th>Status</th><th>Time</th><th>Evidence</th><th>Reviewer Note</th></tr></thead><tbody>${evidence}</tbody></table></div>
<h2>MirrorCXT Links</h2><ul>${mirrorLeads.map((lead) => `<li><a href="${escapeHtml(lead.clover_url)}">${escapeHtml(lead.clover_url)}</a></li>`).join("")}</ul>
${transcriptSections}<script>document.querySelectorAll('.search').forEach(function(input){input.addEventListener('input',function(){var t=document.getElementById(input.dataset.target);var raw=t.textContent;var escaped=input.value.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g,'\\\\$&');t.innerHTML=escaped?raw.replace(new RegExp(escaped,'gi'),function(m){return '<mark>'+m+'</mark>'}):raw})});</script></body></html>`;
}

export function CompassAiShell({ userEmail }: { userEmail: string }) {
  const [view, setView] = useState<"jobs" | "review" | "scorecards" | "mirrorcxt" | "settings">("jobs");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [scorecards, setScorecards] = useState<ScorecardLibrary | null>(null);
  const [selectedResultId, setSelectedResultId] = useState("");
  const [status, setStatus] = useState("Loading CompassAi...");
  const [error, setError] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [mirrorText, setMirrorText] = useState("");
  const [mirrorLeads, setMirrorLeads] = useState<any[]>([]);
  const [reportHtml, setReportHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");

  const results = useMemo(() => jobs.flatMap((job) => job.results.map((result) => ({ job, result }))), [jobs]);
  const selected = results.find((item) => item.result.result_id === selectedResultId) ?? results[0];

  const persistJobs = useCallback((next: Job[]) => {
    setJobs(next);
    window.localStorage.setItem(JOB_STORAGE, JSON.stringify(next));
  }, []);

  const refresh = useCallback(async () => {
    const stored = window.localStorage.getItem(JOB_STORAGE);
    if (stored) setJobs(JSON.parse(stored));
    const key = window.localStorage.getItem(OPENAI_KEY_STORAGE) ?? "";
    setOpenaiApiKey(key);
    setApiKeyDraft(key);
    setStatus(key ? "OpenAI key saved in this browser" : "Paste your OpenAI API key in Settings");
  }, []);

  useEffect(() => {
    refresh();
    fetch("/qa_scorecards.json")
      .then((response) => response.json())
      .then((library: ScorecardLibrary) => {
        const names = new Set((library.scorecards ?? []).map((entry) => entry.name));
        setScorecards({ ...library, required_clients_available: [...REQUIRED_SCORECARDS].every((name) => names.has(name)) });
      })
      .catch((caught) => setError(`Scorecards failed to load: ${caught instanceof Error ? caught.message : String(caught)}`));
  }, [refresh]);

  async function upload() {
    if (!files?.length || !scorecards) return;
    if (!openaiApiKey.trim()) {
      setView("settings");
      setError("Paste and save your OpenAI API key before processing calls.");
      return;
    }
    setBusy(true);
    setError("");
    const job: Job = {
      job_id: uuid(),
      status: "running",
      message: "Starting browser-side processing...",
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
        const transcriptPayload = await transcribeDirect(file, openaiApiKey.trim());
        const ruleAnalysis = makeRuleAnalysis(transcriptPayload.transcript, scorecards, transcriptPayload.duration);
        let rows = ruleAnalysis.rows;
        let source = "OpenAI transcription + browser rule scanner";
        let report = "";
        try {
          update({ message: `Running cloud QA for ${file.name}...`, progress: (index + 0.65) / files.length, percent: Math.round(((index + 0.65) / files.length) * 100) });
          const qa = await qaDirect(transcriptPayload.transcript, ruleAnalysis.entry, openaiApiKey.trim());
          if (Array.isArray(qa.rows) && qa.rows.length) {
            rows = qa.rows.map((row) => ({
              category: row.category || "Qualifier",
              check: row.check,
              status: row.status,
              passed: row.status === "Pass",
              result: row.result,
              evidence_time: row.evidence_time || "00:00",
            }));
            source = "OpenAI transcription + OpenAI QA";
          }
        } catch (caught) {
          report = makeErrorReport("Cloud QA model request; browser rule scanner was used", caught, {
            model: QA_MODEL,
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
      const report = makeErrorReport("Browser transcription workflow", caught, { files: Array.from(files).map((file) => file.name).join(", ") });
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

  function parseMirror() {
    const leads = parseMirrorText(mirrorText);
    setMirrorLeads(leads);
    setStatus(`Imported ${leads.length} MirrorCXT lead(s).`);
  }

  function exportReport() {
    const html = makeReport(results.map((item) => item.result), mirrorLeads);
    setReportHtml(html);
    setStatus("Report generated in browser.");
  }

  function saveOpenAiKey() {
    const trimmed = apiKeyDraft.trim();
    window.localStorage.setItem(OPENAI_KEY_STORAGE, trimmed);
    setOpenaiApiKey(trimmed);
    setStatus(trimmed ? "OpenAI key saved in this browser" : "Paste your OpenAI API key in Settings");
    setError("");
  }

  function clearOpenAiKey() {
    window.localStorage.removeItem(OPENAI_KEY_STORAGE);
    setApiKeyDraft("");
    setOpenaiApiKey("");
    setStatus("Paste your OpenAI API key in Settings");
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
          <strong>{status}</strong>
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
            <h2>Vercel-Only QA Workspace</h2>
            <p>Audio, QA, jobs, and reports run in this browser with your OpenAI API key. Keep this tab open while processing.</p>
          </div>
          <button onClick={refresh} disabled={busy}>Refresh</button>
        </header>
        {error && <div className="notice error">{error}</div>}
        {view === "jobs" && (
          <section className="panel">
            <h3>Add recordings</h3>
            <div className="drop">
              <input type="file" multiple accept="audio/*,video/*" onChange={(event) => setFiles(event.target.files)} />
              <button className="primary" disabled={busy || !files?.length || !openaiApiKey.trim()} onClick={upload}>
                {busy ? "Processing..." : "Upload and process"}
              </button>
            </div>
            {!openaiApiKey.trim() && <p className="hint">Add your OpenAI API key in Settings before uploading recordings.</p>}
            <div className="button-row">
              <button onClick={clearJobs} disabled={busy || !jobs.length}>Clear local jobs</button>
            </div>
            <JobList jobs={jobs} selectedResultId={selectedResultId} select={setSelectedResultId} removeJob={removeJob} />
          </section>
        )}
        {view === "review" && <ReviewPanel item={selected} refresh={refresh} persistJobs={persistJobs} jobs={jobs} setError={setError} />}
        {view === "scorecards" && (
          <section className="panel">
            <h3>Scorecards</h3>
            <div className="scorecard-grid">
              {scorecards?.scorecards.map((entry) => (
                <article key={entry.id}>
                  <strong>{entry.name}</strong>
                  <p>{entry.summary || `${entry.bundle?.universal_rules?.length ?? 0} universal rules, ${Object.keys(entry.bundle?.client_rule_sets ?? {}).length} client rule set(s).`}</p>
                  {entry.id === scorecards.active_scorecard_id && <span className="pill">Default</span>}
                </article>
              ))}
            </div>
          </section>
        )}
        {view === "mirrorcxt" && (
          <section className="panel">
            <h3>MirrorCXT import</h3>
            <textarea value={mirrorText} onChange={(event) => setMirrorText(event.target.value)} placeholder="Paste MirrorCXT HTML export here..." />
            <button className="primary" onClick={parseMirror} disabled={busy || !mirrorText.trim()}>Import MirrorCXT</button>
            <p>{mirrorLeads.length} Clover/MirrorCXT link(s) loaded for reports.</p>
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
              </div>
              <p className="hint">Your key stays in this browser's local storage. CompassAi uses it directly from the browser for OpenAI transcription and QA.</p>
            </div>
            <div className="settings-grid">
              <div><span>Hosting</span><strong>Vercel only</strong><p>No Render, no database, no server-owned OpenAI key.</p></div>
              <div><span>Transcription</span><strong>{TRANSCRIPTION_MODEL}</strong><p>Large files should be compressed under about 24 MB before upload.</p></div>
              <div><span>QA model</span><strong>{QA_MODEL}</strong><p>If cloud QA fails, CompassAi falls back to browser rule scanning and shows a copyable error report.</p></div>
            </div>
          </section>
        )}
        <section className="panel">
          <div className="panel-title">
            <h3>Final report</h3>
            <button className="primary" disabled={!results.length || busy} onClick={exportReport}>Generate HTML report</button>
          </div>
          {reportHtml && <iframe title="CompassAi report preview" srcDoc={reportHtml} />}
        </section>
      </main>
    </div>
  );
}

function JobList({ jobs, selectedResultId, select, removeJob }: { jobs: Job[]; selectedResultId: string; select: (id: string) => void; removeJob: (id: string) => void }) {
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
              {titleFor(result)}
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
  jobs,
  persistJobs,
  setError,
}: {
  item?: { job: Job; result: JobResult };
  refresh: () => Promise<void>;
  jobs: Job[];
  persistJobs: (jobs: Job[]) => void;
  setError: (message: string) => void;
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
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h3>{titleFor(result)}</h3>
          <p>{result.analysis.source} | Score {result.metrics?.qa_score ?? 0}% | {result.metrics?.outcome}</p>
        </div>
        <button className="primary" onClick={save}>Save QA overrides</button>
      </div>
      {result.llm_error_report && <textarea className="error-report" readOnly value={result.llm_error_report} />}
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
