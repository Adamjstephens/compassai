# CompassAi Deployment Checklist

Use this after the source builds locally. Do not commit real secrets.

## 1. Generate Secrets

```bash
cd compassai/web
npm run secrets
```

Set:

- `AUTH_SECRET` in Vercel only.
- `COMPASSAI_JWT_SECRET` in both Vercel and Render.

## 2. Render API

Create the Render web service from `compassai/render.yaml`.

Required Render env vars:

- `COMPASSAI_JWT_SECRET`
- `ALLOWED_ORIGINS`
- `MAX_FILE_MB`
- `MAX_DAILY_AUDIO_MINUTES_PER_USER`
- `MAX_CONCURRENT_JOBS_PER_USER`
- `RATE_LIMIT_PER_MINUTE`

For the 100% free/no-payment launch, leave `DATABASE_URL` unset and use the Render Free web service only. This avoids expiring database trials and payment methods. Set `ALLOWED_ORIGINS=*` until the final Vercel domain is known, or replace it with the exact Vercel domain later. The tradeoff is temporary/session-style storage on the API host, so users should export reports they want to keep. A paid persistent database can be added later by setting `DATABASE_URL`.

OpenAI keys are not configured in Render. Each signed-in user pastes their own OpenAI API key in CompassAi Settings before processing recordings.

After Render deploys:

```bash
python3 compassai/scripts/deploy_smoke.py \
  --api-url https://<render-api-host> \
  --jwt-secret <same-compassai-jwt-secret>
```

## 3. Vercel Web

Set the Vercel project root to `compassai/web`.

Required Vercel env vars:

- `AUTH_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ID`
- `AUTH_MICROSOFT_ENTRA_ID_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
- `ALLOWED_EMAIL_DOMAINS`
- `COMPASSAI_API_URL`
- `COMPASSAI_JWT_SECRET`

Set `COMPASSAI_API_URL` to the Render API URL.

## 4. Microsoft Entra App Registration

The CompassAi app registration has been created in the Convertros tenant.

Current Entra values:

- App registration name: `CompassAi`
- Application/client ID: `bfb0e894-b0c8-4395-9315-57ae9cbb3a31`
- Object ID: `5544512e-a0a8-4c8d-8455-09ee4147c6eb`
- Tenant ID: `7e059612-a828-4b71-a1bc-aa25b1578e2b`
- Supported account type: single tenant, `My organization only`
- Existing web redirect URI: `http://localhost:3000/api/auth/callback/microsoft-entra-id`
- Client secret description: `CompassAi Vercel Auth.js`
- Client secret expiration: `July 13, 2028`

Add this redirect URI after Vercel has a production URL:

```text
https://<vercel-domain>/api/auth/callback/microsoft-entra-id
```

Use the tenant-specific issuer:

```text
https://login.microsoftonline.com/7e059612-a828-4b71-a1bc-aa25b1578e2b/v2.0
```

Set `ALLOWED_EMAIL_DOMAINS` to the approved domains, for example:

```text
convertros.com
```

## 5. Final Checks

Run locally before shipping:

```bash
cd compassai/web
npm run typecheck
npm run build
npm audit
```

```bash
PYTHONPYCACHEPREFIX=/tmp/compassai_pycache python3 -m py_compile \
  compassai/api/app/main.py \
  compassai/api/app/security.py \
  compassai/api/tests/smoke.py \
  compassai/scripts/validate_env.py \
  compassai/scripts/deploy_smoke.py

COMPASSAI_DEV_AUTH=true COMPASSAI_JWT_SECRET=test-secret \
  COMPASSAI_DATA_DIR=/tmp/compassai-smoke \
  python3 compassai/api/tests/smoke.py
```

Check target env files before applying values:

```bash
python3 compassai/scripts/validate_env.py --target web --env-file compassai/web/.env.production
python3 compassai/scripts/validate_env.py --target api --env-file compassai/api/.env.production
```
