# CompassAi Live Launch Steps

CompassAi is now Vercel-only. Render, Render Postgres, R2, and a server-owned OpenAI API key are not used.

## Step 1. Vercel Environment

Required Vercel env vars:

```text
AUTH_SECRET=<generated value, Vercel only>
AUTH_MICROSOFT_ENTRA_ID_ID=bfb0e894-b0c8-4395-9315-57ae9cbb3a31
AUTH_MICROSOFT_ENTRA_ID_SECRET=<paste Entra client secret in Vercel only>
AUTH_MICROSOFT_ENTRA_ID_ISSUER=https://login.microsoftonline.com/7e059612-a828-4b71-a1bc-aa25b1578e2b/v2.0
ALLOWED_EMAIL_DOMAINS=convertros.com
```

Do not add `OPENAI_API_KEY`, `DATABASE_URL`, `COMPASSAI_API_URL`, or `COMPASSAI_JWT_SECRET`. Users paste their own OpenAI API key in CompassAi Settings on first use.

## Step 2. Vercel Frontend

Vercel project settings:

- Root directory: `web`
- Framework preset: Next.js
- Build command: `npm run build`

After Vercel deploys, copy the live site URL. It will look like:

```text
https://<vercel-project>.vercel.app
```

## Step 3. Microsoft Entra Redirect

Add this web redirect URI:

```text
https://<vercel-project>.vercel.app/api/auth/callback/microsoft-entra-id
```

Existing Entra values:

- Application/client ID: `bfb0e894-b0c8-4395-9315-57ae9cbb3a31`
- Tenant ID: `7e059612-a828-4b71-a1bc-aa25b1578e2b`
- Existing local redirect: `http://localhost:3000/api/auth/callback/microsoft-entra-id`

## Step 4. Final Smoke Tests

- Open the Vercel site.
- Sign in with Microsoft.
- Confirm Scorecards includes Feldco, Bachmans, KQR, Pella, and RbA/QWD.
- Open Settings and paste an OpenAI API key for the browser you are testing with.
- Upload one short test call under about 24 MB.
- Confirm a QA result appears, or a copyable diagnostic report appears if browser/OpenAI CORS blocks direct calls.
- Edit one qualifier and save.
- Generate an HTML report.
