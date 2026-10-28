"""Vertex AI generateContent with the service-account key in secrets/gcp_key.json (gitignored; never print it).

The token is refreshed when it expires. Retries 5xx and network errors; on 429 (quota) waits Retry-After, else 20 s
doubling.
"""
import json, threading, time

import google.auth.transport.requests
import requests
from google.oauth2 import service_account

from paths import GCP_KEY

LOCATION = 'global'   # gemini-3.8-flash-tts is served from the global endpoint only (us-central1: 404)

_creds = None
_lock = threading.Lock()


def _token() -> str:
    global _creds
    with _lock:
        if _creds is None:
            if not GCP_KEY.exists():
                raise SystemExit(f'Vertex AI key missing: {GCP_KEY}')
            _creds = service_account.Credentials.from_service_account_file(
                str(GCP_KEY), scopes=['https://www.googleapis.com/auth/cloud-platform'])
        if not _creds.valid:
            _creds.refresh(google.auth.transport.requests.Request())
        return _creds.token


def project() -> str:
    return json.loads(GCP_KEY.read_text(encoding='utf-8'))['project_id']


def generate(model: str, body: dict, timeout: int = 1200) -> dict:
    url = (f'https://aiplatform.googleapis.com/v1/projects/{project()}/locations/{LOCATION}'
           f'/publishers/google/models/{model}:generateContent')
    for attempt in range(7):
        try:
            r = requests.post(url, headers={'Authorization': f'Bearer {_token()}'}, json=body, timeout=timeout)
        except requests.RequestException as e:
            if attempt == 6:
                raise
            print('retry', attempt, repr(e)[:120], flush=True)
            time.sleep(2 + 4 * attempt)
            continue
        if r.status_code == 200:
            return r.json()
        if (r.status_code < 500 and r.status_code != 429) or attempt == 6:
            raise SystemExit(f'Vertex AI {r.status_code}: {r.text[:600]}')
        wait = float(r.headers.get('Retry-After') or 0) or (20 * 2 ** attempt if r.status_code == 429 else 2 + 4 * attempt)
        print(f'retry {attempt} after {min(wait, 300):.0f}s: {r.status_code} {r.text[:120]}', flush=True)
        time.sleep(min(wait, 300))
    raise AssertionError
