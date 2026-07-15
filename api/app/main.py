from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .security import require_user


REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.core_loader import load_core  # noqa: E402


APP_VERSION = "0.1.0"
APP_NAME = "CompassAi"
DATA_DIR = Path(os.environ.get("COMPASSAI_DATA_DIR", REPO_ROOT / "compassai" / ".data")).expanduser()
DB_PATH = DATA_DIR / "compassai.sqlite3"
EXPORT_DIR = DATA_DIR / "exports"
SHARED_SCORECARDS = REPO_ROOT / "compassai" / "shared" / "qa_scorecards.json"
OPENAI_HOST = "https://api.openai.com/v1"
DEFAULT_QA_MODEL = os.environ.get("OPENAI_QA_MODEL", "gpt-4o-mini")
DEFAULT_TRANSCRIPTION_MODEL = os.environ.get("OPENAI_TRANSCRIPTION_MODEL", "gpt-4o-mini-transcribe")
MAX_FILE_MB = int(os.environ.get("MAX_FILE_MB", "250"))
MAX_DAILY_AUDIO_MINUTES_PER_USER = int(os.environ.get("MAX_DAILY_AUDIO_MINUTES_PER_USER", "300"))
MAX_CONCURRENT_JOBS_PER_USER = int(os.environ.get("MAX_CONCURRENT_JOBS_PER_USER", "2"))
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
USE_POSTGRES = DATABASE_URL.startswith(("postgres://", "postgresql://"))

DATA_DIR.mkdir(parents=True, exist_ok=True)
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_ORIGIN_VALUES = [origin.strip() for origin in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if origin.strip()]
ALLOW_ANY_ORIGIN = "*" in ALLOWED_ORIGIN_VALUES

