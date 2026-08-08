#!/usr/bin/env python3
"""Temporary builder for official Wisconsin 2025 Acts 1-247."""
from __future__ import annotations
import concurrent.futures
import hashlib
from pathlib import Path
import re
import subprocess
import time

EXPECTED_BILLS = ['AB2', 'AB19', 'AB35', 'AB45', 'AB61', 'AB65', 'AB74', 'AB75', 'AB78', 'AB80', 'AB86', 'AB89', 'AB94', 'AB95', 'AB96', 'AB99', 'AB102', 'AB127', 'AB129', 'AB130', 'AB132', 'AB136', 'AB141', 'AB147', 'AB152', 'AB153', 'AB159', 'AB164', 'AB170', 'AB179', 'AB196', 'AB200', 'AB205', 'AB207', 'AB211', 'AB212', 'AB217', 'AB218', 'AB231', 'AB247', 'AB250', 'AB257', 'AB265', 'AB266', 'AB274', 'AB275', 'AB277', 'AB288', 'AB299', 'AB301', 'AB302', 'AB303', 'AB305', 'AB306', 'AB307', 'AB309', 'AB312', 'AB323', 'AB336', 'AB337', 'AB338', 'AB347', 'AB348', 'AB358', 'AB360', 'AB363', 'AB364', 'AB377', 'AB380', 'AB382', 'AB384', 'AB385', 'AB386', 'AB389', 'AB393', 'AB398', 'AB406', 'AB420', 'AB429', 'AB430', 'AB435', 'AB438', 'AB439', 'AB447', 'AB449', 'AB456', 'AB457', 'AB463', 'AB482', 'AB483', 'AB507', 'AB521', 'AB525', 'AB529', 'AB532', 'AB536', 'AB537', 'AB557', 'AB558', 'AB562', 'AB568', 'AB575', 'AB579', 'AB598', 'AB601', 'AB625', 'AB626', 'AB642', 'AB650', 'AB651', 'AB662', 'AB665', 'AB677', 'AB682', 'AB690', 'AB698', 'AB705', 'AB717', 'AB761', 'AB770', 'AB777', 'AB782', 'AB799', 'AB814', 'AB815', 'AB816', 'AB856', 'AB863', 'AB874', 'AB894', 'AB927', 'AB950', 'AB957', 'AB958', 'AB1034', 'AB1058', 'SB5', 'SB14', 'SB15', 'SB25', 'SB34', 'SB45', 'SB47', 'SB52', 'SB58', 'SB59', 'SB66', 'SB68', 'SB74', 'SB80', 'SB91', 'SB94', 'SB97', 'SB123', 'SB139', 'SB140', 'SB141', 'SB142', 'SB143', 'SB152', 'SB166', 'SB168', 'SB174', 'SB180', 'SB190', 'SB191', 'SB196', 'SB203', 'SB207', 'SB211', 'SB212', 'SB214', 'SB226', 'SB229', 'SB234', 'SB235', 'SB245', 'SB246', 'SB262', 'SB270', 'SB277', 'SB278', 'SB282', 'SB283', 'SB307', 'SB311', 'SB314', 'SB321', 'SB338', 'SB361', 'SB371', 'SB373', 'SB381', 'SB386', 'SB397', 'SB403', 'SB408', 'SB419', 'SB421', 'SB433', 'SB434', 'SB435', 'SB436', 'SB437', 'SB439', 'SB446', 'SB448', 'SB452', 'SB453', 'SB476', 'SB512', 'SB515', 'SB517', 'SB520', 'SB521', 'SB526', 'SB531', 'SB533', 'SB537', 'SB556', 'SB575', 'SB576', 'SB593', 'SB620', 'SB673', 'SB678', 'SB692', 'SB748', 'SB782', 'SB783', 'SB785', 'SB787', 'SB798', 'SB810', 'SB814', 'SB822', 'SB825', 'SB832', 'SB884', 'SB898', 'SB920', 'SB921']
ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / ".tmp_wi_acts"
PDF_DIR = WORK / "pdf"
TXT_DIR = WORK / "txt"
OUT_DIR = ROOT / "generated"
OUT = OUT_DIR / "Wisconsin_2025-2026_Enacted_Bill_Text.txt"

PDF_URLS = [
    "https://docs.legis.wisconsin.gov/document/acts/2025/{act}.pdf",
    "https://docs.legis.wisconsin.gov/2025/related/acts/{act}.pdf",
]

