from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.request
from collections import Counter
from pathlib import Path

import pyarrow.parquet as pq

SNAPSHOT = "v2026.07"
SNAPSHOT_DATE = "2026-07-21"
URLS = (
    "https://huggingface.co/datasets/vaquill/open-us-law/resolve/main/us_wi_statutes.parquet?download=true",
    "https://oss-data-us.vaquill.ai/v2026.07/us_wi_statutes.parquet",
)


def clean(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple)):
        return " / ".join(part for item in value if (part := clean(item)))
    return str(value).replace("\r\n", "\n").replace("\r", "\n").strip()


def natural_key(value: object) -> tuple[object, ...]:
    text = clean(value).lower()
    return tuple(int(part) if part.isdigit() else part for part in re.split(r"(\d+)", text))


def download_parquet(destination: Path) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; Wisconsin-statutes-artifact-builder/1.0)",
        "Accept": "application/octet-stream,*/*;q=0.8",
    }
    last_error: Exception | None = None
    for url in URLS:
        for attempt in range(1, 4):
            try:
                request = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(request, timeout=180) as response, destination.open("wb") as target:
                    while block := response.read(1024 * 1024):
                        target.write(block)
                if destination.stat().st_size < 1_000_000:
                    raise RuntimeError(f"Downloaded file is unexpectedly small: {destination.stat().st_size} bytes")
                print(f"Downloaded {destination.stat().st_size:,} bytes from {url}")
                return url
            except Exception as exc:  # noqa: BLE001 - retries are intentional here.
                last_error = exc
                print(f"Attempt {attempt} failed for {url}: {exc}")
                time.sleep(3 * attempt)
    raise RuntimeError(f"All download sources failed: {last_error}")


