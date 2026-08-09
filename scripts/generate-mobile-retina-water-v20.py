#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE_VIDEO = ROOT / "public/scenes/mobile-forest-stream-video-v14-retina-2160.mp4"
FALLBACK_ATLAS = ROOT / "public/scenes/mobile-forest-stream-water-sprite-v19-hd-1080.webp"
OUTPUT_DIR = ROOT / "public/scenes"

SOURCE_WIDTH = 2160
SOURCE_HEIGHT = 3840
RETINA_LEFT = 1360
RETINA_TOP = 1440
RETINA_WIDTH = 800
RETINA_HEIGHT = 2400
FRAME_COUNT = 30
FRAMES_PER_STRIP = 3
STRIP_COUNT = FRAME_COUNT // FRAMES_PER_STRIP
FALLBACK_FRAME_WIDTH = 400
FALLBACK_FRAME_HEIGHT = 1200
FALLBACK_COLUMNS = 6


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    for required in (SOURCE_VIDEO, FALLBACK_ATLAS):
        if not required.is_file():
            raise SystemExit(f"Missing required source asset: {required}")
    for command in ("ffmpeg", "ffprobe", "cwebp"):
        if shutil.which(command) is None:
            raise SystemExit(f"Missing required command: {command}")

    dimensions = subprocess.check_output(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=s=x:p=0",
            str(SOURCE_VIDEO),
        ],
        text=True,
    ).strip()
    if dimensions != f"{SOURCE_WIDTH}x{SOURCE_HEIGHT}":
        raise SystemExit(
            f"Unexpected Retina source dimensions: {dimensions}; "
            f"expected {SOURCE_WIDTH}x{SOURCE_HEIGHT}"
        )

    fallback = Image.open(FALLBACK_ATLAS).convert("RGBA")
    expected_fallback = (
        FALLBACK_FRAME_WIDTH * FALLBACK_COLUMNS,
        FALLBACK_FRAME_HEIGHT * 5,
    )
    if fallback.size != expected_fallback:
        raise SystemExit(
            f"Unexpected fallback atlas dimensions: {fallback.size}; "
            f"expected {expected_fallback}"
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for existing in OUTPUT_DIR.glob("mobile-forest-stream-water-strip-v20-retina-*.webp"):
        existing.unlink()

    with tempfile.TemporaryDirectory(prefix="stabilize-retina-water-v20-") as work:
        temporary = Path(work)
        frames_dir = temporary / "frames"
        frames_dir.mkdir()
        run(
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(SOURCE_VIDEO),
            "-vf",
            "fps=6",
            "-frames:v",
            str(FRAME_COUNT),
            str(frames_dir / "frame-%02d.png"),
        )
        frame_paths = sorted(frames_dir.glob("frame-*.png"))
        if len(frame_paths) != FRAME_COUNT:
            raise SystemExit(
                f"Expected {FRAME_COUNT} Retina source frames, found {len(frame_paths)}"
            )

        overlays: list[Image.Image] = []
        for index, frame_path in enumerate(frame_paths):
            source = Image.open(frame_path).convert("RGB")
            if source.size != (SOURCE_WIDTH, SOURCE_HEIGHT):
                raise SystemExit(
                    f"Unexpected frame dimensions for {frame_path.name}: {source.size}"
                )
            color = source.crop(
                (
                    RETINA_LEFT,
                    RETINA_TOP,
                    RETINA_LEFT + RETINA_WIDTH,
                    RETINA_TOP + RETINA_HEIGHT,
                )
            )
            fallback_column = index % FALLBACK_COLUMNS
            fallback_row = index // FALLBACK_COLUMNS
            alpha = fallback.crop(
                (
                    fallback_column * FALLBACK_FRAME_WIDTH,
                    fallback_row * FALLBACK_FRAME_HEIGHT,
                    (fallback_column + 1) * FALLBACK_FRAME_WIDTH,
                    (fallback_row + 1) * FALLBACK_FRAME_HEIGHT,
                )
            ).getchannel("A")
            alpha = alpha.resize(
                (RETINA_WIDTH, RETINA_HEIGHT),
                Image.Resampling.LANCZOS,
            )
            overlay = color.convert("RGBA")
            overlay.putalpha(alpha)
            overlays.append(overlay)

        for strip_index in range(STRIP_COUNT):
            strip = Image.new(
                "RGBA",
                (RETINA_WIDTH * FRAMES_PER_STRIP, RETINA_HEIGHT),
                (0, 0, 0, 0),
            )
            first = strip_index * FRAMES_PER_STRIP
            for local_index in range(FRAMES_PER_STRIP):
                strip.paste(
                    overlays[first + local_index],
                    (local_index * RETINA_WIDTH, 0),
                )

            png_path = temporary / f"strip-{strip_index + 1:02d}.png"
            output_path = OUTPUT_DIR / (
                f"mobile-forest-stream-water-strip-v20-retina-{strip_index + 1:02d}.webp"
            )
            strip.save(png_path, format="PNG", optimize=True)
            run(
                "cwebp",
                "-quiet",
                "-q",
                "92",
                "-alpha_q",
                "100",
                "-m",
                "6",
                "-mt",
                "-exact",
                str(png_path),
                "-o",
                str(output_path),
            )

            check = Image.open(output_path).convert("RGBA")
            expected = (RETINA_WIDTH * FRAMES_PER_STRIP, RETINA_HEIGHT)
            if check.size != expected:
                raise SystemExit(
                    f"Unexpected strip dimensions for {output_path.name}: "
                    f"{check.size}; expected {expected}"
                )
            if check.getchannel("A").getextrema() == (255, 255):
                raise SystemExit(f"Retina strip lost transparency: {output_path.name}")
            size = output_path.stat().st_size
            if not 100_000 < size < 12_000_000:
                raise SystemExit(
                    f"Suspicious Retina strip size for {output_path.name}: {size}"
                )
            print(
                f"Generated {output_path.relative_to(ROOT)}: "
                f"{expected[0]}x{expected[1]}, {size} bytes, sha256={sha256(output_path)}"
            )


if __name__ == "__main__":
    main()
