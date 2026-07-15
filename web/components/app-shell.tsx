"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type ScorecardEntry = { id: string; name: string; summary?: string; bundle?: Record<string, unknown> };
type ScorecardLibrary = { active_scorecard_id: string; scorecards: ScorecardEntry[]; required_clients_available?: boolean };
type JobResult = {
  result_id: string;
  file_name: string;
  label?: string;
  transcript_text: string;
  analysis: { client?: string; source?: string; scorecard_name?: string; rows?: any[]; notes?: string };
  qa_overrides?: EditorRow[];
  metrics?: { qa_score: number; passed_count: number; total_count: number; outcome: string; final_grade: string };
  llm_error_report?: string;
};
type Job = {
  job_id: string;
  status: string;
  message: string;
  progress: number;
  percent: number;
  eta_seconds?: number;
  elapsed_seconds?: number;
  source_files?: string[];
  results: JobResult[];
  error_report?: string;
};
type EditorRow = {
  Category: string;
  Qualifier: string;
  "System status": string;
  "Final status": string;
  Time: string;
  Evidence: string;
  "Reviewer note": string;
};

const OPENAI_KEY_STORAGE = "compassai.openaiApiKey";

async function getToken() {
  const response = await fetch("/api/compassai-token", { method: "POST" });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<{ token: string; apiUrl: string }>;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { token, apiUrl } = await getToken();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {})
    }
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function fmtSeconds(value = 0) {
  if (!value) return "0s";
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
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

  const refresh = useCallback(async () => {
    try {
      const [jobPayload, cardPayload, system] = await Promise.all([
        apiFetch<{ jobs: Job[] }>("/jobs"),
        apiFetch<ScorecardLibrary>("/scorecards"),
        apiFetch<any>("/system/status")
      ]);
      setJobs(jobPayload.jobs);
      setScorecards(cardPayload);
      setStatus(openaiApiKey ? "OpenAI key saved in this browser" : "Paste your OpenAI API key in Settings");
      if (!selectedResultId && jobPayload.jobs.flatMap((job) => job.results).length) {
        setSelectedResultId(jobPayload.jobs.flatMap((job) => job.results)[0].result_id);
      }
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [openaiApiKey, selectedResultId]);

  useEffect(() => {
    const stored = window.localStorage.getItem(OPENAI_KEY_STORAGE) ?? "";
    setOpenaiApiKey(stored);
    setApiKeyDraft(stored);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function upload() {
    if (!files?.length) return;
    if (!openaiApiKey.trim()) {
      setView("settings");
      setError("Paste and save your OpenAI API key before processing calls.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("files", file));
    form.append("language", "en");
    try {
      await apiFetch("/jobs", {
        method: "POST",
        body: form,
        headers: { "X-OpenAI-API-Key": openaiApiKey.trim() }
      });
      setStatus("Job queued.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function removeJob(jobId: string) {
    setBusy(true);
    try {
      await apiFetch(`/jobs/${jobId}`, { method: "DELETE" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function parseMirror() {
    setBusy(true);
    try {
      const payload = await apiFetch<{ leads: any[]; count: number; format: string }>("/mirrorcxt/parse", {
        method: "POST",
        body: JSON.stringify({ html_text: mirrorText })
      });
      setMirrorLeads(payload.leads);
      setStatus(`Imported ${payload.count} MirrorCXT lead(s).`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function exportReport() {
    setBusy(true);
    try {
      const payload = await apiFetch<{ html: string; report_id: string }>("/exports/report", {
        method: "POST",
        body: JSON.stringify({
          job_ids: Array.from(new Set(results.map((item) => item.job.job_id))),
          result_ids: results.map((item) => item.result.result_id),
          mirror_leads: mirrorLeads
        })
      });
      setReportHtml(payload.html);
      setStatus(`Report generated: ${payload.report_id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
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
            <h2>Online QA Workspace</h2>
            <p>Cloud transcription and QA using the OpenAI API key saved in this browser.</p>
          </div>
          <button onClick={refresh} disabled={busy}>Refresh</button>
        </header>
        {error && <div className="notice error">{error}</div>}
        {view === "jobs" && (
          <section className="panel">
            <h3>Add recordings</h3>
            <div className="drop">
              <input type="file" multiple accept="audio/*,video/*" onChange={(event) => setFiles(event.target.files)} />
              <button className="primary" disabled={busy || !files?.length || !openaiApiKey.trim()} onClick={upload}>Upload and process</button>
            </div>
            {!openaiApiKey.trim() && <p className="hint">Add your OpenAI API key in Settings before uploading recordings.</p>}
            <JobList jobs={jobs} selectedResultId={selectedResultId} select={setSelectedResultId} removeJob={removeJob} />
          </section>
        )}
        {view === "review" && (
          <ReviewPanel item={selected} refresh={refresh} setError={setError} />
        )}
        {view === "scorecards" && (
          <section className="panel">
            <h3>Scorecards</h3>
            <div className="scorecard-grid">
              {scorecards?.scorecards.map((entry) => (
                <article key={entry.id}>
                  <strong>{entry.name}</strong>
                  <p>{entry.summary}</p>
                  {entry.id === scorecards.active_scorecard_id && <span className="pill">Active</span>}
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
            <p>{mirrorLeads.length} lead(s) loaded for report matching.</p>
          </section>
        )}
        {view === "settings" && (
          <section className="panel">
            <h3>Settings</h3>
            <div className="api-key-box">
              <label>
                OpenAI API key
                <input
                  type="password"
                  value={apiKeyDraft}
                  onChange={(event) => setApiKeyDraft(event.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                />
              </label>
              <div className="button-row">
                <button className="primary" onClick={saveOpenAiKey}>Save key in this browser</button>
                <button onClick={clearOpenAiKey}>Clear key</button>
              </div>
              <p className="hint">Your key is stored in this browser's local storage and sent to CompassAi only when you process recordings. It is not stored in the app database or Render environment.</p>
            </div>
            <div className="settings-grid">
              <div><span>Transcription</span><strong>OpenAI Cloud</strong><p>Audio is processed server-side and deleted after processing.</p></div>
              <div><span>QA model</span><strong>gpt-4o-mini</strong><p>Each user supplies their own OpenAI API key for transcription and QA.</p></div>
              <div><span>Access</span><strong>Microsoft SSO</strong><p>Only allowlisted signed-in domains can reach the app.</p></div>
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
          <p>{job.percent}% complete | ETA {fmtSeconds(job.eta_seconds)} | {job.message}</p>
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

function ReviewPanel({ item, refresh, setError }: { item?: { job: Job; result: JobResult }; refresh: () => Promise<void>; setError: (message: string) => void }) {
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [finalGrade, setFinalGrade] = useState("Approved");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const preRef = useRef<HTMLPreElement>(null);

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

  async function save() {
    if (!item) return;
    try {
      await apiFetch(`/jobs/${item.job.job_id}/results/${item.result.result_id}/review`, {
        method: "POST",
        body: JSON.stringify({ overrides: rows, final_grade: finalGrade, reviewer_note: note })
      });
      await refresh();
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
          <pre ref={preRef}>{highlight(result.transcript_text, search, active)}</pre>
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
