# CompassAi

CompassAi is the secure online sister app for CompassQA Transcriber. It keeps the same QA workflow and scorecard library, but runs as a cloud web app:

- Next.js web UI for Vercel
- Vercel-only browser processing with local job/report storage
- Microsoft Entra SSO with domain allowlist
- Bring-your-own OpenAI API key for transcription and QA
- Scorecards seeded from `compassai/shared/qa_scorecards.json`
- Static scorecards and browser-local jobs/reports, with optional backend storage only if added later

## Analysis Modes

- **QA Mode** preserves the client-specific scorecard workflow for booked calls, including evidence, reviewer overrides, re-grading, and QA reports.
- **Missed Opportunities Mode** evaluates non-booked calls with a universal, scorecard-free coaching workflow. It detects likely objection windows locally, sends only those windows plus the call ending for strict structured analysis, validates every returned quote against the transcript, and suppresses booked, transferred, callback, disqualified, no-contact, incomplete, or uncertain calls.
- Missed-opportunity findings, review statuses, coaching status, reviewer notes, analysis version, prompt version, model, and cache key are stored with the call in browser storage.
- Reports remain separated by call and grouped by agent.

## Security Defaults

- Users paste their own OpenAI API key in Settings on first use.
- The OpenAI key is saved in the user's browser local storage and used directly from the browser only when processing recordings.
- CompassAi does not require or store a server-owned OpenAI key.
- Uploaded audio is processed from the browser and is not stored by CompassAi.
- Diagnostic reports omit full transcripts and uploaded audio contents.
- Access is protected by Microsoft SSO; jobs and reports are stored only in the user's browser.

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

The app shows the required scorecard readiness check when Feldco, Bachmans, KQR, Pella, and RbA/QWD are available.

## Local Development

Web:

```bash
cd compassai/web
npm install
cp .env.example .env.local
npm run dev
```

Validation:

```bash
npm run typecheck
npm test
npm run build
```

For real development, replace placeholder env values before running the web app.

## Deployment

Use [DEPLOYMENT.md](DEPLOYMENT.md) for the full Vercel launch checklist, secret generation, env validation, and browser smoke test.

Vercel env vars:

- `AUTH_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ID`
- `AUTH_MICROSOFT_ENTRA_ID_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
- `ALLOWED_EMAIL_DOMAINS`
Render is not used for this Vercel-only version.

Microsoft SSO is completed after Vercel deployment by adding the production callback URL to the Entra app registration:

```text
https://<vercel-domain>/api/auth/callback/microsoft-entra-id
```
