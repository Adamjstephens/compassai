# CompassAi

CompassAi is the secure online sister app for CompassQA Transcriber. It keeps the same QA workflow and scorecard library, but runs as a cloud web app:

- Next.js web UI for Vercel
- FastAPI backend for Render
- Microsoft Entra SSO with domain allowlist
- Bring-your-own OpenAI API key for transcription and QA
- Scorecards seeded from `compassai/shared/qa_scorecards.json`
- SQLite for local development and Postgres for production when `DATABASE_URL` is set

## Security Defaults

- Users paste their own OpenAI API key in Settings on first use.
- The OpenAI key is saved in the user's browser local storage and sent to the API only when processing recordings.
- CompassAi does not require or store a server-owned OpenAI key in Render.
- The browser receives only short-lived CompassAi API JWTs.
- Uploaded audio is written only to a temporary file and deleted after processing.
- Diagnostic reports omit full transcripts and uploaded audio contents.
- API requests are protected by per-user rate limits, upload size limits, concurrent job limits, and daily audio-minute quotas.

## Required Scorecards

The initial seed file includes:

- RbA/QWD
- Pella
- KQR
- Forte
- JPC
- Bachmans
- HRS
- Feldco
- CompassQA Transcriber V2 default scorecards

The API `/scorecards` response includes `required_clients_available=true` only when Feldco, Bachmans, KQR, Pella, and RbA/QWD are available.

## Local Development

API:

```bash
cd compassai/api
python3 -m pip install -r requirements.txt
COMPASSAI_DEV_AUTH=true COMPASSAI_JWT_SECRET=dev-secret uvicorn app.main:app --reload
```

Web:

```bash
cd compassai/web
npm install
cp .env.example .env.local
npm run dev
```

For real development, replace placeholder env values before running the web app.

## Deployment

Use [DEPLOYMENT.md](DEPLOYMENT.md) for the full launch checklist, secret generation, env validation, and deployed API smoke test.

Vercel env vars:

- `AUTH_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ID`
- `AUTH_MICROSOFT_ENTRA_ID_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
- `ALLOWED_EMAIL_DOMAINS`
- `COMPASSAI_API_URL`
- `COMPASSAI_JWT_SECRET`

Render env vars:

- `DATABASE_URL` reserved for production database migration
- `COMPASSAI_JWT_SECRET`
- `ALLOWED_ORIGINS`
- `MAX_FILE_MB`
- `MAX_DAILY_AUDIO_MINUTES_PER_USER`
- `MAX_CONCURRENT_JOBS_PER_USER`
- `RATE_LIMIT_PER_MINUTE`

Microsoft SSO is completed after Vercel deployment by adding the production callback URL to the Entra app registration:

```text
https://<vercel-domain>/api/auth/callback/microsoft-entra-id
```
