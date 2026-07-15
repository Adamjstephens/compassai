# CompassAi Deployment Checklist

Use this after the source builds locally. Do not commit real secrets.

## 1. Generate Auth Secret

```bash
cd compassai/web
npm run secrets
```

Set:

- `AUTH_SECRET` in Vercel only.

Render is not used. OpenAI keys are not configured in Vercel; each signed-in user pastes their own OpenAI API key in CompassAi Settings before processing recordings.

## 2. Vercel Web

Set the Vercel project root to `compassai/web`.

Required Vercel env vars:

- `AUTH_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ID`
- `AUTH_MICROSOFT_ENTRA_ID_SECRET`
- `AUTH_MICROSOFT_ENTRA_ID_ISSUER`
- `ALLOWED_EMAIL_DOMAINS`

## 3. Microsoft Entra App Registration

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

## 4. Final Checks

Run locally before shipping:

```bash
cd compassai/web
npm run typecheck
npm run build
npm audit
```

Check target env files before applying values:

```bash
python3 compassai/scripts/validate_env.py --target web --env-file compassai/web/.env.production
```
