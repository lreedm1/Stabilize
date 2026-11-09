#!/usr/bin/env python3
"""Manual, fail-closed API-only repair for the Stabilize Cloudflare Worker.

All credentials come from GitHub Actions secrets. Only fixed error codes,
HTTP statuses and version IDs may be printed. Never echo secret values.
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

OPENAI = "https://api.openai.com/v1"
CLOUDFLARE = "https://api.cloudflare.com/client/v4"
WORKER = "stabilize"


class SafeError(Exception):
    pass


def value(name):
    result = os.environ.get(name, "").strip()
    if not result:
        raise SafeError(f"Missing required workflow configuration: {name}")
    return result


def safe_code(value_):
    if not isinstance(value_, str) or not re.fullmatch(r"[A-Za-z0-9._:-]{1,80}", value_):
        return "unknown"
    return value_


def api(method, url, key, payload=None, org=None):
    headers = {"Authorization": "Bearer " + key, "Accept": "application/json"}
    if org:
        headers["OpenAI-Organization"] = org
    data = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(payload, separators=(",", ":")).encode()
    req = urllib.request.Request(url, headers=headers, data=data, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as response:
            data = response.read(1_000_000)
    except urllib.error.HTTPError as err:
        try:
            failure = json.loads(err.read(8192))
            detail = failure.get("error", {})
            code = detail.get("code") or detail.get("type")
        except (ValueError, AttributeError, UnicodeDecodeError):
            code = None
        raise SafeError(f"API HTTP {err.code}; code={safe_code(code)}") from None
    except (urllib.error.URLError, TimeoutError) as err:
        raise SafeError(f"API connection failed ({type(err).__name__})") from None
    try:
        result = json.loads(data)
    except (ValueError, UnicodeDecodeError):
        raise SafeError("API returned invalid JSON") from None
    if not isinstance(result, dict):
        raise SafeError("API returned unexpected JSON type")
    if result.get("success") is False:
        codes = [str(item.get("code")) for item in result.get("errors", [])
                 if isinstance(item, dict) and isinstance(item.get("code"), int)]
        raise SafeError("Cloudflare rejected request; codes=" + ",".join(codes[:3]))
    return result


def openai_headers_org(org):
    if not re.fullmatch(r"org[-_][A-Za-z0-9_-]{1,128}", org):
        raise SafeError("OPENAI_ORG_ID has an invalid format")


def validate_usage(org, admin_key):
    now = dt.datetime.now(dt.timezone.utc)
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    query = urllib.parse.urlencode({
        "start_time": int(midnight.timestamp()),
        "end_time": int((midnight + dt.timedelta(days=1)).timestamp()),
        "bucket_width": "1d", "limit": 1,
    })
    page = api("GET", OPENAI + "/organization/usage/completions?" + query,
               admin_key, org=org)
    if page.get("object") != "page" or not isinstance(page.get("data"), list):
        raise SafeError("OpenAI organization usage returned an unexpected shape")
    print("[OK] Organization usage admin key authenticated")


def validate_project_key(org, project_key):
    for model in ("gpt-5.4", "gpt-5.6-sol"):
        response = api("POST", OPENAI + "/responses/input_tokens", project_key,
                       {"model": model, "input": [{"role": "user", "content": "Hi"}]}, org=org)
        if response.get("object") != "response.input_tokens" or not isinstance(response.get("input_tokens"), int):
            raise SafeError("OpenAI project key counting returned unexpected response")
    print("[OK] Project API key authenticated for Stabilize's two configured models")


def validate_repo_budget():
    config = json.loads(Path("wrangler.jsonc").read_text())
    vars_ = config["vars"]
    if vars_.get("OPENAI_FREE_TOKENS_ONLY") != "true":
        raise SafeError("Repository free-token-only guard is not enabled")
    if vars_.get("OPENAI_FREE_TOKEN_DAILY_LIMIT") != "900000":
        raise SafeError("Repository token ceiling differs from the approved 900000 limit")
    if vars_.get("OPENAI_FREE_TOKEN_ELIGIBILITY_CONFIRMED") != "true":
        raise SafeError("Repository complimentary-token eligibility is not confirmed")
    print("[OK] Repository budget safeguards remain configured")


def parse_items(response, key):
    result = response.get("result")
    if isinstance(result, list):
        return result
    if isinstance(result, dict):
        for candidate in (key, "items"):
            if isinstance(result.get(candidate), list):
                return result[candidate]
    raise SafeError("Cloudflare returned an unexpected list format")


def cf_path(account_id):
    if not re.fullmatch(r"[a-fA-F0-9]{32}", account_id):
        raise SafeError("CF_ACCOUNT_ID must be 32 hexadecimal characters")
    return f"/accounts/{account_id}/workers/scripts/{WORKER}"


def cf_api(method, path, cf_key, payload=None):
    return api(method, CLOUDFLARE + path, cf_key, payload)


def version_ids(path, cf_key):
    entries = parse_items(cf_api("GET", path + "/versions", cf_key), "versions")
    ids = {v["id"] for v in entries if isinstance(v, dict) and isinstance(v.get("id"), str)}
    if not ids:
        raise SafeError("No Cloudflare Worker versions found")
    return ids


def validate_worker(path, cf_key):
    items = parse_items(cf_api("GET", path + "/secrets", cf_key), "secrets")
    names = {i.get("name") for i in items if isinstance(i, dict)}
    missing = {"OPENAI_API_KEY", "OPENAI_USAGE_ADMIN_KEY", "OPENAI_ORGANIZATION_ID"} - names
    if missing:
        print("[INFO] Secret entries absent and will be created:", ", ".join(sorted(missing)))
    print("[OK] Cloudflare Worker secret inventory accessible")


def create_service_key(org, project_id, provision_key):
    if not re.fullmatch(r"proj_[A-Za-z0-9_-]{1,128}", project_id):
        raise SafeError("OPENAI_PROJECT_ID has an invalid format")
    project = api("GET", OPENAI + "/organization/projects/" + project_id,
                  provision_key, org=org)
    if project.get("id") != project_id or project.get("status") == "archived":
        raise SafeError("OpenAI project not verified as active")
    response = api("POST", OPENAI + "/organization/projects/" + project_id + "/service_accounts",
                   provision_key, {"name": "stabilize-production"}, org=org)
    key = response.get("api_key")
    key = key.get("value") if isinstance(key, dict) else None
    if not isinstance(key, str) or not key.startswith("sk-"):
        raise SafeError("New service account returned no usable API key; investigate the new account")
    print("[OK] Issued project service-account key, held only in this job's memory")
    return key


def run_chat_probe():
    req = urllib.request.Request("https://stabilize.info/api/chat",
        method="POST", data=b'{"message":"Hi"}',
        headers={"Accept": "application/x-ndjson, application/json",
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=75) as response:
            data = response.read(1_000_000).decode("utf-8", "replace")
    except (urllib.error.URLError, TimeoutError) as err:
        raise SafeError("Live chat unavailable: " + type(err).__name__) from None
    try:
        events = [json.loads(line) for line in data.splitlines() if line.strip()]
    except ValueError:
        raise SafeError("Live chat did not return parseable NDJSON") from None
    for event in events:
        if not isinstance(event, dict):
            continue
        if event.get("type") == "error":
            diag = event.get("diagnostic") or {}
            if not isinstance(diag, dict):
                diag = {}
            raise SafeError("Live chat failed: " + safe_code(diag.get("code")) +
                            " / " + safe_code(diag.get("type")))
        if event.get("type") == "done" and isinstance(event.get("reply"), str) and event["reply"].strip():
            print("[OK] Live guest chat produced a complete AI reply")
            return
    raise SafeError("Live chat returned no completed AI reply")


def repair():
    if os.environ.get("REPAIR_CONFIRMATION") != "APPLY-STABILIZE-REPAIR":
        raise SafeError("Repair requires explicit workflow confirmation APPLY-STABILIZE-REPAIR")
    validate_repo_budget()
    org = value("OPENAI_ORG_ID")
    openai_headers_org(org)
    usage_key = value("OPENAI_USAGE_ADMIN_KEY")
    cf_key = value("CF_API_TOKEN")
    path = cf_path(value("CF_ACCOUNT_ID"))

    # Verify both upstream systems before creating any identity or writing secrets.
    validate_usage(org, usage_key)
    validate_worker(path, cf_key)
    before = version_ids(path, cf_key)

    rotate = os.environ.get("REPAIR_CREATE_SERVICE_ACCOUNT", "").lower() == "true"
    if rotate:
        provision_key = value("OPENAI_PROVISION_ADMIN_KEY")
        project_id = value("OPENAI_PROJECT_ID")
        # Creating service accounts in the OpenAI Default project may be disallowed.
        project_key = create_service_key(org, project_id, provision_key)
    else:
        project_key = value("OPENAI_PROJECT_API_KEY")
    validate_project_key(org, project_key)

    # One atomic version preserves all unrelated bindings/secrets.
    secrets = {name: {"name": name, "type": "secret_text", "text": content}
               for name, content in {
                   "OPENAI_ORGANIZATION_ID": org,
                   "OPENAI_USAGE_ADMIN_KEY": usage_key,
                   "OPENAI_API_KEY": project_key,
               }.items()}
    cf_api("PATCH", path + "/secrets-bulk", cf_key, {"secrets": secrets})
    print("[OK] Cloudflare accepted credential patch; no token budget variables modified")

    after = version_ids(path, cf_key)
    created = after - before
    if len(created) != 1:
        raise SafeError("Credential patch completed, but unable to safely identify one new version; manual deployment required")
    new_version = next(iter(created))
    cf_api("POST", path + "/deployments", cf_key, {
        "strategy": "percentage", "versions": [{"version_id": new_version, "percentage": 100}]
    })
    print("[OK] Cloudflare accepted new Worker deployment")
    for _ in range(5):
        deployments = parse_items(cf_api("GET", path + "/deployments?per_page=1", cf_key),
                                  "deployments")
        if deployments and any(
            isinstance(v, dict) and v.get("version_id") == new_version
            and v.get("percentage") == 100
            for v in deployments[0].get("versions", [])
        ):
            break
        time.sleep(2)
    else:
        raise SafeError("Deployment not verified at 100%; inspect Cloudflare deployment history")
    print("[OK] Verified new version serving 100% of traffic")
    run_chat_probe()


def self_test():
    assert safe_code("budget_organization_credentials") == "budget_organization_credentials"
    assert safe_code("Bearer sk-secret or chat text") == "unknown"
    assert re.fullmatch(r"org[-_][A-Za-z0-9_-]{1,128}", "org-example")
    print("[OK] Local self-test: safe diagnostics and organization-ID validation")


def main():
    if "--self-test" in sys.argv:
        self_test()
        return
    mode = os.environ.get("REPAIR_MODE", "diagnose")
    if mode == "diagnose":
        run_chat_probe()
    elif mode == "repair":
        repair()
    else:
        raise SafeError("Unknown repair mode")


if __name__ == "__main__":
    try:
        main()
    except SafeError as error:
        print("[STOP]", str(error), file=sys.stderr)
        sys.exit(1)