def main(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = output_dir / "us_wi_statutes.parquet"
    text_path = output_dir / "Wisconsin_Statutes_Full_Substantive_Text_v2026.07.txt"
    manifest_path = output_dir / "Wisconsin_Statutes_Full_Substantive_Text_v2026.07_manifest.txt"
    sha_path = output_dir / "Wisconsin_Statutes_Full_Substantive_Text_v2026.07.sha256"

    downloaded_from = download_parquet(parquet_path)
    table = pq.read_table(parquet_path)
    rows = table.to_pylist()

    if len(rows) < 18_000:
        raise RuntimeError(f"Expected at least 18,000 Wisconsin records, got {len(rows):,}")
    state_values = {clean(row.get("state")).lower() for row in rows}
    if state_values - {"wi"}:
        raise RuntimeError(f"Unexpected state values: {sorted(state_values)}")

    indexed_rows = list(enumerate(rows))
    indexed_rows.sort(
        key=lambda pair: (
            natural_key(pair[1].get("chapter")),
            natural_key(pair[1].get("section_number")),
            natural_key(pair[1].get("citation")),
            pair[0],
        )
    )

    statuses = Counter(clean(row.get("act_status")) or "unspecified" for row in rows)
    chapters = sorted(
        {clean(row.get("chapter")) for row in rows if clean(row.get("chapter"))},
        key=natural_key,
    )
    nonempty_text = sum(bool(clean(row.get("text"))) for row in rows)
    total_words_reported = sum(int(row.get("word_count") or 0) for row in rows)
    parquet_sha = hashlib.sha256(parquet_path.read_bytes()).hexdigest()

    header = f"""WISCONSIN STATUTES — FULL SUBSTANTIVE TEXT
Snapshot: Open US Law {SNAPSHOT} ({SNAPSHOT_DATE})
Jurisdiction: Wisconsin (WI)
Records: {len(rows):,}
Nonempty text records: {nonempty_text:,}
Distinct chapter identifiers represented: {len(chapters):,}
Reported word count: {total_words_reported:,}

SCOPE AND RELIABILITY
=====================
This file contains the complete substantive text field for every Wisconsin statute
record in the Open US Law {SNAPSHOT} Wisconsin snapshot, including records marked
in force, repealed, reserved, transferred, renumbered, omitted, expired, or with
another source status. No record was intentionally omitted because of status.

This is a dated, third-party structured compilation, not the Wisconsin Legislative
Reference Bureau's certified electronic statutes. Statutory text is public domain;
the dataset's normalization and compilation are offered under CC BY 4.0. Verify any
quotation, deadline, offense, right, duty, or legal conclusion against the current
official Wisconsin Legislature source before relying on it.

Dataset: https://huggingface.co/datasets/vaquill/open-us-law
Official statutes: https://docs.legis.wisconsin.gov/statutes/statutes
Downloaded from: {downloaded_from}
Parquet SHA-256: {parquet_sha}

STATUS COUNTS
=============
"""

    with text_path.open("w", encoding="utf-8", newline="\n") as output:
        output.write(header)
        for status, count in sorted(statuses.items()):
            output.write(f"{status}: {count:,}\n")
        output.write("\nBEGIN FULL STATUTORY CORPUS\n")
        output.write("=" * 80 + "\n")

        current_chapter: str | None = None
        for sequence, (_source_index, row) in enumerate(indexed_rows, start=1):
            chapter = clean(row.get("chapter")) or "UNSPECIFIED"
            chapter_name = clean(row.get("chapter_name"))
            if chapter != current_chapter:
                current_chapter = chapter
                output.write("\n\n" + "#" * 80 + "\n")
                heading = f"CHAPTER {chapter}"
                if chapter_name:
                    heading += f" — {chapter_name}"
                output.write(heading + "\n")
                output.write("#" * 80 + "\n")

            citation = (
                clean(row.get("citation"))
                or clean(row.get("citation_short"))
                or clean(row.get("act_id"))
            )
            title = clean(row.get("section_title"))
            status = clean(row.get("act_status")) or "unspecified"
            source_url = clean(row.get("source_url"))
            breadcrumb = clean(row.get("breadcrumb")) or clean(row.get("display_path"))
            section_number = clean(row.get("section_number"))
            body = clean(row.get("text"))

            output.write("\n" + "-" * 80 + "\n")
            output.write(f"RECORD {sequence:,} OF {len(rows):,}\n")
            output.write(f"Citation: {citation}\n")
            if section_number:
                output.write(f"Section number: {section_number}\n")
            if title:
                output.write(f"Section title: {title}\n")
            output.write(f"Status: {status}\n")
            if breadcrumb:
                output.write(f"Path: {breadcrumb}\n")
            if source_url:
                output.write(f"Source: {source_url}\n")
            output.write("-" * 80 + "\n")
            output.write(body or "[NO SUBSTANTIVE TEXT PRESENT IN SOURCE RECORD]")
            output.write("\n")

        output.write("\n" + "=" * 80 + "\nEND FULL STATUTORY CORPUS\n")

    text_sha = hashlib.sha256(text_path.read_bytes()).hexdigest()
    sha_path.write_text(
        f"{text_sha}  {text_path.name}\n{parquet_sha}  {parquet_path.name}\n",
        encoding="utf-8",
    )

    report = {
        "artifact": text_path.name,
        "snapshot": SNAPSHOT,
        "snapshot_date": SNAPSHOT_DATE,
        "downloaded_from": downloaded_from,
        "source_dataset": "https://huggingface.co/datasets/vaquill/open-us-law",
        "official_verification_source": "https://docs.legis.wisconsin.gov/statutes/statutes",
        "record_count": len(rows),
        "nonempty_text_record_count": nonempty_text,
        "distinct_chapter_identifiers": len(chapters),
        "reported_word_count": total_words_reported,
        "status_counts": dict(sorted(statuses.items())),
        "parquet_bytes": parquet_path.stat().st_size,
        "text_bytes": text_path.stat().st_size,
        "parquet_sha256": parquet_sha,
        "text_sha256": text_sha,
        "columns": table.column_names,
    }
    manifest_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path("output"))
    args = parser.parse_args()
    main(args.output_dir)
