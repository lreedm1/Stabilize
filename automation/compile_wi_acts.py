from __future__ import annotations

import concurrent.futures
import hashlib
import os
import re
import threading
import time
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

YEAR = 2025
ACTS = range(1, 248)
OUT = Path("Wisconsin_2025-2026_Enacted_Acts_Full_Text.txt")
EXPECTED_BILLS = set(os.environ["EXPECTED_BILLS"].split())
MAX_WORKERS = 2
REQUEST_SPACING_SECONDS = 0.8

_thread_local = threading.local()
_rate_lock = threading.Lock()
_last_request_started = 0.0


def session() -> requests.Session:
    current = getattr(_thread_local, "session", None)
    if current is not None:
        return current

    current = requests.Session()
    retry = Retry(
        total=10,
        connect=8,
        read=8,
        status=10,
        backoff_factor=2.0,
        status_forcelist=(408, 425, 429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        respect_retry_after_header=True,
    )
    current.mount(
        "https://",
        HTTPAdapter(max_retries=retry, pool_connections=MAX_WORKERS, pool_maxsize=MAX_WORKERS),
    )
    current.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (compatible; WisconsinActsCompiler/1.1; "
                "+https://github.com/lreedm1/Stabilize)"
            ),
            "Accept": "text/plain, text/markdown;q=0.9, */*;q=0.1",
        }
    )
    _thread_local.session = current
    return current


def pace_requests() -> None:
    global _last_request_started
    with _rate_lock:
        now = time.monotonic()
        delay = REQUEST_SPACING_SECONDS - (now - _last_request_started)
        if delay > 0:
            time.sleep(delay)
        _last_request_started = time.monotonic()


def official_url(act: int) -> str:
    return f"https://docs.legis.wisconsin.gov/document/acts/{YEAR}/{act}.pdf"


def reader_url(act: int) -> str:
    return f"https://r.jina.ai/{official_url(act)}"


def clean_reader_text(raw: str, act: int) -> tuple[str, int | None]:
    raw = raw.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    marker = "Markdown Content:"
    if marker not in raw:
        raise RuntimeError(f"Act {act}: Jina Reader response lacks '{marker}'")

    preamble, body = raw.split(marker, 1)
    page_match = re.search(r"^Number of Pages:\s*(\d+)\s*$", preamble, re.M | re.I)
    page_count = int(page_match.group(1)) if page_match else None

    if "captcha" in preamble.lower() or "captcha" in body[:1000].lower():
        raise RuntimeError(f"Act {act}: proxy returned a CAPTCHA/interstitial")

    body = body.strip()
    body = "\n".join(line.rstrip() for line in body.splitlines())
    body = re.sub(r"\n{4,}", "\n\n\n", body).strip()
    if len(body) < 500:
        raise RuntimeError(f"Act {act}: extracted text is unexpectedly short ({len(body)} chars)")
    return body, page_count


def fetch_act(act: int) -> dict[str, object]:
    source = official_url(act)
    proxy = reader_url(act)
    last_error: Exception | None = None

    for attempt in range(1, 9):
        try:
            pace_requests()
            response = session().get(proxy, timeout=(30, 300))
            response.raise_for_status()
            text, pages = clean_reader_text(response.text, act)

            act_match = re.search(r"2025\s+WISCONSIN\s+ACT\s+(\d+)", text[:50000], re.I)
            if not act_match or int(act_match.group(1)) != act:
                raise RuntimeError(f"Act {act}: act-number validation failed")

            bill_match = re.search(
                r"2025\s+(Assembly|Senate)\s+Bill\s+(\d+)",
                text[:50000],
                re.I,
            )
            if not bill_match:
                raise RuntimeError(f"Act {act}: originating bill not found")
            bill = (
                "AB" if bill_match.group(1).lower().startswith("assembly") else "SB"
            ) + bill_match.group(2)

            return {
                "act": act,
                "bill": bill,
                "text": text,
                "pages": pages,
                "source_url": source,
                "reader_url": proxy,
                "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            }
        except Exception as exc:
            last_error = exc
            if attempt < 8:
                time.sleep(min(90, attempt * 7))

    raise RuntimeError(f"Act {act}: unable to retrieve and validate text: {last_error}")


print("Retrieving the text of 247 official chaptered Wisconsin Acts through Jina Reader...")
records_by_act: dict[int, dict[str, object]] = {}
failures: list[str] = []

with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
    futures = {pool.submit(fetch_act, act): act for act in ACTS}
    for future in concurrent.futures.as_completed(futures):
        act = futures[future]
        try:
            record = future.result()
            records_by_act[act] = record
            print(
                f"retrieved Act {act} ({record['bill']}, "
                f"pages={record['pages'] if record['pages'] is not None else 'unknown'})",
                flush=True,
            )
        except Exception as exc:
            failures.append(str(exc))
            print(f"FAILED Act {act}: {exc}", flush=True)

if failures:
    raise SystemExit("Retrieval failures:\n" + "\n".join(sorted(failures)))

missing_acts = sorted(set(ACTS) - set(records_by_act))
if missing_acts:
    raise SystemExit(f"Missing Acts: {missing_acts}")

records = [records_by_act[act] for act in ACTS]
found_bills = {str(record["bill"]) for record in records}
missing_bills = sorted(EXPECTED_BILLS - found_bills)
extra_bills = sorted(found_bills - EXPECTED_BILLS)

if len(records) != 247 or len(found_bills) != 247 or missing_bills or extra_bills:
    raise SystemExit(
        "Bill-set validation failed. "
        f"records={len(records)} unique_bills={len(found_bills)} "
        f"missing={missing_bills} extra={extra_bills}"
    )

separator = "=" * 100
lines: list[str] = [
    "WISCONSIN 2025-2026 REGULAR SESSION — ENACTED BILL TEXT",
    "",
    "Scope: 2025 Wisconsin Acts 1-247 (247 enacted Assembly and Senate bills).",
    "Primary source: Official chaptered Act PDFs published by the Wisconsin Legislature.",
    "Retrieval: Official PDFs converted to plain text through Jina AI Reader.",
    "The chaptered text reflects the enacted law, including the partial vetoes of SB45, AB650, and AB1034.",
    "Plain-text conversion preserves the readable wording but not original typography, columns, pagination, or visual veto marks.",
    "The compilation was validated against the supplied 247-bill inventory.",
    "",
    "INDEX — ACT NUMBER TO ORIGINATING BILL",
    "",
]
lines.extend(f"2025 Wisconsin Act {record['act']} | {record['bill']}" for record in records)
lines.extend(["", separator, ""])

for record in records:
    pages = record["pages"] if record["pages"] is not None else "unknown"
    lines.extend(
        [
            separator,
            f"2025 WISCONSIN ACT {record['act']} — {record['bill']}",
            f"Official source: {record['source_url']}",
            f"Source PDF pages reported by extractor: {pages}",
            f"Extracted-text SHA-256: {record['text_sha256']}",
            separator,
            "",
            str(record["text"]),
            "",
            "",
        ]
    )

OUT.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
size = OUT.stat().st_size
print(f"Created {OUT} ({size:,} bytes)")
if size < 500_000:
    raise SystemExit("Output is unexpectedly small")
