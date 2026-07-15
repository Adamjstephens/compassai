#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path


WEB_REQUIRED = [
    "AUTH_SECRET",
    "AUTH_MICROSOFT_ENTRA_ID_ID",
    "AUTH_MICROSOFT_ENTRA_ID_SECRET",
    "AUTH_MICROSOFT_ENTRA_ID_ISSUER",
    "ALLOWED_EMAIL_DOMAINS",
]

API_REQUIRED = [
    "COMPASSAI_JWT_SECRET",
    "ALLOWED_ORIGINS",
    "MAX_FILE_MB",
    "MAX_DAILY_AUDIO_MINUTES_PER_USER",
    "MAX_CONCURRENT_JOBS_PER_USER",
    "RATE_LIMIT_PER_MINUTE",
]

PLACEHOLDERS = (
    "replace-with",
    "<tenant-id>",
    "sk-placeholder",
    "same-secret-as-vercel",
    "http://127.0.0.1",
    "http://localhost",
)


def read_env(path: Path | None) -> dict[str, str]:
    values = dict(os.environ)
    if not path:
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def is_placeholder(value: str) -> bool:
    lowered = value.lower()
    return any(marker in lowered for marker in PLACEHOLDERS)


def validate(target: str, values: dict[str, str]) -> list[str]:
    required = WEB_REQUIRED if target == "web" else API_REQUIRED
    errors: list[str] = []
    for key in required:
        value = values.get(key, "").strip()
        if not value:
            errors.append(f"{key} is missing.")
        elif is_placeholder(value):
            errors.append(f"{key} still looks like a placeholder.")

    if target == "web":
        issuer = values.get("AUTH_MICROSOFT_ENTRA_ID_ISSUER", "")
        if issuer and not re.match(r"^https://login\.microsoftonline\.com/.+/v2\.0/?$", issuer):
            errors.append("AUTH_MICROSOFT_ENTRA_ID_ISSUER should look like https://login.microsoftonline.com/<tenant-id>/v2.0")

    if target == "api":
        database_url = values.get("DATABASE_URL", "")
        if database_url and not database_url.startswith(("postgres://", "postgresql://")):
            errors.append("DATABASE_URL should be a Postgres connection string when provided.")
        for key in ["MAX_FILE_MB", "MAX_DAILY_AUDIO_MINUTES_PER_USER", "MAX_CONCURRENT_JOBS_PER_USER", "RATE_LIMIT_PER_MINUTE"]:
            value = values.get(key, "")
            if value and (not value.isdigit() or int(value) <= 0):
                errors.append(f"{key} must be a positive integer.")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate CompassAi deployment environment variables.")
    parser.add_argument("--target", choices=["web", "api"], required=True)
    parser.add_argument("--env-file", type=Path)
    args = parser.parse_args()
    values = read_env(args.env_file)
    errors = validate(args.target, values)
    if errors:
        print(f"CompassAi {args.target} env validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print(f"CompassAi {args.target} env validation passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
