#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import sys
import time
import urllib.error
import urllib.request


REQUIRED_SCORECARDS = {"Feldco", "Bachmans", "KQR", "Pella", "RbA/QWD"}


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def sign_token(email: str, secret: str) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": email.lower().strip(),
        "email": email.lower().strip(),
        "name": "CompassAi Deploy Smoke",
        "iat": now,
        "exp": now + 900,
        "aud": "compassai-api",
        "iss": "compassai-web",
    }
    signing_input = ".".join(
        [
            b64url(json.dumps(header, separators=(",", ":")).encode("utf-8")),
            b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
        ]
    )
    signature = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{b64url(signature)}"


def get_json(url: str, token: str | None = None) -> dict:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{url} returned HTTP {exc.code}: {body}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test a deployed CompassAi API.")
    parser.add_argument("--api-url", required=True, help="Base API URL, for example https://compassai-api.onrender.com")
    parser.add_argument("--jwt-secret", required=True, help="Same COMPASSAI_JWT_SECRET configured in Render and Vercel")
    parser.add_argument("--email", default="deploy-smoke@convertros.com")
    args = parser.parse_args()

    api_url = args.api_url.rstrip("/")
    token = sign_token(args.email, args.jwt_secret)
    health = get_json(f"{api_url}/health")
    if not health.get("ok"):
        raise RuntimeError(f"Unexpected health response: {health}")

    scorecards = get_json(f"{api_url}/scorecards", token)
    names = {entry.get("name") for entry in scorecards.get("scorecards", [])}
    missing = sorted(REQUIRED_SCORECARDS - names)
    if missing:
        raise RuntimeError(f"Missing required scorecards: {', '.join(missing)}")
    if not scorecards.get("required_clients_available"):
        raise RuntimeError("API did not confirm required_clients_available=true.")

    system = get_json(f"{api_url}/system/status", token)
    if "quotas" not in system:
        raise RuntimeError("System status did not include quotas.")

    print(json.dumps({"ok": True, "health": health, "required_scorecards": sorted(REQUIRED_SCORECARDS), "quotas": system["quotas"]}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"CompassAi deploy smoke failed: {exc}", file=sys.stderr)
        sys.exit(1)
