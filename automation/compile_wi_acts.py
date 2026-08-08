from __future__ import annotations

import concurrent.futures
import hashlib
import os
import re
import subprocess
import time
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

YEAR = 2025
ACTS = range(1, 248)
OUT = Path("Wisconsin_2025-2026_Enacted_Acts_Full_Text.txt")
PDF_DIR = Path("_wi_act_pdfs")
PDF_DIR.mkdir(exist_ok=True)
expected_bills = set(os.environ["EXPECTED_BILLS"].split())


def session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=8,
        connect=8,
        read=8,
        status=8,
        backoff_factor=1.5,
        status_forcelist=(408, 425, 429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        respect_retry_after_header=True,
    )
    s.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=8))
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (compatible; WisconsinActsCompiler/1.0; +https://github.com/lreedm1/Stabilize)"
    })
    return s


def download(act: int) -> tuple[int, Path, str]:
    url = f"https://docs.legis.wisconsin.gov/document/acts/{YEAR}/{act}.pdf"
    path = PDF_DIR / f"act_{act:03d}.pdf"
    s = session()
    last_error: Exception | None = None
    for attempt in range(1, 7):
        try:
            with s.get(url, timeout=(30, 240), stream=True) as response:
                response.raise_for_status()
                h = hashlib.sha256()
                total = 0
                with path.open("wb") as f:
                    for chunk in response.iter_content(1024 * 1024):
                        if not chunk:
                            continue
                        f.write(chunk)
                        h.update(chunk)
                        total += len(chunk)
            head = path.read_bytes()[:5]
            if head != b"%PDF-" or total < 500:
                raise RuntimeError(f"Act {act} did not return a valid PDF ({total} bytes)")
            return act, path, h.hexdigest()
        except Exception as exc:
            last_error = exc
            path.unlink(missing_ok=True)
            if attempt < 6:
                time.sleep(min(45, attempt * 5))
    raise RuntimeError(f"Unable to download Act {act} from {url}: {last_error}")


print("Downloading 247 official chaptered Act PDFs...")
downloads: dict[int, tuple[Path, str]] = {}
failures: list[str] = []
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    futures = {pool.submit(download, act): act for act in ACTS}
    for future in concurrent.futures.as_completed(futures):
        act = futures[future]
        try:
            got_act, path, digest = future.result()
            downloads[got_act] = (path, digest)
            print(f"downloaded Act {got_act}")
        except Exception as exc:
            failures.append(str(exc))
            print(f"FAILED Act {act}: {exc}")

if failures:
    raise SystemExit("Download failures:\n" + "\n".join(failures))
if set(downloads) != set(ACTS):
    missing = sorted(set(ACTS) - set(downloads))
    raise SystemExit(f"Missing Act PDFs: {missing}")

records: list[dict[str, object]] = []
for act in ACTS:
    pdf, digest = downloads[act]
    proc = subprocess.run(
        ["pdftotext", "-enc", "UTF-8", "-nopgbrk", str(pdf), "-"],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    text = proc.stdout.decode("utf-8", errors="replace")
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    text = "\n".join(line.rstrip() for line in text.splitlines())
    text = re.sub(r"\n{4,}", "\n\n\n", text).strip()

    act_match = re.search(r"2025\s+WISCONSIN\s+ACT\s+(\d+)", text[:20000], re.I)
    if not act_match or int(act_match.group(1)) != act:
        raise SystemExit(f"Act-number validation failed for Act {act}")

    bill_match = re.search(r"2025\s+(Assembly|Senate)\s+Bill\s+(\d+)", text[:20000], re.I)
    if not bill_match:
        raise SystemExit(f"Originating bill not found in Act {act}")
    bill = ("AB" if bill_match.group(1).lower().startswith("assembly") else "SB") + bill_match.group(2)
    records.append({
        "act": act,
        "bill": bill,
        "text": text,
        "url": f"https://docs.legis.wisconsin.gov/document/acts/{YEAR}/{act}.pdf",
        "sha256": digest,
    })

found_bills = {str(r["bill"]) for r in records}
missing_bills = sorted(expected_bills - found_bills)
extra_bills = sorted(found_bills - expected_bills)
if len(records) != 247 or len(found_bills) != 247 or missing_bills or extra_bills:
    raise SystemExit(
        "Bill-set validation failed. "
        f"records={len(records)} unique_bills={len(found_bills)} "
        f"missing={missing_bills} extra={extra_bills}"
    )

sep = "=" * 100
lines: list[str] = [
    "WISCONSIN 2025-2026 REGULAR SESSION — ENACTED BILL TEXT",
    "",
    "Scope: 2025 Wisconsin Acts 1-247 (247 enacted Assembly and Senate bills).",
    "Source: Official chaptered Act PDFs published by the Wisconsin Legislature.",
    "The text therefore reflects the enacted law, including the partial vetoes of SB45, AB650, and AB1034.",
    "Plain-text conversion preserves the words but not the original PDF typography, columns, or pagination.",
    "Generated by automated extraction and validated against the supplied 247-bill inventory.",
    "",
    "INDEX — ACT NUMBER TO ORIGINATING BILL",
    "",
]
lines.extend(f"2025 Wisconsin Act {r['act']} | {r['bill']}" for r in records)
lines.extend(["", sep, ""])

for r in records:
    act = r["act"]
    bill = r["bill"]
    lines.extend([
        sep,
        f"2025 WISCONSIN ACT {act} — {bill}",
        f"Official source: {r['url']}",
        f"Source PDF SHA-256: {r['sha256']}",
        sep,
        "",
        str(r["text"]),
        "",
        "",
    ])

OUT.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
size = OUT.stat().st_size
print(f"Created {OUT} ({size:,} bytes)")
if size < 100_000:
    raise SystemExit("Output is unexpectedly small")
