#!/usr/bin/env python3
"""Generate a fixed-camera animated WebP of a woodland trail and spring."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps


def soft_mask(mask: np.ndarray, radius: float) -> np.ndarray:
    image = Image.fromarray(np.uint8(np.clip(mask, 0, 1) * 255), "L")
    image = image.filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(image, dtype=np.float32) / 255.0


def remap(image: np.ndarray, map_x: np.ndarray, map_y: np.ndarray) -> np.ndarray:
    """Bilinear remapping implemented with NumPy to keep CI dependencies small."""
    height, width = image.shape[:2]
    x0 = np.floor(map_x).astype(np.int32)
    y0 = np.floor(map_y).astype(np.int32)
    x1 = np.clip(x0 + 1, 0, width - 1)
    y1 = np.clip(y0 + 1, 0, height - 1)
    x0 = np.clip(x0, 0, width - 1)
    y0 = np.clip(y0, 0, height - 1)

    wx = (map_x - x0)[..., None]
    wy = (map_y - y0)[..., None]
    top = image[y0, x0] * (1 - wx) + image[y0, x1] * wx
    bottom = image[y1, x0] * (1 - wx) + image[y1, x1] * wx
    return top * (1 - wy) + bottom * wy


def generate(source: Path, loop_path: Path, still_path: Path) -> None:
    original = ImageOps.exif_transpose(Image.open(source)).convert("RGB")
    base_image = ImageOps.fit(
        original,
        (540, 960),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    base = np.asarray(base_image, dtype=np.float32)
    height, width = base.shape[:2]

    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    x = xx / (width - 1)
    y = yy / (height - 1)
    red, green, blue = base[..., 0], base[..., 1], base[..., 2]

    # Concentrate flowing motion along the small spring on the right.
    spring_center = 0.76 - 0.06 * (1 - y)
    spring_width = 0.18 + 0.08 * y
    spring = np.exp(-((x - spring_center) ** 2) / (2 * spring_width**2))
    spring *= np.clip((y - 0.34) / 0.24, 0, 1)
    spring *= np.clip((x - 0.47) / 0.25, 0, 1)
    water = np.clip((blue + red - 1.2 * green + 85) / 135, 0, 1)
    whitewater = np.clip((red + green + blue - 525) / 180, 0, 1)
    spring *= np.clip(0.35 + 0.65 * np.maximum(water, whitewater), 0, 1)

    # Move green canopy and stream-bank plants while keeping trunks and trail steady.
    foliage_color = np.clip((green - np.maximum(red, blue) - 2) / 58, 0, 1)
    foliage_region = np.clip((0.88 - y) / 0.78, 0, 1)
    foliage_region += (
        0.55
        * np.clip((x - 0.38) / 0.62, 0, 1)
        * np.clip((y - 0.30) / 0.62, 0, 1)
    )
    foliage = np.clip(foliage_color * foliage_region, 0, 1)
    path = np.exp(
        -((x - (0.29 + 0.04 * y)) ** 2)
        / (2 * (0.18 + 0.05 * y) ** 2)
    ) * np.clip((y - 0.32) / 0.68, 0, 1)
    foliage *= 1 - 0.92 * path
    foliage *= np.clip((green - 34) / 95, 0, 1)

    spring = soft_mask(spring, 12)
    foliage = soft_mask(foliage, 9)

    frames: list[Image.Image] = []
    frame_count = 16
    for index in range(frame_count):
        phase = 2 * math.pi * index / frame_count

        spring_dx = (
            2.2 * np.sin(yy / 18 + phase * 2)
            + 1.0 * np.sin(yy / 41 - phase)
        ) * spring
        spring_dy = (
            3.2 * np.sin(xx / 28 - phase * 2)
            + 1.0 * np.sin((xx + yy) / 49 + phase)
        ) * spring

        breeze = 1.7 * np.sin(phase) + 0.65 * np.sin(
            2 * phase + xx / 125
        )
        leaf_dx = breeze * foliage * (0.55 + 0.45 * (1 - y))
        leaf_dy = 0.5 * np.cos(phase + xx / 90) * foliage

        map_x = np.clip(xx + spring_dx + leaf_dx, 0, width - 1)
        map_y = np.clip(yy + spring_dy + leaf_dy, 0, height - 1)
        warped = remap(base, map_x, map_y)

        glint = (
            0.5
            + 0.5 * np.sin(xx / 16 + yy / 12 - phase * 2)
        ) * spring
        leaf_light = (
            0.5
            + 0.5 * np.sin(xx / 45 + yy / 30 + phase)
        ) * foliage
        warped += (7.5 * glint + 2.2 * leaf_light)[..., None]
        frames.append(
            Image.fromarray(np.uint8(np.clip(warped, 0, 255)), "RGB")
        )

    loop_path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(still_path, "WEBP", quality=88, method=6)
    frames[0].save(
        loop_path,
        "WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=190,
        loop=0,
        quality=78,
        method=4,
        minimize_size=True,
    )

    with Image.open(loop_path) as check:
        if check.size != (540, 960) or getattr(check, "n_frames", 1) != frame_count:
            raise RuntimeError("Generated animated WebP failed validation")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("loop", type=Path)
    parser.add_argument("still", type=Path)
    arguments = parser.parse_args()
    generate(arguments.source, arguments.loop, arguments.still)