app = FastAPI(title="CompassAi API", version=APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if ALLOW_ANY_ORIGIN else ALLOWED_ORIGIN_VALUES,
    allow_credentials=not ALLOW_ANY_ORIGIN,
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_LOCK = threading.Lock()
CORE_LOCK = threading.Lock()
JOBS_LOCK = threading.Lock()
RUNNING_JOBS: dict[str, threading.Thread] = {}


class ReviewRequest(BaseModel):
    overrides: list[dict[str, Any]] = Field(default_factory=list)
    final_grade: str = ""
    reviewer_note: str = ""


class ScorecardUpdateRequest(BaseModel):
    name: str = ""
    bundle: dict[str, Any]


class MirrorParseRequest(BaseModel):
    html_text: str


class ExportRequest(BaseModel):
    job_ids: list[str] = Field(default_factory=list)
    result_ids: list[str] = Field(default_factory=list)
    mirror_leads: list[dict[str, Any]] = Field(default_factory=list)


def db() -> Any:
    if USE_POSTGRES:
        try:
            import psycopg
            from psycopg.rows import dict_row
        except ImportError as exc:
            raise RuntimeError("DATABASE_URL is set, but psycopg is not installed.") from exc
        return psycopg.connect(DATABASE_URL, row_factory=dict_row)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def sql(query: str) -> str:
    return query.replace("?", "%s") if USE_POSTGRES else query


def execute(conn: Any, query: str, params: tuple[Any, ...] = ()) -> Any:
    return conn.execute(sql(query), params)


def init_db() -> None:
    with DB_LOCK, db() as conn:
        statements = [
            """
            CREATE TABLE IF NOT EXISTS jobs (
              id TEXT PRIMARY KEY,
              user_email TEXT NOT NULL,
              status TEXT NOT NULL,
              message TEXT NOT NULL,
              progress REAL NOT NULL DEFAULT 0,
              created_at REAL NOT NULL,
              started_at REAL,
              finished_at REAL,
              payload_json TEXT NOT NULL
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_jobs_user_created ON jobs(user_email, created_at DESC)",
            """
            CREATE TABLE IF NOT EXISTS results (
              id TEXT PRIMARY KEY,
              job_id TEXT NOT NULL,
              user_email TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              created_at REAL NOT NULL,
              FOREIGN KEY(job_id) REFERENCES jobs(id)
            )
            """,
            "CREATE INDEX IF NOT EXISTS idx_results_job ON results(job_id)",
            """
            CREATE TABLE IF NOT EXISTS reports (
              id TEXT PRIMARY KEY,
              user_email TEXT NOT NULL,
              html TEXT NOT NULL,
              created_at REAL NOT NULL
            )
            """,
        ]
        for statement in statements:
            execute(conn, statement)


init_db()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_dumps(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def json_loads(value: str, fallback: Any) -> Any:
    try:
        return json.loads(value)
    except Exception:
        return fallback


def core():
    with CORE_LOCK:
        loaded = load_core()
        if SHARED_SCORECARDS.exists() and getattr(loaded, "SCORECARD_FILE", None) != SHARED_SCORECARDS:
            loaded.SCORECARD_FILE = SHARED_SCORECARDS
            loaded.st.session_state.pop("scorecard_library", None)
            loaded.st.session_state.pop("scorecard_bundle", None)
        return loaded


def make_safe_error_report(stage: str, provider: str, error: str, **extra: Any) -> str:
    lines = [
        "CompassAi Cloud LLM Error Report",
        "",
        f"What failed: {stage}",
        f"Provider: {provider}",
        f"Exact error: {error}",
        f"Timestamp: {now_iso()}",
        f"Platform: {sys.platform}",
        f"App version: {APP_VERSION}",
        f"Backend version: {APP_VERSION}",
        f"Python version: {sys.version.split()[0]}",
    ]
    for key, value in extra.items():
        if value not in (None, ""):
            lines.append(f"{key.replace('_', ' ').title()}: {value}")
    lines.append("Likely fix: check OpenAI API key, billing, quotas, model availability, and retry with a smaller file if needed.")
    lines.append("Transcript and uploaded audio contents are intentionally omitted for privacy.")
    return "\n".join(lines)


def active_scorecard_names() -> list[str]:
    library = core().get_scorecard_library()
    return [entry.get("name", "") for entry in library.get("scorecards", [])]


def get_job_row(job_id: str, email: str) -> Any:
    with DB_LOCK, db() as conn:
        row = execute(conn, "SELECT * FROM jobs WHERE id=? AND user_email=?", (job_id, email)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return row


def save_job(job_id: str, email: str, status: str, message: str, progress: float, payload: dict[str, Any], *, started_at: float | None = None, finished_at: float | None = None) -> None:
    with DB_LOCK, db() as conn:
        existing = execute(conn, "SELECT created_at, started_at, finished_at FROM jobs WHERE id=?", (job_id,)).fetchone()
        created_at = float(existing["created_at"]) if existing else time.time()
        if started_at is None and existing:
            started_at = existing["started_at"]
        if finished_at is None and existing:
            finished_at = existing["finished_at"]
        execute(conn, 
            """
            INSERT INTO jobs(id,user_email,status,message,progress,created_at,started_at,finished_at,payload_json)
            VALUES(?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              status=excluded.status,
              message=excluded.message,
              progress=excluded.progress,
              started_at=excluded.started_at,
              finished_at=excluded.finished_at,
              payload_json=excluded.payload_json
            """,
            (job_id, email, status, message, progress, created_at, started_at, finished_at, json_dumps(payload)),
        )


def save_result(job_id: str, email: str, result: dict[str, Any]) -> None:
    with DB_LOCK, db() as conn:
        execute(conn, 
            """
            INSERT INTO results(id,job_id,user_email,payload_json,created_at)
            VALUES(?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json
            """,
            (result["result_id"], job_id, email, json_dumps(result), time.time()),
        )


def daily_audio_minutes(email: str) -> float:
    cutoff = time.time() - 86400
    total_seconds = 0.0
    with DB_LOCK, db() as conn:
        rows = execute(conn, 
            "SELECT payload_json FROM results WHERE user_email=? AND created_at>=?",
            (email, cutoff),
        ).fetchall()
    for row in rows:
        payload = json_loads(row["payload_json"], {})
        try:
            total_seconds += float((payload.get("info") or {}).get("duration") or 0)
        except (TypeError, ValueError):
            continue
    return round(total_seconds / 60, 2)


def ensure_daily_quota_available(email: str) -> None:
    used = daily_audio_minutes(email)
    if used >= MAX_DAILY_AUDIO_MINUTES_PER_USER:
        raise HTTPException(
            status_code=429,
            detail=f"Daily audio-minute quota reached. Used {used} of {MAX_DAILY_AUDIO_MINUTES_PER_USER} minutes in the last 24 hours.",
        )


def list_results(job_id: str, email: str) -> list[dict[str, Any]]:
    with DB_LOCK, db() as conn:
        rows = execute(conn, "SELECT payload_json FROM results WHERE job_id=? AND user_email=? ORDER BY created_at", (job_id, email)).fetchall()
    return [enrich_result(json_loads(row["payload_json"], {})) for row in rows]


def job_snapshot(row: Any, email: str) -> dict[str, Any]:
    payload = json_loads(row["payload_json"], {})
    started = float(row["started_at"] or 0)
    finished = float(row["finished_at"] or 0)
    elapsed = (finished or time.time()) - started if started else 0
    progress = float(row["progress"] or 0)
    eta = round((elapsed / progress) - elapsed) if started and 0 < progress < 1 else 0
    return {
        **payload,
        "job_id": row["id"],
        "status": row["status"],
        "message": row["message"],
        "progress": progress,
        "percent": round(progress * 100),
        "elapsed_seconds": max(0, elapsed),
        "eta_seconds": max(0, eta),
        "results": list_results(row["id"], email),
    }


def editor_rows_from_analysis(analysis: dict[str, Any]) -> list[dict[str, str]]:
    rows = []
    for row in analysis.get("rows", []):
        if row.get("check") == "Client identified":
            continue
        status = str(row.get("status") or ("Pass" if row.get("passed") else "Fail"))
        rows.append(
            {
                "Category": str(row.get("category") or ""),
                "Qualifier": str(row.get("check") or ""),
                "System status": status,
                "Final status": status,
                "Time": str(row.get("evidence_time") or ""),
                "Evidence": str(row.get("result") or ""),
                "Reviewer note": str(row.get("reviewer_note") or ""),
            }
        )
    return rows


def metrics_from_analysis(analysis: dict[str, Any], final_grade: str = "") -> dict[str, Any]:
    c = core()
    qa_score, passed_scored, scored_total = c.get_qa_score(analysis)
    passed_count, total_count = c.get_qualifier_counts(analysis)
    return {
        "qa_score": qa_score,
        "passed_scored": passed_scored,
        "scored_total": scored_total,
        "passed_count": passed_count,
        "total_count": total_count,
        "outcome": c.get_qa_outcome(analysis),
        "final_grade": final_grade or "Approved",
    }


def apply_overrides(result: dict[str, Any]) -> dict[str, Any]:
    c = core()
    analysis = dict(result.get("raw_analysis") or result.get("analysis") or {})
    overrides = list(result.get("qa_overrides") or [])
    if overrides:
        next_override = 0
        rows = []
        for row in analysis.get("rows", []):
            updated = dict(row)
            if row.get("check") != "Client identified" and next_override < len(overrides):
                override = overrides[next_override]
                final_status = str(override.get("Final status") or updated.get("status") or "")
                evidence = str(override.get("Evidence") or updated.get("result") or "")
                note = str(override.get("Reviewer note") or updated.get("reviewer_note") or "")
                updated["status"] = final_status
                updated["result"] = evidence
                updated["reviewer_note"] = note
                updated["passed"] = c.status_to_passed(final_status, evidence)
                updated["evidence_time"] = str(override.get("Time") or updated.get("evidence_time") or "")
                if final_status != str(override.get("System status") or "") or note:
                    updated["overridden"] = True
                next_override += 1
            rows.append(updated)
        analysis["rows"] = rows
    return {**result, "analysis": analysis}


def enrich_result(result: dict[str, Any]) -> dict[str, Any]:
    c = core()
    working = apply_overrides(result)
    analysis = working.get("analysis") or {}
    final_grade = working.get("final_grade") or c.get_default_final_grade(working)
    working["final_grade"] = final_grade
    working["metrics"] = metrics_from_analysis(analysis, final_grade)
    working["label"] = c.make_result_label(working, 0)
    return working


def analyze_transcript(transcript: str, segments: list[dict[str, Any]], api_key: str) -> tuple[dict[str, Any], str | None]:
    c = core()
    scorecard_entry = c._pick_scorecard_entry_for_transcript(transcript, segments)
    llm_report = None
    analysis = c.run_openai_compatible_analysis(
        transcript,
        DEFAULT_QA_MODEL,
        OPENAI_HOST,
        timeout_seconds=180,
        segments=segments,
        scorecard_bundle=scorecard_entry.get("bundle"),
        provider="openai",
        api_key=api_key,
    )
    if not analysis:
        llm_report = c.get_ollama_error_report() or make_safe_error_report(
            "QA analysis",
            "OpenAI Cloud",
            "OpenAI QA failed; rule-based scanner was used.",
            requested_model=DEFAULT_QA_MODEL,
            transcript_characters=min(len(transcript), 18000),
        )
        analysis = c.build_rule_based_analysis(transcript, segments=segments, scorecard_entry=scorecard_entry)
        analysis["source"] = "Built-in scanner after OpenAI Cloud failure"
    return analysis, llm_report


def process_job(job_id: str, email: str, files: list[tuple[str, bytes]], language: str, api_key: str) -> None:
    api_key = api_key.strip()
    payload = {"source_files": [name for name, _ in files], "total_files": len(files)}
    save_job(job_id, email, "running", "Starting cloud transcription...", 0.02, payload, started_at=time.time())
    if not api_key:
        report = make_safe_error_report("cloud transcription", "OpenAI Cloud", "No user OpenAI API key was provided with this job.")
        save_job(job_id, email, "failed", "OpenAI API key is required before processing.", 1, {**payload, "error_report": report}, finished_at=time.time())
        return

    c = core()
    completed = 0
    for filename, content in files:
        if daily_audio_minutes(email) >= MAX_DAILY_AUDIO_MINUTES_PER_USER:
            save_job(
                job_id,
                email,
                "failed",
                f"Daily audio-minute quota reached after {completed}/{len(files)} call(s).",
                completed / max(1, len(files)),
                {**payload, "completed_count": completed, "daily_audio_minutes_used": daily_audio_minutes(email)},
                finished_at=time.time(),
            )
            return
        suffix = Path(filename).suffix or ".audio"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            save_job(job_id, email, "running", f"Transcribing {filename}...", (completed / max(1, len(files))) + 0.05, {**payload, "current_file": filename})
            transcript_text, srt_text, json_text, info, elapsed_seconds, segments = c.transcribe_file_openai(
                tmp_path,
                DEFAULT_TRANSCRIPTION_MODEL,
                language,
                OPENAI_HOST,
                api_key,
                900,
            )
            save_job(job_id, email, "running", f"Running QA for {filename}...", (completed + 0.7) / max(1, len(files)), {**payload, "current_file": filename})
            analysis, llm_report = analyze_transcript(transcript_text, segments, api_key)
            result = {
                "result_id": str(uuid.uuid4()),
                "file_name": filename,
                "transcript_text": transcript_text,
                "srt_text": srt_text,
                "json_text": json_text,
                "elapsed_seconds": elapsed_seconds,
                "segments": segments,
                "info": {
                    "language": getattr(info, "language", language),
                    "language_probability": getattr(info, "language_probability", 0),
                    "duration": getattr(info, "duration", 0),
                },
                "analysis": analysis,
                "raw_analysis": analysis,
                "qa_overrides": editor_rows_from_analysis(analysis),
                "llm_error_report": llm_report,
            }
            save_result(job_id, email, result)
            completed += 1
            save_job(job_id, email, "running", f"Completed {completed}/{len(files)} calls.", completed / max(1, len(files)), {**payload, "completed_count": completed})
        except Exception as exc:
            report = make_safe_error_report(
                "cloud transcription or QA",
                "OpenAI Cloud",
                str(exc),
                requested_transcription_model=DEFAULT_TRANSCRIPTION_MODEL,
                requested_qa_model=DEFAULT_QA_MODEL,
            )
            save_job(job_id, email, "failed", f"Processing failed for {filename}: {exc}", 1, {**payload, "error_report": report}, finished_at=time.time())
            return
        finally:
            try:
                Path(tmp_path).unlink(missing_ok=True)
            except Exception:
                pass
    save_job(job_id, email, "complete", f"Completed {completed} file(s).", 1, {**payload, "completed_count": completed}, finished_at=time.time())


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "compassai-api", "version": APP_VERSION}


@app.get("/system/status")
def system_status(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    return {
        "app": APP_NAME,
        "version": APP_VERSION,
        "user": user["email"],
        "openai_key_mode": "user_provided",
        "scorecards": active_scorecard_names(),
        "quotas": {
            "max_file_mb": MAX_FILE_MB,
            "max_daily_audio_minutes": MAX_DAILY_AUDIO_MINUTES_PER_USER,
            "daily_audio_minutes_used": daily_audio_minutes(user["email"]),
            "max_concurrent_jobs": MAX_CONCURRENT_JOBS_PER_USER,
        },
    }


@app.post("/jobs")
async def create_job(
    files: list[UploadFile] = File(...),
    language: str = Form("en"),
    openai_api_key: Optional[str] = Header(default=None, alias="X-OpenAI-API-Key"),
    user: dict[str, Any] = Depends(require_user),
) -> dict[str, Any]:
    email = user["email"]
    if not (openai_api_key or "").strip():
        raise HTTPException(status_code=400, detail="Paste and save your OpenAI API key in Settings before processing calls.")
    ensure_daily_quota_available(email)
    with DB_LOCK, db() as conn:
        running_count = execute(conn, 
            "SELECT COUNT(*) AS count FROM jobs WHERE user_email=? AND status IN ('queued','running')",
            (email,),
        ).fetchone()["count"]
    if running_count >= MAX_CONCURRENT_JOBS_PER_USER:
        raise HTTPException(status_code=429, detail="Too many active jobs for this user.")

    materialized: list[tuple[str, bytes]] = []
    for upload in files:
        content = await upload.read()
        if len(content) > MAX_FILE_MB * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"{upload.filename} exceeds the {MAX_FILE_MB} MB upload limit.")
        materialized.append((upload.filename or "recording", content))
    job_id = str(uuid.uuid4())
    payload = {"source_files": [name for name, _ in materialized], "total_files": len(materialized), "created_at": now_iso()}
    save_job(job_id, email, "queued", "Job queued.", 0, payload)
    thread = threading.Thread(target=process_job, args=(job_id, email, materialized, language, openai_api_key), daemon=True)
    with JOBS_LOCK:
        RUNNING_JOBS[job_id] = thread
    thread.start()
    return get_job(job_id, user)


@app.get("/jobs")
def list_jobs(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    email = user["email"]
    with DB_LOCK, db() as conn:
        rows = execute(conn, "SELECT * FROM jobs WHERE user_email=? ORDER BY created_at DESC", (email,)).fetchall()
    return {"jobs": [job_snapshot(row, email) for row in rows]}


@app.get("/jobs/{job_id}")
def get_job(job_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    email = user["email"]
    return job_snapshot(get_job_row(job_id, email), email)


@app.delete("/jobs/{job_id}")
def delete_job(job_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    email = user["email"]
    get_job_row(job_id, email)
    with DB_LOCK, db() as conn:
        execute(conn, "DELETE FROM results WHERE job_id=? AND user_email=?", (job_id, email))
        execute(conn, "DELETE FROM jobs WHERE id=? AND user_email=?", (job_id, email))
    return {"ok": True}


@app.post("/jobs/{job_id}/results/{result_id}/review")
def save_review(job_id: str, result_id: str, request: ReviewRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    email = user["email"]
    get_job_row(job_id, email)
    with DB_LOCK, db() as conn:
        row = execute(conn, "SELECT payload_json FROM results WHERE id=? AND job_id=? AND user_email=?", (result_id, job_id, email)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Result not found")
        result = json_loads(row["payload_json"], {})
        result["qa_overrides"] = request.overrides
        result["final_grade"] = request.final_grade
        result["reviewer_note"] = request.reviewer_note
        execute(conn, "UPDATE results SET payload_json=? WHERE id=? AND job_id=? AND user_email=?", (json_dumps(result), result_id, job_id, email))
    return get_job(job_id, user)


@app.post("/jobs/{job_id}/results/{result_id}/review/reset")
def reset_review(job_id: str, result_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    email = user["email"]
    get_job_row(job_id, email)
    with DB_LOCK, db() as conn:
        row = execute(conn, "SELECT payload_json FROM results WHERE id=? AND job_id=? AND user_email=?", (result_id, job_id, email)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Result not found")
        result = json_loads(row["payload_json"], {})
        analysis = result.get("raw_analysis") or result.get("analysis") or {}
        result["qa_overrides"] = editor_rows_from_analysis(analysis)
        result.pop("final_grade", None)
        result.pop("reviewer_note", None)
        execute(conn, "UPDATE results SET payload_json=? WHERE id=? AND job_id=? AND user_email=?", (json_dumps(result), result_id, job_id, email))
    return get_job(job_id, user)


@app.get("/scorecards")
def get_scorecards(user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    c = core()
    library = c.get_scorecard_library()
    return {
        "active_scorecard_id": library.get("active_scorecard_id"),
        "scorecards": library.get("scorecards", []),
        "seeded_from": str(SHARED_SCORECARDS),
        "required_clients_available": all(name in active_scorecard_names() for name in ["Feldco", "Bachmans", "KQR", "Pella", "RbA/QWD"]),
    }


@app.post("/scorecards/import")
def import_scorecard(payload: dict[str, Any], user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    c = core()
    bundle = payload.get("bundle") if isinstance(payload, dict) else None
    if not isinstance(bundle, dict):
        raise HTTPException(status_code=400, detail="Scorecard import expects a JSON bundle.")
    errors = c.validate_scorecard_bundle(bundle)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    c.add_scorecard_to_library(bundle, source_name=str(payload.get("source_name") or "CompassAi upload"))
    return get_scorecards(user)


@app.put("/scorecards/{scorecard_id}")
def update_scorecard(scorecard_id: str, request: ScorecardUpdateRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    c = core()
    errors = c.validate_scorecard_bundle(request.bundle)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))
    library = c.get_scorecard_library()
    entries = []
    found = False
    for entry in library.get("scorecards", []):
        if entry.get("id") == scorecard_id:
            found = True
            entries.append({**entry, "name": request.name or entry.get("name"), "bundle": c.normalize_scorecard_bundle(request.bundle)})
        else:
            entries.append(entry)
    if not found:
        raise HTTPException(status_code=404, detail="Scorecard not found")
    c.set_scorecard_library({**library, "scorecards": entries})
    return get_scorecards(user)


@app.delete("/scorecards/{scorecard_id}")
def delete_scorecard(scorecard_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    c = core()
    c.delete_scorecard_from_library(scorecard_id)
    return get_scorecards(user)


@app.post("/mirrorcxt/parse")
def parse_mirrorcxt(request: MirrorParseRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    leads, export_format = core().parse_mirrorcxt_export(request.html_text)
    return {"format": export_format, "leads": leads, "count": len(leads)}


@app.post("/exports/report")
def export_report(request: ExportRequest, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    email = user["email"]
    selected = set(request.result_ids)
    results: list[dict[str, Any]] = []
    with DB_LOCK, db() as conn:
        for job_id in request.job_ids:
            rows = execute(conn, "SELECT payload_json FROM results WHERE job_id=? AND user_email=?", (job_id, email)).fetchall()
            for row in rows:
                result = enrich_result(json_loads(row["payload_json"], {}))
                if selected and result.get("result_id") not in selected:
                    continue
                results.append(result)
    if not results:
        raise HTTPException(status_code=400, detail="No completed job results selected.")
    html = core().make_batch_html_report(results, request.mirror_leads)
    report_id = str(uuid.uuid4())
    with DB_LOCK, db() as conn:
        execute(conn, "INSERT INTO reports(id,user_email,html,created_at) VALUES(?,?,?,?)", (report_id, email, html, time.time()))
    output = EXPORT_DIR / f"compassai_report_{report_id}.html"
    output.write_text(html, encoding="utf-8")
    return {"report_id": report_id, "path": str(output), "html": html}


@app.get("/exports/{report_id}")
def get_report(report_id: str, user: dict[str, Any] = Depends(require_user)) -> dict[str, Any]:
    with DB_LOCK, db() as conn:
        row = execute(conn, "SELECT html, created_at FROM reports WHERE id=? AND user_email=?", (report_id, user["email"])).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    return {"report_id": report_id, "html": row["html"], "created_at": row["created_at"]}
