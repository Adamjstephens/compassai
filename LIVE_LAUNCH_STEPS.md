# CompassAi Live Launch Steps

Use this checklist to get the first live CompassAi site online. The desktop download/R2 part has been removed from this launch.

## What Adam Needs Ready

- Vercel account access
- Render account access
- The Microsoft Entra client secret from the open Entra tab

Do not paste secrets into chat. Users will paste their own OpenAI API key inside CompassAi Settings on first use.

## Step 1. Generate App Secrets

From the project folder:

```bash
cd compassai/web
npm run secrets
```

This prints:

- `AUTH_SECRET`
- `COMPASSAI_JWT_SECRET`

Use a fresh generated pair for production. `AUTH_SECRET` goes only in Vercel. `COMPASSAI_JWT_SECRET` must be the same in Vercel and Render.

## Step 2. Render Backend

Create this in Render:

- A Web Service for the API

Render Web Service settings:

- Root directory: `compassai/api`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

Render API environment variables:

```text
COMPASSAI_JWT_SECRET=<same generated value used in Vercel>
ALLOWED_ORIGINS=https://<vercel-domain>
COMPASSAI_FREE_HOSTING_MODE=true
MAX_FILE_MB=250
MAX_DAILY_AUDIO_MINUTES_PER_USER=300
MAX_CONCURRENT_JOBS_PER_USER=2
RATE_LIMIT_PER_MINUTE=120
```

Do not add `OPENAI_API_KEY` or `DATABASE_URL` to Render for the free launch. CompassAi is BYOK: each user provides their own OpenAI key in the app UI. The free launch uses temporary service storage, so users should export reports they want to keep.

After Render deploys, copy the API URL. It will look like:

```text
https://<render-service-name>.onrender.com
```

## Step 3. Vercel Frontend

Create a Vercel project.

Vercel project settings:

- Root directory: `compassai/web`
- Framework preset: Next.js
- Build command: `npm run build`

Vercel environment variables:

```text
AUTH_SECRET=<generated value, Vercel only>
AUTH_MICROSOFT_ENTRA_ID_ID=bfb0e894-b0c8-4395-9315-57ae9cbb3a31
AUTH_MICROSOFT_ENTRA_ID_SECRET=<paste Entra client secret in Vercel only>
AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/7e059612-a828-4b71-a1bc-aa25b1578e2b/v2.0
ALLOWED_EMAIL_DOMAINS=convertros.com
COMPASSAI_API_URL=https://<render-service-name>.onrender.com
COMPASSAI_JWT_SECRET=<same generated value used in Render>
```

After Vercel deploys, copy the live site URL. It will look like:

```text
https://<vercel-project>.vercel.app
```

## Step 4. Add Production Redirect In Microsoft Entra

Open the existing CompassAi app registration in Entra.

Add this web redirect URI:

```text
https://<vercel-project>.vercel.app/api/auth/callback/microsoft-entra-id
```

Existing Entra values:

- Application/client ID: `bfb0e894-b0c8-4395-9315-57ae9cbb3a31`
- Tenant ID: `7e059612-a828-4b71-a1bc-aa25b1578e2b`
- Existing local redirect: `http://localhost:3000/api/auth/callback/microsoft-entra-id`

## Step 5. Final Smoke Tests

Run API smoke after Render deploys:

```bash
python3 compassai/scripts/deploy_smoke.py \
  --api-url https://<render-service-name>.onrender.com \
  --jwt-secret <same COMPASSAI_JWT_SECRET>
```

Then test in the browser:

- Open the Vercel site.
- Sign in with Microsoft.
- Open Settings and paste an OpenAI API key for the browser you are testing with.
- Confirm non-allowlisted domains are rejected if testing with another account.
- Confirm Scorecards includes Feldco, Bachmans, KQR, Pella, and RbA/QWD.
- Upload one short test call.
- Confirm a QA result appears.
- Edit one qualifier and save.
- Generate an HTML report.

## Current Known Entra App

- Name: `CompassAi`
- Client ID: `bfb0e894-b0c8-4395-9315-57ae9cbb3a31`
- Object ID: `5544512e-a0a8-4c8d-8455-09ee4147c6eb`
- Tenant ID: `7e059612-a828-4b71-a1bc-aa25b1578e2b`
- Client secret expires: July 13, 2028
