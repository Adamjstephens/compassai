from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import threading
import time
from typing import Any, Optional

from fastapi import Header, HTTPException

RATE_LOCK = threading.Lock()
RATE_BUCKETS: dict[str, list[float]] = {}
RATE_LIMIT_PER_MINUTE = int(os.environ.get("RATE_LIMIT_PER_MINUTE", "120"))


def _check_rate_limit(email: str) -> None:
    now = time.time()
    window_start = now - 60
    key = email.lower().strip() or "anonymous"
    with RATE_LOCK:
        recent = [stamp for stamp in RATE_BUCKETS.get(key, []) if stamp >= window_start]
        if len(recent) >= RATE_LIMIT_PER_MINUTE:
            RATE_BUCKETS[key] = recent
            raise HTTPException(status_code=429, detail="CompassAi request rate limit exceeded. Please wait a minute and try again.")
        recent.append(now)
        RATE_BUCKETS[key] = recent


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode((value + padding).encode("ascii"))


def _b64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def sign_api_token(email: str, name: str = "", expires_in_seconds: int = 900) -> str:
    secret = os.environ.get("COMPASSAI_JWT_SECRET", "")
    if not secret:
        raise RuntimeError("COMPASSAI_JWT_SECRET is required to sign CompassAi API tokens.")
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": email.lower().strip(),
        "email": email.lower().strip(),
        "name": name.strip(),
        "iat": now,
        "exp": now + max(60, expires_in_seconds),
        "aud": "compassai-api",
        "iss": "compassai-web",
    }
    signing_input = ".".join(
        [
            _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
            _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
        ]
    )
    signature = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return f"{signing_input}.{_b64url_encode(signature)}"


def verify_api_token(token: str) -> dict[str, Any]:
    secret = os.environ.get("COMPASSAI_JWT_SECRET", "")
    if not secret:
        raise HTTPException(status_code=500, detail="COMPASSAI_JWT_SECRET is not configured.")
    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".", 2)
        signing_input = f"{encoded_header}.{encoded_payload}"
        expected = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
        actual = _b64url_decode(encoded_signature)
        if not hmac.compare_digest(expected, actual):
            raise ValueError("signature mismatch")
        payload = json.loads(_b64url_decode(encoded_payload).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid CompassAi API token.") from exc

    if payload.get("aud") != "compassai-api" or payload.get("iss") != "compassai-web":
        raise HTTPException(status_code=401, detail="Invalid CompassAi API token audience.")
    if int(payload.get("exp") or 0) < int(time.time()):
        raise HTTPException(status_code=401, detail="CompassAi API token expired.")
    email = str(payload.get("email") or payload.get("sub") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=401, detail="CompassAi API token is missing an email.")
    return {**payload, "email": email}


def require_user(authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    if os.environ.get("COMPASSAI_DEV_AUTH", "").lower() in {"1", "true", "yes"}:
        user = {"email": os.environ.get("COMPASSAI_DEV_EMAIL", "dev@convertros.com"), "name": "CompassAi Dev"}
        _check_rate_limit(user["email"])
        return user
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing CompassAi API bearer token.")
    user = verify_api_token(authorization.split(" ", 1)[1].strip())
    _check_rate_limit(user["email"])
    return user


def redact_secret(value: str) -> str:
    value = value or ""
    if len(value) <= 8:
        return "<redacted>"
    return f"{value[:3]}...{value[-4:]}"
