from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

os.environ.setdefault("COMPASSAI_DEV_AUTH", "true")
os.environ.setdefault("COMPASSAI_JWT_SECRET", "test-secret")
os.environ.setdefault("COMPASSAI_DATA_DIR", "/tmp/compassai-smoke")

from compassai.api.app.main import app  # noqa: E402


client = TestClient(app)


def test_health_and_scorecards() -> None:
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["ok"] is True

    scorecards = client.get("/scorecards")
    assert scorecards.status_code == 200
    payload = scorecards.json()
    names = {entry["name"] for entry in payload["scorecards"]}
    assert {"Feldco", "Bachmans", "KQR", "Pella", "RbA/QWD"}.issubset(names)
    assert payload["required_clients_available"] is True


def test_mirror_parse_empty_html() -> None:
    response = client.post("/mirrorcxt/parse", json={"html_text": "<html><body>No leads</body></html>"})
    assert response.status_code == 200
    assert "leads" in response.json()


def test_jobs_require_user_openai_key() -> None:
    response = client.post(
        "/jobs",
        data={"language": "en"},
        files={"files": ("sample.wav", b"not-a-real-wave", "audio/wav")},
    )
    assert response.status_code == 400
    assert "OpenAI API key" in response.text


def test_export_css_contract_source() -> None:
    source = (ROOT / "app.py").read_text(encoding="utf-8")
    assert "25B8" not in source
    assert "overflow-wrap: anywhere" not in source
    assert "word-break: break-all" not in source
    assert "transcript-search" in source
    assert "free-customer-alert" in source


if __name__ == "__main__":
    test_health_and_scorecards()
    test_mirror_parse_empty_html()
    test_jobs_require_user_openai_key()
    test_export_css_contract_source()
    print(json.dumps({"ok": True, "tests": 4}))