def download_one(act: int) -> tuple[int, Path]:
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    path = PDF_DIR / f"act_{act:03d}.pdf"
    if path.exists() and path.read_bytes()[:4] == b"%PDF":
        return act, path
    tmp = path.with_suffix(".part")
    for url_pattern in PDF_URLS:
        url = url_pattern.format(act=act)
        for attempt in range(5):
            tmp.unlink(missing_ok=True)
            cmd = [
                "curl", "-fL", "--silent", "--show-error",
                "--connect-timeout", "20", "--max-time", "180",
                "--retry", "3", "--retry-delay", "2",
                "-A", "Mozilla/5.0 (compatible; WisconsinActsCompiler/1.0)",
                "-o", str(tmp), url,
            ]
            p = subprocess.run(cmd, text=True, capture_output=True)
            if p.returncode == 0 and tmp.exists() and tmp.stat().st_size > 1000:
                if tmp.read_bytes()[:4] == b"%PDF":
                    tmp.replace(path)
                    return act, path
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Could not download official PDF for Act {act}")

def extract_one(item: tuple[int, Path]) -> tuple[int, Path, str]:
    act, pdf = item
    TXT_DIR.mkdir(parents=True, exist_ok=True)
    txt = TXT_DIR / f"act_{act:03d}.txt"
    p = subprocess.run(["pdftotext", "-layout", str(pdf), str(txt)], text=True, capture_output=True)
    if p.returncode != 0 or not txt.exists() or txt.stat().st_size < 100:
        raise RuntimeError(f"pdftotext failed for Act {act}: {p.stderr}")
    raw = txt.read_text(encoding="utf-8", errors="replace")
    if not re.search(rf"2025\s+WISCONSIN\s+ACT\s+{act}\b", raw, re.I):
        raise RuntimeError(f"Act marker missing from extracted Act {act}")
    patterns = [
        r"2025\s+(Assembly|Senate)\s+Bill\s+(\d+)",
        r"(Assembly|Senate)\s+Bill\s+(\d+)",
    ]
    found = None
    for pat in patterns:
        m = re.search(pat, raw, re.I)
        if m:
            found = ("AB" if m.group(1).lower().startswith("assembly") else "SB") + m.group(2)
            break
    if not found:
        raise RuntimeError(f"Source bill not found in Act {act}")
    return act, txt, found

def normalize_text(raw: str) -> str:
    raw = raw.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    raw = "\n".join(line.rstrip() for line in raw.splitlines())
    raw = re.sub(r"\n{4,}", "\n\n\n", raw)
    return raw.strip() + "\n"

def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    print("Downloading 247 official Wisconsin Act PDFs...", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        downloaded = list(ex.map(download_one, range(1, 248)))
    print("Extracting text...", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        records = list(ex.map(extract_one, downloaded))
    records.sort()
    act_numbers = [a for a, _, _ in records]
    bill_ids = [b for _, _, b in records]
    if act_numbers != list(range(1, 248)):
        raise RuntimeError("Act sequence is incomplete")
    expected = set(EXPECTED_BILLS)
    actual = set(bill_ids)
    if len(bill_ids) != 247 or len(actual) != 247 or actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        dups = sorted({b for b in bill_ids if bill_ids.count(b) > 1})
        raise RuntimeError(f"Bill validation failed. missing={missing} extra={extra} duplicates={dups}")

    parts = [
        "WISCONSIN 2025-2026 REGULAR SESSION",
        "FINAL ENACTED BILL / ACT TEXT",
        "2025 Wisconsin Acts 1-247",
        "",
        "This compilation contains the full text of every chaptered act from the",
        "2025-2026 Wisconsin regular session, arranged by Act number. The chaptered",
        "act is used rather than an earlier bill draft, so partial vetoes are reflected.",
        "",
        "Official source collection: https://docs.legis.wisconsin.gov/2025/related/acts",
        "",
    ]
    for act, txt_path, bill in records:
        chamber = "Assembly Bill " + bill[2:] if bill.startswith("AB") else "Senate Bill " + bill[2:]
        sep = "=" * 100
        parts.extend([
            sep,
            f"2025 WISCONSIN ACT {act} — 2025 {chamber}",
            f"Bill: {bill}",
            f"Official source: https://docs.legis.wisconsin.gov/2025/related/acts/{act}",
            f"Official PDF: https://docs.legis.wisconsin.gov/document/acts/2025/{act}.pdf",
            sep,
            "",
            normalize_text(txt_path.read_text(encoding="utf-8", errors="replace")).rstrip(),
            "",
            "",
        ])
    content = "\n".join(parts).rstrip() + "\n"
    OUT.write_text(content, encoding="utf-8")

    check = OUT.read_text(encoding="utf-8")
    headers = re.findall(r"^2025 WISCONSIN ACT (\d+) — 2025 (Assembly|Senate) Bill (\d+)$", check, re.M)
    if len(headers) != 247 or [int(h[0]) for h in headers] != list(range(1, 248)):
        raise RuntimeError("Final compilation header validation failed")
    if OUT.stat().st_size < 1_000_000:
        raise RuntimeError(f"Final compilation unexpectedly small: {OUT.stat().st_size} bytes")
    print(f"WROTE {OUT} ({OUT.stat().st_size:,} bytes)")
    print("SHA256", hashlib.sha256(OUT.read_bytes()).hexdigest())
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
